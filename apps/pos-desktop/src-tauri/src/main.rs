#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const KEYRING_SERVICE: &str = "MelqardPOSDesktop";

#[derive(Default)]
struct AgentsState {
  official: Option<Child>,
  unofficial: Option<Child>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AgentConfig {
  api_base_url: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  company_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  device_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  device_token: Option<String>,
}

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
  app
    .path()
    .app_data_dir()
    .expect("failed to resolve app data dir")
}

fn ensure_parent_dir(path: &Path) -> std::io::Result<()> {
  if let Some(p) = path.parent() {
    fs::create_dir_all(p)?;
  }
  Ok(())
}

fn is_port_available(port: u16) -> bool {
  std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn http_status_for_local_path(port: u16, path: &str, origin: Option<&str>) -> Option<u16> {
  let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
    Ok(v) => v, Err(_) => return None,
  };
  let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(350)) {
    Ok(v) => v, Err(_) => return None,
  };
  let _ = stream.set_read_timeout(Some(Duration::from_millis(350)));
  let _ = stream.set_write_timeout(Some(Duration::from_millis(350)));
  let mut req = format!(
    "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n",
    if path.trim().is_empty() { "/" } else { path.trim() }
  );
  if let Some(o) = origin {
    if !o.trim().is_empty() {
      req.push_str(&format!("Origin: {}\r\n", o.trim()));
    }
  }
  req.push_str("\r\n");
  if stream.write_all(req.as_bytes()).is_err() {
    return None;
  }
  let mut buf = [0u8; 256];
  let n = match stream.read(&mut buf) {
    Ok(v) => v, Err(_) => return None,
  };
  if n == 0 {
    return None;
  }
  let head = String::from_utf8_lossy(&buf[..n]);
  let mut it = head.lines();
  let first = it.next().unwrap_or("");
  let parts: Vec<&str> = first.split_whitespace().collect();
  if parts.len() < 2 {
    return None;
  }
  parts[1].parse::<u16>().ok()
}

fn is_agent_health_ok(port: u16) -> bool {
  matches!(http_status_for_local_path(port, "/api/health", None), Some(200))
}

fn is_agent_tauri_compatible(port: u16) -> bool {
  // Simulate the desktop webview origin. Old/manual agents may reject this with 403.
  matches!(
    http_status_for_local_path(port, "/api/health", Some("tauri://localhost")),
    Some(200)
  )
}

fn patch_config(
  path: &Path,
  edge_url: &str,
  company_id: Option<&str>,
  device_id: Option<&str>,
  device_token: Option<&str>,
) -> std::io::Result<()> {
  ensure_parent_dir(path)?;
  if path.exists() {
    // Keep existing config, but patch fields when provided.
    let raw = fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string());
    let mut v: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
    v["api_base_url"] = serde_json::Value::String(edge_url.to_string());
    if let Some(x) = company_id.and_then(|s| if s.trim().is_empty() { None } else { Some(s.trim()) }) {
      v["company_id"] = serde_json::Value::String(x.to_string());
    }
    if let Some(x) = device_id.and_then(|s| if s.trim().is_empty() { None } else { Some(s.trim()) }) {
      v["device_id"] = serde_json::Value::String(x.to_string());
    }
    if let Some(x) = device_token.and_then(|s| if s.trim().is_empty() { None } else { Some(s.trim()) }) {
      v["device_token"] = serde_json::Value::String(x.to_string());
    }
    fs::write(path, serde_json::to_string_pretty(&v).unwrap())?;
    return Ok(());
  }

  let cfg = serde_json::to_string_pretty(&AgentConfig {
    api_base_url: edge_url.to_string(),
    company_id: company_id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
    device_id: device_id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
    device_token: device_token.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
  })
  .unwrap();
  fs::write(path, cfg)?;
  Ok(())
}

fn find_sidecar_exe(app: &tauri::AppHandle) -> Option<PathBuf> {
  // For distribution, we recommend bundling `pos-agent` as a resource/sidecar.
  // We look for it in common locations:
  // - resource dir root (manual copy)
  // - resource dir `bin/` (convention)
  let res = app.path().resource_dir().ok()?;
  let candidates = [
    res.join("pos-agent"),
    res.join("pos-agent.exe"),
    res.join("bin").join("pos-agent"),
    res.join("bin").join("pos-agent.exe"),
  ];
  candidates.into_iter().find(|c| c.exists())
}

fn spawn_agent(
  app: &tauri::AppHandle,
  port: u16,
  config_path: &Path,
  db_path: &Path,
  log_path: &Path,
) -> std::io::Result<Child> {
  let sidecar = find_sidecar_exe(app).ok_or_else(|| {
    std::io::Error::new(
      std::io::ErrorKind::NotFound,
      "pos-agent sidecar not found (bundle it for production builds)",
    )
  })?;

  ensure_parent_dir(log_path)?;
  let log = OpenOptions::new()
    .create(true)
    .append(true)
    .open(log_path)?;
  let log_err = log.try_clone()?;

  let mut cmd = Command::new(sidecar);
  cmd.arg("--host")
    .arg("127.0.0.1")
    .arg("--port")
    .arg(port.to_string())
    .arg("--config")
    .arg(config_path.to_string_lossy().to_string())
    .arg("--db")
    .arg(db_path.to_string_lossy().to_string());

  // Always write logs to disk so setup failures are debuggable for operators.
  cmd.stdin(Stdio::null())
    .stdout(Stdio::from(log))
    .stderr(Stdio::from(log_err));
  cmd.spawn()
}

fn init_db_with_sidecar(app: &tauri::AppHandle, config_path: &Path, db_path: &Path) -> Result<(), String> {
  let sidecar = find_sidecar_exe(app)
    .ok_or_else(|| "pos-agent sidecar not found (bundle it for production builds)".to_string())?;
  let out = Command::new(sidecar)
    .arg("--init-db")
    .arg("--config")
    .arg(config_path.to_string_lossy().to_string())
    .arg("--db")
    .arg(db_path.to_string_lossy().to_string())
    .output()
    .map_err(|e| e.to_string())?;

  if out.status.success() {
    return Ok(());
  }

  let mut msg = String::new();
  msg.push_str("init-db failed.\n");
  if !out.stdout.is_empty() {
    msg.push_str(&String::from_utf8_lossy(&out.stdout));
  }
  if !out.stderr.is_empty() {
    msg.push_str("\n");
    msg.push_str(&String::from_utf8_lossy(&out.stderr));
  }
  Err(msg.trim().to_string())
}

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
  let k = key.trim();
  if k.is_empty() || k.len() > 120 {
    return Err("invalid key".to_string());
  }
  keyring::Entry::new(KEYRING_SERVICE, k).map_err(|e| e.to_string())
}

#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
  let entry = keyring_entry(&key)?;
  match entry.get_password() {
    Ok(v) => Ok(Some(v)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
fn secure_set(key: String, value: String) -> Result<(), String> {
  let entry = keyring_entry(&key)?;
  entry.set_password(value.trim_end()).map_err(|e| e.to_string())
}

#[tauri::command]
fn secure_delete(key: String) -> Result<(), String> {
  let entry = keyring_entry(&key)?;
  match entry.delete_credential() {
    Ok(_) => Ok(()),
    Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn start_agents(
  app: tauri::AppHandle,
  state: tauri::State<'_, Mutex<AgentsState>>,
  edge_url: String,
  port_official: u16,
  port_unofficial: u16,
  company_official: Option<String>,
  company_unofficial: Option<String>,
  device_id_official: Option<String>,
  device_token_official: Option<String>,
  device_id_unofficial: Option<String>,
  device_token_unofficial: Option<String>,
) -> Result<(), String> {
  let edge = edge_url.trim().trim_end_matches('/').to_string();
  if edge.is_empty() {
    return Err("edge_url is empty".to_string());
  }

  let data = app_data_dir(&app);
  let official_cfg = data.join("official").join("config.json");
  let unofficial_cfg = data.join("unofficial").join("config.json");
  let official_db = data.join("official").join("pos.sqlite");
  let unofficial_db = data.join("unofficial").join("pos.sqlite");
  let logs_dir = data.join("logs");
  let official_log = logs_dir.join("official.log");
  let unofficial_log = logs_dir.join("unofficial.log");

  let official_busy = !is_port_available(port_official);
  let unofficial_busy = !is_port_available(port_unofficial);

  if official_busy && !is_agent_health_ok(port_official) {
    return Err(format!("port {port_official} is already in use on this machine"));
  }
  if official_busy && !is_agent_tauri_compatible(port_official) {
    return Err(format!(
      "port {port_official} is occupied by an older/manual POS agent that blocks desktop access (tauri origin). Stop external pos-desktop/agent.py and retry."
    ));
  }
  if unofficial_busy && !is_agent_health_ok(port_unofficial) {
    return Err(format!("port {port_unofficial} is already in use on this machine"));
  }
  if unofficial_busy && !is_agent_tauri_compatible(port_unofficial) {
    return Err(format!(
      "port {port_unofficial} is occupied by an older/manual POS agent that blocks desktop access (tauri origin). Stop external pos-desktop/agent.py and retry."
    ));
  }

  patch_config(
    &official_cfg,
    &edge,
    company_official.as_deref(),
    device_id_official.as_deref(),
    device_token_official.as_deref(),
  )
  .map_err(|e| e.to_string())?;
  patch_config(
    &unofficial_cfg,
    &edge,
    company_unofficial.as_deref(),
    device_id_unofficial.as_deref(),
    device_token_unofficial.as_deref(),
  )
  .map_err(|e| e.to_string())?;

  // Preflight DB init to surface schema errors deterministically.
  init_db_with_sidecar(&app, &official_cfg, &official_db)
    .map_err(|e| format!("Official agent DB init failed: {e}"))?;
  init_db_with_sidecar(&app, &unofficial_cfg, &unofficial_db)
    .map_err(|e| format!("Unofficial agent DB init failed: {e}"))?;

  let mut st = state.lock().unwrap();
  if st.official.is_none() && !official_busy {
    let child = spawn_agent(&app, port_official, &official_cfg, &official_db, &official_log)
      .map_err(|e| e.to_string())?;
    st.official = Some(child);
  }
  if st.unofficial.is_none() && !unofficial_busy {
    let child = spawn_agent(&app, port_unofficial, &unofficial_cfg, &unofficial_db, &unofficial_log)
      .map_err(|e| e.to_string())?;
    st.unofficial = Some(child);
  }

  // If a child exits immediately, return log tail to make failures actionable.
  std::thread::sleep(std::time::Duration::from_millis(250));
  if let Some(c) = st.official.as_mut() {
    if let Ok(Some(status)) = c.try_wait() {
      let tail = tail_file(&official_log, 120_000, 80);
      return Err(format!("Official agent exited ({status}).\n{tail}").trim().to_string());
    }
  }
  if let Some(c) = st.unofficial.as_mut() {
    if let Ok(Some(status)) = c.try_wait() {
      let tail = tail_file(&unofficial_log, 120_000, 80);
      return Err(format!("Unofficial agent exited ({status}).\n{tail}").trim().to_string());
    }
  }

  Ok(())
}

#[tauri::command]
fn start_setup_agent(
  app: tauri::AppHandle,
  state: tauri::State<'_, Mutex<AgentsState>>,
  edge_url: String,
  port_official: u16,
  company_official: Option<String>,
  device_id_official: Option<String>,
  device_token_official: Option<String>,
) -> Result<(), String> {
  let edge = edge_url.trim().trim_end_matches('/').to_string();
  if edge.is_empty() {
    return Err("edge_url is empty".to_string());
  }

  let data = app_data_dir(&app);
  let official_cfg = data.join("official").join("config.json");
  let official_db = data.join("official").join("pos.sqlite");
  let logs_dir = data.join("logs");
  let official_log = logs_dir.join("official.log");

  let official_busy = !is_port_available(port_official);
  if official_busy && !is_agent_health_ok(port_official) {
    return Err(format!("port {port_official} is already in use on this machine"));
  }
  if official_busy && !is_agent_tauri_compatible(port_official) {
    return Err(format!(
      "port {port_official} is occupied by an older/manual POS agent that blocks desktop access (tauri origin). Stop external pos-desktop/agent.py and retry."
    ));
  }

  patch_config(
    &official_cfg,
    &edge,
    company_official.as_deref(),
    device_id_official.as_deref(),
    device_token_official.as_deref(),
  )
  .map_err(|e| e.to_string())?;

  init_db_with_sidecar(&app, &official_cfg, &official_db)
    .map_err(|e| format!("Official agent DB init failed: {e}"))?;

  let mut st = state.lock().unwrap();
  if st.official.is_none() && !official_busy {
    let child = spawn_agent(&app, port_official, &official_cfg, &official_db, &official_log)
      .map_err(|e| e.to_string())?;
    st.official = Some(child);
  }

  std::thread::sleep(std::time::Duration::from_millis(250));
  if let Some(c) = st.official.as_mut() {
    if let Ok(Some(status)) = c.try_wait() {
      let tail = tail_file(&official_log, 120_000, 80);
      return Err(format!("Official agent exited ({status}).\n{tail}").trim().to_string());
    }
  }

  Ok(())
}

#[tauri::command]
fn stop_agents(state: tauri::State<'_, Mutex<AgentsState>>) -> Result<(), String> {
  let mut st = state.lock().unwrap();
  if let Some(mut c) = st.official.take() {
    let _ = c.kill();
  }
  if let Some(mut c) = st.unofficial.take() {
    let _ = c.kill();
  }
  Ok(())
}

fn tail_file(path: &Path, max_bytes: usize, max_lines: usize) -> String {
  let mut f = match fs::File::open(path) {
    Ok(v) => v,
    Err(_) => return String::new(),
  };
  let mut buf = Vec::new();
  if f.read_to_end(&mut buf).is_err() {
    return String::new();
  }
  if max_bytes > 0 && buf.len() > max_bytes {
    buf = buf.split_off(buf.len() - max_bytes);
  }
  let text = String::from_utf8_lossy(&buf).to_string();
  if max_lines == 0 {
    return text;
  }
  let mut lines: Vec<&str> = text.lines().collect();
  if lines.len() > max_lines {
    lines = lines.split_off(lines.len() - max_lines);
  }
  lines.join("\n")
}

fn desktop_log_path(app: &tauri::AppHandle) -> PathBuf {
  app_data_dir(app).join("logs").join("desktop-ui.log")
}

fn append_desktop_log(app: &tauri::AppHandle, level: &str, message: &str, stack: Option<&str>) -> Result<(), String> {
  let path = desktop_log_path(app);
  ensure_parent_dir(&path).map_err(|e| e.to_string())?;
  let mut f = OpenOptions::new()
    .create(true)
    .append(true)
    .open(&path)
    .map_err(|e| e.to_string())?;
  let ts = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  let mut line = format!("[{}][{}] {}", ts, level, message.trim());
  if let Some(s) = stack {
    let st = s.trim();
    if !st.is_empty() {
      line.push_str("\n");
      line.push_str(st);
    }
  }
  line.push_str("\n");
  f.write_all(line.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn tail_agent_logs(app: tauri::AppHandle, max_lines: Option<usize>) -> Result<serde_json::Value, String> {
  let data = app_data_dir(&app);
  let logs_dir = data.join("logs");
  let official_log = logs_dir.join("official.log");
  let unofficial_log = logs_dir.join("unofficial.log");
  let n = max_lines.unwrap_or(120).min(600);
  Ok(serde_json::json!({
    "official": tail_file(&official_log, 200_000, n),
    "unofficial": tail_file(&unofficial_log, 200_000, n),
  }))
}

#[tauri::command]
fn frontend_log(
  app: tauri::AppHandle,
  level: String,
  message: String,
  stack: Option<String>,
) -> Result<(), String> {
  let lvl = {
    let x = level.trim().to_lowercase();
    if x.is_empty() { "info".to_string() } else { x }
  };
  append_desktop_log(&app, &lvl, &message, stack.as_deref())
}

#[tauri::command]
fn tail_desktop_log(app: tauri::AppHandle, max_lines: Option<usize>) -> Result<String, String> {
  let n = max_lines.unwrap_or(200).min(1000);
  let p = desktop_log_path(&app);
  Ok(tail_file(&p, 500_000, n))
}

#[tauri::command]
fn app_version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(Mutex::new(AgentsState::default()))
    .invoke_handler(tauri::generate_handler![
      start_agents,
      start_setup_agent,
      stop_agents,
      tail_agent_logs,
      frontend_log,
      tail_desktop_log,
      secure_get,
      secure_set,
      secure_delete,
      app_version
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
