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

fn write_min_config(path: &Path, edge_url: &str) -> std::io::Result<()> {
  ensure_parent_dir(path)?;
  if path.exists() {
    // Keep existing config (may include device tokens etc). Only patch api_base_url if missing.
    let raw = fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string());
    let mut v: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
    if v.get("api_base_url").and_then(|x| x.as_str()).unwrap_or("").trim().is_empty() {
      v["api_base_url"] = serde_json::Value::String(edge_url.to_string());
      fs::write(path, serde_json::to_string_pretty(&v).unwrap())?;
    }
    return Ok(());
  }

  let cfg = serde_json::to_string_pretty(&AgentConfig {
    api_base_url: edge_url.to_string(),
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
  for c in candidates {
    if c.exists() {
      return Some(c);
    }
  }
  None
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
fn start_agents(
  app: tauri::AppHandle,
  state: tauri::State<'_, Mutex<AgentsState>>,
  edge_url: String,
  port_official: u16,
  port_unofficial: u16,
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

  write_min_config(&official_cfg, &edge).map_err(|e| e.to_string())?;
  write_min_config(&unofficial_cfg, &edge).map_err(|e| e.to_string())?;

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
  for child in [&mut st.official, &mut st.unofficial] {
    if let Some(c) = child.as_mut() {
      let _ = c.kill();
    }
    *child = None;
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
