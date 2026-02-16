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
  const v = String(raw || "").trim().replace(/\/+$/, "");
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) return `http://${v}`;
  return v;
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
    return new Date().toISOString();
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

function setSetupNote(msg) {
  const n = el("setupNote");
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

function reportFatal(err, ctx = "Error") {
  const p = stringifyError(err);
  const msg = p.message;
  setStatus(`${ctx}: ${msg}`);
  setSetupNote(`${ctx}: ${msg}`);
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
  const cfgPart = label.toLowerCase() === "unofficial"
    ? "unofficial device token or company mapping"
    : "official device token or company mapping";
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
};

async function ensureAgentsRunningForSetup() {
  const cloudUrl = normalizeUrl(el("edgeUrl").value);
  const edgeLanUrl = "";
  const portOfficial = Number(el("portOfficial").value || 7070);
  const portUnofficial = Number(el("portUnofficial").value || 7072);
  if (!cloudUrl) throw new Error("Please enter the Cloud API URL first.");

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
      "Local official agent did not become reachable. If port 7070 is already used, stop external pos-desktop/agent.py processes and retry."
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
  if (!target) return "Unknown";
  for (const c of quickSetup.companies || []) {
    if (String(c?.id || "").trim().toLowerCase() === target) {
      return String(c?.name || c?.legal_name || target).trim() || "Unknown";
    }
  }
  return "Unknown";
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
  setSetupNote("");
  setStatus("");
  setBtnBusy("setupLoginBtn", true, "Logging in…");
  try {
    const email = String(el("setupEmail").value || "").trim();
    const password = String(el("setupPassword").value || "");
    if (!email || !password) {
      setSetupNote("Enter email and password.");
      return;
    }
    localStorage.setItem(KEY_SETUP_EMAIL, email);

    const { cloudUrl, portOfficial } = await ensureAgentsRunningForSetup();
    quickSetup.apiBaseUrl = cloudUrl;
    const base = agentBase(portOfficial);

    setSetupNote("Logging in…");
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
      setSetupNote("MFA required. Enter your code and click Verify MFA.");
      setStatus("Quick Setup: MFA required.");
      return;
    }

    quickSetup.token = String(res?.token || "").trim() || null;
    quickSetup.mfaToken = null;
    quickSetup.companies = Array.isArray(res?.companies) ? res.companies : [];
    el("setupMfaWrap").style.display = "none";

    const list = normalizeCompanyList(quickSetup.companies);
    fillSelect(el("setupCompanyOfficial"), list, { placeholder: "Select Official company…" });
    fillSelect(el("setupCompanyUnofficial"), list, { placeholder: "Select Unofficial company…" });
    fillSelect(el("setupBranch"), [], { placeholder: "Select branch (optional)…" });

    const active = String(res?.active_company_id || "").trim();
    if (active) {
      el("setupCompanyOfficial").value = active;
      el("setupCompanyUnofficial").value = active;
    }

    setSetupNote("Logged in. Select companies and (optional) branch.");
    setStatus("Quick Setup: logged in.");
    await quickSetupLoadBranches();
  } catch (e) {
    reportFatal(e, "Quick Setup login failed");
  } finally {
    setBtnBusy("setupLoginBtn", false);
  }
}

async function quickSetupVerifyMfa() {
  setSetupNote("");
  setStatus("");
  setBtnBusy("setupVerifyMfaBtn", true, "Verifying…");
  try {
    const code = String(el("setupMfaCode").value || "").trim();
    if (!quickSetup.mfaToken) {
      setSetupNote("Missing MFA token. Click Login again.");
      return;
    }
    if (!code) {
      setSetupNote("Enter your MFA code.");
      return;
    }
    const { cloudUrl, portOfficial } = await ensureAgentsRunningForSetup();
    const base = agentBase(portOfficial);
    setSetupNote("Verifying MFA…");
    setStatus("Quick Setup: verifying MFA…");
    const res = await jpostJson(base, "/api/setup/login", {
      api_base_url: cloudUrl,
      mfa_token: quickSetup.mfaToken,
      mfa_code: code,
    });
    if (res?.mfa_required) {
      setSetupNote("MFA still required. Double-check the code and retry.");
      return;
    }
    quickSetup.token = String(res?.token || "").trim() || null;
    quickSetup.mfaToken = null;
    quickSetup.companies = Array.isArray(res?.companies) ? res.companies : [];
    el("setupMfaWrap").style.display = "none";

    const list = normalizeCompanyList(quickSetup.companies);
    fillSelect(el("setupCompanyOfficial"), list, { placeholder: "Select Official company…" });
    fillSelect(el("setupCompanyUnofficial"), list, { placeholder: "Select Unofficial company…" });
    setSetupNote("MFA verified. Select companies and (optional) branch.");
    setStatus("Quick Setup: MFA verified.");
    await quickSetupLoadBranches();
  } catch (e) {
    reportFatal(e, "Quick Setup MFA failed");
  } finally {
    setBtnBusy("setupVerifyMfaBtn", false);
  }
}

async function quickSetupLoadBranches() {
  const companyId = String(el("setupCompanyOfficial")?.value || "").trim();
  if (!companyId || !quickSetup.token || !quickSetup.apiBaseUrl) return;
  const portOfficial = Number(el("portOfficial").value || 7070);
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
    if (res?.warning) setSetupNote(String(res.warning));
  } catch (e) {
    // Non-fatal; branches can be permissioned.
    setSetupNote(`Branch list unavailable. You can proceed. (${e instanceof Error ? e.message : String(e)})`);
    fillSelect(el("setupBranch"), [], { placeholder: "Branch list unavailable…" });
  }
}

async function quickSetupApply() {
  setSetupNote("");
  setStatus("");
  setBtnBusy("setupApplyBtn", true, "Generating…");
  try {
    if (!quickSetup.token || !quickSetup.apiBaseUrl) {
      setSetupNote("Please Login first.");
      return;
    }

    const { cloudUrl, edgeLanUrl, portOfficial, portUnofficial } = await ensureAgentsRunningForSetup();
    const base = agentBase(portOfficial);

    const companyOfficial = String(el("setupCompanyOfficial").value || "").trim();
    const companyUnofficial = String(el("setupCompanyUnofficial").value || "").trim();
    const branchId = String(el("setupBranch").value || "").trim();
    const deviceCodeOfficial = String(el("setupDeviceCodeOfficial").value || "").trim() || "POS-OFFICIAL-01";
    const deviceCodeUnofficial = String(el("setupDeviceCodeUnofficial").value || "").trim() || "POS-UNOFFICIAL-01";

    if (!companyOfficial) {
      setSetupNote("Select the Official company.");
      return;
    }
    if (!companyUnofficial) {
      setSetupNote("Select the Unofficial company (or set it to the same company).");
      return;
    }

    setSetupNote("Checking pos:manage permission for selected companies…");
    setStatus("Quick Setup: checking permissions…");
    const officialName = getCompanyNameById(companyOfficial);
    const unofficialName = getCompanyNameById(companyUnofficial);
    const permissionChecks = await Promise.all([
      quickSetupCheckCompanyPermissions(base, cloudUrl, quickSetup.token, companyOfficial, officialName),
    ]);

    if (companyOfficial !== companyUnofficial) {
      permissionChecks.push(
        quickSetupCheckCompanyPermissions(base, cloudUrl, quickSetup.token, companyUnofficial, unofficialName),
      );
    }

    const missing = permissionChecks.filter((x) => !x.hasPermission);
    if (missing.length) {
      const names = [...new Set(missing.map((m) => m.companyLabel || m.companyId))];
      setSetupNote(`Permission missing on ${names.join(", ")}.`);
      setStatus(`Quick Setup: permission check failed for ${names.join(", ")}.`);
      if (companyOfficial === companyUnofficial) {
        const label = names[0] || "selected company";
        setSetupNote(`Quick Setup: ${label} lacks pos:manage. Grant pos:manage to this account, then retry.`);
      } else {
        const lines = names
          .map((n) => `${n} missing pos:manage. Grant permission and retry.`)
          .join(" | ");
        setSetupNote(lines);
      }
      return;
    }

    const unavailable = permissionChecks.filter((r) => r && r.permissionEndpointSupported === false);
    if (unavailable.length) {
      setSetupNote(
        `Permission check endpoint unavailable for ${[...new Set(unavailable.map((x) => x.companyLabel || x.companyId))].join(", ")}. Continuing.`,
      );
    }

    setSetupNote("Registering POS devices…");
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

    const officialReg = await registerDevice("Official", companyOfficial, branchId, deviceCodeOfficial);
    const unofficialReg = await registerDevice(
      "Unofficial",
      companyUnofficial,
      branchId,
      deviceCodeUnofficial,
    );

    const deviceIdOfficial = String(officialReg?.device_id || "").trim();
    const deviceTokenOfficial = String(officialReg?.device_token || "").trim();
    const deviceIdUnofficial = String(unofficialReg?.device_id || "").trim();
    const deviceTokenUnofficial = String(unofficialReg?.device_token || "").trim();
    if (!deviceIdOfficial || !deviceTokenOfficial || !deviceIdUnofficial || !deviceTokenUnofficial) {
      setSetupNote("Device registration returned incomplete credentials. Please retry.");
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
    setSetupNote("Applying config to local agents…");
    setStatus("Quick Setup: applying local config…");
    await jpostJson(agentBase(portOfficial), "/api/config", {
      api_base_url: cloudUrl,
      edge_api_base_url: "",
      cloud_api_base_url: cloudUrl,
      company_id: companyOfficial,
      branch_id: branchId,
      device_code: deviceCodeOfficial,
      device_id: deviceIdOfficial,
      device_token: deviceTokenOfficial,
    });
    await jpostJson(agentBase(portUnofficial), "/api/config", {
      api_base_url: cloudUrl,
      edge_api_base_url: "",
      cloud_api_base_url: cloudUrl,
      company_id: companyUnofficial,
      branch_id: branchId,
      device_code: deviceCodeUnofficial,
      device_id: deviceIdUnofficial,
      device_token: deviceTokenUnofficial,
    });

    setSetupNote("Setup complete. Starting POS…");
    setStatus("Quick Setup: starting POS…");
    await start();
  } catch (e) {
    const msg = humanizeApiError(e);
    setSetupNote(`Quick Setup failed: ${msg}${permissionHintForError(msg)}`);
    setStatus(`Quick Setup failed: ${msg}`);
    try {
      const logs = await tauriInvoke("tail_agent_logs", { maxLines: 120 });
      const a = String(logs?.official || "").trim();
      const b = String(logs?.unofficial || "").trim();
      const parts = [];
      if (a) parts.push(`Official log:\n${a}`);
      if (b) parts.push(`Unofficial log:\n${b}`);
      if (parts.length) setDiag(parts.join("\n\n"));
    } catch {
      // ignore
    }
  } finally {
    setBtnBusy("setupApplyBtn", false);
  }
}

function quickSetupClear() {
  quickSetup = { token: null, mfaToken: null, companies: [], apiBaseUrl: null };
  if (el("setupPassword")) el("setupPassword").value = "";
  if (el("setupMfaCode")) el("setupMfaCode").value = "";
  if (el("setupMfaWrap")) el("setupMfaWrap").style.display = "none";
  fillSelect(el("setupCompanyOfficial"), [], { placeholder: "Login to load companies…" });
  fillSelect(el("setupCompanyUnofficial"), [], { placeholder: "Login to load companies…" });
  fillSelect(el("setupBranch"), [], { placeholder: "Login to load branches…" });
  setSetupNote("Cleared Quick Setup session.");
}

async function start() {
  const cloudUrl = normalizeUrl(el("edgeUrl").value);
  const edgeLanUrl = "";
  const portOfficial = Number(el("portOfficial").value || 7070);
  const portUnofficial = Number(el("portUnofficial").value || 7072);
  const companyOfficial = String(el("companyOfficial").value || "").trim();
  const companyUnofficial = String(el("companyUnofficial").value || "").trim();
  const deviceIdOfficial = String(el("deviceIdOfficial").value || "").trim();
  const deviceTokenOfficial = String(el("deviceTokenOfficial").value || "").trim();
  const deviceIdUnofficial = String(el("deviceIdUnofficial").value || "").trim();
  const deviceTokenUnofficial = String(el("deviceTokenUnofficial").value || "").trim();

  if (!cloudUrl) {
    setStatus("Please enter the Cloud API URL first.");
    return;
  }

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
    setStatus(`Failed to start agents: ${e instanceof Error ? e.message : String(e)}`);
    try {
      const logs = await tauriInvoke("tail_agent_logs", { maxLines: 120 });
      const a = String(logs?.official || "").trim();
      const b = String(logs?.unofficial || "").trim();
      const parts = [];
      if (a) parts.push(`Official log:\n${a}`);
      if (b) parts.push(`Unofficial log:\n${b}`);
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
    setStatus(`Agent startup incomplete. Official=${okA ? "ok" : "missing"} Unofficial=${okB ? "ok" : "missing"}`);
    try {
      const logs = await tauriInvoke("tail_agent_logs", { maxLines: 120 });
      const a = String(logs?.official || "").trim();
      const b = String(logs?.unofficial || "").trim();
      const parts = [];
      if (!okA && a) parts.push(`Official log:\n${a}`);
      if (!okB && b) parts.push(`Unofficial log:\n${b}`);
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
  const diagLines = [fmtEdgeDiag("Official", stA), fmtEdgeDiag("Unofficial", stB)];
  const authWarnings = [edgeAuthNotice("Official", stA), edgeAuthNotice("Unofficial", stB)].filter(Boolean);
  if (authWarnings.length > 0) {
    diagLines.push("", "AUTH warning:", ...authWarnings);
  }
  setDiag(diagLines.join("\n"));
  if (authWarnings.length > 0) {
    setStatus("Edge auth issue detected. See diagnostics below.");
    setSetupNote(`Auth issue: ${authWarnings.join(" | ")}`);
  } else {
    setStatus("Opening POS…");
  }
  const uiOk = await checkLatestUnifiedUi(portOfficial);
  if (!uiOk) {
    setStatus("Unified UI unavailable on this host.");
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
    const update = await tauriInvoke("plugin:updater|check", {});
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
    await tauriInvoke("plugin:updater|download_and_install", { update: availableUpdate });
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
    setDiag(`Official agent: ${okA ? "ok" : "not reachable"}\nUnofficial agent: ${okB ? "ok" : "not reachable"}`);
    return;
  }
  const [stA, stB] = await Promise.all([
    fetchEdgeStatus(portOfficial),
    fetchEdgeStatus(portUnofficial),
  ]);
  const diagLines = [fmtEdgeDiag("Official", stA), fmtEdgeDiag("Unofficial", stB)];
  const authWarnings = [edgeAuthNotice("Official", stA), edgeAuthNotice("Unofficial", stB)].filter(Boolean);
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
      `ports=official:${portOfficial}, unofficial:${portUnofficial}`,
      ``,
      `=== UI Diagnostics ===`,
      diag || "(empty)",
      ``,
      `=== Desktop UI Log ===`,
      desktopLogs.trim() || "(empty)",
      ``,
      `=== Official Agent Log ===`,
      String(agentLogs?.official || "").trim() || "(empty)",
      ``,
      `=== Unofficial Agent Log ===`,
      String(agentLogs?.unofficial || "").trim() || "(empty)",
      ``,
    ].join("\n");

    await navigator.clipboard.writeText(report);
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
  fillSelect(el("setupCompanyOfficial"), [], { placeholder: "Login to load companies…" });
  fillSelect(el("setupCompanyUnofficial"), [], { placeholder: "Login to load companies…" });
  fillSelect(el("setupBranch"), [], { placeholder: "Login to load branches…" });
  el("setupLoginBtn").addEventListener("click", () => quickSetupLogin());
  el("setupVerifyMfaBtn").addEventListener("click", () => quickSetupVerifyMfa());
  el("setupClearBtn").addEventListener("click", quickSetupClear);
  el("setupApplyBtn").addEventListener("click", () => quickSetupApply());
  el("setupCompanyOfficial").addEventListener("change", () => quickSetupLoadBranches().catch(() => {}));
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
