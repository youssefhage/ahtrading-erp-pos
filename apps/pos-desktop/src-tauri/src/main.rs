#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

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
) -> std::io::Result<Child> {
  let sidecar = find_sidecar_exe(app).ok_or_else(|| {
    std::io::Error::new(
      std::io::ErrorKind::NotFound,
      "pos-agent sidecar not found (bundle it for production builds)",
    )
  })?;

  let mut cmd = Command::new(sidecar);
  cmd.arg("--host")
    .arg("127.0.0.1")
    .arg("--port")
    .arg(port.to_string())
    .arg("--config")
    .arg(config_path.to_string_lossy().to_string())
    .arg("--db")
    .arg(db_path.to_string_lossy().to_string());

  // Keep logs available via OS process tools. (We can pipe later if we want a UI console.)
  cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
  cmd.spawn()
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

  let mut st = state.lock().unwrap();
  if st.official.is_none() {
    let child = spawn_agent(&app, port_official, &official_cfg, &official_db).map_err(|e| e.to_string())?;
    st.official = Some(child);
  }
  if st.unofficial.is_none() {
    let child = spawn_agent(&app, port_unofficial, &unofficial_cfg, &unofficial_db).map_err(|e| e.to_string())?;
    st.unofficial = Some(child);
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

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(Mutex::new(AgentsState::default()))
    .invoke_handler(tauri::generate_handler![start_agents, stop_agents])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
