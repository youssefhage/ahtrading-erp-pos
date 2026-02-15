#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;

#[derive(Default)]
struct RunnerState {
  child: Option<Child>,
  stop_requested: bool,
  running: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Prereqs {
  repo_ok: bool,
  docker_ok: bool,
  docker_compose_ok: bool,
  details: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct OnboardParams {
  repo_path: String,
  mode: String, // "hybrid" | "onprem" | "pos"

  // Optional: where to store Edge runtime (env, compose, onboarding output) when using bundled mode.
  edge_home: Option<String>,

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

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
  app
    .path()
    .app_data_dir()
    .expect("failed to resolve app data dir")
}

fn repo_script(repo: &Path) -> PathBuf {
  repo.join("scripts").join("onboard_onprem_pos.py")
}

fn has_repo_layout(repo: &Path) -> bool {
  repo_script(repo).exists() && repo.join("deploy").join("docker-compose.edge.yml").exists()
}

fn has_bundled_layout(app: &tauri::AppHandle) -> bool {
  let res = match app.path().resource_dir() {
    Ok(p) => p,
    Err(_) => return false,
  };
  let d = res.join("edge_bundle");
  d.join("onboard_onprem_pos.py").exists() && d.join("docker-compose.edge.images.yml").exists()
}

fn default_edge_home(app: &tauri::AppHandle) -> PathBuf {
  app_data_dir(app).join("edge")
}

fn ensure_edge_bundle(app: &tauri::AppHandle, edge_home: &Path) -> Result<PathBuf, String> {
  let res = app.path().resource_dir().map_err(|e| e.to_string())?;
  let src_dir = res.join("edge_bundle");
  let src_runner = src_dir.join("onboard_onprem_pos.py");
  let src_compose = src_dir.join("docker-compose.edge.images.yml");
  let src_env_example = src_dir.join(".env.edge.example");

  if !src_runner.exists() || !src_compose.exists() {
    return Err("Bundled Edge assets are missing from this installer build.".to_string());
  }

  fs::create_dir_all(edge_home).map_err(|e| e.to_string())?;
  let dst_runner = edge_home.join("onboard_onprem_pos.py");
  let dst_compose = edge_home.join("docker-compose.edge.images.yml");

  // Keep these files overwritten so updating Setup Desktop upgrades the bundle.
  fs::copy(&src_runner, &dst_runner).map_err(|e| e.to_string())?;
  fs::copy(&src_compose, &dst_compose).map_err(|e| e.to_string())?;
  if src_env_example.exists() {
    let _ = fs::copy(&src_env_example, &edge_home.join(".env.edge.example"));
  }

  Ok(dst_runner)
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

fn docker_ok() -> bool {
  try_cmd("docker", &["--version"])
}

fn docker_compose_ok() -> bool {
  // Docker Desktop ships compose as `docker compose ...` (subcommand).
  try_cmd("docker", &["compose", "version"])
}

#[tauri::command]
fn check_prereqs(app: tauri::AppHandle, repo_path: String) -> Result<Prereqs, String> {
  let repo = PathBuf::from(repo_path.trim());
  let repo_ok = has_repo_layout(&repo) || has_bundled_layout(&app);
  let docker_ok = docker_ok();
  let docker_compose_ok = docker_compose_ok();

  let mut details: Vec<String> = Vec::new();
  if !repo_ok {
    details.push(
      "Missing onboarding runner. Either provide a valid repo path, or reinstall Setup Desktop with bundled Edge assets."
        .to_string(),
    );
  }
  if !docker_ok {
    details.push("Docker not found in PATH. Install Docker Desktop (Windows/macOS) and ensure `docker --version` works.".to_string());
  }
  if docker_ok && !docker_compose_ok {
    details.push("Docker Compose not available (`docker compose version` failed). Update Docker Desktop.".to_string());
  }

  Ok(Prereqs {
    repo_ok,
    docker_ok,
    docker_compose_ok,
    details,
  })
}

fn emit_log(app: &tauri::AppHandle, line: &str) {
  let _ = app.emit("onboarding://log", line.to_string());
}

fn emit_done(app: &tauri::AppHandle, code: i32) {
  let _ = app.emit("onboarding://done", serde_json::json!({ "exitCode": code }));
}

fn stop_requested(state: &Arc<Mutex<RunnerState>>) -> bool {
  state.lock().unwrap().stop_requested
}

fn read_env_file(path: &Path) -> std::collections::HashMap<String, String> {
  let mut out: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  let raw = match fs::read_to_string(path) {
    Ok(s) => s,
    Err(_) => return out,
  };
  for line in raw.lines() {
    let s = line.trim();
    if s.is_empty() || s.starts_with('#') {
      continue;
    }
    let Some((k, v)) = s.split_once('=') else { continue };
    let key = k.trim().to_string();
    let val = v.trim().to_string();
    if !key.is_empty() {
      out.insert(key, val);
    }
  }
  out
}

fn write_env_file(path: &Path, values: &std::collections::HashMap<String, String>) -> Result<(), String> {
  let mut lines: Vec<String> = Vec::new();
  lines.push("# Auto-generated by Setup Desktop".to_string());
  lines.push("# Do not commit this file (contains secrets).".to_string());
  lines.push("".to_string());
  lines.push("# Edge service ports".to_string());
  lines.push(format!("API_PORT={}", values.get("API_PORT").cloned().unwrap_or_else(|| "8001".to_string())));
  lines.push(format!("ADMIN_PORT={}", values.get("ADMIN_PORT").cloned().unwrap_or_else(|| "3000".to_string())));
  lines.push("".to_string());
  lines.push("# Postgres".to_string());
  lines.push(format!("POSTGRES_DB={}", values.get("POSTGRES_DB").cloned().unwrap_or_else(|| "ahtrading".to_string())));
  lines.push(format!("POSTGRES_USER={}", values.get("POSTGRES_USER").cloned().unwrap_or_else(|| "ahtrading".to_string())));
  lines.push(format!(
    "POSTGRES_PASSWORD={}",
    values.get("POSTGRES_PASSWORD").cloned().unwrap_or_else(|| "".to_string())
  ));
  lines.push("".to_string());
  lines.push("# App DB role".to_string());
  lines.push(format!("APP_DB_USER={}", values.get("APP_DB_USER").cloned().unwrap_or_else(|| "ahapp".to_string())));
  lines.push(format!(
    "APP_DB_PASSWORD={}",
    values.get("APP_DB_PASSWORD").cloned().unwrap_or_else(|| "".to_string())
  ));
  lines.push("".to_string());
  lines.push("# Bootstrap admin (script toggles this off after provisioning)".to_string());
  lines.push(format!(
    "BOOTSTRAP_ADMIN={}",
    values.get("BOOTSTRAP_ADMIN").cloned().unwrap_or_else(|| "0".to_string())
  ));
  lines.push(format!(
    "BOOTSTRAP_ADMIN_EMAIL={}",
    values.get("BOOTSTRAP_ADMIN_EMAIL").cloned().unwrap_or_else(|| "admin@ahtrading.local".to_string())
  ));
  lines.push(format!(
    "BOOTSTRAP_ADMIN_PASSWORD={}",
    values.get("BOOTSTRAP_ADMIN_PASSWORD").cloned().unwrap_or_else(|| "".to_string())
  ));
  lines.push(format!(
    "BOOTSTRAP_ADMIN_RESET_PASSWORD={}",
    values.get("BOOTSTRAP_ADMIN_RESET_PASSWORD").cloned().unwrap_or_else(|| "0".to_string())
  ));
  lines.push("".to_string());
  lines.push("# MinIO / attachments".to_string());
  lines.push(format!(
    "MINIO_ROOT_USER={}",
    values.get("MINIO_ROOT_USER").cloned().unwrap_or_else(|| "minioadmin".to_string())
  ));
  lines.push(format!(
    "MINIO_ROOT_PASSWORD={}",
    values.get("MINIO_ROOT_PASSWORD").cloned().unwrap_or_else(|| "".to_string())
  ));
  lines.push(format!(
    "S3_BUCKET={}",
    values.get("S3_BUCKET").cloned().unwrap_or_else(|| "attachments".to_string())
  ));
  lines.push("".to_string());
  lines.push("# Edge -> cloud sync (optional)".to_string());
  lines.push(format!(
    "EDGE_SYNC_TARGET_URL={}",
    values.get("EDGE_SYNC_TARGET_URL").cloned().unwrap_or_else(|| "".to_string())
  ));
  lines.push(format!(
    "EDGE_SYNC_KEY={}",
    values.get("EDGE_SYNC_KEY").cloned().unwrap_or_else(|| "".to_string())
  ));
  lines.push(format!(
    "EDGE_SYNC_NODE_ID={}",
    values.get("EDGE_SYNC_NODE_ID").cloned().unwrap_or_else(|| "".to_string())
  ));
  lines.push("".to_string());

  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::write(path, lines.join("\n")).map_err(|e| e.to_string())?;
  Ok(())
}

fn rand_secret(len: usize) -> String {
  use rand::distributions::Alphanumeric;
  use rand::Rng;
  let mut rng = rand::thread_rng();
  std::iter::repeat_with(|| rng.sample(Alphanumeric) as char)
    .take(len)
    .collect::<String>()
}

fn slug(raw: &str) -> String {
  let mut out = String::new();
  let mut last_dash = false;
  for ch in raw.trim().to_lowercase().chars() {
    if ch.is_ascii_alphanumeric() {
      out.push(ch);
      last_dash = false;
    } else if !last_dash && !out.is_empty() {
      out.push('-');
      last_dash = true;
    }
  }
  while out.ends_with('-') {
    out.pop();
  }
  if out.is_empty() {
    "company".to_string()
  } else {
    out
  }
}

fn device_code_prefix(company_name: &str) -> String {
  let mut cleaned = String::new();
  for ch in company_name.chars() {
    if ch.is_ascii_alphanumeric() {
      cleaned.push(ch.to_ascii_uppercase());
    } else if !cleaned.ends_with('-') {
      cleaned.push('-');
    }
  }
  let cleaned = cleaned.trim_matches('-').to_string();
  if cleaned.is_empty() {
    return "POS".to_string();
  }
  cleaned.chars().take(14).collect()
}

fn machine_hostname() -> String {
  std::env::var("COMPUTERNAME")
    .or_else(|_| std::env::var("HOSTNAME"))
    .unwrap_or_else(|_| "edge".to_string())
}

fn http_json(
  method: &str,
  url: &str,
  headers: &[(&str, &str)],
  payload: Option<serde_json::Value>,
  timeout_s: u64,
) -> Result<serde_json::Value, String> {
  let agent = ureq::AgentBuilder::new()
    .timeout_read(Duration::from_secs(timeout_s))
    .timeout_write(Duration::from_secs(timeout_s))
    .build();

  let mut req = match method.to_uppercase().as_str() {
    "GET" => agent.get(url),
    "POST" => agent.post(url),
    "PUT" => agent.put(url),
    "DELETE" => agent.delete(url),
    other => return Err(format!("unsupported method {other}")),
  };

  req = req.set("Accept", "application/json");
  for (k, v) in headers {
    req = req.set(k, v);
  }

  let res = if let Some(p) = payload {
    req.set("Content-Type", "application/json").send_json(p)
  } else {
    req.call()
  };

  match res {
    Ok(r) => {
      if r.header("content-length") == Some("0") {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
      }
      r.into_json::<serde_json::Value>()
        .map_err(|e| format!("invalid json response: {e}"))
        .or_else(|_e| Ok(serde_json::Value::Object(serde_json::Map::new())))
    }
    Err(ureq::Error::Status(code, resp)) => {
      let body = resp.into_string().unwrap_or_default();
      Err(format!("HTTP {code} {url}: {body}"))
    }
    Err(e) => Err(e.to_string()),
  }
}

fn wait_api_healthy(app: &tauri::AppHandle, state: &Arc<Mutex<RunnerState>>, api_base: &str, timeout_s: u64) -> Result<(), String> {
  let url = format!("{}/health", api_base.trim_end_matches('/'));
  let start = std::time::Instant::now();
  let mut last_err = String::new();
  while start.elapsed().as_secs() < timeout_s {
    if stop_requested(state) {
      return Err("Stopped.".to_string());
    }
    match http_json("GET", &url, &[], None, 3) {
      Ok(v) => {
        if v.get("status").and_then(|x| x.as_str()).unwrap_or("") == "ok" {
          return Ok(());
        }
        last_err = format!("health status={}", v.get("status").cloned().unwrap_or(serde_json::Value::Null));
      }
      Err(e) => last_err = e,
    }
    emit_log(app, &format!("Waiting for API health... ({last_err})"));
    thread::sleep(Duration::from_secs(2));
  }
  Err(format!("Edge API did not become healthy in time ({timeout_s}s). Last error: {last_err}"))
}

fn run_cmd_stream(
  app: &tauri::AppHandle,
  state: &Arc<Mutex<RunnerState>>,
  mut cmd: Command,
  label: &str,
) -> Result<(), String> {
  cmd.stdin(Stdio::null());
  cmd.stdout(Stdio::piped());
  cmd.stderr(Stdio::piped());

  emit_log(app, &format!("$ {} {:?}", label, cmd.get_args().collect::<Vec<_>>()));

  let mut child = cmd.spawn().map_err(|e| e.to_string())?;
  let stdout = child.stdout.take().ok_or_else(|| "Failed to capture stdout".to_string())?;
  let stderr = child.stderr.take().ok_or_else(|| "Failed to capture stderr".to_string())?;

  {
    let mut st = state.lock().unwrap();
    st.child = Some(child);
  }

  let app_out = app.clone();
  let out_t = thread::spawn(move || {
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
      emit_log(&app_out, &line);
    }
  });

  let app_err = app.clone();
  let err_t = thread::spawn(move || {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
      emit_log(&app_err, &format!("[stderr] {line}"));
    }
  });

  let code: i32;
  loop {
    if stop_requested(state) {
      let mut st = state.lock().unwrap();
      if let Some(ch) = st.child.as_mut() {
        let _ = ch.kill();
      }
    }

    let done = {
      let mut st = state.lock().unwrap();
      if let Some(ch) = st.child.as_mut() {
        match ch.try_wait() {
          Ok(Some(status)) => Some(status.code().unwrap_or(-1)),
          Ok(None) => None,
          Err(_) => Some(-1),
        }
      } else {
        Some(-1)
      }
    };

    if let Some(c) = done {
      code = c;
      break;
    }
    thread::sleep(Duration::from_millis(300));
  }

  {
    let mut st = state.lock().unwrap();
    st.child.take();
  }

  let _ = out_t.join();
  let _ = err_t.join();

  if code == 0 {
    Ok(())
  } else if stop_requested(state) {
    Err("Stopped.".to_string())
  } else {
    Err(format!("Command failed (exit {code})."))
  }
}

fn run_onboarding_internal(app: &tauri::AppHandle, state: &Arc<Mutex<RunnerState>>, params: OnboardParams) -> Result<(), String> {
  use chrono::Utc;
  use serde_json::json;

  let repo = PathBuf::from(params.repo_path.trim());
  let use_repo = !params.repo_path.trim().is_empty() && has_repo_layout(&repo);

  let mut edge_home = params.edge_home.clone().unwrap_or_default().trim().to_string();
  if edge_home.is_empty() {
    edge_home = if use_repo {
      repo.join("deploy").join("edge").to_string_lossy().to_string()
    } else {
      default_edge_home(app).to_string_lossy().to_string()
    };
  }
  let edge_home_path = PathBuf::from(edge_home.trim()).to_path_buf();

  // In bundled mode, ensure assets exist in edge_home (compose/env example).
  let compose_mode_images = !use_repo;
  if compose_mode_images {
    // Ensure the app's bundled Edge assets exist under edge_home (overwrites on each run).
    let _ = ensure_edge_bundle(app, &edge_home_path)?;
  }

  let env_path = edge_home_path.join(".env.edge");
  let onboarding_root = edge_home_path.join("onboarding");
  let existing_env = read_env_file(&env_path);
  let env_exists = env_path.exists();
  let should_write_env = (!env_exists) || params.update_env.unwrap_or(false);

  let api_port = params
    .api_port
    .or_else(|| existing_env.get("API_PORT").and_then(|v| v.parse::<u16>().ok()))
    .unwrap_or(8001);
  let admin_port = params
    .admin_port
    .or_else(|| existing_env.get("ADMIN_PORT").and_then(|v| v.parse::<u16>().ok()))
    .unwrap_or(3000);

  let edge_api_url_for_pos = params.edge_api_url_for_pos.trim().trim_end_matches('/').to_string();
  if edge_api_url_for_pos.is_empty() {
    return Err("edge_api_url_for_pos is required.".to_string());
  }

  let sync_enabled = params.enable_sync.unwrap_or(false);
  let cloud_api_url = params.cloud_api_url.clone().unwrap_or_default().trim().trim_end_matches('/').to_string();
  let edge_sync_key = params.edge_sync_key.clone().unwrap_or_default();
  if sync_enabled && edge_sync_key.trim().is_empty() {
    return Err("Sync enabled but edge_sync_key is empty.".to_string());
  }

  let admin_email = params
    .admin_email
    .clone()
    .filter(|s| !s.trim().is_empty())
    .or_else(|| existing_env.get("BOOTSTRAP_ADMIN_EMAIL").cloned())
    .unwrap_or_else(|| "admin@ahtrading.local".to_string());
  let mut admin_password = params
    .admin_password
    .clone()
    .filter(|s| !s.trim().is_empty())
    .or_else(|| existing_env.get("BOOTSTRAP_ADMIN_PASSWORD").cloned())
    .unwrap_or_default();
  let mut generated_admin_password = false;
  if admin_password.trim().is_empty() {
    admin_password = rand_secret(20);
    generated_admin_password = true;
  }

  let edge_node_id = params
    .edge_node_id
    .clone()
    .filter(|s| !s.trim().is_empty())
    .or_else(|| existing_env.get("EDGE_SYNC_NODE_ID").cloned())
    .unwrap_or_else(machine_hostname);

  let pg_password = existing_env.get("POSTGRES_PASSWORD").cloned().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| rand_secret(24));
  let app_password = existing_env.get("APP_DB_PASSWORD").cloned().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| rand_secret(24));
  let minio_password = existing_env.get("MINIO_ROOT_PASSWORD").cloned().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| rand_secret(24));

  let mut env_values: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  env_values.insert("API_PORT".to_string(), api_port.to_string());
  env_values.insert("ADMIN_PORT".to_string(), admin_port.to_string());
  env_values.insert("POSTGRES_DB".to_string(), existing_env.get("POSTGRES_DB").cloned().unwrap_or_else(|| "ahtrading".to_string()));
  env_values.insert("POSTGRES_USER".to_string(), existing_env.get("POSTGRES_USER").cloned().unwrap_or_else(|| "ahtrading".to_string()));
  env_values.insert("POSTGRES_PASSWORD".to_string(), pg_password);
  env_values.insert("APP_DB_USER".to_string(), existing_env.get("APP_DB_USER").cloned().unwrap_or_else(|| "ahapp".to_string()));
  env_values.insert("APP_DB_PASSWORD".to_string(), app_password);
  env_values.insert(
    "BOOTSTRAP_ADMIN".to_string(),
    if should_write_env { "1".to_string() } else { existing_env.get("BOOTSTRAP_ADMIN").cloned().unwrap_or_else(|| "0".to_string()) },
  );
  env_values.insert("BOOTSTRAP_ADMIN_EMAIL".to_string(), admin_email.clone());
  env_values.insert("BOOTSTRAP_ADMIN_PASSWORD".to_string(), admin_password.clone());
  env_values.insert(
    "BOOTSTRAP_ADMIN_RESET_PASSWORD".to_string(),
    if should_write_env { "1".to_string() } else { existing_env.get("BOOTSTRAP_ADMIN_RESET_PASSWORD").cloned().unwrap_or_else(|| "0".to_string()) },
  );
  env_values.insert("MINIO_ROOT_USER".to_string(), existing_env.get("MINIO_ROOT_USER").cloned().unwrap_or_else(|| "minioadmin".to_string()));
  env_values.insert("MINIO_ROOT_PASSWORD".to_string(), minio_password);
  env_values.insert("S3_BUCKET".to_string(), existing_env.get("S3_BUCKET").cloned().unwrap_or_else(|| "attachments".to_string()));
  env_values.insert("EDGE_SYNC_TARGET_URL".to_string(), if sync_enabled { cloud_api_url.clone() } else { "".to_string() });
  env_values.insert("EDGE_SYNC_KEY".to_string(), if sync_enabled { edge_sync_key.clone() } else { "".to_string() });
  env_values.insert("EDGE_SYNC_NODE_ID".to_string(), edge_node_id);

  if should_write_env {
    write_env_file(&env_path, &env_values)?;
    emit_log(app, &format!("Wrote {}", env_path.to_string_lossy()));
  } else {
    emit_log(app, &format!("Reusing existing {}", env_path.to_string_lossy()));
  }

  // Determine mode semantics.
  let mode = params.mode.trim().to_lowercase();
  let skip_devices = mode == "onprem";
  let skip_start = mode == "pos";

  // Compose file selection.
  let compose_file = if compose_mode_images {
    edge_home_path.join("docker-compose.edge.images.yml")
  } else {
    repo.join("deploy").join("docker-compose.edge.yml")
  };
  if !compose_file.exists() && !skip_start {
    return Err(format!("Compose file not found: {}", compose_file.to_string_lossy()));
  }

  if !skip_start {
    emit_log(app, "Starting EDGE stack...");
    let mut cmd = Command::new("docker");
    cmd.arg("compose");
    cmd.arg("--env-file").arg(env_path.to_string_lossy().to_string());
    cmd.arg("-f").arg(compose_file.to_string_lossy().to_string());
    cmd.arg("up").arg("-d");
    if compose_mode_images {
      cmd.arg("--pull").arg("always");
    } else {
      cmd.arg("--build");
    }
    cmd.current_dir(if compose_mode_images { &edge_home_path } else { &repo });
    run_cmd_stream(app, state, cmd, "docker compose up")?;
  } else {
    emit_log(app, "Skipping EDGE start (POS-only mode).");
  }

  // Resolve the base URL used for provisioning calls.
  let mut api_base = params.api_base_url.clone().unwrap_or_default().trim().trim_end_matches('/').to_string();
  if api_base.is_empty() {
    api_base = format!("http://127.0.0.1:{api_port}");
  }
  emit_log(app, &format!("Waiting for EDGE API health at {api_base}/health ..."));
  wait_api_healthy(app, state, &api_base, 300)?;
  emit_log(app, "EDGE API is healthy.");

  #[derive(Clone)]
  struct DeviceRec {
    company_id: String,
    company_name: String,
    branch_id: Option<String>,
    branch_name: Option<String>,
    device_code: String,
    device_id: String,
    device_token: String,
  }

  let mut devices: Vec<DeviceRec> = Vec::new();

  if !skip_devices {
    emit_log(app, "Authenticating admin...");
    let login = http_json(
      "POST",
      &format!("{api_base}/auth/login"),
      &[],
      Some(json!({ "email": admin_email, "password": admin_password })),
      12,
    )?;
    if login.get("mfa_required").and_then(|v| v.as_bool()).unwrap_or(false) {
      return Err("Admin user requires MFA; automation cannot continue. Use a bootstrap admin without MFA.".to_string());
    }
    let token = login.get("token").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if token.trim().is_empty() {
      return Err("Login succeeded but no token was returned.".to_string());
    }

    let companies_v = http_json("GET", &format!("{api_base}/companies"), &[("Authorization", &format!("Bearer {token}"))], None, 12)?;
    let companies = companies_v.get("companies").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if companies.is_empty() {
      return Err("No companies available for this admin user. Cannot provision POS devices.".to_string());
    }

    let requested: std::collections::HashSet<String> = params
      .companies
      .clone()
      .unwrap_or_default()
      .into_iter()
      .map(|s| s.trim().to_string())
      .filter(|s| !s.is_empty())
      .collect();

    let default_device_count = params.device_count.unwrap_or(1).max(1) as usize;

    for c in companies {
      if stop_requested(state) {
        return Err("Stopped.".to_string());
      }
      let company_id = c.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
      if company_id.is_empty() {
        continue;
      }
      if !requested.is_empty() && !requested.contains(&company_id) {
        continue;
      }
      let company_name = c.get("name").and_then(|v| v.as_str()).unwrap_or(&company_id).to_string();

      // Branch selection: in non-interactive mode we pick the first branch (if any).
      let branches_v = http_json(
        "GET",
        &format!("{api_base}/branches"),
        &[("Authorization", &format!("Bearer {token}")), ("X-Company-Id", &company_id)],
        None,
        12,
      )?;
      let branches = branches_v.get("branches").and_then(|v| v.as_array()).cloned().unwrap_or_default();
      let (branch_id, branch_name) = if let Some(b) = branches.first() {
        (
          b.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
          b.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        )
      } else {
        (None, None)
      };

      let prefix = device_code_prefix(&company_name);
      emit_log(app, &format!("Registering devices for {company_name} ({company_id}) ..."));

      for i in 1..=default_device_count {
        if stop_requested(state) {
          return Err("Stopped.".to_string());
        }
        let device_code = format!("{prefix}-POS-{i:02}");
        let mut q = format!(
          "company_id={}&device_code={}&reset_token=true",
          urlencoding::encode(&company_id),
          urlencoding::encode(&device_code)
        );
        if let Some(bid) = branch_id.as_ref().filter(|s| !s.trim().is_empty()) {
          q.push_str(&format!("&branch_id={}", urlencoding::encode(bid)));
        }
        let url = format!("{api_base}/pos/devices/register?{q}");
        let reg = http_json(
          "POST",
          &url,
          &[("Authorization", &format!("Bearer {token}")), ("X-Company-Id", &company_id)],
          Some(json!({})),
          20,
        )?;
        let device_id = reg.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let device_token = reg.get("token").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if device_id.trim().is_empty() || device_token.trim().is_empty() {
          return Err(format!("Failed to register device {device_code} for company {company_id}"));
        }
        emit_log(app, &format!("  - {device_code} registered"));
        devices.push(DeviceRec {
          company_id: company_id.clone(),
          company_name: company_name.clone(),
          branch_id: branch_id.clone(),
          branch_name: branch_name.clone(),
          device_code: device_code.clone(),
          device_id,
          device_token,
        });
      }
    }
  } else {
    emit_log(app, "Skipping POS device registration (on-prem only mode).");
  }

  // Output bundle.
  if !devices.is_empty() {
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let out_dir = onboarding_root.join(timestamp);
    fs::create_dir_all(out_dir.join("pos-device-packs")).map_err(|e| e.to_string())?;

    // Write device packs
    for d in &devices {
      let company_slug = slug(&d.company_name);
      let filename = format!("{}__{}.json", company_slug, slug(&d.device_code));
      let payload = json!({
        "api_base_url": edge_api_url_for_pos,
        "company_id": d.company_id,
        "branch_id": d.branch_id.clone().unwrap_or_default(),
        "device_code": d.device_code,
        "device_id": d.device_id,
        "device_token": d.device_token,
        "shift_id": ""
      });
      fs::write(out_dir.join("pos-device-packs").join(filename), serde_json::to_string_pretty(&payload).unwrap_or_default())
        .map_err(|e| e.to_string())?;
    }

    // Summary + tauri prefill
    let devices_json: Vec<serde_json::Value> = devices
      .iter()
      .map(|d| {
        json!({
          "company_id": d.company_id,
          "company_name": d.company_name,
          "branch_id": d.branch_id,
          "branch_name": d.branch_name,
          "device_code": d.device_code,
          "device_id": d.device_id,
          "device_token": d.device_token,
        })
      })
      .collect();

    let summary = json!({
      "generated_at": Utc::now().to_rfc3339(),
      "edge_api_url_for_pos": edge_api_url_for_pos,
      "devices": devices_json,
    });
    fs::write(out_dir.join("summary.json"), serde_json::to_string_pretty(&summary).unwrap_or_default()).map_err(|e| e.to_string())?;

    // Tauri launcher prefill: choose official/unofficial by company name.
    let pick = |kind: &str| -> Option<&DeviceRec> {
      let kind_l = kind.to_lowercase();
      for d in &devices {
        let name = d.company_name.to_lowercase();
        if kind_l == "official" {
          if name.contains("official") && !name.contains("unofficial") {
            return Some(d);
          }
          continue;
        }
        if name.contains(&kind_l) {
          return Some(d);
        }
      }
      None
    };
    let mut official = pick("official");
    let mut unofficial = pick("unofficial");
    if official.is_none() {
      official = devices.first();
    }
    if unofficial.is_none() && devices.len() > 1 {
      unofficial = devices.get(1);
    }
    if unofficial.is_none() {
      unofficial = official;
    }
    let off = official.cloned();
    let un = unofficial.cloned();
    let prefill = json!({
      // POS Desktop now supports Hybrid URLs:
      // - cloudUrl: cloud base (master)
      // - edgeLanUrl: on-prem edge base (LAN, preferred when reachable)
      //
      // Back-compat: keep edgeUrl populated too.
      "cloudUrl": cloud_api_url,
      "edgeLanUrl": edge_api_url_for_pos,
      "edgeUrl": if cloud_api_url.is_empty() { edge_api_url_for_pos } else { cloud_api_url.clone() },
      "portOfficial": 7070,
      "portUnofficial": 7072,
      "companyOfficial": off.as_ref().map(|d| d.company_id.clone()).unwrap_or_default(),
      "companyUnofficial": un.as_ref().map(|d| d.company_id.clone()).unwrap_or_default(),
      "deviceIdOfficial": off.as_ref().map(|d| d.device_id.clone()).unwrap_or_default(),
      "deviceTokenOfficial": off.as_ref().map(|d| d.device_token.clone()).unwrap_or_default(),
      "deviceIdUnofficial": un.as_ref().map(|d| d.device_id.clone()).unwrap_or_default(),
      "deviceTokenUnofficial": un.as_ref().map(|d| d.device_token.clone()).unwrap_or_default(),
    });
    fs::write(out_dir.join("tauri-launcher-prefill.json"), serde_json::to_string_pretty(&prefill).unwrap_or_default())
      .map_err(|e| e.to_string())?;

    let readme = "On-Prem POS Onboarding Bundle\n\nSecurity note: device tokens are sensitive secrets. Keep this folder private.\n";
    fs::write(out_dir.join("README.txt"), readme).map_err(|e| e.to_string())?;

    emit_log(app, &format!("Exported onboarding bundle to: {}", out_dir.to_string_lossy()));
  }

  // Harden future restarts only for fresh installs / explicit env update runs.
  if should_write_env {
    env_values.insert("BOOTSTRAP_ADMIN".to_string(), "0".to_string());
    env_values.insert("BOOTSTRAP_ADMIN_RESET_PASSWORD".to_string(), "0".to_string());
    write_env_file(&env_path, &env_values)?;
    emit_log(app, "Updated .env.edge to disable bootstrap reset on future restarts.");

    if !skip_start {
      emit_log(app, "Applying final hardened env (quick compose refresh)...");
      let mut cmd = Command::new("docker");
      cmd.arg("compose");
      cmd.arg("--env-file").arg(env_path.to_string_lossy().to_string());
      cmd.arg("-f").arg(compose_file.to_string_lossy().to_string());
      cmd.arg("up").arg("-d");
      if compose_mode_images {
        cmd.arg("--pull").arg("always");
      }
      cmd.current_dir(if compose_mode_images { &edge_home_path } else { &repo });
      let _ = run_cmd_stream(app, state, cmd, "docker compose up (refresh)");
    }
  }

  emit_log(app, "");
  emit_log(app, "Onboarding complete.");
  emit_log(app, &format!("- Edge API URL for POS: {}", edge_api_url_for_pos));
  if sync_enabled {
    emit_log(app, &format!("- Edge->Cloud sync target: {}", cloud_api_url));
  } else {
    emit_log(app, "- Edge->Cloud sync: disabled");
  }
  if generated_admin_password {
    emit_log(app, "- Bootstrap admin password was auto-generated for this run:");
    emit_log(app, &format!("  {admin_password}"));
  }
  if stop_requested(state) {
    return Err("Stopped.".to_string());
  }
  Ok(())
}

#[tauri::command]
fn stop_onboarding(state: tauri::State<'_, Arc<Mutex<RunnerState>>>) -> Result<(), String> {
  let mut st = state.inner().lock().unwrap();
  st.stop_requested = true;
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
    let mut st = state.inner().lock().unwrap();
    if st.running {
      return Err("Onboarding is already running.".to_string());
    }
    st.running = true;
    st.stop_requested = false;
    st.child = None;
  }

  if !docker_ok() || !docker_compose_ok() {
    let mut st = state.inner().lock().unwrap();
    st.running = false;
    return Err("Docker/Docker Compose not available. Install/upgrade Docker Desktop first.".to_string());
  }

  emit_log(&app, "Starting onboarding...");

  let app_bg = app.clone();
  let state_bg = state.inner().clone();
  let params_bg = params.clone();
  thread::spawn(move || {
    let code = match run_onboarding_internal(&app_bg, &state_bg, params_bg) {
      Ok(_) => 0,
      Err(e) => {
        emit_log(&app_bg, &format!("[error] {e}"));
        1
      }
    };
    {
      let mut st = state_bg.lock().unwrap();
      st.child.take();
      st.running = false;
    }
    emit_done(&app_bg, code);
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
