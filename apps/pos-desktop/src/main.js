import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";

const KEY_EDGE = "ahtrading.posDesktop.edgeUrl";
const KEY_PORT_OFFICIAL = "ahtrading.posDesktop.portOfficial";
const KEY_PORT_UNOFFICIAL = "ahtrading.posDesktop.portUnofficial";
const KEY_CO_OFFICIAL = "ahtrading.posDesktop.companyOfficial";
const KEY_CO_UNOFFICIAL = "ahtrading.posDesktop.companyUnofficial";
const KEY_DEV_ID_OFFICIAL = "ahtrading.posDesktop.deviceIdOfficial";
const KEY_DEV_TOK_OFFICIAL = "ahtrading.posDesktop.deviceTokenOfficial";
const KEY_DEV_ID_UNOFFICIAL = "ahtrading.posDesktop.deviceIdUnofficial";
const KEY_DEV_TOK_UNOFFICIAL = "ahtrading.posDesktop.deviceTokenUnofficial";

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
  el("edgeUrl").value = localStorage.getItem(KEY_EDGE) || "https://app.melqard.com/mapi";
  el("portOfficial").value = localStorage.getItem(KEY_PORT_OFFICIAL) || "7070";
  el("portUnofficial").value = localStorage.getItem(KEY_PORT_UNOFFICIAL) || "7072";
  el("companyOfficial").value = localStorage.getItem(KEY_CO_OFFICIAL) || "00000000-0000-0000-0000-000000000001";
  el("companyUnofficial").value = localStorage.getItem(KEY_CO_UNOFFICIAL) || "00000000-0000-0000-0000-000000000002";
  el("deviceIdOfficial").value = localStorage.getItem(KEY_DEV_ID_OFFICIAL) || "";
  el("deviceTokenOfficial").value = localStorage.getItem(KEY_DEV_TOK_OFFICIAL) || "";
  el("deviceIdUnofficial").value = localStorage.getItem(KEY_DEV_ID_UNOFFICIAL) || "";
  el("deviceTokenUnofficial").value = localStorage.getItem(KEY_DEV_TOK_UNOFFICIAL) || "";
  setStatus("");
}

async function start() {
  const edgeUrl = normalizeUrl(el("edgeUrl").value);
  const portOfficial = Number(el("portOfficial").value || 7070);
  const portUnofficial = Number(el("portUnofficial").value || 7072);
  const companyOfficial = String(el("companyOfficial").value || "").trim();
  const companyUnofficial = String(el("companyUnofficial").value || "").trim();
  const deviceIdOfficial = String(el("deviceIdOfficial").value || "").trim();
  const deviceTokenOfficial = String(el("deviceTokenOfficial").value || "").trim();
  const deviceIdUnofficial = String(el("deviceIdUnofficial").value || "").trim();
  const deviceTokenUnofficial = String(el("deviceTokenUnofficial").value || "").trim();

  if (!edgeUrl) {
    setStatus("Please enter the Edge API URL first.");
    return;
  }

  localStorage.setItem(KEY_EDGE, edgeUrl);
  localStorage.setItem(KEY_PORT_OFFICIAL, String(portOfficial));
  localStorage.setItem(KEY_PORT_UNOFFICIAL, String(portUnofficial));
  localStorage.setItem(KEY_CO_OFFICIAL, companyOfficial);
  localStorage.setItem(KEY_CO_UNOFFICIAL, companyUnofficial);
  localStorage.setItem(KEY_DEV_ID_OFFICIAL, deviceIdOfficial);
  localStorage.setItem(KEY_DEV_TOK_OFFICIAL, deviceTokenOfficial);
  localStorage.setItem(KEY_DEV_ID_UNOFFICIAL, deviceIdUnofficial);
  localStorage.setItem(KEY_DEV_TOK_UNOFFICIAL, deviceTokenUnofficial);

  setStatus("Starting local agents…");
  try {
    await invoke("start_agents", {
      edgeUrl,
      portOfficial,
      portUnofficial,
      companyOfficial,
      companyUnofficial,
      deviceIdOfficial,
      deviceTokenOfficial,
      deviceIdUnofficial,
      deviceTokenUnofficial,
    });
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
