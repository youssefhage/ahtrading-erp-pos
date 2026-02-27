// ---------------------------------------------------------------------------
// Melqard POS Desktop — Thin Launcher
//
// Responsibilities:
// 1. Start POS agent sidecars (primary + secondary)
// 2. Show minimal splash while agents boot
// 3. Navigate to agent web UI once healthy
// 4. Auto-updater (check, download, install)
// 5. Diagnostics (tail logs, copy debug report)
//
// Setup/config is handled entirely by the agent's own Svelte web UI.
// ---------------------------------------------------------------------------

const KEY_PORT_OFFICIAL = "pos.desktop.portOfficial";
const KEY_PORT_UNOFFICIAL = "pos.desktop.portUnofficial";
const UPDATER_CHECK_TIMEOUT_MS = 20_000;
const UPDATER_RECHECK_MIN_MS = 5 * 60 * 1000;
const UPDATER_BACKGROUND_INTERVAL_MS = 30 * 60 * 1000;
const UPDATER_AUTO_INSTALL_DELAY_MS = 3 * 60 * 1000; // wait 3 min after launch before auto-installing
const KEY_UPDATER_LAST_CHECK = "pos.desktop.updater.lastCheckAt";

let APP_VERSION = "unknown";
let availableUpdate = null;
let updaterCheckInFlight = null;
let updaterBackgroundTimer = null;
let updaterAutoInstallInFlight = false;
const updaterLaunchTime = Date.now();
let updaterLastCheckAt = 0;
try { updaterLastCheckAt = Number(localStorage.getItem(KEY_UPDATER_LAST_CHECK) || 0) || 0; } catch {}

function safeGetPort(key, fallback) {
  try {
    const v = Number(localStorage.getItem(key));
    return (Number.isFinite(v) && v >= 1024 && v <= 65535) ? v : fallback;
  } catch { return fallback; }
}

function safeSetPort(key, value) {
  try { localStorage.setItem(key, String(value)); } catch {}
}

// ---------------------------------------------------------------------------
// Tauri bridge
// ---------------------------------------------------------------------------

async function tauriInvoke(cmd, args = {}) {
  const fn = globalThis?.__TAURI_INTERNALS__?.invoke;
  if (typeof fn !== "function") {
    throw new Error("Tauri bridge unavailable.");
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
  if (typeof transform !== "function") throw new Error("Tauri channel bridge unavailable.");
  const callbackId = transform((payload) => {
    try { if (typeof handler === "function") handler(payload); } catch {}
  }, false);
  let closed = false;
  return {
    toJSON() { return `__CHANNEL__:${callbackId}`; },
    close() {
      if (closed) return;
      closed = true;
      try { if (typeof unregister === "function") unregister(callbackId); } catch {}
    },
  };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);

function setBootState(title, subtitle, showSpinner = true) {
  const t = el("bootTitle");
  const s = el("bootSubtitle");
  const sp = el("bootSpinner");
  if (t) t.textContent = title;
  if (s) s.textContent = subtitle;
  if (sp) sp.hidden = !showSpinner;
}

function setStatus(msg, isError = false) {
  const n = el("bootStatus");
  if (!n) return;
  n.textContent = msg || "";
  n.classList.toggle("error", isError);
}

function showErrorPanel(show = true) {
  const p = el("errorPanel");
  if (p) p.hidden = !show;
}

function closeMoreMenu() {
  const m = el("moreMenu");
  if (m && m.open) m.open = false;
}

// ---------------------------------------------------------------------------
// Updater
// ---------------------------------------------------------------------------

function updaterHeaders() {
  return {
    "cache-control": "no-cache, no-store, must-revalidate",
    pragma: "no-cache",
    expires: "0",
    "x-melqard-update-check": String(Date.now()),
    "x-melqard-app-version": String(APP_VERSION || "unknown"),
  };
}

function invokeHeaders(headers) {
  try { return Array.from(new Headers(headers || {}).entries()); } catch { return []; }
}

async function updaterCheck(options = {}) {
  const checkOptions = { headers: updaterHeaders(), timeout: UPDATER_CHECK_TIMEOUT_MS, ...(options || {}) };
  const api = getGlobalUpdaterApi();
  if (api && typeof api.check === "function") return await api.check(checkOptions);
  return await tauriInvoke("plugin:updater|check", { ...checkOptions, headers: invokeHeaders(checkOptions.headers) });
}

async function updaterDownloadAndInstall(update, onEvent, options = {}) {
  if (!update) throw new Error("No update metadata provided.");
  const opts = { headers: updaterHeaders(), timeout: UPDATER_CHECK_TIMEOUT_MS, ...(options || {}) };
  if (typeof update.downloadAndInstall === "function") {
    await update.downloadAndInstall(onEvent, opts);
    return;
  }
  const rid = Number(update?.rid);
  if (!Number.isFinite(rid) || rid <= 0) throw new Error("Update metadata is missing rid.");
  const channel = createTauriChannel(onEvent);
  try {
    await tauriInvoke("plugin:updater|download_and_install", { rid, onEvent: channel, ...opts, headers: invokeHeaders(opts.headers) });
  } finally {
    channel.close();
  }
}

function markUpdaterCheckedNow() {
  updaterLastCheckAt = Date.now();
  try { localStorage.setItem(KEY_UPDATER_LAST_CHECK, String(updaterLastCheckAt)); } catch {}
}

function getUpdateVersion(u) { return String(u?.version || "").trim(); }

function showUpdateNotification(update) {
  const version = getUpdateVersion(update);
  availableUpdate = version ? update : null;
  const btn = el("updateDownloadBtn");
  const badge = el("updateBadge");
  if (badge) badge.textContent = version ? `Update available (${version})` : "No update available";
  if (btn) btn.disabled = !version;
}

async function autoInstallIfAvailable(update) {
  const version = getUpdateVersion(update);
  if (!version) return;
  if ((Date.now() - updaterLaunchTime) < UPDATER_AUTO_INSTALL_DELAY_MS) {
    persistLog("info", `[updater] auto-install deferred (grace period) for ${version}`);
    showUpdateNotification(update);
    return;
  }
  if (updaterAutoInstallInFlight) return;
  updaterAutoInstallInFlight = true;
  persistLog("info", `[updater] auto-installing ${version}…`);
  try {
    await updaterDownloadAndInstall(update, (evt) => {
      if (String(evt?.event || "") === "Finished") {
        persistLog("info", `[updater] auto-install download complete, installing…`);
      }
    });
    persistLog("info", `[updater] auto-install done, restarting…`);
    showUpdateNotification(null);
    try { await tauriInvoke("restart_app"); } catch {
      persistLog("warn", `[updater] auto-restart failed, showing notification`);
      showUpdateNotification(update);
    }
  } catch (e) {
    persistLog("warn", `[updater] auto-install failed: ${e instanceof Error ? e.message : String(e)}`);
    showUpdateNotification(update);
  } finally {
    updaterAutoInstallInFlight = false;
  }
}

async function checkForUpdates({ silent = false, force = false } = {}) {
  if (updaterCheckInFlight) return await updaterCheckInFlight;
  if (!force && updaterLastCheckAt > 0 && (Date.now() - updaterLastCheckAt) < UPDATER_RECHECK_MIN_MS) return availableUpdate;
  if (!silent) setStatus("Checking for updates...");
  const runner = (async () => {
    try {
      const update = await updaterCheck();
      markUpdaterCheckedNow();
      const version = getUpdateVersion(update);
      if (!version) {
        showUpdateNotification(null);
        if (!silent) setStatus("You are up to date.");
        return null;
      }
      if (!silent) {
        showUpdateNotification(update);
        setStatus(`Update available: ${version}. Click Download Update.`);
      } else {
        autoInstallIfAvailable(update).catch(() => {});
      }
      return update;
    } catch (e) {
      if (!silent) setStatus(`Update check failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      updaterCheckInFlight = null;
    }
  })();
  updaterCheckInFlight = runner;
  return await runner;
}

async function downloadUpdateNow() {
  const btn = el("updateDownloadBtn");
  if (!availableUpdate || !getUpdateVersion(availableUpdate)) {
    await checkForUpdates({ silent: false, force: true });
    if (!availableUpdate) return;
  }
  const version = getUpdateVersion(availableUpdate);
  if (btn) { btn.disabled = true; btn.textContent = `Downloading ${version}...`; }
  let totalBytes = 0;
  let downloadedBytes = 0;
  try {
    await updaterDownloadAndInstall(availableUpdate, (evt) => {
      const type = String(evt?.event || "");
      if (type === "Started") { totalBytes = Number(evt?.data?.contentLength || 0); downloadedBytes = 0; }
      if (type === "Progress") {
        downloadedBytes += Number(evt?.data?.chunkLength || 0);
        if (totalBytes > 0) setStatus(`Downloading update... ${Math.min(100, Math.round(downloadedBytes / totalBytes * 100))}%`);
      }
      if (type === "Finished") setStatus("Installing update...");
    });
    setStatus("Update installed. Restarting...");
    try { await tauriInvoke("restart_app"); } catch { setStatus("Update installed. Please restart the app."); }
  } catch (e) {
    setStatus(`Update failed: ${e instanceof Error ? e.message : String(e)}`, true);
    showUpdateNotification(availableUpdate);
    if (btn) { btn.disabled = false; btn.textContent = "Download Update"; }
  }
}

function scheduleBackgroundUpdateChecks() {
  if (updaterBackgroundTimer) clearInterval(updaterBackgroundTimer);
  const silentUpdateCheck = (opts) => checkForUpdates({ silent: true, ...opts }).catch((e) => {
    persistLog("warn", `Background update check failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  updaterBackgroundTimer = setInterval(() => silentUpdateCheck({}), UPDATER_BACKGROUND_INTERVAL_MS);
  window.addEventListener("online", () => silentUpdateCheck({ force: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") silentUpdateCheck({});
  });
}

// ---------------------------------------------------------------------------
// Agent URL builder
// ---------------------------------------------------------------------------

function agentBase(port) {
  return `http://127.0.0.1:${Number(port || 7070)}`;
}

function buildUnifiedUiUrl(port, otherPort = null) {
  const q = new URLSearchParams();
  q.set("cb", String(Date.now()));
  q.set("desktop", "1");
  if (APP_VERSION && APP_VERSION !== "unknown") q.set("desktopVersion", APP_VERSION);
  // Tell the frontend about the secondary agent so it routes unofficial
  // traffic through the local agent instead of cloud-only mode.
  if (otherPort && otherPort !== port) {
    q.set("otherAgentUrl", agentBase(otherPort));
  }
  return `${agentBase(port)}/?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Health polling
// ---------------------------------------------------------------------------

async function waitForAgent(port, timeoutMs = 10000) {
  const url = `${agentBase(port)}/api/health`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 3000);
      const res = await fetch(url, { method: "GET", signal: ac.signal });
      clearTimeout(tid);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Port conflict recovery
// ---------------------------------------------------------------------------

function isPortConflict(msg) {
  const t = String(msg || "").toLowerCase();
  return t.includes("already in use") || t.includes("occupied by an older") || (t.includes("port") && t.includes("occupied"));
}

async function startAgentsWithPortRecovery(portOfficial, portUnofficial) {
  let off = portOfficial;
  let un = portUnofficial;
  const maxRetries = 6;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await tauriInvoke("start_agents", { portOfficial: off, portUnofficial: un });
      return { portOfficial: off, portUnofficial: un };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isPortConflict(msg) || attempt >= maxRetries) throw e;
      try {
        const suggested = await tauriInvoke("suggest_port_pair", { startOfficial: off + 2, startUnofficial: un + 2, maxAttempts: 60 });
        off = Number(suggested?.port_official) || off + 2;
        un = Number(suggested?.port_unofficial) || un + 2;
      } catch {
        off += 2;
        un += 2;
      }
      setStatus(`Port conflict. Retrying on ${off}/${un}...`);
    }
  }
  throw new Error("Unable to find available ports for POS agents.");
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

async function showDiagnostics() {
  const diagEl = el("diag");
  if (!diagEl) return;
  diagEl.hidden = false;
  diagEl.textContent = "Loading...";
  try {
    const [logs, desktopLog] = await Promise.all([
      tauriInvoke("tail_agent_logs", { maxLines: 80 }).catch(() => ({})),
      tauriInvoke("tail_desktop_log", { maxLines: 200 }).catch(() => ""),
    ]);
    const parts = [];
    const a = String(logs?.official || "").trim();
    const b = String(logs?.unofficial || "").trim();
    const d = String(desktopLog || "").trim();
    if (a) parts.push(`=== Primary Agent Log ===\n${a}`);
    if (b) parts.push(`=== Secondary Agent Log ===\n${b}`);
    if (d) parts.push(`=== Desktop UI Log ===\n${d}`);
    diagEl.textContent = parts.join("\n\n") || "(No logs available)";
  } catch (e) {
    diagEl.textContent = `Failed to load logs: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function copyDebugReport() {
  try {
    const [logs, desktopLog] = await Promise.all([
      tauriInvoke("tail_agent_logs", { maxLines: 200 }).catch(() => ({})),
      tauriInvoke("tail_desktop_log", { maxLines: 400 }).catch(() => ""),
    ]);
    const report = [
      `Melqard POS Desktop Debug Report`,
      `app_version=${APP_VERSION}`,
      `user_agent=${navigator.userAgent}`,
      `ports=${safeGetPort(KEY_PORT_OFFICIAL, 7070)}/${safeGetPort(KEY_PORT_UNOFFICIAL, 7072)}`,
      ``,
      `=== Primary Agent Log ===`,
      String(logs?.official || "").trim() || "(empty)",
      ``,
      `=== Secondary Agent Log ===`,
      String(logs?.unofficial || "").trim() || "(empty)",
      ``,
      `=== Desktop UI Log ===`,
      String(desktopLog || "").trim() || "(empty)",
    ].join("\n");
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(report);
      setStatus("Debug report copied to clipboard.");
    } else {
      const diagEl = el("diag");
      if (diagEl) { diagEl.hidden = false; diagEl.textContent = report; }
      setStatus("Clipboard unavailable. Report shown below.");
    }
  } catch (e) {
    setStatus(`Copy failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

// ---------------------------------------------------------------------------
// Frontend log bridge
// ---------------------------------------------------------------------------

async function persistLog(level, message, stack = "") {
  try { await tauriInvoke("frontend_log", { level, message, stack }); } catch {}
}

window.addEventListener("error", (ev) => {
  const msg = ev?.error?.message || ev?.message || "Unknown error";
  persistLog("error", `UI error: ${msg}`, String(ev?.error?.stack || ""));
});
window.addEventListener("unhandledrejection", (ev) => {
  const msg = ev?.reason?.message || String(ev?.reason || "Unknown rejection");
  persistLog("error", `Unhandled rejection: ${msg}`, String(ev?.reason?.stack || ""));
});

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------

async function showWindow() {
  try { await tauriInvoke("show_main_window"); } catch {}
}

async function boot() {
  // Window starts hidden — only shown on success or on error (for diagnostics).
  setBootState("Starting POS", "Please wait...");
  setStatus("Starting agents...");
  showErrorPanel(false);

  const portOfficial = safeGetPort(KEY_PORT_OFFICIAL, 7070);
  const portUnofficial = safeGetPort(KEY_PORT_UNOFFICIAL, 7072);

  let activeOff = portOfficial;
  let activeUn = portUnofficial;

  try {
    const result = await startAgentsWithPortRecovery(portOfficial, portUnofficial);
    activeOff = result.portOfficial;
    activeUn = result.portUnofficial;
    safeSetPort(KEY_PORT_OFFICIAL, activeOff);
    safeSetPort(KEY_PORT_UNOFFICIAL, activeUn);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    persistLog("error", `Failed to start agents: ${msg}`);
    setBootState("POS Launch Failed", "Use Retry to try again, or check diagnostics.", false);
    setStatus(`Failed: ${msg}`, true);
    showErrorPanel(true);
    await showWindow();
    return;
  }

  const ok = await waitForAgent(activeOff, 12000);
  if (!ok) {
    persistLog("error", `Primary agent not reachable on port ${activeOff}`);
    setBootState("POS Not Ready", "The agent did not respond in time. Retry or check diagnostics.", false);
    setStatus(`Primary agent not reachable on port ${activeOff}.`, true);
    showErrorPanel(true);
    await showWindow();
    return;
  }

  // Navigate to the POS app and reveal the window.
  window.location.href = buildUnifiedUiUrl(activeOff, activeUn);
  await showWindow();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function loadAppVersion() {
  try {
    const v = await tauriInvoke("app_version");
    if (typeof v === "string" && v.trim()) APP_VERSION = v.trim();
  } catch {}
  const vEl = el("appVersion");
  if (vEl) vEl.textContent = `v${APP_VERSION}`;
}

el("retryBtn")?.addEventListener("click", () => { closeMoreMenu(); boot(); });
el("updateBtn")?.addEventListener("click", () => { closeMoreMenu(); checkForUpdates({ silent: false, force: true }); });
el("updateDownloadBtn")?.addEventListener("click", () => { closeMoreMenu(); downloadUpdateNow(); });
el("diagBtn")?.addEventListener("click", () => { closeMoreMenu(); showDiagnostics(); });
el("copyDebugBtn")?.addEventListener("click", () => { closeMoreMenu(); copyDebugReport(); });

loadAppVersion();
scheduleBackgroundUpdateChecks();
setTimeout(() => { checkForUpdates({ silent: true, force: true }).catch((e) => {
  persistLog("warn", `Initial update check failed: ${e instanceof Error ? e.message : String(e)}`);
}); }, 1200);
boot();
