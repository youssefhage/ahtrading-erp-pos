// NOTE: This frontend is shipped as raw static files (no bundler).
// That means bare module imports like `@tauri-apps/api/...` will NOT resolve in the webview.
// Use the Tauri-injected bridge directly instead.

function tauriInvoke(cmd, args = {}) {
  const fn = globalThis?.__TAURI_INTERNALS__?.invoke;
  if (typeof fn !== "function") {
    throw new Error(
      "Tauri bridge unavailable. Please open this screen from the Melqard Setup Desktop app (not a browser).",
    );
  }
  return fn(String(cmd || ""), args || {});
}

function tauriTransformCallback(cb, once = false) {
  const fn = globalThis?.__TAURI_INTERNALS__?.transformCallback;
  if (typeof fn !== "function") {
    throw new Error("Tauri transformCallback unavailable (bridge not initialized).");
  }
  return fn(cb, !!once);
}

async function tauriListen(event, handler, options = {}) {
  const target =
    typeof options?.target === "string"
      ? { kind: "AnyLabel", label: options.target }
      : options?.target || { kind: "Any" };

  const eventId = await tauriInvoke("plugin:event|listen", {
    event,
    target,
    handler: tauriTransformCallback(handler),
  });

  return async () => {
    // Best-effort: keep the internal JS registry in sync if it exists.
    try {
      globalThis?.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener?.(event, eventId);
    } catch {
      // ignore
    }
    await tauriInvoke("plugin:event|unlisten", { event, eventId });
  };
}

function getGlobalUpdaterApi() {
  const updater = globalThis?.__TAURI__?.updater;
  return updater && typeof updater === "object" ? updater : null;
}

function createTauriChannel(handler) {
  const unregister = globalThis?.__TAURI_INTERNALS__?.unregisterCallback;
  const callbackId = tauriTransformCallback((payload) => {
    if (typeof handler !== "function") return;
    try {
      handler(payload);
    } catch {
      // ignore callback errors
    }
  });

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

const KEY = "melqard.setupDesktop.state.v1";

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

function appendLog(line) {
  const box = el("logs");
  const next = (box.value ? box.value + "\n" : "") + String(line || "");
  // Keep the log from growing forever.
  const max = 22000;
  box.value = next.length > max ? next.slice(next.length - max) : next;
  box.scrollTop = box.scrollHeight;
}

// Surface unexpected errors in the UI, otherwise the user experiences "nothing happens".
window.addEventListener("error", (ev) => {
  try {
    const payload = ev?.error || ev?.message || "Unknown error";
    appendLog(`[ui:error] ${payload instanceof Error ? payload.message : String(payload)}`);
    setStatus(`UI error: ${payload instanceof Error ? payload.message : String(payload)}`);
  } catch {
    // ignore
  }
});
window.addEventListener("unhandledrejection", (ev) => {
  try {
    const payload = ev?.reason || "Unknown rejection";
    appendLog(`[ui:unhandledrejection] ${payload instanceof Error ? payload.message : String(payload)}`);
    setStatus(`UI error: ${payload instanceof Error ? payload.message : String(payload)}`);
  } catch {
    // ignore
  }
});

function uiBusy(isBusy) {
  el("runBtn").disabled = !!isBusy;
  el("stopBtn").disabled = !isBusy;
  el("checkBtn").disabled = !!isBusy;
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object") return;

    el("mode").value = s.mode || "hybrid";
    el("repoPath").value = s.repoPath || "";
    el("edgeHome").value = s.edgeHome || "";
    el("apiPort").value = s.apiPort || "";
    el("adminPort").value = s.adminPort || "";
    el("edgeApiUrlForPos").value = s.edgeApiUrlForPos || "";
    el("apiBaseUrl").value = s.apiBaseUrl || "";
    el("deviceCount").value = s.deviceCount || "";
    el("companies").value = s.companies || "";
    el("adminEmail").value = s.adminEmail || "";
    el("adminPassword").value = ""; // never persist
    el("syncEnabled").value = s.syncEnabled || "no";
    el("cloudApiUrl").value = s.cloudApiUrl || "";
    el("edgeSyncKey").value = ""; // never persist
    el("edgeNodeId").value = s.edgeNodeId || "";
    el("updateEnv").value = s.updateEnv || "no";
  } catch {
    // ignore
  }
}

function saveState() {
  const s = {
    mode: el("mode").value,
    repoPath: el("repoPath").value,
    edgeHome: el("edgeHome").value,
    apiPort: el("apiPort").value,
    adminPort: el("adminPort").value,
    edgeApiUrlForPos: el("edgeApiUrlForPos").value,
    apiBaseUrl: el("apiBaseUrl").value,
    deviceCount: el("deviceCount").value,
    companies: el("companies").value,
    adminEmail: el("adminEmail").value,
    syncEnabled: el("syncEnabled").value,
    cloudApiUrl: el("cloudApiUrl").value,
    edgeNodeId: el("edgeNodeId").value,
    updateEnv: el("updateEnv").value,
  };
  localStorage.setItem(KEY, JSON.stringify(s));
}

function updateModeUi() {
  const mode = String(el("mode").value || "").toLowerCase();
  el("posOnlyBlock").hidden = mode !== "pos";
}

async function autoUpdate() {
  // Quiet auto-update: great for fast internal iteration, but should not block offline usage.
  try {
    const update = await updaterCheck();
    if (!update) return;
    appendLog(`[updater] Update available: ${update.version}. Downloading...`);
    await updaterDownloadAndInstall(update);
    appendLog("[updater] Update installed. Please restart the app.");
    setStatus("Update installed. Please restart the app.");
  } catch {
    // Ignore update errors (offline, etc.).
  }
}

async function preflight() {
  setStatus("Running preflight checks...");
  saveState();

  const repoPath = String(el("repoPath").value || "").trim();
  const res = await tauriInvoke("check_prereqs", { repoPath });

  if (res.details && res.details.length) {
    for (const d of res.details) appendLog(`[preflight] ${d}`);
  }

  if (res.repo_ok && res.docker_ok && res.docker_compose_ok) {
    setStatus("Preflight OK.");
    return true;
  }
  setStatus("Preflight failed. See logs for details.");
  return false;
}

function parseCompanies() {
  const raw = String(el("companies").value || "").trim();
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}

async function runSetup() {
  appendLog("----");
  const ok = await preflight();
  if (!ok) return;

  const mode = String(el("mode").value || "").toLowerCase();
  const repoPath = String(el("repoPath").value || "").trim();
  const edgeHome = String(el("edgeHome").value || "").trim();

  const apiPort = Number(el("apiPort").value || "");
  const adminPort = Number(el("adminPort").value || "");
  const deviceCount = Number(el("deviceCount").value || "");

  const edgeApiUrlForPos = normalizeUrl(el("edgeApiUrlForPos").value);
  const apiBaseUrl = normalizeUrl(el("apiBaseUrl").value);
  const adminEmail = String(el("adminEmail").value || "").trim();
  const adminPassword = String(el("adminPassword").value || "");

  const syncEnabled = el("syncEnabled").value === "yes";
  const cloudApiUrl = normalizeUrl(el("cloudApiUrl").value);
  const edgeSyncKey = String(el("edgeSyncKey").value || "");
  const edgeNodeId = String(el("edgeNodeId").value || "").trim();
  const updateEnv = el("updateEnv").value === "yes";

  if (!edgeApiUrlForPos) {
    setStatus("Missing POS Edge API URL.");
    return;
  }
  if (mode === "pos" && !apiBaseUrl) {
    setStatus("POS-only mode requires Remote Edge API base URL.");
    return;
  }
  if (syncEnabled && !edgeSyncKey) {
    setStatus("Sync enabled but EDGE_SYNC_KEY is empty.");
    return;
  }

  const params = {
    repo_path: repoPath,
    mode,
    edge_home: edgeHome || null,
    api_port: Number.isFinite(apiPort) && apiPort > 0 ? apiPort : null,
    admin_port: Number.isFinite(adminPort) && adminPort > 0 ? adminPort : null,
    api_base_url: mode === "pos" ? apiBaseUrl : null,
    edge_api_url_for_pos: edgeApiUrlForPos,
    admin_email: adminEmail || null,
    admin_password: adminPassword || null,
    device_count: Number.isFinite(deviceCount) && deviceCount > 0 ? deviceCount : null,
    companies: parseCompanies(),
    enable_sync: syncEnabled,
    cloud_api_url: syncEnabled ? cloudApiUrl || null : null,
    edge_sync_key: syncEnabled ? edgeSyncKey : null,
    edge_node_id: syncEnabled ? edgeNodeId || null : null,
    update_env: updateEnv,
  };

  uiBusy(true);
  setStatus("Starting onboarding...");
  saveState();
  try {
    await tauriInvoke("start_onboarding", { params });
  } catch (e) {
    uiBusy(false);
    setStatus(`Failed to start: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function stopSetup() {
  try {
    await tauriInvoke("stop_onboarding");
    appendLog("[setup] Stop requested.");
    setStatus("Stopping...");
  } catch (e) {
    setStatus(`Stop failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

el("mode").addEventListener("change", updateModeUi);
el("runBtn").addEventListener("click", runSetup);
el("stopBtn").addEventListener("click", stopSetup);
el("checkBtn").addEventListener("click", () => preflight().catch((e) => setStatus(String(e))));
el("clearLogsBtn").addEventListener("click", () => {
  el("logs").value = "";
  setStatus("");
});

tauriListen("onboarding://log", (event) => {
  appendLog(event.payload);
});
tauriListen("onboarding://done", (event) => {
  const code = event?.payload?.exitCode;
  uiBusy(false);
  if (code === 0) setStatus("Onboarding complete.");
  else setStatus(`Onboarding finished with exit code: ${code}`);
});

uiBusy(false);
loadState();
updateModeUi();
setTimeout(() => autoUpdate(), 1200);
