const KEY_EDGE = "ahtrading.posDesktop.edgeUrl";
const KEY_EDGE_LAN = "ahtrading.posDesktop.edgeLanUrl";
const KEY_PACK = "ahtrading.posDesktop.setupPack";
const KEY_PORT_OFFICIAL = "ahtrading.posDesktop.portOfficial";
const KEY_PORT_UNOFFICIAL = "ahtrading.posDesktop.portUnofficial";
const KEY_CO_OFFICIAL = "ahtrading.posDesktop.companyOfficial";
const KEY_CO_UNOFFICIAL = "ahtrading.posDesktop.companyUnofficial";
const KEY_DEV_ID_OFFICIAL = "ahtrading.posDesktop.deviceIdOfficial";
const KEY_DEV_TOK_OFFICIAL = "ahtrading.posDesktop.deviceTokenOfficial";
const KEY_DEV_ID_UNOFFICIAL = "ahtrading.posDesktop.deviceIdUnofficial";
const KEY_DEV_TOK_UNOFFICIAL = "ahtrading.posDesktop.deviceTokenUnofficial";
const KEY_SETUP_EMAIL = "ahtrading.posDesktop.setupEmail";
const DEBUG_MAX_LINES = 320;
let APP_VERSION = "unknown";

const debugState = {
  lines: [],
};

let availableUpdate = null;

async function tauriInvoke(cmd, args = {}) {
  const fn = globalThis?.__TAURI_INTERNALS__?.invoke;
  if (typeof fn !== "function") {
    throw new Error("Tauri bridge unavailable. Please open this screen from Melqard POS Desktop app.");
  }
  return await fn(String(cmd || ""), args || {});
}

function getGlobalUpdaterApi() {
  const updater = globalThis?.__TAURI__?.updater;
  return updater && typeof updater === "object" ? updater : null;
}

function createTauriChannel(handler) {
  const transform = globalThis?.__TAURI_INTERNALS__?.transformCallback;
  const unregister = globalThis?.__TAURI_INTERNALS__?.unregisterCallback;
  if (typeof transform !== "function") {
    throw new Error("Tauri channel bridge unavailable.");
  }

  const callbackId = transform((payload) => {
    if (typeof handler !== "function") return;
    try {
      handler(payload);
    } catch {
      // ignore callback errors
    }
  }, false);

  let closed = false;
  return {
    toJSON() {
      return `__CHANNEL__:${callbackId}`;
    },
    close() {
      if (closed) return;
      closed = true;
      if (typeof unregister !== "function") return;
      try {
        unregister(callbackId);
      } catch {
        // ignore channel cleanup errors
      }
    },
  };
}

async function updaterCheck() {
  const updater = getGlobalUpdaterApi();
  if (updater && typeof updater.check === "function") {
    return await updater.check();
  }
  return await tauriInvoke("plugin:updater|check", {});
}

async function updaterDownloadAndInstall(update, onEvent) {
  if (!update) {
    throw new Error("No update metadata provided.");
  }
  if (typeof update.downloadAndInstall === "function") {
    await update.downloadAndInstall(onEvent);
    return;
  }
  const rid = Number(update?.rid);
  if (!Number.isFinite(rid) || rid <= 0) {
    throw new Error("Update metadata is missing rid. Please check for updates again.");
  }
  const channel = createTauriChannel(onEvent);
  try {
    await tauriInvoke("plugin:updater|download_and_install", { rid, onEvent: channel });
  } finally {
    channel.close();
  }
}

// Surface unexpected errors in the UI, otherwise the user experiences "nothing happens".
window.addEventListener("error", (ev) => {
  try {
    const payload = ev?.error || ev?.message || "Unknown error";
    reportFatal(payload, "UI error");
  } catch {
    // ignore
  }
});
window.addEventListener("unhandledrejection", (ev) => {
  try {
    const payload = ev?.reason || "Unknown rejection";
    reportFatal(payload, "Unhandled rejection");
  } catch {
    // ignore
  }
});

// Store sensitive values in OS keychain (Windows Credential Manager / macOS Keychain).
// We keep non-sensitive fields (URLs/ports/ids) in localStorage for convenience.
async function secureGet(k) {
  try {
    return await tauriInvoke("secure_get", { key: String(k || "") });
  } catch {
    return null;
  }
}

async function secureSet(k, v) {
  try {
    await tauriInvoke("secure_set", { key: String(k || ""), value: String(v ?? "") });
    return true;
  } catch {
    return false;
  }
}

async function secureDelete(k) {
  try {
    await tauriInvoke("secure_delete", { key: String(k || "") });
  } catch {
    // ignore
  }
}

function el(id) {
  return document.getElementById(id);
}

function normalizeUrl(raw) {
  let v = String(raw || "").trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) {
    const host = String(v.split("/")[0] || "").toLowerCase();
    const privateNet = host === "localhost" || host.startsWith("127.") || host.startsWith("10.") ||
      host.startsWith("192.168.") || host.startsWith("0.0.0.0") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    v = `${privateNet ? "http" : "https"}://${v}`;
  }
  return v.replace(/\/+$/, "");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEVICE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;

function parseUrlSafe(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

function isLocalOrPrivateHost(hostnameRaw) {
  const h = String(hostnameRaw || "").toLowerCase();
  return h === "localhost" || h === "0.0.0.0" || h.endsWith(".local") ||
    h.startsWith("127.") || h.startsWith("10.") || h.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h);
}

function validateCloudUrl(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) throw new Error("Cloud API URL is required.");
  const parsed = parseUrlSafe(normalized);
  if (!parsed) throw new Error("Cloud API URL is invalid.");
  if (parsed.protocol !== "https:" && !isLocalOrPrivateHost(parsed.hostname)) {
    throw new Error("Cloud API URL must use HTTPS (except localhost/private testing URLs).");
  }
  return normalized;
}

function parsePort(raw, label, fieldId = "") {
  const text = String(raw || "").trim();
  if (!text) throwFieldError(fieldId, `${label} is required.`);
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throwFieldError(fieldId, `${label} must be an integer between 1024 and 65535.`);
  }
  return n;
}

function normalizeDeviceCode(raw) {
  return String(raw || "").trim().toUpperCase();
}

function deriveSecondaryDeviceCode(primaryCodeRaw) {
  const primary = normalizeDeviceCode(primaryCodeRaw) || "POS-01";
  const base = primary.slice(0, 38) || "POS";
  const candidates = [`${base}-B`, `${base}-2`, `${base}2`, "POS-02"];
  for (const cand of candidates) {
    const code = String(cand || "").slice(0, 40);
    if (!DEVICE_CODE_RE.test(code)) continue;
    if (code !== primary) return code;
  }
  return "POS-02";
}

function throwFieldError(fieldId, message) {
  const err = new Error(String(message || "Invalid input."));
  err.fieldId = String(fieldId || "");
  throw err;
}

function clearInputError(id) {
  const n = el(id);
  if (!n) return;
  n.classList.remove("input-invalid");
  n.removeAttribute("aria-invalid");
  n.removeAttribute("title");
}

function markInputError(id, message) {
  const n = el(id);
  if (!n) return;
  n.classList.add("input-invalid");
  n.setAttribute("aria-invalid", "true");
  if (message) n.setAttribute("title", String(message));
}

function focusField(id) {
  const n = el(id);
  if (!n || typeof n.focus !== "function") return;
  n.focus();
}

function setStatus(msg) {
  el("status").textContent = msg || "";
}

function setDiag(msg) {
  const n = el("diag");
  if (n) n.textContent = msg || "";
}

function setVersionLabel() {
  const v = el("appVersion");
  if (!v) return;
  v.textContent = APP_VERSION;
}

async function loadAppVersion() {
  try {
    const current = await tauriInvoke("app_version");
    if (typeof current === "string" && current.trim()) {
      APP_VERSION = current.trim();
    }
  } catch {
    // keep fallback until native command responds
  }
}

function fmtNow() {
  try {
    return new Date().toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return String(Date.now());
  }
}

function stringifyError(err) {
  if (err instanceof Error) {
    const stack = String(err.stack || "").trim();
    return {
      message: err.message || "Error",
      stack,
    };
  }
  const msg = typeof err === "string" ? err : JSON.stringify(err);
  return { message: msg || "Unknown error", stack: "" };
}

function appendDebugLine(line) {
  const text = String(line || "").trim();
  if (!text) return;
  debugState.lines.push(text);
  if (debugState.lines.length > DEBUG_MAX_LINES) {
    debugState.lines = debugState.lines.slice(debugState.lines.length - DEBUG_MAX_LINES);
  }
  setDiag(debugState.lines.join("\n"));
}

async function persistDesktopLog(level, message, stack = "") {
  try {
    await tauriInvoke("frontend_log", {
      level: String(level || "info"),
      message: String(message || ""),
      stack: String(stack || ""),
    });
  } catch {
    // ignore
  }
}

function setSetupNote(msg, level = "info") {
  const n = el("setupNote");
  if (!n) return;
  n.textContent = msg || "";
  n.classList.remove("setup-note--error", "setup-note--warn", "setup-note--success");
  if (level === "error") n.classList.add("setup-note--error");
  else if (level === "warn") n.classList.add("setup-note--warn");
  else if (level === "success") n.classList.add("setup-note--success");
}

function setSetupChecklist(msg) {
  const n = el("setupChecklist");
  if (n) n.textContent = msg || "";
}

function setBtnBusy(btnId, busy, label = "Working…") {
  const b = el(btnId);
  if (!b) return;
  if (busy) {
    b.dataset.origLabel = b.textContent || "";
    b.textContent = label;
    b.disabled = true;
    return;
  }
  if (b.dataset.origLabel) b.textContent = b.dataset.origLabel;
  delete b.dataset.origLabel;
  b.disabled = false;
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to legacy copy
    }
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

function reportFatal(err, ctx = "Error") {
  const p = stringifyError(err);
  const msg = p.message;
  setStatus(`${ctx}: ${msg}`);
  setSetupNote(`${ctx}: ${msg}`, "error");
  appendDebugLine(`[${fmtNow()}] [error] ${ctx}: ${msg}`);
  if (p.stack) appendDebugLine(p.stack);
  persistDesktopLog("error", `${ctx}: ${msg}`, p.stack);
  try { console.error(err); } catch {}
}

function reportInfo(msg, ctx = "Info") {
  const text = `${ctx}: ${String(msg || "").trim()}`;
  appendDebugLine(`[${fmtNow()}] [info] ${text}`);
  persistDesktopLog("info", text, "");
}

const _consoleError = console.error?.bind(console);
const _consoleWarn = console.warn?.bind(console);
console.error = (...args) => {
  try { if (_consoleError) _consoleError(...args); } catch {}
  try {
    const text = args.map((x) => (x instanceof Error ? (x.stack || x.message) : String(x))).join(" ");
    appendDebugLine(`[${fmtNow()}] [console.error] ${text}`);
    persistDesktopLog("error", text, "");
  } catch {}
};
console.warn = (...args) => {
  try { if (_consoleWarn) _consoleWarn(...args); } catch {}
  try {
    const text = args.map((x) => (x instanceof Error ? (x.stack || x.message) : String(x))).join(" ");
    appendDebugLine(`[${fmtNow()}] [console.warn] ${text}`);
    persistDesktopLog("warn", text, "");
  } catch {}
};

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
  // New shape supports both cloudUrl + edgeUrl(LAN). Back-compat: edgeUrl/api_base_url treated as LAN.
  const cloudUrl =
    normalizeUrl(pack.cloudUrl || pack.cloud_url || pack.cloud_api_base_url || pack.cloudApiBaseUrl || "");
  const edgeLanUrl =
    normalizeUrl(
      pack.edgeLanUrl ||
        pack.edge_lan_url ||
        pack.edgeUrl ||
        pack.edge_url ||
        pack.edge_api_base_url ||
        pack.edgeApiBaseUrl ||
        pack.api_base_url ||
        pack.apiBaseUrl ||
        ""
    );
  if (cloudUrl) el("edgeUrl").value = cloudUrl;
  if (edgeLanUrl && el("edgeLanUrl")) el("edgeLanUrl").value = edgeLanUrl;

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

async function migrateSecretsFromLocalStorage() {
  // Best-effort: move any previously-saved secrets out of localStorage.
  const secrets = [
    KEY_PACK,
    KEY_DEV_TOK_OFFICIAL,
    KEY_DEV_TOK_UNOFFICIAL,
  ];
  for (const k of secrets) {
    const v = localStorage.getItem(k);
    if (!v) continue;
    const existing = await secureGet(k);
    if (!existing) {
      const ok = await secureSet(k, v);
      if (ok) localStorage.removeItem(k);
    } else {
      localStorage.removeItem(k);
    }
  }
}

async function load() {
  // Cloud pilot default: POS subdomain routes /api to the same backend.
  el("edgeUrl").value = localStorage.getItem(KEY_EDGE) || "https://app.melqard.com/api";
  if (el("edgeLanUrl")) el("edgeLanUrl").value = localStorage.getItem(KEY_EDGE_LAN) || "";
  await migrateSecretsFromLocalStorage();
  el("setupPack").value = (await secureGet(KEY_PACK)) || "";
  el("portOfficial").value = localStorage.getItem(KEY_PORT_OFFICIAL) || "7070";
  el("portUnofficial").value = localStorage.getItem(KEY_PORT_UNOFFICIAL) || "7072";
  el("companyOfficial").value = localStorage.getItem(KEY_CO_OFFICIAL) || "00000000-0000-0000-0000-000000000001";
  el("companyUnofficial").value = localStorage.getItem(KEY_CO_UNOFFICIAL) || "00000000-0000-0000-0000-000000000002";
  el("deviceIdOfficial").value = localStorage.getItem(KEY_DEV_ID_OFFICIAL) || "";
  el("deviceTokenOfficial").value = (await secureGet(KEY_DEV_TOK_OFFICIAL)) || "";
  el("deviceIdUnofficial").value = localStorage.getItem(KEY_DEV_ID_UNOFFICIAL) || "";
  el("deviceTokenUnofficial").value = (await secureGet(KEY_DEV_TOK_UNOFFICIAL)) || "";
  if (el("setupEmail")) el("setupEmail").value = localStorage.getItem(KEY_SETUP_EMAIL) || "";
  setVersionLabel();
  setStatus("");
  setDiag("");
  setSetupNote("");
  setQuickSetupStage("account", "active", "Enter Cloud API URL and credentials, then click Log In.");
  updateQuickSetupActionState();
}

async function waitForAgent(port, timeoutMs = 8000) {
  const url = `http://127.0.0.1:${port}/api/health`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return true;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function fetchEdgeStatus(port) {
  const url = `http://127.0.0.1:${port}/api/edge/status`;
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "GET" });
    const data = await res.json().catch(() => ({}));
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, error: data?.error || data?.detail || `HTTP ${res.status}` };
    return { ok: true, ms, data };
  } catch (e) {
    const ms = Date.now() - started;
    return { ok: false, ms, error: e instanceof Error ? e.message : String(e) };
  }
}

function fmtEdgeDiag(label, res) {
  if (!res) return `${label}: (no data)`;
  if (!res.ok) return `${label}: local agent error (${res.ms}ms) ${res.error || ""}`.trim();
  const d = res.data || {};
  const serverOk = !!d.edge_ok;
  const authOk = d.edge_auth_ok == null ? null : !!d.edge_auth_ok;
  const pend = Number(d.outbox_pending || 0);
  if (serverOk && (authOk === true || authOk == null)) {
    return `${label}: server OK${d.edge_latency_ms ? ` (${d.edge_latency_ms}ms)` : ""} · auth OK · queued ${pend}`;
  }
  if (serverOk && authOk === false) {
    const code = d.edge_auth_status ? ` (${d.edge_auth_status})` : "";
    const err = d.edge_auth_error ? ` - ${d.edge_auth_error}` : "";
    return `${label}: server OK · auth FAILED${code}${err} · queued ${pend}`;
  }
  const err = d.edge_error ? ` - ${d.edge_error}` : "";
  return `${label}: OFFLINE${err} · queued ${pend}`;
}

function edgeAuthNotice(label, res) {
  if (!res || !res.ok) return null;
  const d = res.data || {};
  if (d.edge_auth_ok !== false) return null;
  const code = d.edge_auth_status ? ` (${d.edge_auth_status})` : "";
  const rawErr = String(d.edge_auth_error || "").trim() || "Device token is missing or invalid.";
  const isSecondary = String(label || "").trim().toLowerCase().includes("secondary");
  const cfgPart = isSecondary
    ? "secondary device token or company mapping"
    : "primary device token or company mapping";
  return `${label}: auth failed${code}. ${rawErr} Verify ${cfgPart} in Advanced settings, then restart POS agents.`;
}

function fillSelect(selectEl, items, { placeholder = "Select…" } = {}) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  selectEl.appendChild(ph);
  for (const it of items || []) {
    const opt = document.createElement("option");
    opt.value = String(it.value || "");
    opt.textContent = String(it.label || it.value || "");
    selectEl.appendChild(opt);
  }
}

function agentBase(port) {
  return `http://127.0.0.1:${Number(port || 7070)}`;
}

function buildUnifiedUiUrl(port) {
  const ts = Date.now();
  return `${agentBase(port)}/?cb=${ts}`;
}

async function checkLatestUnifiedUi(port) {
  const url = `${agentBase(port)}/?check=1`;
  try {
    const resp = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

class ApiError extends Error {
  constructor(message, status, payload = null, path = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    this.path = path;
  }
}

async function jpostJson(base, path, payload) {
  const url = `${String(base || "").replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error || data?.detail || data?.hint || `HTTP ${res.status}`;
    const hint = data?.hint;
    const msg = typeof err === "string" ? err : JSON.stringify(err);
    const full = hint ? `${msg}. Hint: ${hint}` : msg;
    throw new ApiError(full, res.status, data, path);
  }
  return data;
}

async function jgetJson(base, path) {
  const url = `${String(base || "").replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error || data?.detail || data?.hint || `HTTP ${res.status}`;
    const hint = data?.hint;
    const msg = typeof err === "string" ? err : JSON.stringify(err);
    const full = hint ? `${msg}. Hint: ${hint}` : msg;
    throw new ApiError(full, res.status, data, path);
  }
  return data;
}

function isPosManageError(msg) {
  const x = String(msg || "").toLowerCase();
  return x.includes("pos:manage") || x.includes("permission denied") || x.includes("insufficient permission");
}

function isPermissionCheckUnavailable(err) {
  const status = typeof err?.status === "number" ? Number(err.status) : Number.NaN;
  if (Number.isFinite(status) && status === 404) return true;
  const msg = String(err?.payload?.error || err?.payload?.message || err?.message || "").toLowerCase();
  return msg.includes("not found") || msg.includes("endpoint") || msg.includes("unsupported");
}

function humanizeApiError(err) {
  if (err && typeof err === "object") {
    const payload = err.payload || {};
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const errMsg = payload.error || payload.detail || payload.hint || payload.message;
      const hint = payload.hint;
      const extras = [];
      if (hint && hint !== errMsg) extras.push(`Hint: ${hint}`);
      if (payload.company_id) extras.push(`company_id: ${payload.company_id}`);
      const base = typeof errMsg === "string" && errMsg.trim() ? errMsg : err.message;
      return `${base}${extras.length ? ` (${extras.join(", ")})` : ""}`;
    }
  }
  return err instanceof Error ? err.message : String(err || "Load failed");
}

function permissionHintForError(msg) {
  return isPosManageError(msg) ? "\nHint: your account must have permission pos:manage for each company." : "";
}

let quickSetup = {
  token: null,
  mfaToken: null,
  companies: [],
  apiBaseUrl: null,
  deviceCatalogByCompany: {},
};
let quickSetupDeviceLoadSeq = { official: 0, unofficial: 0 };
let quickSetupBusy = false;
const QUICK_SETUP_STEPS = ["account", "company", "permissions", "register", "start"];
const QUICK_SETUP_FIELD_IDS = [
  "edgeUrl",
  "portOfficial",
  "portUnofficial",
  "setupEmail",
  "setupPassword",
  "setupMfaCode",
  "setupCompanyOfficial",
  "setupCompanyUnofficial",
  "setupDeviceCodeOfficial",
  "setupDeviceCodeUnofficial",
];

function clearQuickSetupFieldErrors() {
  for (const id of QUICK_SETUP_FIELD_IDS) clearInputError(id);
}

function setQuickSetupStage(step, state = "active", checklist = "") {
  const idx = QUICK_SETUP_STEPS.indexOf(step);
  if (idx < 0) return;
  const nodes = Array.from(document.querySelectorAll("[data-setup-step]"));
  for (const node of nodes) {
    const s = String(node?.getAttribute?.("data-setup-step") || "");
    const si = QUICK_SETUP_STEPS.indexOf(s);
    node.classList.remove("setup-step--active", "setup-step--done", "setup-step--error");
    if (si < idx || (si === idx && state === "done")) {
      node.classList.add("setup-step--done");
      continue;
    }
    if (si === idx && state === "error") {
      node.classList.add("setup-step--error");
      continue;
    }
    if (si === idx) {
      node.classList.add("setup-step--active");
    }
  }
  if (checklist) setSetupChecklist(checklist);
}

function setQuickSetupBusyState(busy, activeBtnId = "", label = "Working…") {
  quickSetupBusy = !!busy;
  const ids = ["setupLoginBtn", "setupVerifyMfaBtn", "setupApplyBtn", "setupClearBtn"];
  if (quickSetupBusy) {
    for (const id of ids) {
      const b = el(id);
      if (!b) continue;
      b.disabled = true;
    }
    if (activeBtnId) setBtnBusy(activeBtnId, true, label);
    return;
  }
  for (const id of ids) {
    const b = el(id);
    if (!b) continue;
    if (b.dataset.origLabel) setBtnBusy(id, false);
    else b.disabled = false;
  }
  updateQuickSetupActionState();
}

function getActiveQuickSetupStepId() {
  const node = document.querySelector(".setup-step--active[data-setup-step]");
  return String(node?.getAttribute?.("data-setup-step") || "").trim();
}

function quickSetupFail(message, fieldId = "") {
  const msg = String(message || "Quick Setup validation failed.");
  const step = getActiveQuickSetupStepId();
  if (step) setQuickSetupStage(step, "error", msg);
  setSetupNote(msg, "error");
  setStatus(`Quick Setup: ${msg}`);
  if (fieldId) {
    markInputError(fieldId, msg);
    focusField(fieldId);
  }
  return false;
}

function collectSetupPorts() {
  const portOfficial = parsePort(el("portOfficial")?.value, "Primary agent port", "portOfficial");
  const portUnofficial = parsePort(el("portUnofficial")?.value, "Secondary agent port", "portUnofficial");
  if (portOfficial === portUnofficial) {
    throwFieldError("portUnofficial", "Primary and secondary ports must be different.");
  }
  return { portOfficial, portUnofficial };
}

function buildQuickSetupSnapshot() {
  const cloudUrl = normalizeUrl(el("edgeUrl")?.value || "");
  const officialCompany = String(el("setupCompanyOfficial")?.value || "").trim();
  const unofficialCompany = String(el("setupCompanyUnofficial")?.value || "").trim();
  const officialCode = normalizeDeviceCode(el("setupDeviceCodeOfficial")?.value || "");
  const unofficialCode = normalizeDeviceCode(el("setupDeviceCodeUnofficial")?.value || "");
  const branch = String(el("setupBranch")?.value || "").trim();
  const dual = quickSetupDualModeEnabled();
  const tokenState = quickSetup.token ? "present" : "missing";
  return [
    "=== Quick Setup Snapshot ===",
    `cloud_url=${cloudUrl || "(empty)"}`,
    `dual_mode=${dual ? "yes" : "no"}`,
    `primary_company=${officialCompany || "(empty)"}`,
    `secondary_company=${unofficialCompany || "(empty)"}`,
    `branch_id=${branch || "(none)"}`,
    `primary_device_code=${officialCode || "(empty)"}`,
    `secondary_device_code=${unofficialCode || "(empty)"}`,
    `session_token=${tokenState}`,
  ].join("\n");
}

function buildStartSnapshot() {
  const cloudUrl = normalizeUrl(el("edgeUrl")?.value || "");
  const portOfficial = String(el("portOfficial")?.value || "").trim();
  const portUnofficial = String(el("portUnofficial")?.value || "").trim();
  const companyOfficial = String(el("companyOfficial")?.value || "").trim();
  const companyUnofficial = String(el("companyUnofficial")?.value || "").trim();
  const deviceIdOfficial = String(el("deviceIdOfficial")?.value || "").trim();
  const deviceIdUnofficial = String(el("deviceIdUnofficial")?.value || "").trim();
  const tokO = String(el("deviceTokenOfficial")?.value || "").trim();
  const tokU = String(el("deviceTokenUnofficial")?.value || "").trim();
  return [
    "=== Start Configuration Snapshot ===",
    `cloud_url=${cloudUrl || "(empty)"}`,
    `port_primary=${portOfficial || "(empty)"}`,
    `port_secondary=${portUnofficial || "(empty)"}`,
    `company_primary=${companyOfficial || "(empty)"}`,
    `company_secondary=${companyUnofficial || "(empty)"}`,
    `device_id_primary=${deviceIdOfficial || "(empty)"}`,
    `device_id_secondary=${deviceIdUnofficial || "(empty)"}`,
    `token_primary=${tokO ? "present" : "missing"}`,
    `token_secondary=${tokU ? "present" : "missing"}`,
  ].join("\n");
}

function updateQuickSetupActionState() {
  const loginBtn = el("setupLoginBtn");
  const verifyBtn = el("setupVerifyMfaBtn");
  const applyBtn = el("setupApplyBtn");
  const clearBtn = el("setupClearBtn");

  const email = String(el("setupEmail")?.value || "").trim();
  const pass = String(el("setupPassword")?.value || "");
  const mfaCode = String(el("setupMfaCode")?.value || "").trim();
  const hasCompany = String(el("setupCompanyOfficial")?.value || "").trim().length > 0;

  if (loginBtn) loginBtn.disabled = quickSetupBusy || !email || !pass;
  if (verifyBtn) verifyBtn.disabled = quickSetupBusy || !quickSetup.mfaToken || !mfaCode;
  if (applyBtn) applyBtn.disabled = quickSetupBusy || !quickSetup.token || !hasCompany;
  if (clearBtn) clearBtn.disabled = quickSetupBusy;
}

function quickSetupDualModeEnabled() {
  return !!el("setupDualMode")?.checked;
}

function syncQuickSetupSecondarySelection() {
  if (quickSetupDualModeEnabled()) return;
  if (el("setupCompanyUnofficial")) {
    el("setupCompanyUnofficial").value = String(el("setupCompanyOfficial")?.value || "").trim();
    clearInputError("setupCompanyUnofficial");
  }
}

function updateQuickSetupModeUI() {
  const dual = quickSetupDualModeEnabled();
  const secondaryWrap = el("setupSecondaryWrap");
  const secondaryCodeWrap = el("setupSecondaryCodeWrap");
  if (secondaryWrap) secondaryWrap.style.display = dual ? "" : "none";
  if (secondaryCodeWrap) secondaryCodeWrap.style.display = dual ? "" : "none";
  syncQuickSetupSecondarySelection();
  applySetupDeviceSelection("official", { silent: true });
  const primaryCode = normalizeDeviceCode(el("setupDeviceCodeOfficial")?.value || "");
  if (!dual && el("setupDeviceCodeUnofficial")) {
    const current = normalizeDeviceCode(el("setupDeviceCodeUnofficial")?.value || "");
    if (!current || current === primaryCode || !DEVICE_CODE_RE.test(current)) {
      el("setupDeviceCodeUnofficial").value = deriveSecondaryDeviceCode(primaryCode);
    }
    if (el("setupDeviceSelectUnofficial")) {
      el("setupDeviceSelectUnofficial").value = "";
    }
    const unCodeEl = el("setupDeviceCodeUnofficial");
    if (unCodeEl) {
      unCodeEl.readOnly = false;
      unCodeEl.removeAttribute("aria-readonly");
    }
  } else {
    applySetupDeviceSelection("unofficial", { silent: true });
  }
  updateQuickSetupActionState();
}

async function ensureAgentsRunningForSetup() {
  const cloudUrl = validateCloudUrl(el("edgeUrl").value);
  const edgeLanUrl = "";
  const { portOfficial, portUnofficial } = collectSetupPorts();

  await tauriInvoke("start_setup_agent", {
    edgeUrl: cloudUrl,
    edgeLanUrl,
    portOfficial,
    companyOfficial: null,
    deviceIdOfficial: null,
    deviceTokenOfficial: null,
  });

  const ok = await waitForAgent(portOfficial, 8000);
  if (!ok) {
    throw new Error(
      `Local primary agent did not become reachable on port ${portOfficial}. If this port is already in use, stop external pos-desktop/agent.py processes and retry.`
    );
  }
  return { cloudUrl, edgeLanUrl, portOfficial, portUnofficial };
}

function normalizeCompanyList(companies) {
  const out = [];
  for (const c of companies || []) {
    const id = String(c?.id || "").trim();
    const name = String(c?.name || c?.legal_name || id || "").trim();
    if (!id) continue;
    out.push({ value: id, label: name });
  }
  return out;
}

function getCompanyNameById(id) {
  const target = String(id || "").trim().toLowerCase();
  if (!target) return "selected company";
  for (const c of quickSetup.companies || []) {
    if (String(c?.id || "").trim().toLowerCase() === target) {
      return String(c?.name || c?.legal_name || target).trim() || target;
    }
  }
  return target;
}

function normalizeCompanyLabel(label, companyId) {
  const raw = String(label || "").trim();
  const lowered = raw.toLowerCase();
  if (raw && lowered !== "undefined" && lowered !== "null" && lowered !== "unknown") return raw;
  const fallbackId = String(companyId || "").trim();
  return fallbackId || "selected company";
}

function setupDeviceConfig(kind) {
  if (kind === "unofficial") {
    return {
      kind: "unofficial",
      label: "Secondary",
      companyId: "setupCompanyUnofficial",
      selectId: "setupDeviceSelectUnofficial",
      codeId: "setupDeviceCodeUnofficial",
      defaultCode: "POS-02",
    };
  }
  return {
    kind: "official",
    label: "Primary",
    companyId: "setupCompanyOfficial",
    selectId: "setupDeviceSelectOfficial",
    codeId: "setupDeviceCodeOfficial",
    defaultCode: "POS-01",
  };
}

function normalizeSetupDeviceList(devices) {
  const out = [];
  const seen = new Set();
  for (const d of devices || []) {
    const code = normalizeDeviceCode(d?.device_code || "");
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({
      id: String(d?.id || "").trim(),
      device_code: code,
      branch_id: String(d?.branch_id || "").trim(),
      branch_name: String(d?.branch_name || "").trim(),
      has_token: !!d?.has_token,
    });
  }
  out.sort((a, b) => String(a.device_code || "").localeCompare(String(b.device_code || "")));
  return out;
}

function setupDeviceFromCatalog(companyId, deviceCode) {
  const cid = String(companyId || "").trim();
  const code = normalizeDeviceCode(deviceCode || "");
  if (!cid || !code) return null;
  const rows = Array.isArray(quickSetup.deviceCatalogByCompany?.[cid]) ? quickSetup.deviceCatalogByCompany[cid] : [];
  for (const row of rows) {
    if (normalizeDeviceCode(row?.device_code || "") === code) return row;
  }
  return null;
}

function selectedSetupDevice(kind) {
  const cfg = setupDeviceConfig(kind);
  const companyId = String(el(cfg.companyId)?.value || "").trim();
  const selectedCode = normalizeDeviceCode(el(cfg.selectId)?.value || "");
  if (!companyId || !selectedCode) return null;
  return setupDeviceFromCatalog(companyId, selectedCode);
}

function syncBranchFromSelectedPrimaryDevice({ silent = false } = {}) {
  const selected = selectedSetupDevice("official");
  const branchEl = el("setupBranch");
  if (!selected || !branchEl) return;
  const branchId = String(selected?.branch_id || "").trim();
  if (!branchId) return;
  const hasOption = Array.from(branchEl.options || []).some((opt) => String(opt?.value || "").trim() === branchId);
  const current = String(branchEl.value || "").trim();
  if (hasOption) {
    if (current !== branchId) {
      branchEl.value = branchId;
      if (!silent) {
        const branchLabel = String(selected?.branch_name || branchId).trim() || branchId;
        setSetupNote(`Branch auto-selected from Primary POS device (${branchLabel}).`, "warn");
      }
    }
    return;
  }
  if (!silent) {
    const branchLabel = String(selected?.branch_name || branchId).trim() || branchId;
    setSetupNote(
      `Primary POS device is assigned to branch ${branchLabel}, but that branch is not available in the current branch list.`,
      "warn",
    );
  }
}

function applySetupDeviceSelection(kind, { silent = false } = {}) {
  const cfg = setupDeviceConfig(kind);
  const pickEl = el(cfg.selectId);
  const codeEl = el(cfg.codeId);
  if (!codeEl) return;

  const selectedCode = normalizeDeviceCode(pickEl?.value || "");
  if (selectedCode) {
    codeEl.value = selectedCode;
    codeEl.readOnly = true;
    codeEl.setAttribute("aria-readonly", "true");
    if (kind === "official") syncBranchFromSelectedPrimaryDevice({ silent });
    return;
  }

  codeEl.readOnly = false;
  codeEl.removeAttribute("aria-readonly");
  const normalized = normalizeDeviceCode(codeEl.value || "");
  codeEl.value = normalized || cfg.defaultCode;
  if (kind === "official") syncBranchFromSelectedPrimaryDevice({ silent });
}

function fillSetupDevicePicker(kind, devices) {
  const cfg = setupDeviceConfig(kind);
  const pickEl = el(cfg.selectId);
  if (!pickEl) return;

  const current = normalizeDeviceCode(pickEl.value || "");
  const list = normalizeSetupDeviceList(devices).map((d) => ({
    value: d.device_code,
    label: d.branch_name ? `${d.device_code} (${d.branch_name})` : d.device_code,
  }));
  fillSelect(pickEl, list, { placeholder: "Create new POS code (manual)..." });
  if (current && list.some((x) => normalizeDeviceCode(x.value) === current)) {
    pickEl.value = current;
  } else {
    pickEl.value = "";
  }
  applySetupDeviceSelection(kind, { silent: true });
}

async function quickSetupLoadDevicesForCompany(companyId, { force = false } = {}) {
  const cid = String(companyId || "").trim();
  if (!cid || !quickSetup.token || !quickSetup.apiBaseUrl) return [];
  if (!UUID_RE.test(cid)) return [];
  if (!force && Array.isArray(quickSetup.deviceCatalogByCompany?.[cid])) {
    return quickSetup.deviceCatalogByCompany[cid];
  }

  let portOfficial = 7070;
  try {
    portOfficial = parsePort(el("portOfficial")?.value, "Primary agent port", "portOfficial");
  } catch {
    return [];
  }
  const base = agentBase(portOfficial);
  const res = await jpostJson(base, "/api/setup/devices", {
    api_base_url: quickSetup.apiBaseUrl,
    token: quickSetup.token,
    company_id: cid,
  });
  const devices = normalizeSetupDeviceList(res?.devices || []);
  quickSetup.deviceCatalogByCompany = { ...(quickSetup.deviceCatalogByCompany || {}), [cid]: devices };
  return devices;
}

async function quickSetupRefreshDevicePicker(kind, { silent = false } = {}) {
  const cfg = setupDeviceConfig(kind);
  const pickEl = el(cfg.selectId);
  if (!pickEl) return;

  const companyId = String(el(cfg.companyId)?.value || "").trim();
  if (!companyId || !quickSetup.token || !quickSetup.apiBaseUrl || !UUID_RE.test(companyId)) {
    fillSelect(pickEl, [], { placeholder: "Select company first..." });
    pickEl.value = "";
    applySetupDeviceSelection(kind, { silent: true });
    return;
  }

  const seq = (quickSetupDeviceLoadSeq[kind] || 0) + 1;
  quickSetupDeviceLoadSeq[kind] = seq;
  fillSelect(pickEl, [], { placeholder: "Loading POS devices..." });

  try {
    const devices = await quickSetupLoadDevicesForCompany(companyId);
    if (quickSetupDeviceLoadSeq[kind] !== seq) return;
    fillSetupDevicePicker(kind, devices);
  } catch (e) {
    if (quickSetupDeviceLoadSeq[kind] !== seq) return;
    fillSelect(pickEl, [], { placeholder: "Could not load devices; enter code manually..." });
    pickEl.value = "";
    applySetupDeviceSelection(kind, { silent: true });
    if (!silent) {
      const msg = e instanceof Error ? e.message : String(e);
      setSetupNote(`${cfg.label} POS list unavailable (${msg}). You can still enter a device code manually.`, "warn");
    }
  }
}

async function quickSetupCheckCompanyPermissions(base, apiBaseUrl, token, companyId, companyLabel) {
  try {
    const response = await jpostJson(base, "/api/setup/check-permissions", {
      api_base_url: apiBaseUrl,
      token,
      company_id: companyId,
    });
    if (!response || response.ok !== true) {
      const msg = response?.error || "Could not verify permissions";
      return { companyId, companyLabel, hasPermission: false, error: String(msg || "Could not verify permissions") };
    }
    return {
      companyId,
      companyLabel,
      hasPermission: !!response.has_pos_manage,
      error: response.has_pos_manage ? null : (response.error || "permission denied"),
      permissionEndpointSupported: true,
    };
  } catch (e) {
    if (isPermissionCheckUnavailable(e)) {
      return {
        companyId,
        companyLabel,
        hasPermission: true,
        error: "Permission check endpoint unavailable. Continuing and letting registration enforce permissions.",
        permissionEndpointSupported: false,
      };
    }
    const msg = humanizeApiError(e);
    return { companyId, companyLabel, hasPermission: false, error: String(msg || "Could not verify permissions") };
  }
}

async function quickSetupLogin() {
  if (quickSetupBusy) return;
  clearQuickSetupFieldErrors();
  setSetupNote("");
  setStatus("");
  setQuickSetupStage("account", "active", "Verify account credentials and Cloud API URL.");
  setQuickSetupBusyState(true, "setupLoginBtn", "Logging in…");
  try {
    const email = String(el("setupEmail").value || "").trim();
    const password = String(el("setupPassword").value || "");
    if (!email) return quickSetupFail("Enter your email address.", "setupEmail");
    if (!EMAIL_RE.test(email)) return quickSetupFail("Email format looks invalid.", "setupEmail");
    if (!password) return quickSetupFail("Enter your password.", "setupPassword");
    const cloudUrlInput = String(el("edgeUrl")?.value || "");
    try {
      validateCloudUrl(cloudUrlInput);
      clearInputError("edgeUrl");
    } catch (e) {
      return quickSetupFail(e instanceof Error ? e.message : String(e), "edgeUrl");
    }
    localStorage.setItem(KEY_SETUP_EMAIL, email);

    const { cloudUrl, portOfficial } = await ensureAgentsRunningForSetup();
    quickSetup.apiBaseUrl = cloudUrl;
    const base = agentBase(portOfficial);

    setSetupChecklist("Logging in and loading available companies…");
    setSetupNote("Logging in…", "warn");
    setStatus("Quick Setup: logging in…");
    const res = await jpostJson(base, "/api/setup/login", {
      api_base_url: cloudUrl,
      email,
      password,
    });

    if (res?.mfa_required) {
      quickSetup.mfaToken = String(res?.mfa_token || "").trim() || null;
      quickSetup.token = null;
      el("setupMfaWrap").style.display = "";
      setSetupChecklist("MFA is required for this account. Enter the code to continue.");
      setSetupNote("MFA required. Enter your code and click Verify MFA.", "warn");
      setStatus("Quick Setup: MFA required.");
      updateQuickSetupActionState();
      return;
    }

    quickSetup.token = String(res?.token || "").trim() || null;
    quickSetup.mfaToken = null;
    quickSetup.companies = Array.isArray(res?.companies) ? res.companies : [];
    quickSetup.deviceCatalogByCompany = {};
    el("setupMfaWrap").style.display = "none";

    const list = normalizeCompanyList(quickSetup.companies);
    fillSelect(el("setupCompanyOfficial"), list, { placeholder: "Select primary company…" });
    fillSelect(el("setupCompanyUnofficial"), list, { placeholder: "Select secondary company…" });
    fillSelect(el("setupBranch"), [], { placeholder: "Select branch (optional)…" });
    fillSelect(el("setupDeviceSelectOfficial"), [], { placeholder: "Loading POS devices..." });
    fillSelect(el("setupDeviceSelectUnofficial"), [], { placeholder: "Loading POS devices..." });

    const active = String(res?.active_company_id || "").trim();
    if (active) {
      el("setupCompanyOfficial").value = active;
      el("setupCompanyUnofficial").value = active;
    }

    updateQuickSetupModeUI();
    setQuickSetupStage("company", "active", "Select company, branch, and device codes.");
    setSetupNote("Logged in. Select your company and branch, then generate setup.", "success");
    setStatus("Quick Setup: logged in.");
    await Promise.allSettled([
      quickSetupLoadBranches(),
      quickSetupRefreshDevicePicker("official", { silent: true }),
      quickSetupRefreshDevicePicker("unofficial", { silent: true }),
    ]);
  } catch (e) {
    const msg = humanizeApiError(e);
    if (e?.fieldId) {
      markInputError(e.fieldId, msg);
      focusField(e.fieldId);
    }
    setQuickSetupStage("account", "error", "Login failed. Review credentials and cloud URL.");
    setSetupNote(`Quick Setup login failed: ${msg}`, "error");
    setStatus(`Quick Setup login failed: ${msg}`);
    appendDebugLine(buildQuickSetupSnapshot());
    reportFatal(e, "Quick Setup login failed");
  } finally {
    setQuickSetupBusyState(false, "setupLoginBtn");
  }
}

async function quickSetupVerifyMfa() {
  if (quickSetupBusy) return;
  clearQuickSetupFieldErrors();
  setSetupNote("");
  setStatus("");
  setQuickSetupStage("account", "active", "Verifying MFA code.");
  setQuickSetupBusyState(true, "setupVerifyMfaBtn", "Verifying…");
  try {
    const code = String(el("setupMfaCode").value || "").trim();
    if (!quickSetup.mfaToken) {
      return quickSetupFail("Missing MFA token. Click Login again.", "setupMfaCode");
    }
    if (!code) {
      return quickSetupFail("Enter your MFA code.", "setupMfaCode");
    }
    if (!/^\d{4,8}$/.test(code)) {
      return quickSetupFail("MFA code must be 4 to 8 digits.", "setupMfaCode");
    }
    const { cloudUrl, portOfficial } = await ensureAgentsRunningForSetup();
    const base = agentBase(portOfficial);
    setSetupChecklist("MFA verification unlocks company selection.");
    setSetupNote("Verifying MFA…", "warn");
    setStatus("Quick Setup: verifying MFA…");
    const res = await jpostJson(base, "/api/setup/login", {
      api_base_url: cloudUrl,
      mfa_token: quickSetup.mfaToken,
      mfa_code: code,
    });
    if (res?.mfa_required) {
      setQuickSetupStage("account", "error", "MFA code was rejected. Retry with a fresh code.");
      setSetupNote("MFA still required. Double-check the code and retry.", "error");
      return;
    }
    quickSetup.token = String(res?.token || "").trim() || null;
    quickSetup.mfaToken = null;
    quickSetup.companies = Array.isArray(res?.companies) ? res.companies : [];
    quickSetup.deviceCatalogByCompany = {};
    el("setupMfaWrap").style.display = "none";

    const list = normalizeCompanyList(quickSetup.companies);
    fillSelect(el("setupCompanyOfficial"), list, { placeholder: "Select primary company…" });
    fillSelect(el("setupCompanyUnofficial"), list, { placeholder: "Select secondary company…" });
    fillSelect(el("setupDeviceSelectOfficial"), [], { placeholder: "Loading POS devices..." });
    fillSelect(el("setupDeviceSelectUnofficial"), [], { placeholder: "Loading POS devices..." });
    updateQuickSetupModeUI();
    setQuickSetupStage("company", "active", "Select company, branch, and device codes.");
    setSetupNote("MFA verified. Select your company and branch, then generate setup.", "success");
    setStatus("Quick Setup: MFA verified.");
    await Promise.allSettled([
      quickSetupLoadBranches(),
      quickSetupRefreshDevicePicker("official", { silent: true }),
      quickSetupRefreshDevicePicker("unofficial", { silent: true }),
    ]);
  } catch (e) {
    const msg = humanizeApiError(e);
    if (e?.fieldId) {
      markInputError(e.fieldId, msg);
      focusField(e.fieldId);
    }
    setQuickSetupStage("account", "error", "MFA verification failed. Retry.");
    setSetupNote(`Quick Setup MFA failed: ${msg}`, "error");
    setStatus(`Quick Setup MFA failed: ${msg}`);
    appendDebugLine(buildQuickSetupSnapshot());
    reportFatal(e, "Quick Setup MFA failed");
  } finally {
    setQuickSetupBusyState(false, "setupVerifyMfaBtn");
  }
}

async function quickSetupLoadBranches() {
  const companyId = String(el("setupCompanyOfficial")?.value || "").trim();
  if (!companyId || !quickSetup.token || !quickSetup.apiBaseUrl) return;
  if (!UUID_RE.test(companyId)) {
    markInputError("setupCompanyOfficial", "Company ID format is invalid.");
    setSetupNote("Primary company ID format looks invalid.", "error");
    return;
  }
  clearInputError("setupCompanyOfficial");
  let portOfficial = 7070;
  try {
    portOfficial = parsePort(el("portOfficial")?.value, "Primary agent port", "portOfficial");
    clearInputError("portOfficial");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    markInputError("portOfficial", msg);
    setSetupNote(msg, "error");
    return;
  }
  const base = agentBase(portOfficial);
  try {
    const res = await jpostJson(base, "/api/setup/branches", {
      api_base_url: quickSetup.apiBaseUrl,
      token: quickSetup.token,
      company_id: companyId,
    });
    const branches = Array.isArray(res?.branches) ? res.branches : [];
    const items = branches
      .map((b) => ({
        value: String(b?.id || "").trim(),
        label: String(b?.name || b?.code || b?.id || "").trim(),
      }))
      .filter((x) => x.value);
    fillSelect(el("setupBranch"), items, { placeholder: "Select branch (optional)…" });
    syncBranchFromSelectedPrimaryDevice({ silent: true });
    if (res?.warning) setSetupNote(String(res.warning), "warn");
  } catch (e) {
    // Non-fatal; branches can be permissioned.
    setSetupNote(`Branch list unavailable. You can proceed. (${e instanceof Error ? e.message : String(e)})`, "warn");
    fillSelect(el("setupBranch"), [], { placeholder: "Branch list unavailable…" });
  }
}

async function quickSetupApply() {
  if (quickSetupBusy) return;
  clearQuickSetupFieldErrors();
  setSetupNote("");
  setStatus("");
  setQuickSetupStage("company", "active", "Validating company, branch, and device code inputs.");
  setQuickSetupBusyState(true, "setupApplyBtn", "Generating…");
  let stage = "company";
  try {
    if (!quickSetup.token || !quickSetup.apiBaseUrl) {
      return quickSetupFail("Please log in first.", "setupEmail");
    }

    try {
      validateCloudUrl(el("edgeUrl")?.value || "");
      clearInputError("edgeUrl");
    } catch (e) {
      return quickSetupFail(e instanceof Error ? e.message : String(e), "edgeUrl");
    }

    let ports = null;
    try {
      ports = collectSetupPorts();
      clearInputError("portOfficial");
      clearInputError("portUnofficial");
    } catch (e) {
      markInputError("portOfficial", e instanceof Error ? e.message : String(e));
      markInputError("portUnofficial", e instanceof Error ? e.message : String(e));
      focusField("portOfficial");
      return quickSetupFail(e instanceof Error ? e.message : String(e));
    }

    const dualMode = quickSetupDualModeEnabled();
    const companyOfficial = String(el("setupCompanyOfficial").value || "").trim();
    const companyUnofficial = dualMode
      ? String(el("setupCompanyUnofficial").value || "").trim()
      : companyOfficial;
    const branchId = String(el("setupBranch").value || "").trim();
    const selectedDeviceCodeOfficial = normalizeDeviceCode(el("setupDeviceSelectOfficial")?.value || "");
    const selectedDeviceCodeUnofficial = normalizeDeviceCode(el("setupDeviceSelectUnofficial")?.value || "");
    const deviceCodeOfficial = selectedDeviceCodeOfficial || normalizeDeviceCode(el("setupDeviceCodeOfficial").value || "") || "POS-01";
    const deviceCodeUnofficial = dualMode
      ? (selectedDeviceCodeUnofficial || normalizeDeviceCode(el("setupDeviceCodeUnofficial").value || "") || "POS-02")
      : deriveSecondaryDeviceCode(deviceCodeOfficial);
    const selectedOfficialDevice = setupDeviceFromCatalog(companyOfficial, deviceCodeOfficial);
    const selectedUnofficialDevice = setupDeviceFromCatalog(companyUnofficial, deviceCodeUnofficial);
    let branchIdOfficial = branchId;
    if (selectedOfficialDevice?.branch_id) {
      branchIdOfficial = String(selectedOfficialDevice.branch_id).trim();
    }
    let branchIdUnofficial = companyOfficial === companyUnofficial ? branchIdOfficial : "";
    if (selectedUnofficialDevice?.branch_id) {
      branchIdUnofficial = String(selectedUnofficialDevice.branch_id).trim();
    }

    el("setupDeviceCodeOfficial").value = deviceCodeOfficial;
    el("setupDeviceCodeUnofficial").value = deviceCodeUnofficial;

    if (!companyOfficial) return quickSetupFail("Select the primary company.", "setupCompanyOfficial");
    if (!UUID_RE.test(companyOfficial)) return quickSetupFail("Primary company ID format is invalid.", "setupCompanyOfficial");
    if (dualMode && !companyUnofficial) return quickSetupFail("Select the secondary company or turn off secondary mode.", "setupCompanyUnofficial");
    if (dualMode && !UUID_RE.test(companyUnofficial)) return quickSetupFail("Secondary company ID format is invalid.", "setupCompanyUnofficial");
    if (branchId && !UUID_RE.test(branchId)) return quickSetupFail("Branch ID format is invalid.", "setupBranch");
    if (!DEVICE_CODE_RE.test(deviceCodeOfficial)) {
      return quickSetupFail("Primary device code must be 2-40 chars (A-Z, 0-9, _ or -).", "setupDeviceCodeOfficial");
    }
    if (!DEVICE_CODE_RE.test(deviceCodeUnofficial)) {
      return quickSetupFail("Secondary device code must be 2-40 chars (A-Z, 0-9, _ or -).", "setupDeviceCodeUnofficial");
    }
    if (companyOfficial === companyUnofficial && deviceCodeOfficial === deviceCodeUnofficial) {
      return quickSetupFail(
        "When primary and secondary point to the same company, device codes must be different.",
        "setupDeviceCodeUnofficial",
      );
    }

    const branchWarnings = [];
    if (branchId && selectedOfficialDevice?.branch_id && branchId !== branchIdOfficial) {
      const branchLabel = String(selectedOfficialDevice?.branch_name || branchIdOfficial).trim() || branchIdOfficial;
      branchWarnings.push(`Primary POS device is assigned to ${branchLabel}; setup will use that branch.`);
    }
    if (
      dualMode &&
      companyOfficial === companyUnofficial &&
      selectedOfficialDevice?.branch_id &&
      selectedUnofficialDevice?.branch_id &&
      branchIdOfficial !== branchIdUnofficial
    ) {
      const offBranch = String(selectedOfficialDevice?.branch_name || branchIdOfficial).trim() || branchIdOfficial;
      const unBranch = String(selectedUnofficialDevice?.branch_name || branchIdUnofficial).trim() || branchIdUnofficial;
      branchWarnings.push(`Primary/Secondary selected devices are on different branches (${offBranch} vs ${unBranch}); each agent will keep its device branch.`);
    }
    if (branchWarnings.length) {
      setSetupNote(branchWarnings[0], "warn");
      appendDebugLine(`Quick Setup branch warning: ${branchWarnings.join(" | ")}`);
    }

    const { cloudUrl, portOfficial, portUnofficial } = await ensureAgentsRunningForSetup();
    if (!ports || portOfficial !== ports.portOfficial || portUnofficial !== ports.portUnofficial) {
      setSetupChecklist("Ports were updated while setup was running. Review before retrying if needed.");
    }
    const base = agentBase(portOfficial);

    stage = "permissions";
    setQuickSetupStage("permissions", "active", "Checking pos:manage permissions on selected companies.");
    setSetupNote("Checking pos:manage permission for selected companies…", "warn");
    setStatus("Quick Setup: checking permissions…");
    const officialName = normalizeCompanyLabel(getCompanyNameById(companyOfficial), companyOfficial);
    const unofficialName = normalizeCompanyLabel(getCompanyNameById(companyUnofficial), companyUnofficial);
    const permissionChecks = await Promise.all([
      quickSetupCheckCompanyPermissions(base, cloudUrl, quickSetup.token, companyOfficial, officialName),
      ...(companyOfficial !== companyUnofficial
        ? [quickSetupCheckCompanyPermissions(base, cloudUrl, quickSetup.token, companyUnofficial, unofficialName)]
        : []),
    ]);

    const missing = permissionChecks.filter((x) => !x.hasPermission);
    if (missing.length) {
      const names = [
        ...new Set(
          missing
            .map((m) => normalizeCompanyLabel(m?.companyLabel, m?.companyId))
            .filter(Boolean),
        ),
      ];
      setStatus(`Quick Setup: permission check failed for ${names.join(", ")}.`);
      if (companyOfficial === companyUnofficial) {
        const label = names[0] || "selected company";
        setQuickSetupStage("permissions", "error", "Permission check failed. Grant pos:manage and retry.");
        setSetupNote(`Quick Setup: ${label} lacks pos:manage. Grant pos:manage to this account, then retry.`, "error");
      } else {
        const lines = names
          .map((n) => `${n} missing pos:manage. Grant permission and retry.`)
          .join(" | ");
        setQuickSetupStage("permissions", "error", "Permission check failed. Grant pos:manage and retry.");
        setSetupNote(lines, "error");
      }
      return;
    }

    const unavailable = permissionChecks.filter((r) => r && r.permissionEndpointSupported === false);
    if (unavailable.length) {
      setSetupNote(
        `Permission check endpoint unavailable for ${[...new Set(unavailable.map((x) => x.companyLabel || x.companyId))].join(", ")}. Continuing with registration checks.`,
        "warn",
      );
    }

    stage = "register";
    setQuickSetupStage("register", "active", "Registering devices and applying credentials to local agents.");
    setSetupNote("Registering POS devices…", "warn");
    setStatus("Quick Setup: registering devices…");
    const registerDevice = async (kind, companyId, branchId, deviceCode) => {
      try {
        return await jpostJson(base, "/api/setup/register-device", {
          api_base_url: cloudUrl,
          token: quickSetup.token,
          company_id: companyId,
          branch_id: branchId,
          device_code: deviceCode,
          reset_token: true,
        });
      } catch (e) {
        const msg = humanizeApiError(e);
        throw new Error(`${kind} company register-device failed: ${msg}`);
      }
    };

    const officialReg = await registerDevice("Official", companyOfficial, branchIdOfficial, deviceCodeOfficial);
    const unofficialReg = await registerDevice(
      "Unofficial",
      companyUnofficial,
      branchIdUnofficial,
      deviceCodeUnofficial,
    );

    const deviceIdOfficial = String(officialReg?.device_id || "").trim();
    const deviceTokenOfficial = String(officialReg?.device_token || "").trim();
    const deviceIdUnofficial = String(unofficialReg?.device_id || "").trim();
    const deviceTokenUnofficial = String(unofficialReg?.device_token || "").trim();
    if (!UUID_RE.test(deviceIdOfficial) || !deviceTokenOfficial || !UUID_RE.test(deviceIdUnofficial) || !deviceTokenUnofficial) {
      setQuickSetupStage("register", "error", "Registration response was incomplete.");
      setSetupNote("Device registration returned incomplete credentials. Please retry.", "error");
      return;
    }

    // Persist into the existing (advanced) fields so Start POS keeps working even without Quick Setup.
    el("companyOfficial").value = companyOfficial;
    el("companyUnofficial").value = companyUnofficial;
    el("deviceIdOfficial").value = deviceIdOfficial;
    el("deviceTokenOfficial").value = deviceTokenOfficial;
    el("deviceIdUnofficial").value = deviceIdUnofficial;
    el("deviceTokenUnofficial").value = deviceTokenUnofficial;

    localStorage.setItem(KEY_EDGE, cloudUrl);
    localStorage.setItem(KEY_EDGE_LAN, "");
    localStorage.setItem(KEY_CO_OFFICIAL, companyOfficial);
    localStorage.setItem(KEY_CO_UNOFFICIAL, companyUnofficial);
    localStorage.setItem(KEY_DEV_ID_OFFICIAL, deviceIdOfficial);
    localStorage.setItem(KEY_DEV_ID_UNOFFICIAL, deviceIdUnofficial);
    await secureSet(KEY_DEV_TOK_OFFICIAL, deviceTokenOfficial);
    await secureSet(KEY_DEV_TOK_UNOFFICIAL, deviceTokenUnofficial);

    // Patch the agent config files live (agent reloads config on each request) so the POS can sync immediately.
    setSetupNote("Applying config to local agents…", "warn");
    setStatus("Quick Setup: applying local config…");
    await jpostJson(agentBase(portOfficial), "/api/config", {
      api_base_url: cloudUrl,
      edge_api_base_url: "",
      cloud_api_base_url: cloudUrl,
      company_id: companyOfficial,
      branch_id: branchIdOfficial,
      device_code: deviceCodeOfficial,
      device_id: deviceIdOfficial,
      device_token: deviceTokenOfficial,
    });
    try {
      await jpostJson(agentBase(portUnofficial), "/api/config", {
        api_base_url: cloudUrl,
        edge_api_base_url: "",
        cloud_api_base_url: cloudUrl,
        company_id: companyUnofficial,
        branch_id: branchIdUnofficial,
        device_code: deviceCodeUnofficial,
        device_id: deviceIdUnofficial,
        device_token: deviceTokenUnofficial,
      });
    } catch (secondaryCfgErr) {
      const msg = humanizeApiError(secondaryCfgErr);
      setSetupNote(
        `Secondary local agent was not reachable during config apply (${msg}). Continuing: Start POS will launch and reconfigure it.`,
        "warn",
      );
      appendDebugLine(`Quick Setup warn: secondary config apply skipped (${msg})`);
    }

    stage = "start";
    setQuickSetupStage("start", "active", "Setup saved. Launching POS now.");
    setSetupNote("Setup complete. Starting POS…", "success");
    setStatus("Quick Setup: starting POS…");
    await start();
    setQuickSetupStage("start", "done", "Quick Setup finished. POS is launching.");
  } catch (e) {
    const msg = humanizeApiError(e);
    if (e?.fieldId) {
      markInputError(e.fieldId, msg);
      focusField(e.fieldId);
    }
    setQuickSetupStage(stage, "error", "Quick Setup failed. Review diagnostics and retry.");
    setSetupNote(`Quick Setup failed: ${msg}${permissionHintForError(msg)}`, "error");
    setStatus(`Quick Setup failed: ${msg}`);
    appendDebugLine(buildQuickSetupSnapshot());
    try {
      const logs = await tauriInvoke("tail_agent_logs", { maxLines: 120 });
      const a = String(logs?.official || "").trim();
      const b = String(logs?.unofficial || "").trim();
      const parts = [];
      if (a) parts.push(`Primary log:\n${a}`);
      if (b) parts.push(`Secondary log:\n${b}`);
      if (parts.length) setDiag(parts.join("\n\n"));
    } catch {
      // ignore
    }
  } finally {
    setQuickSetupBusyState(false, "setupApplyBtn");
  }
}

function quickSetupClear() {
  if (quickSetupBusy) return;
  quickSetup = { token: null, mfaToken: null, companies: [], apiBaseUrl: null, deviceCatalogByCompany: {} };
  quickSetupDeviceLoadSeq = { official: 0, unofficial: 0 };
  clearQuickSetupFieldErrors();
  if (el("setupPassword")) el("setupPassword").value = "";
  if (el("setupMfaCode")) el("setupMfaCode").value = "";
  if (el("setupMfaWrap")) el("setupMfaWrap").style.display = "none";
  fillSelect(el("setupCompanyOfficial"), [], { placeholder: "Log in to load companies…" });
  fillSelect(el("setupCompanyUnofficial"), [], { placeholder: "Log in to load companies…" });
  fillSelect(el("setupBranch"), [], { placeholder: "Log in to load branches…" });
  fillSelect(el("setupDeviceSelectOfficial"), [], { placeholder: "Log in and select company..." });
  fillSelect(el("setupDeviceSelectUnofficial"), [], { placeholder: "Log in and select company..." });
  if (el("setupDualMode")) el("setupDualMode").checked = false;
  if (el("setupDeviceCodeOfficial")) el("setupDeviceCodeOfficial").value = "POS-01";
  if (el("setupDeviceCodeUnofficial")) el("setupDeviceCodeUnofficial").value = "POS-02";
  updateQuickSetupModeUI();
  setQuickSetupStage("account", "active", "Enter Cloud API URL and account credentials, then click Log In.");
  setSetupNote("Quick Setup session cleared.", "success");
  updateQuickSetupActionState();
}

function validateStartConfiguration() {
  const fieldIds = [
    "edgeUrl",
    "portOfficial",
    "portUnofficial",
    "companyOfficial",
    "companyUnofficial",
    "deviceIdOfficial",
    "deviceIdUnofficial",
    "deviceTokenOfficial",
    "deviceTokenUnofficial",
  ];
  for (const id of fieldIds) clearInputError(id);

  const cloudUrl = validateCloudUrl(el("edgeUrl").value);
  const edgeLanUrl = "";
  const { portOfficial, portUnofficial } = collectSetupPorts();
  const companyOfficial = String(el("companyOfficial").value || "").trim();
  const companyUnofficial = String(el("companyUnofficial").value || "").trim();
  const deviceIdOfficial = String(el("deviceIdOfficial").value || "").trim();
  const deviceTokenOfficial = String(el("deviceTokenOfficial").value || "").trim();
  const deviceIdUnofficial = String(el("deviceIdUnofficial").value || "").trim();
  const deviceTokenUnofficial = String(el("deviceTokenUnofficial").value || "").trim();

  if (!UUID_RE.test(companyOfficial)) throwFieldError("companyOfficial", "Primary company ID is required and must be a UUID.");
  if (!UUID_RE.test(companyUnofficial)) throwFieldError("companyUnofficial", "Secondary company ID is required and must be a UUID.");
  if (!UUID_RE.test(deviceIdOfficial)) throwFieldError("deviceIdOfficial", "Primary device ID is required and must be a UUID.");
  if (!deviceTokenOfficial) throwFieldError("deviceTokenOfficial", "Primary device token is required.");
  if (!UUID_RE.test(deviceIdUnofficial)) throwFieldError("deviceIdUnofficial", "Secondary device ID is required and must be a UUID.");
  if (!deviceTokenUnofficial) throwFieldError("deviceTokenUnofficial", "Secondary device token is required.");

  return {
    cloudUrl,
    edgeLanUrl,
    portOfficial,
    portUnofficial,
    companyOfficial,
    companyUnofficial,
    deviceIdOfficial,
    deviceTokenOfficial,
    deviceIdUnofficial,
    deviceTokenUnofficial,
  };
}

async function start() {
  let cfg = null;
  try {
    cfg = validateStartConfiguration();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e?.fieldId) {
      markInputError(e.fieldId, msg);
      focusField(e.fieldId);
    }
    setStatus(msg);
    setSetupNote(msg, "error");
    return;
  }
  const {
    cloudUrl,
    edgeLanUrl,
    portOfficial,
    portUnofficial,
    companyOfficial,
    companyUnofficial,
    deviceIdOfficial,
    deviceTokenOfficial,
    deviceIdUnofficial,
    deviceTokenUnofficial,
  } = cfg;

  localStorage.setItem(KEY_EDGE, cloudUrl);
  localStorage.setItem(KEY_EDGE_LAN, "");
  localStorage.setItem(KEY_PORT_OFFICIAL, String(portOfficial));
  localStorage.setItem(KEY_PORT_UNOFFICIAL, String(portUnofficial));
  localStorage.setItem(KEY_CO_OFFICIAL, companyOfficial);
  localStorage.setItem(KEY_CO_UNOFFICIAL, companyUnofficial);
  localStorage.setItem(KEY_DEV_ID_OFFICIAL, deviceIdOfficial);
  localStorage.setItem(KEY_DEV_ID_UNOFFICIAL, deviceIdUnofficial);
  await secureSet(KEY_DEV_TOK_OFFICIAL, deviceTokenOfficial);
  await secureSet(KEY_DEV_TOK_UNOFFICIAL, deviceTokenUnofficial);

  setStatus("Starting local agents…");
  setDiag("");
  try {
    await tauriInvoke("start_agents", {
      edgeUrl: cloudUrl,
      edgeLanUrl,
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
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(`Failed to start agents: ${msg}`);
    setSetupNote(`Start POS failed: ${msg}`, "error");
    appendDebugLine(buildStartSnapshot());
    try {
      const logs = await tauriInvoke("tail_agent_logs", { maxLines: 120 });
      const a = String(logs?.official || "").trim();
      const b = String(logs?.unofficial || "").trim();
      const parts = [];
      parts.push(buildStartSnapshot());
      if (a) parts.push(`Primary log:\n${a}`);
      if (b) parts.push(`Secondary log:\n${b}`);
      if (parts.length) setDiag(parts.join("\n\n"));
    } catch {
      // ignore
    }
    return;
  }

  setStatus("Waiting for agents to start…");
  const [okA, okB] = await Promise.all([
    waitForAgent(portOfficial, 10000),
    waitForAgent(portUnofficial, 10000),
  ]);
  if (!okA || !okB) {
    setStatus(`Agent startup incomplete. Primary=${okA ? "ok" : "missing"} Secondary=${okB ? "ok" : "missing"}`);
    setSetupNote("Agent startup incomplete. Check diagnostics and fix missing agent.", "error");
    appendDebugLine(buildStartSnapshot());
    try {
      const logs = await tauriInvoke("tail_agent_logs", { maxLines: 120 });
      const a = String(logs?.official || "").trim();
      const b = String(logs?.unofficial || "").trim();
      const parts = [];
      parts.push(buildStartSnapshot());
      if (!okA && a) parts.push(`Primary log:\n${a}`);
      if (!okB && b) parts.push(`Secondary log:\n${b}`);
      if (parts.length) setDiag(parts.join("\n\n"));
    } catch {
      // ignore
    }
  } else {
    setStatus("Agents started. Checking server connection…");
  }

  const [stA, stB] = await Promise.all([
    fetchEdgeStatus(portOfficial),
    fetchEdgeStatus(portUnofficial),
  ]);
  const diagLines = [fmtEdgeDiag("Primary", stA), fmtEdgeDiag("Secondary", stB)];
  const authWarnings = [edgeAuthNotice("Primary", stA), edgeAuthNotice("Secondary", stB)].filter(Boolean);
  if (authWarnings.length > 0) {
    diagLines.push("", "AUTH warning:", ...authWarnings);
  }
  setDiag(diagLines.join("\n"));
  if (authWarnings.length > 0) {
    setStatus("Server auth issue detected. See diagnostics below.");
    setSetupNote(`Auth issue: ${authWarnings.join(" | ")}`, "error");
  } else {
    setStatus("Opening POS…");
  }
  const uiOk = await checkLatestUnifiedUi(portOfficial);
  if (!uiOk) {
    setStatus("Unified UI unavailable on this host.");
    setSetupNote("Unified UI unavailable on this host.", "error");
    appendDebugLine(buildStartSnapshot());
    return;
  }
  window.location.href = buildUnifiedUiUrl(portOfficial);
}

async function openPos() {
  const portOfficial = Number(el("portOfficial").value || 7070);
  const uiOk = await checkLatestUnifiedUi(portOfficial);
  if (!uiOk) {
    setStatus("Unified UI unavailable on this host.");
    return;
  }
  window.location.href = buildUnifiedUiUrl(portOfficial);
}

function getUpdateVersion(update) {
  return String(update?.version || "").trim();
}

function clearUpdateNotification() {
  availableUpdate = null;
  const btn = el("updateDownloadBtn");
  const badge = el("updateBadge");
  if (btn) {
    btn.disabled = true;
  }
  if (badge) {
    badge.textContent = "No update available";
  }
}

function showUpdateNotification(update) {
  const version = getUpdateVersion(update);
  if (!version) {
    clearUpdateNotification();
    return;
  }
  availableUpdate = update;
  const btn = el("updateDownloadBtn");
  const badge = el("updateBadge");
  if (!btn) return;
  if (badge) {
    badge.textContent = `Update available (${version})`;
  }
  btn.disabled = false;
}

async function checkForUpdates({ silent = false } = {}) {
  if (!silent) {
    setStatus("Checking for updates…");
  }
  try {
    const update = await updaterCheck();
    const version = getUpdateVersion(update);
    if (!version) {
      clearUpdateNotification();
      if (!silent) {
        setStatus("You are up to date.");
      }
      return null;
    }
    showUpdateNotification(update);
    if (!silent) {
      setStatus(`Update available: ${version}. Click Download Update.`);
    }
    return update;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unknown command|plugin/i.test(String(msg || ""))) {
      if (!silent) {
        setStatus("Updater is not available in this build.");
      }
      return;
    }
    if (!silent) {
      setStatus(`Update check failed: ${msg}`);
    }
  }
}

async function downloadUpdateNow() {
  const btn = el("updateDownloadBtn");
  if (!btn) {
    return;
  }
  if (!availableUpdate || !getUpdateVersion(availableUpdate)) {
    setStatus("Checking for updates first…");
    await checkForUpdates({ silent: false });
    if (!availableUpdate || !getUpdateVersion(availableUpdate)) {
      setStatus("No update available.");
      return;
    }
  }
  const version = getUpdateVersion(availableUpdate);
  const previousLabel = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = version ? `Downloading ${version}…` : "Downloading…";
  try {
    await updaterDownloadAndInstall(availableUpdate);
    setStatus("Update downloaded. Please restart the app.");
    clearUpdateNotification();
  } catch (e) {
    reportFatal(e, "Update download failed");
    if (availableUpdate && getUpdateVersion(availableUpdate)) {
      showUpdateNotification(availableUpdate);
      btn.innerHTML = previousLabel;
      btn.disabled = false;
    }
  } finally {
    if (btn && btn.disabled) {
      btn.disabled = false;
    }
    if (btn && !btn.hidden && availableUpdate && getUpdateVersion(availableUpdate) && btn.innerHTML !== previousLabel) {
      showUpdateNotification(availableUpdate);
    }
  }
}

async function runDiagnostics() {
  const portOfficial = Number(el("portOfficial").value || 7070);
  const portUnofficial = Number(el("portUnofficial").value || 7072);
  setStatus("Running diagnostics…");
  setDiag("");
  const [okA, okB] = await Promise.all([
    waitForAgent(portOfficial, 1500),
    waitForAgent(portUnofficial, 1500),
  ]);
  if (!okA || !okB) {
    setStatus("Agents are not running (or not ready). Click Start POS first.");
    setDiag(`Primary agent: ${okA ? "ok" : "not reachable"}\nSecondary agent: ${okB ? "ok" : "not reachable"}`);
    return;
  }
  const [stA, stB] = await Promise.all([
    fetchEdgeStatus(portOfficial),
    fetchEdgeStatus(portUnofficial),
  ]);
  const diagLines = [fmtEdgeDiag("Primary", stA), fmtEdgeDiag("Secondary", stB)];
  const authWarnings = [edgeAuthNotice("Primary", stA), edgeAuthNotice("Secondary", stB)].filter(Boolean);
  if (authWarnings.length > 0) {
    diagLines.push("", "AUTH warning:", ...authWarnings);
  }
  setDiag(diagLines.join("\n"));
  if (authWarnings.length > 0) {
    setStatus("Diagnostics found auth failures. Update device token/ID for the flagged agent.");
  } else {
    setStatus("Diagnostics complete.");
  }
}

async function showDesktopLogs() {
  setStatus("Loading desktop logs…");
  try {
    const logs = await tauriInvoke("tail_desktop_log", { maxLines: 300 });
    const text = String(logs || "").trim() || "(No desktop UI logs yet)";
    const current = String(el("diag")?.textContent || "").trim();
    const merged = current ? `${current}\n\n=== Desktop UI Log ===\n${text}` : `=== Desktop UI Log ===\n${text}`;
    setDiag(merged);
    setStatus("Desktop logs loaded.");
  } catch (e) {
    reportFatal(e, "Desktop log read failed");
  }
}

async function copyDebugReport() {
  setStatus("Preparing debug report…");
  try {
    const status = String(el("status")?.textContent || "").trim();
    const setup = String(el("setupNote")?.textContent || "").trim();
    const diag = String(el("diag")?.textContent || "").trim();
    const edgeUrl = String(el("edgeUrl")?.value || "").trim();
    const portOfficial = String(el("portOfficial")?.value || "").trim();
    const portUnofficial = String(el("portUnofficial")?.value || "").trim();
    const appVersion = APP_VERSION;

    let agentLogs = {};
    let desktopLogs = "";
    try {
      agentLogs = await tauriInvoke("tail_agent_logs", { maxLines: 220 });
    } catch {}
    try {
      desktopLogs = String(await tauriInvoke("tail_desktop_log", { maxLines: 400 }) || "");
    } catch {}

    const report = [
      `Melqard POS Desktop Debug Report`,
      `generated_at=${fmtNow()}`,
      `app_version=${appVersion}`,
      `user_agent=${navigator.userAgent}`,
      ``,
      `status=${status}`,
      `setup_note=${setup}`,
      `api_url=${edgeUrl}`,
      `ports=primary:${portOfficial}, secondary:${portUnofficial}`,
      ``,
      `=== UI Diagnostics ===`,
      diag || "(empty)",
      ``,
      `=== Desktop UI Log ===`,
      desktopLogs.trim() || "(empty)",
      ``,
      `=== Primary Agent Log ===`,
      String(agentLogs?.official || "").trim() || "(empty)",
      ``,
      `=== Secondary Agent Log ===`,
      String(agentLogs?.unofficial || "").trim() || "(empty)",
      ``,
    ].join("\n");

    const copied = await copyTextToClipboard(report);
    if (!copied) {
      setDiag(report);
      setStatus("Clipboard access was blocked. Debug report is shown in Diagnostics for manual copy.");
      reportInfo("Clipboard blocked; rendered debug report in diagnostics.", "Diagnostics");
      return;
    }
    setStatus("Debug report copied to clipboard.");
    reportInfo("Debug report copied.", "Diagnostics");
  } catch (e) {
    reportFatal(e, "Copy debug report failed");
  }
}

// Quiet update check on launch (best-effort). If unavailable/offline, ignore.
setTimeout(() => {
  checkForUpdates({ silent: true })
    .then(() => null)
    .catch(() => null);
}, 1200);

el("startBtn").addEventListener("click", start);
el("openBtn").addEventListener("click", openPos);
el("updateBtn").addEventListener("click", () => checkForUpdates({ silent: false }));
if (el("updateDownloadBtn")) el("updateDownloadBtn").addEventListener("click", downloadUpdateNow);
el("diagBtn").addEventListener("click", runDiagnostics);
if (el("showDesktopLogsBtn")) el("showDesktopLogsBtn").addEventListener("click", showDesktopLogs);
if (el("copyDebugBtn")) el("copyDebugBtn").addEventListener("click", copyDebugReport);
if (el("setupCompanyOfficial")) {
  fillSelect(el("setupCompanyOfficial"), [], { placeholder: "Log in to load companies…" });
  fillSelect(el("setupCompanyUnofficial"), [], { placeholder: "Log in to load companies…" });
  fillSelect(el("setupBranch"), [], { placeholder: "Log in to load branches…" });
  fillSelect(el("setupDeviceSelectOfficial"), [], { placeholder: "Log in and select company..." });
  fillSelect(el("setupDeviceSelectUnofficial"), [], { placeholder: "Log in and select company..." });
  el("setupLoginBtn").addEventListener("click", () => quickSetupLogin());
  el("setupVerifyMfaBtn").addEventListener("click", () => quickSetupVerifyMfa());
  el("setupClearBtn").addEventListener("click", quickSetupClear);
  el("setupApplyBtn").addEventListener("click", () => quickSetupApply());
  if (el("setupPassword")) {
    el("setupPassword").addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      quickSetupLogin();
    });
  }
  if (el("setupMfaCode")) {
    el("setupMfaCode").addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      quickSetupVerifyMfa();
    });
  }
  for (const id of ["setupEmail", "setupPassword", "setupMfaCode", "setupDeviceCodeOfficial", "setupDeviceCodeUnofficial", "edgeUrl"]) {
    const n = el(id);
    if (!n) continue;
    n.addEventListener("input", () => {
      clearInputError(id);
      updateQuickSetupActionState();
    });
  }
  if (el("setupDeviceSelectOfficial")) {
    el("setupDeviceSelectOfficial").addEventListener("change", () => {
      applySetupDeviceSelection("official");
      clearInputError("setupDeviceCodeOfficial");
      updateQuickSetupActionState();
    });
  }
  if (el("setupDeviceSelectUnofficial")) {
    el("setupDeviceSelectUnofficial").addEventListener("change", () => {
      applySetupDeviceSelection("unofficial");
      clearInputError("setupDeviceCodeUnofficial");
      updateQuickSetupActionState();
    });
  }
  for (const id of ["portOfficial", "portUnofficial", "setupCompanyOfficial", "setupCompanyUnofficial", "setupBranch"]) {
    const n = el(id);
    if (!n) continue;
    n.addEventListener("change", () => {
      clearInputError(id);
      updateQuickSetupActionState();
    });
  }
  if (el("setupBranch")) {
    el("setupBranch").addEventListener("change", () => {
      const selected = selectedSetupDevice("official");
      const branchId = String(el("setupBranch")?.value || "").trim();
      const deviceBranchId = String(selected?.branch_id || "").trim();
      if (selected && branchId && deviceBranchId && branchId !== deviceBranchId) {
        const branchLabel = String(selected?.branch_name || deviceBranchId).trim() || deviceBranchId;
        setSetupNote(`Primary POS device is assigned to ${branchLabel}; setup will use the device branch.`, "warn");
      }
    });
  }
  el("setupCompanyOfficial").addEventListener("change", () => {
    syncQuickSetupSecondarySelection();
    setQuickSetupStage("company", "active", "Company selected. Loading branches and waiting for device setup.");
    quickSetupLoadBranches().catch(() => {});
    quickSetupRefreshDevicePicker("official", { silent: true }).catch(() => {});
    if (!quickSetupDualModeEnabled()) {
      quickSetupRefreshDevicePicker("unofficial", { silent: true }).catch(() => {});
    }
  });
  if (el("setupCompanyUnofficial")) {
    el("setupCompanyUnofficial").addEventListener("change", () => {
      setQuickSetupStage("company", "active", "Company mapping updated.");
      quickSetupRefreshDevicePicker("unofficial", { silent: true }).catch(() => {});
    });
  }
  if (el("setupDualMode")) {
    el("setupDualMode").addEventListener("change", () => {
      updateQuickSetupModeUI();
      if (quickSetupDualModeEnabled()) {
        quickSetupRefreshDevicePicker("unofficial", { silent: true }).catch(() => {});
      }
    });
  }
  updateQuickSetupModeUI();
  setQuickSetupStage("account", "active", "Enter Cloud API URL and credentials, then click Log In.");
}
el("applyPackBtn").addEventListener("click", () => {
  const raw = el("setupPack").value;
  secureSet(KEY_PACK, raw);
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
    localStorage.setItem(KEY_DEV_ID_UNOFFICIAL, String(el("deviceIdUnofficial").value || "").trim());
    secureSet(KEY_DEV_TOK_OFFICIAL, String(el("deviceTokenOfficial").value || "").trim());
    secureSet(KEY_DEV_TOK_UNOFFICIAL, String(el("deviceTokenUnofficial").value || "").trim());

    setStatus("Setup pack applied.");
    setDiag("");
  } catch (e) {
    setStatus(`Setup pack error: ${e instanceof Error ? e.message : String(e)}`);
  }
});
el("clearPackBtn").addEventListener("click", () => {
  el("setupPack").value = "";
  secureDelete(KEY_PACK);
  setStatus("Cleared setup pack.");
});
installReplaceOnTypeBehavior();
load().catch(() => {});
loadAppVersion().then(() => {
  setVersionLabel();
}).catch(() => {});
