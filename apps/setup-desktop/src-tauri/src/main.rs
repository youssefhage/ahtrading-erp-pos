#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Emitter;

#[derive(Default)]
struct RunnerState {
  child: Option<Child>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Prereqs {
  repo_ok: bool,
  docker_ok: bool,
  docker_compose_ok: bool,
  python_ok: bool,
  details: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct OnboardParams {
  repo_path: String,
  mode: String, // "hybrid" | "onprem" | "pos"

  api_port: Option<u16>,
  admin_port: Option<u16>,

  // For "pos" mode, this is the remote Edge API base URL the provisioning calls should use.
  api_base_url: Option<String>,

  // URL POS terminals will use in their config.
  edge_api_url_for_pos: String,

  admin_email: Option<String>,
  admin_password: Option<String>,

  device_count: Option<u16>,
  companies: Option<Vec<String>>,

  enable_sync: Option<bool>,
  cloud_api_url: Option<String>,
  edge_sync_key: Option<String>,
  edge_node_id: Option<String>,

  update_env: Option<bool>,
}

fn repo_script(repo: &Path) -> PathBuf {
  repo.join("scripts").join("onboard_onprem_pos.py")
}

fn has_repo_layout(repo: &Path) -> bool {
  repo_script(repo).exists() && repo.join("deploy").join("docker-compose.edge.yml").exists()
}

fn try_cmd(cmd: &str, args: &[&str]) -> bool {
  Command::new(cmd)
    .args(args)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map(|s| s.success())
    .unwrap_or(false)
}

fn python_ok() -> bool {
  try_cmd("python3", &["--version"]) || try_cmd("python", &["--version"]) || try_cmd("py", &["-3", "--version"])
}

fn docker_ok() -> bool {
  try_cmd("docker", &["--version"])
}

fn docker_compose_ok() -> bool {
  // Docker Desktop ships compose as `docker compose ...` (subcommand).
  try_cmd("docker", &["compose", "version"])
}

#[tauri::command]
fn check_prereqs(repo_path: String) -> Result<Prereqs, String> {
  let repo = PathBuf::from(repo_path.trim());
  let repo_ok = has_repo_layout(&repo);
  let docker_ok = docker_ok();
  let docker_compose_ok = docker_compose_ok();
  let python_ok = python_ok();

  let mut details: Vec<String> = Vec::new();
  if !repo_ok {
    details.push("Repo not found or missing required files (scripts/onboard_onprem_pos.py, deploy/docker-compose.edge.yml).".to_string());
  }
  if !docker_ok {
    details.push("Docker not found in PATH. Install Docker Desktop (Windows/macOS) and ensure `docker --version` works.".to_string());
  }
  if docker_ok && !docker_compose_ok {
    details.push("Docker Compose not available (`docker compose version` failed). Update Docker Desktop.".to_string());
  }
  if !python_ok {
    details.push("Python 3 not found. Install Python 3 or ensure `python3 --version` / `python --version` works.".to_string());
  }

  Ok(Prereqs {
    repo_ok,
    docker_ok,
    docker_compose_ok,
    python_ok,
    details,
  })
}

fn pick_python() -> Option<(String, Vec<String>)> {
  if try_cmd("python3", &["--version"]) {
    return Some(("python3".to_string(), vec![]));
  }
  if try_cmd("python", &["--version"]) {
    return Some(("python".to_string(), vec![]));
  }
  if try_cmd("py", &["-3", "--version"]) {
    return Some(("py".to_string(), vec!["-3".to_string()]));
  }
  None
}

fn emit_log(app: &tauri::AppHandle, line: &str) {
  let _ = app.emit("onboarding://log", line.to_string());
}

fn emit_done(app: &tauri::AppHandle, code: i32) {
  let _ = app.emit("onboarding://done", serde_json::json!({ "exitCode": code }));
}

#[tauri::command]
fn stop_onboarding(state: tauri::State<'_, Arc<Mutex<RunnerState>>>) -> Result<(), String> {
  let mut st = state.inner().lock().unwrap();
  if let Some(mut child) = st.child.take() {
    let _ = child.kill();
  }
  Ok(())
}

#[tauri::command]
fn start_onboarding(
  app: tauri::AppHandle,
  state: tauri::State<'_, Arc<Mutex<RunnerState>>>,
  params: OnboardParams,
) -> Result<(), String> {
  {
    let st = state.inner().lock().unwrap();
    if st.child.is_some() {
      return Err("Onboarding is already running.".to_string());
    }
  }

  let repo = PathBuf::from(params.repo_path.trim());
  if !has_repo_layout(&repo) {
    return Err("Repo path is invalid (missing scripts/onboard_onprem_pos.py or deploy/docker-compose.edge.yml).".to_string());
  }
  if !docker_ok() || !docker_compose_ok() {
    return Err("Docker/Docker Compose not available. Install/upgrade Docker Desktop first.".to_string());
  }

  let (py, py_args) = pick_python().ok_or_else(|| "Python 3 not found. Install Python 3 first.".to_string())?;
  let script = repo_script(&repo);

  let mut args: Vec<String> = Vec::new();
  args.push(script.to_string_lossy().to_string());
  args.push("--non-interactive".to_string());

  if params.update_env.unwrap_or(false) {
    args.push("--update-env".to_string());
  }

  let mode = params.mode.trim().to_lowercase();
  if mode == "onprem" {
    args.push("--skip-devices".to_string());
  } else if mode == "pos" {
    args.push("--skip-start".to_string());
    let api_base = params
      .api_base_url
      .clone()
      .unwrap_or_default()
      .trim()
      .trim_end_matches('/')
      .to_string();
    if api_base.is_empty() {
      return Err("POS-only mode requires api_base_url (remote Edge API base URL).".to_string());
    }
    args.push("--api-base-url".to_string());
    args.push(api_base);
  } else if mode == "hybrid" {
    // default
  } else {
    return Err("Unknown mode. Use: hybrid, onprem, pos".to_string());
  }

  if let Some(p) = params.api_port {
    args.push("--api-port".to_string());
    args.push(p.to_string());
  }
  if let Some(p) = params.admin_port {
    args.push("--admin-port".to_string());
    args.push(p.to_string());
  }

  let edge_for_pos = params.edge_api_url_for_pos.trim().to_string();
  if edge_for_pos.is_empty() {
    return Err("edge_api_url_for_pos is required.".to_string());
  }
  args.push("--edge-api-url-for-pos".to_string());
  args.push(edge_for_pos);

  if let Some(email) = params.admin_email.clone().filter(|s| !s.trim().is_empty()) {
    args.push("--admin-email".to_string());
    args.push(email.trim().to_string());
  }
  if let Some(pw) = params.admin_password.clone().filter(|s| !s.trim().is_empty()) {
    args.push("--admin-password".to_string());
    args.push(pw);
  }

  if let Some(c) = params.device_count {
    args.push("--device-count".to_string());
    args.push(c.to_string());
  }

  if let Some(company_ids) = params.companies.clone() {
    let cleaned: Vec<String> = company_ids
      .into_iter()
      .map(|s| s.trim().to_string())
      .filter(|s| !s.is_empty())
      .collect();
    if !cleaned.is_empty() {
      args.push("--companies".to_string());
      args.extend(cleaned);
    }
  }

  let sync = params.enable_sync.unwrap_or(false);
  if sync {
    if let Some(url) = params.cloud_api_url.clone().filter(|s| !s.trim().is_empty()) {
      args.push("--cloud-api-url".to_string());
      args.push(url.trim().trim_end_matches('/').to_string());
    }
    if let Some(key) = params.edge_sync_key.clone().filter(|s| !s.trim().is_empty()) {
      args.push("--edge-sync-key".to_string());
      args.push(key);
    } else {
      return Err("Sync enabled but edge_sync_key is empty.".to_string());
    }
    if let Some(node) = params.edge_node_id.clone().filter(|s| !s.trim().is_empty()) {
      args.push("--edge-node-id".to_string());
      args.push(node.trim().to_string());
    }
  }

  // Combine python executable + args.
  let mut cmd = Command::new(py);
  cmd.args(&py_args);
  cmd.args(&args);
  cmd.current_dir(&repo);
  cmd.stdin(Stdio::null());
  cmd.stdout(Stdio::piped());
  cmd.stderr(Stdio::piped());

  emit_log(&app, "Starting onboarding...");
  emit_log(&app, &format!("Working directory: {}", repo.to_string_lossy()));

  let mut child = cmd.spawn().map_err(|e| format!("Failed to start onboarding: {e}"))?;

  let stdout = child
    .stdout
    .take()
    .ok_or_else(|| "Failed to capture stdout".to_string())?;
  let stderr = child
    .stderr
    .take()
    .ok_or_else(|| "Failed to capture stderr".to_string())?;

  {
    let mut st = state.inner().lock().unwrap();
    st.child = Some(child);
  }

  // Stream stdout.
  let app_out = app.clone();
  thread::spawn(move || {
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
      emit_log(&app_out, &line);
    }
  });

  // Stream stderr.
  let app_err = app.clone();
  thread::spawn(move || {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
      emit_log(&app_err, &format!("[stderr] {line}"));
    }
  });

  // Poll for completion so Stop can still kill the child.
  let app_done = app.clone();
  let state_done = state.inner().clone();
  thread::spawn(move || loop {
    {
      let mut st = state_done.lock().unwrap();
      if let Some(ch) = st.child.as_mut() {
        match ch.try_wait() {
          Ok(Some(status)) => {
            let code = status.code().unwrap_or(-1);
            st.child.take();
            emit_done(&app_done, code);
            break;
          }
          Ok(None) => {
            // Still running.
          }
          Err(_) => {
            st.child.take();
            emit_done(&app_done, -1);
            break;
          }
        }
      } else {
        // No longer running (maybe stopped).
        break;
      }
    }
    thread::sleep(Duration::from_millis(400));
  });

  Ok(())
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(Arc::new(Mutex::new(RunnerState::default())))
    .invoke_handler(tauri::generate_handler![
      check_prereqs,
      start_onboarding,
      stop_onboarding
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
