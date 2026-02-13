#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::process::Command;
use base64::Engine;

#[derive(Serialize)]
struct PrinterInfo {
  name: String,
  is_default: bool,
}

#[derive(Serialize)]
struct PrintersRes {
  printers: Vec<PrinterInfo>,
  default_printer: Option<String>,
  error: Option<String>,
}

fn run_cmd(args: &[&str], timeout_ms: u64) -> Result<(i32, String, String), String> {
  // Rust std::process::Command has no timeout; keep it simple and best-effort.
  // Our calls are local and usually fast (lpstat / powershell).
  let mut cmd = Command::new(args[0]);
  if args.len() > 1 {
    cmd.args(&args[1..]);
  }
  let out = cmd
    .output()
    .map_err(|e| format!("failed to run {}: {}", args[0], e))?;
  let code = out.status.code().unwrap_or(1);
  let stdout = String::from_utf8_lossy(&out.stdout).to_string();
  let stderr = String::from_utf8_lossy(&out.stderr).to_string();

  // Keep clippy quiet about unused timeout; we may upgrade to a timeout wrapper later.
  let _ = timeout_ms;
  Ok((code, stdout, stderr))
}

#[tauri::command]
fn list_printers() -> Result<PrintersRes, String> {
  // Windows
  #[cfg(target_os = "windows")]
  {
    let (code, stdout, stderr) = run_cmd(
      &[
        "powershell",
        "-NoProfile",
        "-Command",
        "Get-Printer | Select-Object -ExpandProperty Name",
      ],
      4000,
    )?;
    if code != 0 {
      return Ok(PrintersRes {
        printers: vec![],
        default_printer: None,
        error: Some(stderr.trim().to_string()),
      });
    }
    let names: Vec<String> = stdout
      .lines()
      .map(|l| l.trim().to_string())
      .filter(|l| !l.is_empty())
      .collect();
    return Ok(PrintersRes {
      printers: names
        .into_iter()
        .map(|n| PrinterInfo {
          name: n,
          is_default: false,
        })
        .collect(),
      default_printer: None,
      error: None,
    });
  }

  // macOS/Linux (CUPS)
  #[cfg(not(target_os = "windows"))]
  {
    let mut default_printer: Option<String> = None;
    if let Ok((code, stdout, _stderr)) = run_cmd(&["lpstat", "-d"], 2000) {
      if code == 0 {
        for ln in stdout.lines() {
          if ln.contains("default destination") {
            if let Some((_head, tail)) = ln.split_once(':') {
              let p = tail.trim();
              if !p.is_empty() {
                default_printer = Some(p.to_string());
              }
            }
          }
        }
      }
    }

    let (code, stdout, stderr) = run_cmd(&["lpstat", "-p"], 2500)?;
    if code != 0 {
      let msg = stderr.trim().to_string();
      return Ok(PrintersRes {
        printers: vec![],
        default_printer,
        error: Some(if msg.is_empty() { "lpstat failed".to_string() } else { msg }),
      });
    }
    let mut printers: Vec<PrinterInfo> = vec![];
    for ln in stdout.lines() {
      let line = ln.trim();
      if !line.starts_with("printer ") {
        continue;
      }
      let parts: Vec<&str> = line.split_whitespace().collect();
      if parts.len() < 2 {
        continue;
      }
      let name = parts[1].trim();
      if name.is_empty() {
        continue;
      }
      printers.push(PrinterInfo {
        name: name.to_string(),
        is_default: default_printer
          .as_ref()
          .map(|d| d == name)
          .unwrap_or(false),
      });
    }
    Ok(PrintersRes {
      printers,
      default_printer,
      error: None,
    })
  }
}

fn clamp_copies(copies: Option<u32>) -> u32 {
  let c = copies.unwrap_or(1);
  c.clamp(1, 10)
}

#[tauri::command]
fn print_text(text: String, printer: Option<String>, copies: Option<u32>) -> Result<(), String> {
  let c = clamp_copies(copies);
  let mut tmp = tempfile::NamedTempFile::new().map_err(|e| format!("tempfile failed: {}", e))?;
  std::io::Write::write_all(&mut tmp, text.as_bytes()).map_err(|e| format!("write failed: {}", e))?;
  let path = tmp.path().to_string_lossy().to_string();

  #[cfg(target_os = "windows")]
  {
    // Best-effort: send text to printer via Out-Printer.
    let p = printer.unwrap_or_default();
    if p.trim().is_empty() {
      return Err("printer is required on Windows for print_text".to_string());
    }
    let script = format!(
      "Get-Content -Raw -Path \"{}\" | Out-Printer -Name \"{}\"",
      path.replace('"', ""),
      p.replace('"', "")
    );
    for _ in 0..c {
      let (code, _stdout, stderr) = run_cmd(&["powershell", "-NoProfile", "-Command", &script], 6000)?;
      if code != 0 {
        return Err(stderr.trim().to_string());
      }
    }
    return Ok(());
  }

  #[cfg(not(target_os = "windows"))]
  {
    let mut cmd = Command::new("lp");
    if let Some(p) = printer {
      let pp = p.trim();
      if !pp.is_empty() {
        cmd.args(["-d", pp]);
      }
    }
    if c != 1 {
      cmd.args(["-n", &c.to_string()]);
    }
    let out = cmd.arg(&path).output().map_err(|e| format!("lp failed: {}", e))?;
    if !out.status.success() {
      return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
  }
}

#[tauri::command]
fn print_pdf_base64(pdf_base64: String, printer: Option<String>, copies: Option<u32>) -> Result<(), String> {
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(pdf_base64.trim())
    .map_err(|e| format!("base64 decode failed: {}", e))?;
  if bytes.is_empty() {
    return Err("empty pdf".to_string());
  }
  let c = clamp_copies(copies);
  let mut tmp = tempfile::Builder::new()
    .suffix(".pdf")
    .tempfile()
    .map_err(|e| format!("tempfile failed: {}", e))?;
  std::io::Write::write_all(&mut tmp, &bytes).map_err(|e| format!("write failed: {}", e))?;
  let path = tmp.path().to_string_lossy().to_string();

  #[cfg(target_os = "windows")]
  {
    // Best-effort: rely on default PDF handler supporting PrintTo.
    let p = printer.unwrap_or_default();
    if p.trim().is_empty() {
      return Err("printer is required on Windows for print_pdf".to_string());
    }
    let script = format!(
      "Start-Process -FilePath \"{}\" -Verb PrintTo -ArgumentList '\"{}\"' -WindowStyle Hidden",
      path.replace('\"', ""),
      p.replace('\"', "")
    );
    for _ in 0..c {
      let (code, _stdout, stderr) = run_cmd(&["powershell", "-NoProfile", "-Command", &script], 10000)?;
      if code != 0 {
        return Err(stderr.trim().to_string());
      }
    }
    return Ok(());
  }

  #[cfg(not(target_os = "windows"))]
  {
    let mut cmd = Command::new("lp");
    if let Some(p) = printer {
      let pp = p.trim();
      if !pp.is_empty() {
        cmd.args(["-d", pp]);
      }
    }
    if c != 1 {
      cmd.args(["-n", &c.to_string()]);
    }
    let out = cmd.arg(&path).output().map_err(|e| format!("lp failed: {}", e))?;
    if !out.status.success() {
      return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
  }
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![list_printers, print_text, print_pdf_base64])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
