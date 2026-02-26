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
  el("serverUrl").value = saved || "https://app.melqard.com";
  setStatus("");
}

function reset() {
  localStorage.removeItem(KEY);
  el("serverUrl").value = "";
  setStatus("Cleared. Enter the Portal URL (cloud: https://app.melqard.com, or later the Edge portal URL on LAN).");
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

// Silent auto-update: download, install, and restart without user action.
async function silentAutoUpdate() {
  try {
    const update = await check();
    if (!update) return;
    await update.downloadAndInstall();
    // Restart automatically so the admin never has to act.
    try {
      const invoke = globalThis?.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke === "function") await invoke("restart_app", {});
    } catch {
      // If restart fails the update is still installed — it'll apply on next launch.
    }
  } catch {
    // Offline or transient error — next check will retry.
  }
}

// Check on launch (1.2 s delay) and every 30 minutes after that.
setTimeout(() => silentAutoUpdate(), 1200);
setInterval(() => silentAutoUpdate(), 30 * 60 * 1000);
window.addEventListener("online", () => silentAutoUpdate());

el("openBtn").addEventListener("click", openAdmin);
el("resetBtn").addEventListener("click", reset);
el("updateBtn").addEventListener("click", checkUpdates);
load();
