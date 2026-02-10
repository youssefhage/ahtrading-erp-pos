import { check } from "@tauri-apps/plugin-updater";

const KEY = "ahtrading.adminDesktop.serverUrl";

function el(id) {
  return document.getElementById(id);
}

function normalizeUrl(raw) {
  const v = String(raw || "").trim().replace(/\\/+$/, "");
  if (!v) return "";
  // Allow users to paste without protocol.
  if (!/^https?:\\/\\//i.test(v)) return `http://${v}`;
  return v;
}

function setStatus(msg) {
  el("status").textContent = msg || "";
}

function load() {
  const saved = localStorage.getItem(KEY) || "";
  el("serverUrl").value = saved;
  setStatus("");
}

function reset() {
  localStorage.removeItem(KEY);
  el("serverUrl").value = "";
  setStatus("Cleared. Enter the edge Admin URL (ex: http://192.168.1.50:3000).");
}

async function openAdmin() {
  const url = normalizeUrl(el("serverUrl").value);
  if (!url) {
    setStatus("Please enter the Admin URL first.");
    return;
  }
  localStorage.setItem(KEY, url);
  setStatus("Opening…");

  // Navigate the webview to the admin web app. This keeps cookies/storage on the admin origin,
  // so login behaves exactly like the browser.
  window.location.href = url;
}

async function checkUpdates() {
  setStatus("Checking for updates...");
  try {
    const update = await check();
    if (!update) {
      setStatus("You are up to date.");
      return;
    }
    setStatus(`Update available: ${update.version}. Downloading...`);
    await update.downloadAndInstall();
    setStatus("Update installed. Please restart the app.");
  } catch (e) {
    setStatus(`Update check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

el("openBtn").addEventListener("click", openAdmin);
el("resetBtn").addEventListener("click", reset);
el("updateBtn").addEventListener("click", checkUpdates);
load();
