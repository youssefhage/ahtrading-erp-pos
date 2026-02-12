import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";

const KEY_EDGE = "ahtrading.posDesktop.edgeUrl";
const KEY_PACK = "ahtrading.posDesktop.setupPack";
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

function parsePack(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error("Invalid JSON in setup pack.");
  }
  if (!obj || typeof obj !== "object") throw new Error("Setup pack must be a JSON object.");
  return obj;
}

function applyPackObject(pack) {
  // Accept either:
  // 1) tauri-launcher-prefill.json shape (edgeUrl, companyOfficial, ...)
  // 2) a single device config shape (api_base_url, company_id, device_id, device_token) - applies to Official.
  const edgeUrl =
    normalizeUrl(pack.edgeUrl || pack.edge_url || pack.api_base_url || pack.apiBaseUrl || "");
  if (edgeUrl) el("edgeUrl").value = edgeUrl;

  const isPrefill =
    "companyOfficial" in pack ||
    "deviceIdOfficial" in pack ||
    "companyUnofficial" in pack ||
    "deviceIdUnofficial" in pack;

  if (isPrefill) {
    if (pack.portOfficial) el("portOfficial").value = String(pack.portOfficial);
    if (pack.portUnofficial) el("portUnofficial").value = String(pack.portUnofficial);
    if (pack.companyOfficial) el("companyOfficial").value = String(pack.companyOfficial);
    if (pack.companyUnofficial) el("companyUnofficial").value = String(pack.companyUnofficial);
    if (pack.deviceIdOfficial) el("deviceIdOfficial").value = String(pack.deviceIdOfficial);
    if (pack.deviceTokenOfficial) el("deviceTokenOfficial").value = String(pack.deviceTokenOfficial);
    if (pack.deviceIdUnofficial) el("deviceIdUnofficial").value = String(pack.deviceIdUnofficial);
    if (pack.deviceTokenUnofficial) el("deviceTokenUnofficial").value = String(pack.deviceTokenUnofficial);
  } else {
    // Single config -> official only.
    if (pack.company_id) el("companyOfficial").value = String(pack.company_id);
    if (pack.device_id) el("deviceIdOfficial").value = String(pack.device_id);
    if (pack.device_token) el("deviceTokenOfficial").value = String(pack.device_token);
  }
}

function isEditableTextInput(node) {
  if (!(node instanceof HTMLInputElement)) return false;
  const type = String(node.type || "text").toLowerCase();
  if (node.disabled || node.readOnly) return false;
  return !["checkbox", "radio", "button", "submit", "reset", "file", "hidden"].includes(type);
}

function installReplaceOnTypeBehavior() {
  const inputs = Array.from(document.querySelectorAll("input"));
  for (const input of inputs) {
    if (!isEditableTextInput(input)) continue;

    input.addEventListener("pointerdown", (e) => {
      // First click/tap focuses and arms "replace on type" by selecting all text.
      if (e.defaultPrevented || e.button !== 0) return;
      if (document.activeElement !== input) {
        e.preventDefault();
        input.focus();
      }
    });

    input.addEventListener("focus", () => {
      try {
        queueMicrotask(() => input.select());
      } catch {
        // ignore
      }
    });
  }
}

function load() {
  // Cloud pilot default: POS subdomain routes /api to the same backend.
  el("edgeUrl").value = localStorage.getItem(KEY_EDGE) || "https://pos.melqard.com/api";
  el("setupPack").value = localStorage.getItem(KEY_PACK) || "";
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

// Quiet auto-update on launch (helps fast iteration). If offline, do nothing.
setTimeout(() => {
  check()
    .then((update) => update && update.downloadAndInstall().catch(() => {}))
    .catch(() => {});
}, 1200);

el("startBtn").addEventListener("click", start);
el("openBtn").addEventListener("click", openPos);
el("updateBtn").addEventListener("click", checkUpdates);
el("applyPackBtn").addEventListener("click", () => {
  const raw = el("setupPack").value;
  localStorage.setItem(KEY_PACK, raw);
  try {
    const pack = parsePack(raw);
    if (!pack) {
      setStatus("Paste a setup pack first.");
      return;
    }
    applyPackObject(pack);
    // Persist everything immediately so Start POS doesn't lose it.
    localStorage.setItem(KEY_EDGE, normalizeUrl(el("edgeUrl").value));
    localStorage.setItem(KEY_PORT_OFFICIAL, String(el("portOfficial").value || "7070"));
    localStorage.setItem(KEY_PORT_UNOFFICIAL, String(el("portUnofficial").value || "7072"));
    localStorage.setItem(KEY_CO_OFFICIAL, String(el("companyOfficial").value || "").trim());
    localStorage.setItem(KEY_CO_UNOFFICIAL, String(el("companyUnofficial").value || "").trim());
    localStorage.setItem(KEY_DEV_ID_OFFICIAL, String(el("deviceIdOfficial").value || "").trim());
    localStorage.setItem(KEY_DEV_TOK_OFFICIAL, String(el("deviceTokenOfficial").value || "").trim());
    localStorage.setItem(KEY_DEV_ID_UNOFFICIAL, String(el("deviceIdUnofficial").value || "").trim());
    localStorage.setItem(KEY_DEV_TOK_UNOFFICIAL, String(el("deviceTokenUnofficial").value || "").trim());

    setStatus("Setup pack applied.");
  } catch (e) {
    setStatus(`Setup pack error: ${e instanceof Error ? e.message : String(e)}`);
  }
});
el("clearPackBtn").addEventListener("click", () => {
  el("setupPack").value = "";
  localStorage.removeItem(KEY_PACK);
  setStatus("Cleared setup pack.");
});
installReplaceOnTypeBehavior();
load();
