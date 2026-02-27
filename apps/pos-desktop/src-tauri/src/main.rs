#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[derive(Clone, Debug)]
struct AgentRuntime {
  port: u16,
  config_path: PathBuf,
  db_path: PathBuf,
  log_path: PathBuf,
}

#[derive(Default)]
struct AgentsState {
  official: Option<Child>,
  unofficial: Option<Child>,
  official_spec: Option<AgentRuntime>,
  unofficial_spec: Option<AgentRuntime>,
  watchdog_started: bool,
}

impl Drop for AgentsState {
  fn drop(&mut self) {
    if let Some(mut c) = self.official.take() {
      let _ = c.kill();
    }
    if let Some(mut c) = self.unofficial.take() {
      let _ = c.kill();
    }
  }
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .app_data_dir()
    .map_err(|e| format!("failed to resolve app data dir: {e}"))
}

fn ensure_parent_dir(path: &Path) -> std::io::Result<()> {
  if let Some(p) = path.parent() {
    fs::create_dir_all(p)?;
  }
  Ok(())
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(|e| {
    eprintln!("[warn] mutex poisoned, recovering: {e}");
    e.into_inner()
  })
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
  matches!(
    http_status_for_local_path(port, "/api/health", Some("tauri://localhost")),
    Some(200)
  )
}

/// Create a minimal config.json if it does not already exist.
/// The agent manages its own config via Express Setup in the web UI.
fn ensure_config_exists(path: &Path) -> std::io::Result<()> {
  ensure_parent_dir(path)?;
  if path.exists() {
    return Ok(());
  }
  let cfg = serde_json::json!({
    "api_base_url": "http://localhost:7070",
    "cloud_api_base_url": "",
    "company_id": "",
    "device_id": "",
    "device_token": ""
  });
  let json_str = serde_json::to_string_pretty(&cfg)
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
  fs::write(path, json_str)?;
  Ok(())
}

fn find_sidecar_exe(app: &tauri::AppHandle) -> Option<PathBuf> {
  let res = app.path().resource_dir().ok()?;
  let candidates = if cfg!(target_os = "windows") {
    vec![
      res.join("pos-agent.exe"),
      res.join("bin").join("pos-agent.exe"),
    ]
  } else {
    vec![
      res.join("pos-agent"),
      res.join("bin").join("pos-agent"),
    ]
  };
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

  cmd.stdin(Stdio::null())
    .stdout(Stdio::from(log))
    .stderr(Stdio::from(log_err));

  #[cfg(target_os = "windows")]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
  }

  cmd.spawn()
}

fn spawn_agent_from_spec(app: &tauri::AppHandle, spec: &AgentRuntime) -> std::io::Result<Child> {
  spawn_agent(app, spec.port, &spec.config_path, &spec.db_path, &spec.log_path)
}

fn ensure_watchdog_running(app: &tauri::AppHandle) {
  let should_start = {
    let state: tauri::State<'_, Mutex<AgentsState>> = app.state();
    let mut st = lock_or_recover(&state);
    if st.watchdog_started {
      false
    } else {
      st.watchdog_started = true;
      true
    }
  };
  if !should_start {
    return;
  }

  let app_handle = app.clone();
  std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_secs(2));

    let mut restart_official: Option<AgentRuntime> = None;
    let mut restart_unofficial: Option<AgentRuntime> = None;
    {
      let state: tauri::State<'_, Mutex<AgentsState>> = app_handle.state();
      let mut st = lock_or_recover(&state);

      if let Some(child) = st.official.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_))) {
          st.official = None;
        }
      }
      if let Some(child) = st.unofficial.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_))) {
          st.unofficial = None;
        }
      }

      if st.official.is_none() {
        if let Some(spec) = st.official_spec.clone() {
          if is_port_available(spec.port) {
            restart_official = Some(spec);
          }
        }
      }
      if st.unofficial.is_none() {
        if let Some(spec) = st.unofficial_spec.clone() {
          if is_port_available(spec.port) {
            restart_unofficial = Some(spec);
          }
        }
      }
    }

    if let Some(spec) = restart_official {
      match spawn_agent_from_spec(&app_handle, &spec) {
        Ok(child) => {
          let state: tauri::State<'_, Mutex<AgentsState>> = app_handle.state();
          let mut st = lock_or_recover(&state);
          if st.official.is_none() {
            st.official = Some(child);
            let _ = append_desktop_log(
              &app_handle,
              "warn",
              &format!("watchdog restarted primary agent on port {}", spec.port),
              None,
            );
          }
        }
        Err(e) => {
          let _ = append_desktop_log(
            &app_handle,
            "error",
            &format!("watchdog failed to restart primary agent: {}", e),
            None,
          );
        }
      }
    }

    if let Some(spec) = restart_unofficial {
      match spawn_agent_from_spec(&app_handle, &spec) {
        Ok(child) => {
          let state: tauri::State<'_, Mutex<AgentsState>> = app_handle.state();
          let mut st = lock_or_recover(&state);
          if st.unofficial.is_none() {
            st.unofficial = Some(child);
            let _ = append_desktop_log(
              &app_handle,
              "warn",
              &format!("watchdog restarted secondary agent on port {}", spec.port),
              None,
            );
          }
        }
        Err(e) => {
          let _ = append_desktop_log(
            &app_handle,
            "error",
            &format!("watchdog failed to restart secondary agent: {}", e),
            None,
          );
        }
      }
    }
  });
}

fn init_db_with_sidecar(app: &tauri::AppHandle, config_path: &Path, db_path: &Path) -> Result<(), String> {
  let sidecar = find_sidecar_exe(app)
    .ok_or_else(|| "pos-agent sidecar not found (bundle it for production builds)".to_string())?;
  let mut cmd = Command::new(sidecar);
  cmd.arg("--init-db")
    .arg("--config")
    .arg(config_path.to_string_lossy().to_string())
    .arg("--db")
    .arg(db_path.to_string_lossy().to_string());

  #[cfg(target_os = "windows")]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
  }

  let out = cmd.output().map_err(|e| e.to_string())?;

  if out.status.success() {
    return Ok(());
  }

  let mut msg = String::new();
  msg.push_str("init-db failed.\n");
  if !out.stdout.is_empty() {
    msg.push_str(&String::from_utf8_lossy(&out.stdout));
  }
  if !out.stderr.is_empty() {
    msg.push('\n');
    msg.push_str(&String::from_utf8_lossy(&out.stderr));
  }
  Err(msg.trim().to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn start_agents(
  app: tauri::AppHandle,
  state: tauri::State<'_, Mutex<AgentsState>>,
  port_official: u16,
  port_unofficial: u16,
) -> Result<(), String> {
  if port_official == port_unofficial {
    return Err("primary and secondary ports must be different".to_string());
  }

  let data = app_data_dir(&app)?;
  let official_cfg = data.join("official").join("config.json");
  let unofficial_cfg = data.join("unofficial").join("config.json");
  let official_db = data.join("official").join("pos.sqlite");
  let unofficial_db = data.join("unofficial").join("pos.sqlite");
  let logs_dir = data.join("logs");
  let official_log = logs_dir.join("official.log");
  let unofficial_log = logs_dir.join("unofficial.log");
  let official_spec = AgentRuntime {
    port: port_official,
    config_path: official_cfg.clone(),
    db_path: official_db.clone(),
    log_path: official_log.clone(),
  };
  let unofficial_spec = AgentRuntime {
    port: port_unofficial,
    config_path: unofficial_cfg.clone(),
    db_path: unofficial_db.clone(),
    log_path: unofficial_log.clone(),
  };

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

  // Ensure minimal config files exist. The agent manages its own config via its web UI.
  ensure_config_exists(&official_cfg).map_err(|e| e.to_string())?;
  ensure_config_exists(&unofficial_cfg).map_err(|e| e.to_string())?;

  // Preflight DB init only for agents we actually need to spawn.
  if !official_busy {
    init_db_with_sidecar(&app, &official_cfg, &official_db)
      .map_err(|e| format!("Primary agent DB init failed: {e}"))?;
  }
  if !unofficial_busy {
    init_db_with_sidecar(&app, &unofficial_cfg, &unofficial_db)
      .map_err(|e| format!("Secondary agent DB init failed: {e}"))?;
  }

  let mut st = lock_or_recover(&state);
  st.official_spec = Some(official_spec);
  st.unofficial_spec = Some(unofficial_spec);
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
      return Err(format!("Primary agent exited ({status}).\n{tail}").trim().to_string());
    }
  }
  if let Some(c) = st.unofficial.as_mut() {
    if let Ok(Some(status)) = c.try_wait() {
      let tail = tail_file(&unofficial_log, 120_000, 80);
      return Err(format!("Secondary agent exited ({status}).\n{tail}").trim().to_string());
    }
  }

  drop(st);
  ensure_watchdog_running(&app);
  Ok(())
}

#[tauri::command]
fn stop_agents(state: tauri::State<'_, Mutex<AgentsState>>) -> Result<(), String> {
  let mut st = lock_or_recover(&state);
  if let Some(mut c) = st.official.take() {
    let _ = c.kill();
  }
  if let Some(mut c) = st.unofficial.take() {
    let _ = c.kill();
  }
  st.official_spec = None;
  st.unofficial_spec = None;
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

fn desktop_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  Ok(app_data_dir(app)?.join("logs").join("desktop-ui.log"))
}

fn append_desktop_log(app: &tauri::AppHandle, level: &str, message: &str, stack: Option<&str>) -> Result<(), String> {
  let path = desktop_log_path(app)?;
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
      line.push('\n');
      line.push_str(st);
    }
  }
  line.push('\n');
  f.write_all(line.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn tail_agent_logs(app: tauri::AppHandle, max_lines: Option<usize>) -> Result<serde_json::Value, String> {
  let data = app_data_dir(&app)?;
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
  let p = desktop_log_path(&app)?;
  Ok(tail_file(&p, 500_000, n))
}

#[tauri::command]
fn suggest_port_pair(start_official: u16, start_unofficial: u16, max_attempts: Option<u16>) -> Result<serde_json::Value, String> {
  let mut off = if start_official < 1024 { 7070 } else { start_official };
  let mut un = if start_unofficial < 1024 { 7072 } else { start_unofficial };
  if off == un {
    un = un.saturating_add(2);
  }
  let attempts = max_attempts.unwrap_or(24).clamp(1, 200);
  for i in 0..attempts {
    if i > 0 {
      off = off.saturating_add(2);
      un = un.saturating_add(2);
    }
    if off == un {
      break;
    }
    if is_port_available(off) && is_port_available(un) {
      return Ok(serde_json::json!({
        "port_official": off,
        "port_unofficial": un,
      }));
    }
  }
  Err("No free port pair found near configured ports.".to_string())
}

#[tauri::command]
fn app_version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(w) = app.get_webview_window("main") {
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
  app.request_restart();
  Ok(())
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      // Focus the existing window when a second instance is launched.
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
      }
    }))
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(Mutex::new(AgentsState::default()))
    .invoke_handler(tauri::generate_handler![
      start_agents,
      stop_agents,
      tail_agent_logs,
      frontend_log,
      tail_desktop_log,
      suggest_port_pair,
      app_version,
      show_main_window,
      restart_app
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
