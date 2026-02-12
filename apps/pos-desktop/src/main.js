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
const KEY_SETUP_EMAIL = "ahtrading.posDesktop.setupEmail";

// Surface unexpected errors in the UI, otherwise the user experiences "nothing happens".
window.addEventListener("error", (ev) => {
  try {
    const msg = ev?.error?.message || ev?.message || "Unknown error";
    reportFatal(msg, "UI error");
  } catch {
    // ignore
  }
});
window.addEventListener("unhandledrejection", (ev) => {
  try {
    const msg = ev?.reason?.message || String(ev?.reason || "Unknown rejection");
    reportFatal(msg, "UI error");
  } catch {
    // ignore
  }
});

// Store sensitive values in OS keychain (Windows Credential Manager / macOS Keychain).
// We keep non-sensitive fields (URLs/ports/ids) in localStorage for convenience.
async function secureGet(k) {
  try {
    return await invoke("secure_get", { key: String(k || "") });
  } catch {
    return null;
  }
}

async function secureSet(k, v) {
  try {
    await invoke("secure_set", { key: String(k || ""), value: String(v ?? "") });
    return true;
  } catch {
    return false;
  }
}

async function secureDelete(k) {
  try {
    await invoke("secure_delete", { key: String(k || "") });
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
  const msg = err instanceof Error ? err.message : String(err);
  setStatus(`${ctx}: ${msg}`);
  setSetupNote(`${ctx}: ${msg}`);
  try { console.error(err); } catch {}
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

async function jpostJson(base, path, payload) {
  const url = `${String(base || "").replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error || data?.detail || `HTTP ${res.status}`;
    const msg = typeof err === "string" ? err : JSON.stringify(err);
    throw new Error(msg);
  }
  return data;
}

async function jgetJson(base, path) {
  const url = `${String(base || "").replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error || data?.detail || `HTTP ${res.status}`;
    const msg = typeof err === "string" ? err : JSON.stringify(err);
    throw new Error(msg);
  }
  return data;
}

let quickSetup = {
  token: null,
  mfaToken: null,
  companies: [],
  apiBaseUrl: null,
};

async function ensureAgentsRunningForSetup() {
  const edgeUrl = normalizeUrl(el("edgeUrl").value);
  const portOfficial = Number(el("portOfficial").value || 7070);
  const portUnofficial = Number(el("portUnofficial").value || 7072);
  if (!edgeUrl) throw new Error("Please enter the API URL first.");

  // Try to start agents best-effort. If they are already running, the ports may be in use;
  // we'll proceed as long as the agent responds on /api/health.
  try {
    await invoke("start_agents", {
      edgeUrl,
      portOfficial,
      portUnofficial,
      companyOfficial: null,
      companyUnofficial: null,
      deviceIdOfficial: null,
      deviceTokenOfficial: null,
      deviceIdUnofficial: null,
      deviceTokenUnofficial: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // If the port is already in use, we can't tell if it's the agent or something else.
    // We'll check /api/health below and only fail if it isn't reachable.
    setSetupNote(`Agent start note: ${msg}`);
  }

  const ok = await waitForAgent(portOfficial, 8000);
  if (!ok) throw new Error("Local agent is not reachable on the Official port. Try Start POS first.");
  return { edgeUrl, portOfficial, portUnofficial };
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

    const { edgeUrl, portOfficial } = await ensureAgentsRunningForSetup();
    quickSetup.apiBaseUrl = edgeUrl;
    const base = agentBase(portOfficial);

    setSetupNote("Logging in…");
    setStatus("Quick Setup: logging in…");
    const res = await jpostJson(base, "/api/setup/login", {
      api_base_url: edgeUrl,
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
    const { edgeUrl, portOfficial } = await ensureAgentsRunningForSetup();
    const base = agentBase(portOfficial);
    setSetupNote("Verifying MFA…");
    setStatus("Quick Setup: verifying MFA…");
    const res = await jpostJson(base, "/api/setup/login", {
      api_base_url: edgeUrl,
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

    const { edgeUrl, portOfficial, portUnofficial } = await ensureAgentsRunningForSetup();
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

    setSetupNote("Registering POS devices…");
    setStatus("Quick Setup: registering devices…");
    const officialReg = await jpostJson(base, "/api/setup/register-device", {
      api_base_url: edgeUrl,
      token: quickSetup.token,
      company_id: companyOfficial,
      branch_id: branchId,
      device_code: deviceCodeOfficial,
      reset_token: true,
    });
    const unofficialReg = await jpostJson(base, "/api/setup/register-device", {
      api_base_url: edgeUrl,
      token: quickSetup.token,
      company_id: companyUnofficial,
      branch_id: branchId,
      device_code: deviceCodeUnofficial,
      reset_token: true,
    });

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

    localStorage.setItem(KEY_EDGE, edgeUrl);
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
      api_base_url: edgeUrl,
      company_id: companyOfficial,
      branch_id: branchId,
      device_code: deviceCodeOfficial,
      device_id: deviceIdOfficial,
      device_token: deviceTokenOfficial,
    });
    await jpostJson(agentBase(portUnofficial), "/api/config", {
      api_base_url: edgeUrl,
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
    const msg = e instanceof Error ? e.message : String(e);
    setSetupNote(`Quick Setup failed: ${msg}\nHint: your account must have permission pos:manage for each company.`);
    setStatus(`Quick Setup failed: ${msg}`);
    try {
      const logs = await invoke("tail_agent_logs", { maxLines: 120 });
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
  localStorage.setItem(KEY_DEV_ID_UNOFFICIAL, deviceIdUnofficial);
  await secureSet(KEY_DEV_TOK_OFFICIAL, deviceTokenOfficial);
  await secureSet(KEY_DEV_TOK_UNOFFICIAL, deviceTokenUnofficial);

  setStatus("Starting local agents…");
  setDiag("");
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
    setStatus(`Failed to start agents: ${e instanceof Error ? e.message : String(e)}`);
    try {
      const logs = await invoke("tail_agent_logs", { maxLines: 120 });
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
      const logs = await invoke("tail_agent_logs", { maxLines: 120 });
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
  setDiag([fmtEdgeDiag("Official", stA), fmtEdgeDiag("Unofficial", stB)].join("\n"));

  setStatus("Opening POS…");
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
  setDiag([fmtEdgeDiag("Official", stA), fmtEdgeDiag("Unofficial", stB)].join("\n"));
  setStatus("Diagnostics complete.");
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
el("diagBtn").addEventListener("click", runDiagnostics);
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
