import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";

const KEY_EDGE = "ahtrading.posDesktop.edgeUrl";
const KEY_PORT_OFFICIAL = "ahtrading.posDesktop.portOfficial";
const KEY_PORT_UNOFFICIAL = "ahtrading.posDesktop.portUnofficial";

function el(id) {
  return document.getElementById(id);
}

function normalizeUrl(raw) {
  const v = String(raw || "").trim().replace(/\/+$/, "");
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) return `http://${v}`;
  return v;
}

function setStatus(msg) {
  el("status").textContent = msg || "";
}

function load() {
  el("edgeUrl").value = localStorage.getItem(KEY_EDGE) || "";
  el("portOfficial").value = localStorage.getItem(KEY_PORT_OFFICIAL) || "7070";
  el("portUnofficial").value = localStorage.getItem(KEY_PORT_UNOFFICIAL) || "7072";
  setStatus("");
}

async function start() {
  const edgeUrl = normalizeUrl(el("edgeUrl").value);
  const portOfficial = Number(el("portOfficial").value || 7070);
  const portUnofficial = Number(el("portUnofficial").value || 7072);

  if (!edgeUrl) {
    setStatus("Please enter the Edge API URL first.");
    return;
  }

  localStorage.setItem(KEY_EDGE, edgeUrl);
  localStorage.setItem(KEY_PORT_OFFICIAL, String(portOfficial));
  localStorage.setItem(KEY_PORT_UNOFFICIAL, String(portUnofficial));

  setStatus("Starting local agents…");
  try {
    await invoke("start_agents", { edgeUrl, portOfficial, portUnofficial });
  } catch (e) {
    setStatus(`Failed to start agents: ${e}`);
    return;
  }

  setStatus("Opening POS…");
  // Give the agents a moment to bind the HTTP ports.
  await new Promise((r) => setTimeout(r, 700));
  window.location.href = `http://127.0.0.1:${portOfficial}/unified.html`;
}

function openPos() {
  const portOfficial = Number(el("portOfficial").value || 7070);
  window.location.href = `http://127.0.0.1:${portOfficial}/unified.html`;
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

el("startBtn").addEventListener("click", start);
el("openBtn").addEventListener("click", openPos);
el("updateBtn").addEventListener("click", checkUpdates);
load();
