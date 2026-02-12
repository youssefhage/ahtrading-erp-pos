// Unified POS (pilot): one UI coordinating two local POS agents.
// Served by one agent (this origin). Assumes the "other" agent runs on localhost:7072 by default.

function el(id) {
  return document.getElementById(id);
}

function fmtUsd(n) {
  return Number(n || 0).toFixed(2);
}

function toNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

const state = {
  // Two agents:
  // - official: typically the current origin
  // - unofficial: typically localhost:7072
  agents: {
    official: { base: window.location.origin, label: "Official" },
    unofficial: { base: "http://localhost:7072", label: "Unofficial" }
  },
  edge: {
    official: { ok: null, latency_ms: null, pending: 0 },
    unofficial: { ok: null, latency_ms: null, pending: 0 }
  },
  // Data loaded from both agents.
  items: {
    official: [],
    unofficial: []
  },
  barcodes: {
    official: [],
    unofficial: []
  },
  // In-memory search indexes rebuilt after each cache load.
  index: {
    itemsById: { official: new Map(), unofficial: new Map() },
    byBarcode: { official: new Map(), unofficial: new Map() },
    bySku: { official: new Map(), unofficial: new Map() },
  },
  configs: {
    official: null,
    unofficial: null
  },
  setup: {
    sessions: {
      official: null,
      unofficial: null
    },
    companies: {
      official: [],
      unofficial: []
    },
    branches: {
      official: [],
      unofficial: []
    }
  },
  // Cart lines include agent/company attribution.
  cart: [],
  lastLookup: null,
  ui: {
    statusText: "Loading…",
    statusKind: "info",
    theme: "light",
    densityMode: "auto",
    cashierId: "",
    cashierName: "",
    customerLabel: "Guest",
    customerLookupSeq: 0,
    customerResults: [],
    customerActiveIndex: -1,
    lookupResults: [],
    lookupActiveIndex: -1,
    lookupQuery: "",
    // Optional callback to refresh the current lookup UI after caches are refreshed.
    refreshLookup: null,
    edgePollTimer: null,
    edgePollBackoff: {
      official: { failures: 0, nextAtMs: 0 },
      unofficial: { failures: 0, nextAtMs: 0 }
    },
    autoSyncTimer: null,
    autoSyncBusy: false,
    autoSyncBackoff: { failures: 0, nextAtMs: 0 }
  }
};

// Theme storage is per-cashier by default (so each cashier can keep their preference).
// We keep a legacy key as read-only fallback for migration.
const UI_THEME_STORAGE_KEY_LEGACY = "unified.pos.theme";
const UI_THEME_STORAGE_KEY_ANON = "unified.pos.theme.anonymous";
const UI_THEME_STORAGE_KEY_CASHIER_PREFIX = "unified.pos.theme.cashier.";
const UI_DENSITY_STORAGE_KEY_ANON = "unified.pos.density.anonymous";
const UI_DENSITY_STORAGE_KEY_CASHIER_PREFIX = "unified.pos.density.cashier.";

const CONFIG_FIELD_SUFFIX = {
  api_base_url: "ApiBaseUrl",
  company_id: "CompanyId",
  branch_id: "BranchId",
  device_code: "DeviceCode",
  device_id: "DeviceId",
  shift_id: "ShiftId"
};

async function jget(base, path) {
  const res = await fetch(`${base}${path}`, { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
  return data;
}

async function jpost(base, path, payload) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
  return data;
}

function getInvoiceCompany() {
  const v = String(el("invoiceCompany")?.value || "auto").trim().toLowerCase();
  if (v === "official") return "official";
  if (v === "unofficial") return "unofficial";
  return "auto";
}

function otherAgentUrl() {
  return String(el("otherAgentUrl").value || "").trim() || "http://localhost:7072";
}

function cartCompaniesSet() {
  return new Set((state.cart || []).map((c) => c.companyKey).filter(Boolean));
}

function primaryCompanyFromCart() {
  const s = cartCompaniesSet();
  if (s.size === 1) return Array.from(s.values())[0];
  return null;
}

function effectiveInvoiceCompany() {
  // For "Auto", infer from cart. Otherwise use the forced selection.
  const mode = getInvoiceCompany();
  if (mode === "official" || mode === "unofficial") return mode;
  return primaryCompanyFromCart() || "unofficial";
}

function statusKindFromMessage(msg, fallback = "info") {
  const t = String(msg || "").toLowerCase();
  if (/\berror\b|\bfailed\b|\binvalid\b|\bforbidden\b/.test(t)) return "error";
  if (/\boffline\b|\bretry\b|\bwarning\b/.test(t)) return "warn";
  if (/\bok\b|\bready\b|\bcomplete\b|\bsynced\b|\blogged in\b/.test(t)) return "ok";
  return fallback;
}

function setStatus(msg, kind = null) {
  state.ui.statusText = String(msg || "");
  state.ui.statusKind = kind || statusKindFromMessage(msg, "info");
  const legacy = el("status");
  if (legacy) legacy.textContent = state.ui.statusText;
  const pill = el("statusPill");
  if (pill) {
    pill.textContent = state.ui.statusText;
    pill.className = `statusPill ${state.ui.statusKind}`;
  }
}

function setScanMeta(msg) {
  const node = el("scanMeta");
  if (node) node.textContent = String(msg || "");
}

function setButtonBusy(id, busy, labelWhenBusy = "Working...") {
  const node = el(id);
  if (!node) return;
  if (busy) {
    node.dataset.origLabel = node.textContent || "";
    node.textContent = labelWhenBusy;
    node.disabled = true;
    node.classList.add("isBusy");
    return;
  }
  if (node.dataset.origLabel) node.textContent = node.dataset.origLabel;
  delete node.dataset.origLabel;
  node.disabled = false;
  node.classList.remove("isBusy");
}

function normalizeTheme(theme) {
  return String(theme || "").toLowerCase() === "dark" ? "dark" : "light";
}

function themeStorageKeyForCashier(cashierId) {
  const cid = String(cashierId || "").trim();
  if (cid) return `${UI_THEME_STORAGE_KEY_CASHIER_PREFIX}${cid}`;
  return UI_THEME_STORAGE_KEY_ANON;
}

function loadStoredTheme(key) {
  try {
    return normalizeTheme(window.localStorage.getItem(String(key || "")) || "");
  } catch (_e) {
    return "";
  }
}

function storeTheme(key, theme) {
  try {
    window.localStorage.setItem(String(key || ""), normalizeTheme(theme));
  } catch (_e) {
    // Ignore storage failures (private mode / locked storage).
  }
}

function applyTheme(theme, persist = false) {
  const next = normalizeTheme(theme);
  state.ui.theme = next;
  document.documentElement.setAttribute("data-theme", next);
  const toggle = el("themeToggle");
  if (toggle) {
    const switchTo = next === "dark" ? "Light" : "Dark";
    toggle.textContent = `${switchTo} Theme`;
    toggle.setAttribute("aria-label", `Switch to ${switchTo.toLowerCase()} theme`);
  }
  if (!persist) return;
  storeTheme(themeStorageKeyForCashier(state.ui.cashierId), next);
}

function initTheme() {
  // Priority:
  // 1) Cashier-specific theme (if cashierId is known)
  // 2) Anonymous theme (shared on this device before login)
  // 3) Legacy device-wide theme key (migration)
  // 4) Default light
  const cashierKey = themeStorageKeyForCashier(state.ui.cashierId);
  let storedTheme = loadStoredTheme(cashierKey);

  if (!storedTheme && state.ui.cashierId) {
    const anon = loadStoredTheme(UI_THEME_STORAGE_KEY_ANON);
    if (anon) {
      storedTheme = anon;
      storeTheme(cashierKey, storedTheme);
    }
  }

  if (!storedTheme) {
    const legacy = loadStoredTheme(UI_THEME_STORAGE_KEY_LEGACY);
    if (legacy) {
      storedTheme = legacy;
      // Best-effort migrate legacy preference to the current scope.
      storeTheme(cashierKey, storedTheme);
    }
  }

  applyTheme(storedTheme || "light", false);
}

function toggleTheme() {
  const next = state.ui.theme === "dark" ? "light" : "dark";
  applyTheme(next, true);
}

function normalizeDensityMode(mode) {
  const m = String(mode || "").toLowerCase();
  if (m === "compact" || m === "ultra") return m;
  return "auto";
}

function densityStorageKeyForCashier(cashierId) {
  const cid = String(cashierId || "").trim();
  if (cid) return `${UI_DENSITY_STORAGE_KEY_CASHIER_PREFIX}${cid}`;
  return UI_DENSITY_STORAGE_KEY_ANON;
}

function loadStoredDensityMode(key) {
  try {
    const raw = window.localStorage.getItem(String(key || ""));
    if (raw == null) return "";
    return normalizeDensityMode(raw);
  } catch (_e) {
    return "";
  }
}

function storeDensityMode(key, mode) {
  try {
    window.localStorage.setItem(String(key || ""), normalizeDensityMode(mode));
  } catch (_e) {
    // Ignore storage failures.
  }
}

function applyDensityMode(mode, persist = false) {
  const next = normalizeDensityMode(mode);
  state.ui.densityMode = next;
  const btn = el("densityToggle");
  if (btn) {
    const label = next === "auto" ? "Auto" : (next === "compact" ? "Compact" : "Ultra");
    btn.textContent = `Density: ${label}`;
    btn.setAttribute("aria-label", `Density mode ${label}`);
    btn.title = "Cycle density: Auto -> Compact -> Ultra";
  }
  if (!persist) return;
  storeDensityMode(densityStorageKeyForCashier(state.ui.cashierId), next);
}

function initDensityMode() {
  const cashierKey = densityStorageKeyForCashier(state.ui.cashierId);
  let stored = loadStoredDensityMode(cashierKey);
  if (!stored && state.ui.cashierId) {
    const anon = loadStoredDensityMode(UI_DENSITY_STORAGE_KEY_ANON);
    if (anon) {
      stored = anon;
      storeDensityMode(cashierKey, stored);
    }
  }
  applyDensityMode(stored || "compact", false);
}

function toggleDensityMode() {
  const cur = normalizeDensityMode(state.ui.densityMode);
  const next = cur === "auto" ? "compact" : (cur === "compact" ? "ultra" : "auto");
  applyDensityMode(next, true);
  applyResponsiveLayout();
}

function setCashierContextFromConfig(cfg) {
  const c = cfg || {};
  const nextId = String(c.cashier_id || "").trim();
  if (!nextId) return false;
  if (state.ui.cashierId === nextId) return false;
  state.ui.cashierId = nextId;
  return true;
}

function setCashierContextFromLogin(res) {
  const cashier = res?.cashier || {};
  const nextId = String(cashier.id || "").trim();
  if (!nextId) return false;
  state.ui.cashierId = nextId;
  state.ui.cashierName = String(cashier.name || "").trim();
  return true;
}

async function hydrateCashierContext() {
  setOtherAgentBase();
  const a = state.agents.official.base;
  const b = state.agents.unofficial.base;
  const results = await Promise.allSettled([jget(a, "/api/config"), jget(b, "/api/config")]);
  const cfgA = results[0].status === "fulfilled" ? results[0].value : null;
  const cfgB = results[1].status === "fulfilled" ? results[1].value : null;
  // Prefer Official config if it has a cashier; otherwise take Unofficial.
  const changed = setCashierContextFromConfig(cfgA) || setCashierContextFromConfig(cfgB);
  return changed;
}

function setCustomerSelection(id, label = "") {
  const cid = String(id || "").trim();
  const customerInput = el("customerId");
  if (customerInput) customerInput.value = cid;
  state.ui.customerLabel = cid ? (String(label || cid).trim() || cid) : "Guest";
  updateUiFacts();
}

function clearCustomerResults() {
  const root = el("customerResults");
  if (root) root.innerHTML = "";
  state.ui.customerResults = [];
  state.ui.customerActiveIndex = -1;
}

function applyCustomerFromResult(c) {
  const customer = c || {};
  const cid = String(customer.id || "").trim();
  if (!cid) return;
  setCustomerSelection(cid, customer.name || cid);
  clearCustomerResults();
  setStatus(`Customer selected: ${customer.name || cid}`, "ok");
}

function setCustomerResultsActiveIndex(nextIndex, opts = {}) {
  const root = el("customerResults");
  if (!root) {
    state.ui.customerActiveIndex = -1;
    return -1;
  }
  const rows = Array.from(root.querySelectorAll(".custRow"));
  if (!rows.length) {
    state.ui.customerActiveIndex = -1;
    return -1;
  }
  let idx = Number(nextIndex);
  if (!Number.isFinite(idx)) idx = 0;
  idx = Math.max(0, Math.min(rows.length - 1, idx));
  state.ui.customerActiveIndex = idx;
  rows.forEach((row, i) => {
    const active = i === idx;
    row.classList.toggle("active", active);
    row.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (opts.scroll) rows[idx].scrollIntoView({ block: "nearest" });
  return idx;
}

function moveCustomerResultsActive(delta) {
  const list = state.ui.customerResults || [];
  if (!list.length) return false;
  let idx = Number(state.ui.customerActiveIndex);
  if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) {
    idx = 0;
  } else {
    idx = (idx + Number(delta || 0) + list.length) % list.length;
  }
  setCustomerResultsActiveIndex(idx, { scroll: true });
  return true;
}

function selectActiveCustomerMatch() {
  const list = state.ui.customerResults || [];
  if (!list.length) return false;
  const idx = Number.isFinite(state.ui.customerActiveIndex) && state.ui.customerActiveIndex >= 0
    ? state.ui.customerActiveIndex
    : 0;
  const c = list[idx];
  if (!c) return false;
  applyCustomerFromResult(c);
  return true;
}

function updateUiFacts() {
  const lineCount = state.cart.length;
  const qtyCount = state.cart.reduce((sum, c) => sum + Math.max(0, Number(c.qty || 0)), 0);
  const mode = getInvoiceCompany(); // "auto" | "official" | "unofficial"
  const invoiceCompany = effectiveInvoiceCompany(); // resolved to a specific agent
  const cartCompanies = cartCompaniesSet();
  const primaryCompany = primaryCompanyFromCart();
  const mixedCompanies = cartCompanies.size > 1;
  const flagToOfficial = !!el("flagOfficial")?.checked;
  const crossCompany = !!primaryCompany && !mixedCompanies && invoiceCompany !== primaryCompany;
  const cartSummary = el("cartSummary");
  if (cartSummary) {
    const modeSuffix = flagToOfficial
      ? " · Flag: Official"
      : (mixedCompanies ? " · Split: Official+Unofficial" : (crossCompany ? " · Cross-company" : ""));
    cartSummary.textContent = `Cart: ${lineCount} line(s), ${qtyCount} item(s)${modeSuffix}`;
  }
  const activeCustomer = el("activeCustomer");
  if (activeCustomer) activeCustomer.textContent = `Customer: ${state.ui.customerLabel}`;
  const tItems = el("tItems");
  if (tItems) tItems.textContent = String(qtyCount);
  const inv = el("tInvoiceCompany");
  if (inv) {
    if (flagToOfficial) {
      inv.textContent = "Official (review)";
    } else if (mixedCompanies) {
      inv.textContent = "Split (2 invoices)";
    } else if (mode === "auto") {
      if (crossCompany) inv.textContent = invoiceCompany === "official" ? "Auto: Official (cross-company)" : "Auto: Unofficial (cross-company)";
      else inv.textContent = invoiceCompany === "official" ? "Auto: Official" : "Auto: Unofficial";
    } else {
      if (crossCompany) inv.textContent = invoiceCompany === "official" ? "Official (cross-company)" : "Unofficial (cross-company)";
      else inv.textContent = invoiceCompany === "official" ? "Official" : "Unofficial";
    }
  }

  // Disable credit when the cart would produce split invoices, to avoid partial failures
  // due to customer/account mismatches across companies.
  const creditOpt = el("payment")?.querySelector?.('option[value="credit"]');
  if (creditOpt) creditOpt.disabled = (mixedCompanies || crossCompany) && !flagToOfficial;

  // Make the Pay button communicate split/flag mode without adding more clicks.
  const payBtn = el("payBtn");
  if (payBtn && !payBtn.classList.contains("isBusy")) {
    if (flagToOfficial) payBtn.textContent = "Pay (Official Flag)";
    else if (mixedCompanies) payBtn.textContent = "Pay (Split)";
    else if (crossCompany) payBtn.textContent = "Pay (Cross-company)";
    else payBtn.textContent = "Pay";
  }
}

function setOtherAgentBase() {
  state.agents.unofficial.base = otherAgentUrl();
}

function recordEdgePollSuccess(key) {
  const b = state.ui.edgePollBackoff[key];
  if (!b) return;
  b.failures = 0;
  b.nextAtMs = 0;
}

function recordEdgePollFailure(key) {
  const b = state.ui.edgePollBackoff[key];
  if (!b) return;
  b.failures = Math.min(8, Number(b.failures || 0) + 1);
  const delayMs = Math.min(60000, 3000 * (2 ** Math.max(0, b.failures - 1)));
  b.nextAtMs = Date.now() + delayMs;
}

function canEdgePollNow(key) {
  const b = state.ui.edgePollBackoff[key];
  if (!b) return true;
  return Date.now() >= Number(b.nextAtMs || 0);
}

function stopEdgePolling() {
  if (!state.ui.edgePollTimer) return;
  clearInterval(state.ui.edgePollTimer);
  state.ui.edgePollTimer = null;
}

function startEdgePolling() {
  stopEdgePolling();
  refreshEdgeStatusBoth();
  state.ui.edgePollTimer = setInterval(refreshEdgeStatusBoth, 3000);
}

async function ensureOfficialAgentApiAvailable() {
  try {
    await jget(state.agents.official.base, "/api/config");
    return true;
  } catch (_e) {
    stopEdgePolling();
    setStatus(
      "POS API is not available on this host. Open http://127.0.0.1:7070/unified.html from the local POS agent.",
      "error"
    );
    setScanMeta("Local agent is not serving /api endpoints on this page.");
    return false;
  }
}

function settingsFieldId(agentKey, suffix) {
  return `${agentKey}${suffix}`;
}

function setSettingsStatus(msg, isError = false) {
  const node = el("settingsStatus");
  if (!node) return;
  node.textContent = msg || "";
  node.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function setQuickStatus(msg, isError = false) {
  const node = el("quickStatus");
  if (!node) return;
  node.textContent = msg || "";
  node.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function setCustomerCreateStatus(msg, isError = false) {
  const node = el("customerCreateStatus");
  if (!node) return;
  node.textContent = msg || "";
  node.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function setCustomerCreatePanel(open) {
  const panel = el("customerCreatePanel");
  if (!panel) return;
  panel.classList.toggle("hidden", !open);
  if (!open) {
    setCustomerCreateStatus("");
    return;
  }
  const name = el("customerCreateName");
  if (name) name.focus();
}

function selectedQuickAgent() {
  return el("quickAgent")?.value === "official" ? "official" : "unofficial";
}

function selectedQuickAgentBase() {
  const key = selectedQuickAgent();
  return state.agents[key].base;
}

function normalizeApiBase(input) {
  return String(input || "").trim().replace(/\/+$/, "");
}

function setQuickBusy(busy) {
  const signIn = el("quickSignIn");
  const apply = el("quickApply");
  if (signIn) signIn.disabled = !!busy;
  if (apply) apply.disabled = !!busy;
}

function setQuickCompanyOptions(agentKey, selectedId = "") {
  const node = el("quickCompany");
  if (!node) return;
  const companies = state.setup.companies[agentKey] || [];
  node.innerHTML = "";
  if (!companies.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Sign in to load companies...";
    node.appendChild(opt);
    return;
  }
  const first = document.createElement("option");
  first.value = "";
  first.textContent = "Select a company...";
  node.appendChild(first);
  for (const c of companies) {
    const opt = document.createElement("option");
    opt.value = String(c.id || "");
    opt.textContent = String(c.name || c.id || "Unnamed Company");
    node.appendChild(opt);
  }
  const wanted = String(selectedId || "").trim();
  if (wanted) {
    node.value = wanted;
  } else if (companies[0]?.id) {
    node.value = String(companies[0].id);
  }
}

function setQuickBranchOptions(agentKey, selectedId = "", warning = "") {
  const node = el("quickBranch");
  if (!node) return;
  const branches = state.setup.branches[agentKey] || [];
  node.innerHTML = "";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "None";
  node.appendChild(noneOpt);
  for (const b of branches) {
    const opt = document.createElement("option");
    opt.value = String(b.id || "");
    opt.textContent = String(b.name || b.id || "Branch");
    node.appendChild(opt);
  }
  const wanted = String(selectedId || "").trim();
  if (wanted) node.value = wanted;
  if (warning) setQuickStatus(warning, false);
}

function prefillQuickFormForAgent(agentKey) {
  const sid = state.setup.sessions[agentKey] || {};
  const cfg = state.configs[agentKey] || {};
  const apiNode = el("quickApiBaseUrl");
  const deviceNode = el("quickDeviceCode");
  const fallback = agentKey === "official" ? "POS-OFFICIAL-01" : "POS-UNOFFICIAL-01";
  if (apiNode) apiNode.value = String(sid.api_base_url || cfg.api_base_url || "");
  if (deviceNode) deviceNode.value = String(cfg.device_code || fallback);
  setQuickCompanyOptions(agentKey, cfg.company_id || "");
  setQuickBranchOptions(agentKey, cfg.branch_id || "");
}

function openSettingsModal() {
  el("settingsBackdrop").classList.remove("hidden");
  el("settingsModal").classList.remove("hidden");
}

function closeSettingsModal() {
  el("settingsModal").classList.add("hidden");
  el("settingsBackdrop").classList.add("hidden");
  setSettingsStatus("");
  setQuickStatus("");
}

// Manager modal (PIN-gated "open Admin" shortcut)
const MANAGER_PIN_HASH_KEY = "unified.pos.manager.pinHash";
const MANAGER_ADMIN_URL_KEY = "unified.pos.manager.adminUrl";
let managerUnlockedUntilMs = 0;

function isManagerModalOpen() {
  const modal = el("managerModal");
  return !!modal && !modal.classList.contains("hidden");
}

function setManagerStatus(msg, isErr = false) {
  const node = el("managerStatus");
  if (!node) return;
  node.textContent = String(msg || "");
  node.style.color = isErr ? "var(--danger)" : "";
}

function managerUnlocked() {
  return Date.now() < managerUnlockedUntilMs;
}

function updateManagerUi() {
  const openBtn = el("adminOpenBtn");
  if (openBtn) openBtn.disabled = !managerUnlocked();
}

function openManagerModal() {
  const back = el("managerBackdrop");
  const modal = el("managerModal");
  if (back) back.classList.remove("hidden");
  if (modal) modal.classList.remove("hidden");
  updateManagerUi();
}

function closeManagerModal() {
  const back = el("managerBackdrop");
  const modal = el("managerModal");
  if (modal) modal.classList.add("hidden");
  if (back) back.classList.add("hidden");
  setManagerStatus("");
}

function normalizeUrl(raw) {
  const v = String(raw || "").trim().replace(/\/+$/, "");
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) return `http://${v}`;
  return v;
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(String(text || ""));
  const hash = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function suggestAdminUrlFromApiBase(apiBaseUrl) {
  const api = normalizeUrl(apiBaseUrl);
  if (!api) return "https://app.melqard.com";
  try {
    const u = new URL(api);
    // For cloud, admin lives on a separate host.
    if (u.hostname.endsWith("melqard.com")) return "https://app.melqard.com";
    u.port = "3000";
    u.pathname = "";
    u.search = "";
    u.hash = "";
    return String(u.toString()).replace(/\/$/, "");
  } catch {
    return "https://app.melqard.com";
  }
}

async function loadAdminUrlDefault() {
  const saved = String(localStorage.getItem(MANAGER_ADMIN_URL_KEY) || "").trim();
  if (saved) return saved;
  try {
    const cfg = state.configs?.official || (await jget(state.agents.official.base, "/api/config"));
    const apiBase = String(cfg?.api_base_url || "").trim();
    return suggestAdminUrlFromApiBase(apiBase);
  } catch {
    return "https://app.melqard.com";
  }
}

async function openManagerDialog() {
  const admin = el("adminUrl");
  if (admin && !String(admin.value || "").trim()) {
    admin.value = await loadAdminUrlDefault();
  }
  openManagerModal();
  // Focus PIN for quick usage.
  const pin = el("managerPin");
  if (pin) pin.focus();
}

async function managerUnlock() {
  const stored = String(localStorage.getItem(MANAGER_PIN_HASH_KEY) || "").trim();
  if (!stored) {
    setManagerStatus("No manager PIN set on this terminal yet. Set a PIN first.", true);
    return;
  }
  const pin = String(el("managerPin")?.value || "");
  if (!pin.trim()) {
    setManagerStatus("Enter the manager PIN.", true);
    return;
  }
  const h = await sha256Hex(pin);
  if (h !== stored) {
    setManagerStatus("Wrong PIN.", true);
    return;
  }
  managerUnlockedUntilMs = Date.now() + 10 * 60 * 1000;
  setManagerStatus("Unlocked for 10 minutes.");
  updateManagerUi();
}

async function managerSetPin() {
  const a = String(el("managerPinNew")?.value || "");
  const b = String(el("managerPinNew2")?.value || "");
  if (!a.trim() || a.length < 4) {
    setManagerStatus("PIN must be at least 4 characters.", true);
    return;
  }
  if (a !== b) {
    setManagerStatus("PIN confirmation does not match.", true);
    return;
  }
  localStorage.setItem(MANAGER_PIN_HASH_KEY, await sha256Hex(a));
  setManagerStatus("Manager PIN set. You can unlock now.");
  el("managerPinNew").value = "";
  el("managerPinNew2").value = "";
  el("managerPin").focus();
}

function managerLock() {
  managerUnlockedUntilMs = 0;
  updateManagerUi();
  setManagerStatus("Locked.");
}

function managerResetPin() {
  const ok = window.confirm("Reset manager PIN on this terminal?");
  if (!ok) return;
  localStorage.removeItem(MANAGER_PIN_HASH_KEY);
  managerLock();
  setManagerStatus("PIN reset. Set a new PIN to enable manager unlock.");
}

async function managerOpenAdmin() {
  if (!managerUnlocked()) {
    setManagerStatus("Unlock with PIN first.", true);
    return;
  }
  const url = normalizeUrl(el("adminUrl")?.value || "");
  if (!url) {
    setManagerStatus("Enter the Admin URL first.", true);
    return;
  }
  localStorage.setItem(MANAGER_ADMIN_URL_KEY, url);
  // Works both in browser and inside the POS Desktop app.
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) {
    setManagerStatus("Popup blocked. Copy the Admin URL and open it manually.", true);
    return;
  }
  setManagerStatus("Opened Admin.");
}

function openCartModal() {
  const back = el("cartBackdrop");
  const modal = el("cartModal");
  if (back) back.classList.remove("hidden");
  if (modal) modal.classList.remove("hidden");
  renderCart();
}

function closeCartModal() {
  const back = el("cartBackdrop");
  const modal = el("cartModal");
  if (modal) modal.classList.add("hidden");
  if (back) back.classList.add("hidden");
}

function isCartModalOpen() {
  const modal = el("cartModal");
  return !!modal && !modal.classList.contains("hidden");
}

function applyViewportDensity() {
  const mode = normalizeDensityMode(state.ui.densityMode);
  if (mode === "compact") {
    document.documentElement.setAttribute("data-density", "sm");
    return;
  }
  if (mode === "ultra") {
    document.documentElement.setAttribute("data-density", "xs");
    return;
  }
  const h = Math.max(0, Number(window.innerHeight || 0));
  const d = h <= 760 ? "xs" : (h <= 900 ? "sm" : "md");
  document.documentElement.setAttribute("data-density", d);
}

function applyDynamicStickyOffset() {
  const top = document.querySelector(".top");
  const h = top ? Math.ceil(top.getBoundingClientRect().height) : 52;
  document.documentElement.style.setProperty("--top-offset", `${Math.max(40, h)}px`);
}

function calcCartPreviewLimit() {
  const panel = document.querySelector(".panelRight");
  if (!panel) return 7;
  const ph = Number(panel.clientHeight || 0);
  if (!Number.isFinite(ph) || ph <= 0) return 7;
  // Reserve space for panel header + totals + pay/customer block.
  const reserved = 300;
  const available = Math.max(70, ph - reserved);
  // Approx line height for compact cart row.
  const perLine = 54;
  return Math.max(3, Math.min(12, Math.floor(available / perLine)));
}

function applyResponsiveLayout() {
  applyViewportDensity();
  applyDynamicStickyOffset();
  // Re-render cart so preview line count matches current viewport height.
  renderCart();
}

function setSettingsBusy(busy) {
  const btn = el("settingsSave");
  if (btn) btn.disabled = !!busy;
}

function clearAgentConfigForm(agentKey) {
  for (const suffix of Object.values(CONFIG_FIELD_SUFFIX)) {
    const n = el(settingsFieldId(agentKey, suffix));
    if (n) n.value = "";
  }
  const tok = el(settingsFieldId(agentKey, "DeviceToken"));
  if (tok) tok.value = "";
}

function fillAgentConfigForm(agentKey, cfg) {
  const src = cfg || {};
  for (const [k, suffix] of Object.entries(CONFIG_FIELD_SUFFIX)) {
    const n = el(settingsFieldId(agentKey, suffix));
    if (n) n.value = src[k] || "";
  }
  const tok = el(settingsFieldId(agentKey, "DeviceToken"));
  if (tok) tok.value = "";
}

async function loadAgentConfig(agentKey) {
  const base = state.agents[agentKey].base;
  const cfg = await jget(base, "/api/config");
  state.configs[agentKey] = cfg;
  fillAgentConfigForm(agentKey, cfg);
  return cfg;
}

async function openSettingsDialog() {
  setOtherAgentBase();
  openSettingsModal();
  setSettingsBusy(true);
  setSettingsStatus("Loading current settings…");
  setQuickStatus("");
  clearAgentConfigForm("official");
  clearAgentConfigForm("unofficial");

  const results = await Promise.allSettled([loadAgentConfig("official"), loadAgentConfig("unofficial")]);
  setSettingsBusy(false);

  const failed = [];
  if (results[0].status === "rejected") failed.push("Official");
  if (results[1].status === "rejected") failed.push("Unofficial");

  if (!failed.length) {
    prefillQuickFormForAgent(selectedQuickAgent());
    setSettingsStatus("Loaded. Edit fields then save.");
    return;
  }
  prefillQuickFormForAgent(selectedQuickAgent());
  setSettingsStatus(`Could not load: ${failed.join(", ")}. Check agent URL and try again.`, true);
}

function collectAgentPayload(agentKey) {
  const payload = {};
  for (const [k, suffix] of Object.entries(CONFIG_FIELD_SUFFIX)) {
    const n = el(settingsFieldId(agentKey, suffix));
    payload[k] = String(n?.value || "").trim();
  }
  const tokenInput = String(el(settingsFieldId(agentKey, "DeviceToken"))?.value || "").trim();
  if (tokenInput) payload.device_token = tokenInput;
  return payload;
}

async function saveSettingsDialog() {
  setOtherAgentBase();
  setSettingsBusy(true);
  setSettingsStatus("Saving settings…");

  const updates = ["official", "unofficial"].map(async (agentKey) => {
    const base = state.agents[agentKey].base;
    const payload = collectAgentPayload(agentKey);
    await jpost(base, "/api/config", payload);
    return agentKey;
  });
  const results = await Promise.allSettled(updates);
  setSettingsBusy(false);

  const ok = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  const failed = ["official", "unofficial"].filter((k, i) => results[i].status === "rejected");

  if (failed.length) {
    setSettingsStatus(
      `Saved: ${ok.join(", ") || "none"}. Failed: ${failed.join(", ")}. Verify URL/token and retry.`,
      true
    );
    return;
  }

  setSettingsStatus("Saved.");
  closeSettingsModal();
  await refreshEdgeStatusBoth();
  await loadCaches();
  setStatus("Settings saved and reloaded.");
}

async function quickLoadBranches(agentKey, companyId, opts = {}) {
  const sid = state.setup.sessions[agentKey];
  if (!sid?.token || !sid?.api_base_url || !companyId) {
    state.setup.branches[agentKey] = [];
    setQuickBranchOptions(agentKey, "", "");
    return;
  }
  const agentBase = state.agents[agentKey].base;
  const res = await jpost(agentBase, "/api/setup/branches", {
    api_base_url: sid.api_base_url,
    token: sid.token,
    company_id: companyId
  });
  const branches = Array.isArray(res.branches) ? res.branches : [];
  state.setup.branches[agentKey] = branches;
  setQuickBranchOptions(agentKey, opts.selectedBranchId || "", res.warning || "");
}

async function quickSignIn() {
  setOtherAgentBase();
  const agentKey = selectedQuickAgent();
  const agentBase = selectedQuickAgentBase();
  const api_base_url = normalizeApiBase(el("quickApiBaseUrl")?.value || "");
  const email = String(el("quickEmail")?.value || "").trim();
  const password = String(el("quickPassword")?.value || "");
  const mfa_code = String(el("quickMfaCode")?.value || "").trim();
  if (!api_base_url) throw new Error("API base URL is required.");
  if (!email) throw new Error("Email is required.");
  if (!password) throw new Error("Password is required.");

  const existing = state.setup.sessions[agentKey] || {};
  const payload = {
    api_base_url,
    email,
    password
  };
  if (existing.mfa_token) payload.mfa_token = existing.mfa_token;
  if (mfa_code) payload.mfa_code = mfa_code;

  setQuickBusy(true);
  setQuickStatus(`Signing in on ${agentKey}...`);
  try {
    const res = await jpost(agentBase, "/api/setup/login", payload);
    if (res.mfa_required) {
      state.setup.sessions[agentKey] = {
        api_base_url,
        token: "",
        mfa_token: String(res.mfa_token || "")
      };
      state.setup.companies[agentKey] = [];
      state.setup.branches[agentKey] = [];
      setQuickCompanyOptions(agentKey, "");
      setQuickBranchOptions(agentKey, "");
      setQuickStatus("MFA required. Enter the code and click Sign In again.");
      return;
    }

    const companies = Array.isArray(res.companies) ? res.companies : [];
    state.setup.sessions[agentKey] = {
      api_base_url,
      token: String(res.token || ""),
      mfa_token: ""
    };
    state.setup.companies[agentKey] = companies;
    setQuickCompanyOptions(agentKey, res.active_company_id || state.configs[agentKey]?.company_id || "");
    const companyId = String(el("quickCompany")?.value || "").trim();
    await quickLoadBranches(agentKey, companyId, { selectedBranchId: state.configs[agentKey]?.branch_id || "" });
    setQuickStatus(`Signed in. ${companies.length} compan${companies.length === 1 ? "y" : "ies"} loaded.`);
  } finally {
    setQuickBusy(false);
  }
}

async function quickRegisterAndApply() {
  setOtherAgentBase();
  const agentKey = selectedQuickAgent();
  const agentBase = selectedQuickAgentBase();
  const sid = state.setup.sessions[agentKey];
  if (!sid?.token) throw new Error("Sign in first.");
  const companyId = String(el("quickCompany")?.value || "").trim();
  const branchId = String(el("quickBranch")?.value || "").trim();
  const deviceCode = String(el("quickDeviceCode")?.value || "").trim();
  const resetToken = !!el("quickResetToken")?.checked;
  if (!companyId) throw new Error("Select a company.");
  if (!deviceCode) throw new Error("Device code is required.");

  setQuickBusy(true);
  setQuickStatus("Registering device and applying config...");
  try {
    const reg = await jpost(agentBase, "/api/setup/register-device", {
      api_base_url: sid.api_base_url,
      token: sid.token,
      company_id: companyId,
      branch_id: branchId || null,
      device_code: deviceCode,
      reset_token: resetToken
    });
    const deviceId = String(reg.device_id || "").trim();
    const deviceToken = String(reg.device_token || "").trim();
    if (!deviceId || !deviceToken) {
      throw new Error("Registration succeeded but no device credentials were returned.");
    }

    const setupPayload = {
      api_base_url: sid.api_base_url,
      company_id: companyId,
      branch_id: branchId || "",
      device_code: deviceCode,
      device_id: deviceId,
      device_token: deviceToken
    };
    await jpost(agentBase, "/api/config", setupPayload);
    await loadAgentConfig(agentKey);

    // Best-effort first pull to hydrate warehouse/tax/rate defaults.
    try {
      await jpost(agentBase, "/api/sync/pull", {});
    } catch (_e) {
      // Ignore pull failures here; config is still saved.
    }
    await refreshEdgeStatusBoth();
    await loadCaches();
    setQuickStatus(`Quick Connect complete for ${agentKey}.`);
    setSettingsStatus(`Quick Connect applied to ${agentKey}.`, false);
    setStatus(`Quick Connect complete (${agentKey}).`);
  } finally {
    setQuickBusy(false);
  }
}

function renderEdgeBadges() {
  const map = {
    unofficial: el("edgeUnofficial"),
    official: el("edgeOfficial")
  };
  for (const key of ["unofficial", "official"]) {
    const n = map[key];
    if (!n) continue;
    const st = state.edge[key] || { ok: null, pending: 0, latency_ms: null, auth_ok: null, auth_status: null, auth_error: "" };
    n.classList.remove("edgeOk", "edgeOffline", "edgeUnknown");
    if (st.ok === true && (st.auth_ok === true || st.auth_ok == null)) {
      n.classList.add("edgeOk");
      const ms = Number(st.latency_ms || 0);
      n.textContent = `${key}: OK${ms ? ` (${ms}ms)` : ""} · ${Number(st.pending || 0)} queued`;
      const tip = [];
      tip.push(`Server: OK${ms ? ` (${ms}ms)` : ""}`);
      if (st.auth_ok === true) tip.push("Device auth: OK");
      n.title = tip.join("\n");
    } else if (st.ok === true && st.auth_ok === false) {
      // Server reachable but device credentials are invalid/missing.
      n.classList.add("edgeOffline");
      const code = st.auth_status ? ` (${st.auth_status})` : "";
      n.textContent = `${key}: AUTH${code} · ${Number(st.pending || 0)} queued`;
      const tip = [];
      tip.push("Server: OK");
      tip.push(`Device auth: FAILED${code}`);
      if (st.auth_error) tip.push(`Error: ${st.auth_error}`);
      if (st.auth_url) tip.push(`URL: ${st.auth_url}`);
      n.title = tip.join("\n");
    } else if (st.ok === false) {
      n.classList.add("edgeOffline");
      n.textContent = `${key}: OFFLINE · ${Number(st.pending || 0)} queued`;
      const tip = [];
      if (st.error) tip.push(`Error: ${st.error}`);
      if (st.url) tip.push(`URL: ${st.url}`);
      n.title = tip.join("\n");
    } else {
      n.classList.add("edgeUnknown");
      n.textContent = `${key}: …`;
      n.title = "";
    }
  }

  // Disable credit on the selected invoice agent when its edge is offline.
  const inv = effectiveInvoiceCompany();
  const creditOpt = el("payment")?.querySelector?.('option[value="credit"]');
  if (creditOpt) creditOpt.disabled = state.edge[inv]?.ok === false;
}

async function refreshEdgeStatusBoth() {
  setOtherAgentBase();
  const prev = {
    official: state.edge.official?.ok,
    unofficial: state.edge.unofficial?.ok
  };
  for (const key of ["official", "unofficial"]) {
    if (!canEdgePollNow(key)) continue;
    const base = state.agents[key].base;
    try {
      const res = await jget(base, "/api/edge/status");
      state.edge[key] = {
        ok: !!res.edge_ok,
        latency_ms: res.edge_latency_ms ?? null,
        pending: Number(res.outbox_pending || 0),
        url: String(res.edge_url || ""),
        error: String(res.edge_error || ""),
        auth_ok: res.edge_auth_ok == null ? null : !!res.edge_auth_ok,
        auth_status: res.edge_auth_status ?? null,
        auth_error: String(res.edge_auth_error || ""),
        auth_url: String(res.edge_auth_url || ""),
      };
      recordEdgePollSuccess(key);
    } catch (e) {
      state.edge[key] = {
        ok: false,
        latency_ms: null,
        pending: state.edge[key]?.pending || 0,
        url: "",
        error: String(e?.message || e || ""),
        auth_ok: null,
        auth_status: null,
        auth_error: "",
        auth_url: "",
      };
      recordEdgePollFailure(key);
    }
  }
  renderEdgeBadges();
  if ((prev.official === false && state.edge.official?.ok === true) ||
      (prev.unofficial === false && state.edge.unofficial?.ok === true)) {
    maybeAutoSyncPullBoth({ reason: "edge-online" });
  }
}

function recordAutoSyncSuccess() {
  state.ui.autoSyncBackoff.failures = 0;
  state.ui.autoSyncBackoff.nextAtMs = 0;
}

function recordAutoSyncFailure() {
  state.ui.autoSyncBackoff.failures = Math.min(8, Number(state.ui.autoSyncBackoff.failures || 0) + 1);
  const delayMs = Math.min(5 * 60_000, 10_000 * (2 ** Math.max(0, state.ui.autoSyncBackoff.failures - 1)));
  state.ui.autoSyncBackoff.nextAtMs = Date.now() + delayMs;
}

function canAutoSyncNow() {
  return Date.now() >= Number(state.ui.autoSyncBackoff.nextAtMs || 0);
}

function isUiBusyForAutoSync() {
  // Avoid syncing while high-risk actions are in flight.
  const ids = ["payBtn", "syncBtn", "pushBtn", "reconnectBothBtn"];
  return ids.some((id) => el(id)?.classList?.contains("isBusy"));
}

async function maybeAutoSyncPullBoth(_opts = {}) {
  if (document.hidden) return;
  if (state.ui.autoSyncBusy) return;
  if (!canAutoSyncNow()) return;
  if (isUiBusyForAutoSync()) return;

  // Only pull on agents whose edge is currently reachable.
  const targets = ["official", "unofficial"].filter((k) => state.edge[k]?.ok !== false);
  if (!targets.length) return;

  state.ui.autoSyncBusy = true;
  try {
    const pulls = await Promise.allSettled(
      targets.map((k) => jpost(state.agents[k].base, "/api/sync/pull", {}))
    );
    const anyOk = pulls.some((r) => r.status === "fulfilled");
    if (!anyOk) throw new Error("auto-sync failed");
    await loadCaches({ silent: true });
    recordAutoSyncSuccess();
  } catch (_e) {
    recordAutoSyncFailure();
  } finally {
    state.ui.autoSyncBusy = false;
  }
}

function stopAutoSyncPullBoth() {
  if (!state.ui.autoSyncTimer) return;
  clearInterval(state.ui.autoSyncTimer);
  state.ui.autoSyncTimer = null;
}

function startAutoSyncPullBoth() {
  stopAutoSyncPullBoth();
  state.ui.autoSyncTimer = setInterval(() => maybeAutoSyncPullBoth({ reason: "interval" }), 30_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) maybeAutoSyncPullBoth({ reason: "tab-visible" });
  });
}

function rebuildItemIndexes() {
  // Reset maps in-place so other references remain valid.
  for (const k of ["official", "unofficial"]) {
    state.index.itemsById[k].clear();
    state.index.byBarcode[k].clear();
    state.index.bySku[k].clear();

    const items = state.items[k] || [];
    for (const it of items) {
      const id = String(it?.id || "").trim();
      if (!id) continue;
      state.index.itemsById[k].set(id, it);

      const sku = String(it?.sku || "").trim().toLowerCase();
      if (sku) state.index.bySku[k].set(sku, it);

      const bc = String(it?.barcode || "").trim();
      if (bc) state.index.byBarcode[k].set(bc, it);
    }

    const bcs = state.barcodes[k] || [];
    for (const b of bcs) {
      const bc = String(b?.barcode || "").trim();
      const itemId = String(b?.item_id || "").trim();
      if (!bc || !itemId) continue;
      const it = state.index.itemsById[k].get(itemId);
      if (it) state.index.byBarcode[k].set(bc, it);
    }
  }
}

function findByBarcode(companyKey, barcode) {
  const bc = String(barcode).trim();
  if (!bc) return null;
  const m = state.index?.byBarcode?.[companyKey];
  if (m && typeof m.get === "function") return m.get(bc) || null;
  // Fallback: scan items array (should be rare if indexes are built).
  const items = state.items[companyKey] || [];
  return items.find((i) => String(i?.barcode || "").trim() === bc) || null;
}

function lookupCompanyOrder() {
  const inv = effectiveInvoiceCompany();
  const first = inv === "official" ? "official" : "unofficial";
  const second = first === "official" ? "unofficial" : "official";
  return [first, second];
}

function _matchKey(companyKey, item) {
  const id = String(item?.id || "").trim();
  return `${companyKey}|${id}`;
}

function lookupMatches(barcodeOrText) {
  const q = String(barcodeOrText || "").trim();
  if (!q) return [];
  const [first, second] = lookupCompanyOrder();
  const order = [first, second];
  const out = [];
  const seen = new Set();

  function push(companyKey, item, reason, score) {
    if (!item) return;
    const k = _matchKey(companyKey, item);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ companyKey, item, reason, score: Number(score || 0) });
  }

  // 1) Barcode exact: return all matches across both companies (if any).
  for (const companyKey of order) {
    const it = findByBarcode(companyKey, q);
    if (it) push(companyKey, it, "barcode", 1000);
  }
  if (out.length) {
    return out.sort((a, b) => (b.score - a.score) || (a.companyKey === first ? -1 : 1));
  }

  const norm = q.toLowerCase();

  // 2) SKU exact.
  for (const companyKey of order) {
    const it = state.index?.bySku?.[companyKey]?.get?.(norm) || null;
    if (it) push(companyKey, it, "sku", 900);
  }
  if (out.length) {
    return out.sort((a, b) => (b.score - a.score) || (a.companyKey === first ? -1 : 1));
  }

  // 3) Text search (name/sku contains) across both companies.
  // Keep results small and stable for cashier speed.
  const MAX = 8;
  if (norm.length < 2) return [];

  for (const companyKey of order) {
    const items = state.items[companyKey] || [];
    for (const it of items) {
      const name = String(it?.name || "").toLowerCase();
      const sku = String(it?.sku || "").toLowerCase();
      if (!name && !sku) continue;
      let score = 0;
      let reason = "";
      if (sku && sku === norm) { score = 850; reason = "sku"; }
      else if (sku && sku.startsWith(norm)) { score = 650; reason = "sku-prefix"; }
      else if (name && name.startsWith(norm)) { score = 620; reason = "name-prefix"; }
      else if (sku && sku.includes(norm)) { score = 520; reason = "sku-contains"; }
      else if (name && name.includes(norm)) { score = 480; reason = "name-contains"; }
      if (!score) continue;
      // Small bias towards the preferred company.
      if (companyKey === first) score += 2;
      push(companyKey, it, reason, score);
      if (out.length > MAX * 4) break; // short-circuit large catalogs
    }
  }

  out.sort((a, b) => (b.score - a.score) || (a.companyKey === first ? -1 : 1));
  return out.slice(0, MAX);
}

function setLookupResults(matches, query) {
  const list = Array.isArray(matches) ? matches : [];
  state.ui.lookupResults = list;
  state.ui.lookupQuery = String(query || "").trim();
  state.ui.lookupActiveIndex = list.length ? 0 : -1;
  state.lastLookup = list.length ? list[0] : null;
}

function activeLookup() {
  const list = state.ui.lookupResults || [];
  const idx = Number(state.ui.lookupActiveIndex);
  if (Number.isFinite(idx) && idx >= 0 && idx < list.length) return list[idx] || null;
  return list[0] || null;
}

function setLookupActiveIndex(nextIndex, opts = {}) {
  const root = el("results");
  const list = state.ui.lookupResults || [];
  if (!root || !list.length) {
    state.ui.lookupActiveIndex = -1;
    state.lastLookup = null;
    return -1;
  }
  let idx = Number(nextIndex);
  if (!Number.isFinite(idx)) idx = 0;
  idx = Math.max(0, Math.min(list.length - 1, idx));
  state.ui.lookupActiveIndex = idx;
  state.lastLookup = list[idx] || null;
  const rows = Array.from(root.querySelectorAll("[data-lookup-idx]"));
  rows.forEach((r) => {
    const i = Number(r.getAttribute("data-lookup-idx") || "-1");
    r.classList.toggle("active", i === idx);
    r.setAttribute("aria-selected", i === idx ? "true" : "false");
  });
  if (opts.scroll && rows[idx]) rows[idx].scrollIntoView({ block: "nearest" });
  return idx;
}

function moveLookupActive(delta) {
  const list = state.ui.lookupResults || [];
  if (!list.length) return false;
  let idx = Number(state.ui.lookupActiveIndex);
  if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) idx = 0;
  else idx = (idx + Number(delta || 0) + list.length) % list.length;
  setLookupActiveIndex(idx, { scroll: true });
  return true;
}

function renderResults(matches, opts = {}) {
  const root = el("results");
  root.innerHTML = "";
  const list = Array.isArray(matches) ? matches : [];
  if (!list.length) {
    root.innerHTML = `<div class="hint">No match. Try Sync Both or refine your search.</div>`;
    if (!opts.silentMeta) setScanMeta("No result for current input.");
    return;
  }

  const activeIdx = Number.isFinite(state.ui.lookupActiveIndex) ? state.ui.lookupActiveIndex : 0;
  for (let i = 0; i < list.length; i += 1) {
    const m = list[i];
    const { companyKey, item } = m;
    const tagClass = companyKey === "official" ? "official" : "unofficial";
    const tagText = companyKey === "official" ? "Official" : "Unofficial";
    const price = toNum(item?.price_usd || 0);
    const reason = String(m?.reason || "").replaceAll("-", " ");
    const row = document.createElement("div");
    row.className = `resultRow${i === activeIdx ? " active" : ""}`;
    row.setAttribute("data-lookup-idx", String(i));
    row.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
    row.innerHTML = `
      <div class="meta">
        <div class="name">${escapeHtml(item?.name || item?.sku || item?.id)}</div>
        <div class="sub mono">SKU: ${escapeHtml(item?.sku || "-")} · Barcode: ${escapeHtml(item?.barcode || "-")} · USD ${fmtUsd(price)}</div>
        <div class="sub mono">Match: ${escapeHtml(reason || "search")}</div>
      </div>
      <div class="resultRight">
        <div class="tag ${tagClass}">${tagText}</div>
        <button class="btn tiny" type="button">Add</button>
      </div>
    `;
    row.addEventListener("click", (e) => {
      // Clicking the row selects; the Add button actually adds.
      if (e?.target && e.target.tagName === "BUTTON") return;
      setLookupActiveIndex(i, { scroll: false });
    });
    row.querySelector("button")?.addEventListener("click", () => addToCart(companyKey, item));
    root.appendChild(row);
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function cartKey(companyKey, itemId) {
  return `${companyKey}|${String(itemId)}`;
}

function addToCart(companyKey, item) {
  const key = cartKey(companyKey, item.id);
  const existing = state.cart.find((c) => c.key === key);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      key,
      companyKey,
      agentBase: state.agents[companyKey].base,
      id: item.id,
      sku: item.sku,
      name: item.name,
      barcode: item.barcode,
      price_usd: toNum(item.price_usd || 0),
      price_lbp: toNum(item.price_lbp || 0),
      qty: 1
    });
  }
  renderCart();
}

function removeFromCart(key) {
  state.cart = state.cart.filter((c) => c.key !== key);
  renderCart();
}

function changeQty(key, delta) {
  const it = state.cart.find((c) => c.key === key);
  if (!it) return;
  it.qty = Math.max(1, (it.qty || 1) + delta);
  renderCart();
}

function computeTotals() {
  let subtotal = 0;
  for (const c of state.cart) {
    subtotal += toNum(c.price_usd) * toNum(c.qty);
  }
  // VAT is computed by backend too; for UI we do a simple default 11%.
  const vat = subtotal * 0.11;
  return { subtotal, vat, total: subtotal + vat };
}

function computeTotalsByCompany() {
  const out = {
    official: { subtotal: 0, vat: 0, total: 0 },
    unofficial: { subtotal: 0, vat: 0, total: 0 }
  };
  for (const c of state.cart) {
    const k = c.companyKey === "official" ? "official" : "unofficial";
    out[k].subtotal += toNum(c.price_usd) * toNum(c.qty);
  }
  for (const k of ["official", "unofficial"]) {
    out[k].vat = out[k].subtotal * 0.11;
    out[k].total = out[k].subtotal + out[k].vat;
  }
  return out;
}

function renderSplitTotals() {
  const box = el("splitTotals");
  if (!box) return;
  const cartCompanies = new Set(state.cart.map((c) => c.companyKey));
  const mixedCompanies = cartCompanies.size > 1;
  box.classList.toggle("hidden", !mixedCompanies);
  if (!mixedCompanies) return;
  const by = computeTotalsByCompany();
  const tOfficial = el("tTotalOfficial");
  const tUnofficial = el("tTotalUnofficial");
  if (tOfficial) tOfficial.textContent = fmtUsd(by.official.total);
  if (tUnofficial) tUnofficial.textContent = fmtUsd(by.unofficial.total);
}

function renderCart() {
  const root = el("cart");
  const fullRoot = el("cartFull");
  const MAIN_MAX = calcCartPreviewLimit();

  function renderInto(node, lines, opts = {}) {
    if (!node) return;
    node.innerHTML = "";
    const list = Array.isArray(lines) ? lines : [];
    if (!list.length) {
      node.innerHTML = `<div class="hint">Cart is empty.</div>`;
      return;
    }
    if (opts.truncated) {
      const note = document.createElement("div");
      note.className = "hint";
      note.textContent = `Showing last ${MAIN_MAX} lines. Use View for full cart.`;
      node.appendChild(note);
    }
    for (const c of list) {
      const tagClass = c.companyKey === "official" ? "official" : "unofficial";
      const tagText = c.companyKey === "official" ? "Official" : "Unofficial";
      const line = toNum(c.price_usd) * toNum(c.qty);
      const div = document.createElement("div");
      div.className = "cartItem";
      div.innerHTML = `
        <div>
          <div class="title">${escapeHtml(c.name || c.sku || c.id)}</div>
          <div class="small mono">${escapeHtml(c.sku || "-")} · USD ${fmtUsd(c.price_usd)} · Line ${fmtUsd(line)}</div>
        </div>
        <div class="tag ${tagClass}">${tagText}</div>
        <div class="qty">
          <button data-k="${c.key}" data-d="-1" aria-label="Decrease qty">-</button>
          <div class="n">${escapeHtml(c.qty)}</div>
          <button data-k="${c.key}" data-d="1" aria-label="Increase qty">+</button>
        </div>
        <div class="remove" data-r="${c.key}" title="Remove line">DEL</div>
      `;
      node.appendChild(div);
    }
    node.querySelectorAll("button[data-k]").forEach((b) => {
      b.addEventListener("click", () => changeQty(b.getAttribute("data-k"), Number(b.getAttribute("data-d") || 0)));
    });
    node.querySelectorAll(".remove").forEach((d) => {
      d.addEventListener("click", () => removeFromCart(d.getAttribute("data-r")));
    });
  }

  const totalLines = state.cart.length;
  const mainLines = totalLines > MAIN_MAX ? state.cart.slice(-MAIN_MAX) : state.cart;
  renderInto(root, mainLines, { truncated: totalLines > MAIN_MAX });

  // Full cart is only needed when the modal is open, but rendering it is cheap and keeps it in sync.
  renderInto(fullRoot, state.cart, { truncated: false });

  const t = computeTotals();
  el("tSubtotal").textContent = fmtUsd(t.subtotal);
  el("tVat").textContent = fmtUsd(t.vat);
  el("tTotal").textContent = fmtUsd(t.total);
  renderSplitTotals();
  updateUiFacts();
}

async function syncBoth() {
  setOtherAgentBase();
  setStatus("Syncing both agents…", "info");
  setButtonBusy("syncBtn", true, "Syncing...");
  const a = state.agents.official.base;
  const b = state.agents.unofficial.base;
  try {
    await Promise.all([
      jpost(a, "/api/sync/pull", {}),
      jpost(b, "/api/sync/pull", {})
    ]);
    await loadCaches();
    setStatus("Synced.", "ok");
  } finally {
    setButtonBusy("syncBtn", false);
  }
}

async function pushBoth() {
  setOtherAgentBase();
  setStatus("Pushing both agents…", "info");
  setButtonBusy("pushBtn", true, "Pushing...");
  const a = state.agents.official.base;
  const b = state.agents.unofficial.base;
  try {
    await Promise.allSettled([
      jpost(a, "/api/sync/push", {}),
      jpost(b, "/api/sync/push", {})
    ]);
    setStatus("Pushed (check outbox if offline).", "ok");
    await refreshEdgeStatusBoth();
  } finally {
    setButtonBusy("pushBtn", false);
  }
}

async function reconnectBoth() {
  setOtherAgentBase();
  setStatus("Reconnect: checking edge…", "info");
  setButtonBusy("reconnectBothBtn", true, "Checking...");
  await refreshEdgeStatusBoth();
  const off = [];
  for (const k of ["official", "unofficial"]) {
    if (state.edge[k]?.ok === false) off.push(k);
  }
  if (off.length) {
    setStatus(`Edge offline for: ${off.join(", ")}. Fix LAN/edge then retry.`, "warn");
    setButtonBusy("reconnectBothBtn", false);
    return;
  }
  try {
    setStatus("Reconnect: Sync Both…");
    await syncBoth();
    setStatus("Reconnect: Push Both…");
    await pushBoth();
    const pendO = Number(state.edge.official?.pending || 0);
    const pendU = Number(state.edge.unofficial?.pending || 0);
    if (pendO === 0 && pendU === 0) setStatus("Back online. Queues cleared.", "ok");
    else setStatus(`Back online. Queued: official ${pendO}, unofficial ${pendU}.`, "warn");
  } catch (e) {
    setStatus(`Reconnect error: ${e.message}`, "error");
  } finally {
    setButtonBusy("reconnectBothBtn", false);
  }
}

async function loadCaches(opts = {}) {
  setOtherAgentBase();
  const a = state.agents.official.base;
  const b = state.agents.unofficial.base;

  const results = await Promise.allSettled([
    jget(a, "/api/items"),
    jget(a, "/api/barcodes"),
    jget(b, "/api/items"),
    jget(b, "/api/barcodes")
  ]);

  const failures = [];
  if (results[0].status === "fulfilled") state.items.official = results[0].value.items || [];
  else failures.push("Official items");
  if (results[1].status === "fulfilled") state.barcodes.official = results[1].value.barcodes || [];
  else failures.push("Official barcodes");
  if (results[2].status === "fulfilled") state.items.unofficial = results[2].value.items || [];
  else failures.push("Unofficial items");
  if (results[3].status === "fulfilled") state.barcodes.unofficial = results[3].value.barcodes || [];
  else failures.push("Unofficial barcodes");

  if (!opts.silent) {
    if (failures.length) {
      setStatus(`Loaded with warnings: ${failures.join(", ")}.`, "warn");
    } else {
      setStatus(
        `Ready. Official: ${state.items.official.length} item(s), Unofficial: ${state.items.unofficial.length} item(s).`,
        "ok"
      );
    }
  }
  try { rebuildItemIndexes(); } catch (_e) {}
  if (typeof state.ui.refreshLookup === "function") state.ui.refreshLookup();
}

async function cashierPinBoth() {
  setOtherAgentBase();
  const pin = window.prompt("Cashier PIN (logs in on BOTH agents):");
  if (!pin) return;
  setStatus("Logging in cashier on both agents…", "info");
  setButtonBusy("loginBtn", true, "Logging in...");
  const a = state.agents.official.base;
  const b = state.agents.unofficial.base;
  const payload = { pin: String(pin).trim() };
  try {
    const [ra, rb] = await Promise.allSettled([
      jpost(a, "/api/cashiers/login", payload),
      jpost(b, "/api/cashiers/login", payload)
    ]);
    if (ra.status === "rejected" || rb.status === "rejected") {
      const ea = ra.status === "rejected" ? ra.reason?.message : null;
      const eb = rb.status === "rejected" ? rb.reason?.message : null;
      throw new Error(`login failed: ${ea || ""} ${eb || ""}`.trim());
    }

    // Update cashier context and immediately apply that cashier's preferred UI preferences.
    const changed = setCashierContextFromLogin(ra.value) || setCashierContextFromLogin(rb.value);
    if (changed) {
      initTheme();
      initDensityMode();
      applyResponsiveLayout();
    }
    setStatus("Cashier logged in on both.", "ok");
  } finally {
    setButtonBusy("loginBtn", false);
  }
}

function renderCustomerResults(rows, companyKey) {
  const root = el("customerResults");
  if (!root) return;
  root.innerHTML = "";
  const all = Array.isArray(rows) ? rows : [];
  const MAX = 6;
  const list = all.slice(0, MAX);
  const truncated = all.length > list.length;
  state.ui.customerResults = list;
  state.ui.customerActiveIndex = list.length ? 0 : -1;
  if (!all.length) {
    root.innerHTML = `<div class="hint">No customer matches.</div>`;
    return;
  }
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    const div = document.createElement("div");
    div.className = `custRow${i === 0 ? " preselected active" : ""}`;
    div.dataset.top = i === 0 ? "1" : "0";
    div.dataset.idx = String(i);
    div.setAttribute("aria-selected", i === 0 ? "true" : "false");
    div.innerHTML = `
      <div>
        <div class="name">${escapeHtml(c.name || c.id)}</div>
        <div class="id">${escapeHtml(c.id)}</div>
      </div>
      <div class="tag ${companyKey === "official" ? "official" : "unofficial"}">${companyKey}</div>
    `;
    div.addEventListener("click", () => {
      applyCustomerFromResult(c);
    });
    root.appendChild(div);
  }
  if (truncated) {
    const note = document.createElement("div");
    note.className = "hint";
    note.textContent = `Showing ${MAX} of ${all.length}. Refine search to narrow.`;
    root.appendChild(note);
  }
}

function selectTopCustomerMatch() {
  return selectActiveCustomerMatch();
}

async function customerSearch(opts = {}) {
  setOtherAgentBase();
  const q = String(opts.query ?? el("customerQuery")?.value ?? "").trim();
  const live = !!opts.live;
  const limit = Number(opts.limit || 6);
  if (!q) {
    state.ui.customerLookupSeq += 1;
    clearCustomerResults();
    return [];
  }
  const invoiceCompany = opts.companyKey || effectiveInvoiceCompany();
  const base = state.agents[invoiceCompany].base;
  const reqSeq = ++state.ui.customerLookupSeq;
  if (!live) {
    setStatus(`Searching customers (${invoiceCompany})…`, "info");
    setButtonBusy("customerSearchBtn", true, "Searching...");
  }
  try {
    const res = await jget(base, `/api/customers?query=${encodeURIComponent(q)}&limit=${Math.max(1, Math.min(100, limit))}`);
    if (reqSeq !== state.ui.customerLookupSeq) return [];
    const rows = Array.isArray(res.customers) ? res.customers : [];
    renderCustomerResults(rows, invoiceCompany);
    if (!live) {
      if (!rows.length) setStatus("No customer matches.", "warn");
      else setStatus(`Customers: ${rows.length}. Use ↑/↓ then Enter.`, "ok");
    }
    return rows;
  } finally {
    if (!live) setButtonBusy("customerSearchBtn", false);
  }
}

async function createCustomerFromPos() {
  setOtherAgentBase();
  const invoiceCompany = effectiveInvoiceCompany();
  const base = state.agents[invoiceCompany].base;
  const name = String(el("customerCreateName")?.value || "").trim();
  const phone = String(el("customerCreatePhone")?.value || "").trim();
  const email = String(el("customerCreateEmail")?.value || "").trim();
  if (!name) throw new Error("Customer name is required.");
  setButtonBusy("customerCreateBtn", true, "Creating...");
  setCustomerCreateStatus(`Creating on ${invoiceCompany}…`);
  try {
    const res = await jpost(base, "/api/customers/create", {
      name,
      phone,
      email
    });
    const c = res.customer || {};
    const cid = String(c.id || "").trim();
    if (!cid) throw new Error("Customer created but no id returned.");
    setCustomerSelection(cid, c.name || cid);
    const q = String(c.name || c.id || "").trim();
    if (el("customerQuery")) el("customerQuery").value = q;
    if (el("customerCreateName")) el("customerCreateName").value = "";
    if (el("customerCreatePhone")) el("customerCreatePhone").value = "";
    if (el("customerCreateEmail")) el("customerCreateEmail").value = "";
    setCustomerCreatePanel(false);
    renderCustomerResults([c], invoiceCompany);
    setStatus(`Customer created: ${c.name || cid}`, "ok");
  } finally {
    setButtonBusy("customerCreateBtn", false);
  }
}

async function pay() {
  if (!state.cart.length) throw new Error("empty cart");
  setOtherAgentBase();

  const payment_method = el("payment").value || "cash";
  const requested_customer_id = String(el("customerId").value || "").trim() || null;
  if (payment_method === "credit" && !requested_customer_id) {
    throw new Error("credit sale requires customer_id");
  }

  const cartCompanies = cartCompaniesSet();
  const flag = !!el("flagOfficial")?.checked;
  const mixedCompanies = cartCompanies.size > 1;
  const inferredPrimary = primaryCompanyFromCart();
  const invForPay = effectiveInvoiceCompany();
  const crossCompany = !!inferredPrimary && !mixedCompanies && invForPay !== inferredPrimary;

  if (!flag && crossCompany && payment_method === "credit") {
    throw new Error("Credit is disabled for cross-company invoices. Use cash/card/transfer, or Flag to invoice Official for review.");
  }

  async function resolveCustomerId(companyKey) {
    const cid = requested_customer_id;
    if (!cid) return null;
    try {
      const base = state.agents[companyKey].base;
      const res = await jget(base, `/api/customers/by-id?customer_id=${encodeURIComponent(cid)}`);
      const ok = !!(res && res.customer && res.customer.id);
      if (!ok && payment_method === "credit") {
        throw new Error(`Customer not found on ${companyKey}. Credit sale requires a valid customer.`);
      }
      return ok ? cid : null;
    } catch (_e) {
      if (payment_method === "credit") throw _e;
      return null;
    }
  }

  function mapCart(lines) {
    return lines.map((c) => ({
      id: c.id,
      sku: c.sku,
      name: c.name,
      barcode: c.barcode,
      price_usd: c.price_usd,
      price_lbp: c.price_lbp,
      qty: c.qty
    }));
  }

  // Ensure credit is only used when the invoice agent is online.
  function assertCreditAllowed(companyKey) {
    if (payment_method !== "credit") return;
    if (state.edge[companyKey]?.ok === false) throw new Error("credit is disabled while edge is offline");
  }

  setButtonBusy("payBtn", true, "Submitting...");
  try {
    // Flag override: issue ONE invoice on Official for later review (even if items are mixed).
    if (flag) {
      const invoiceCompany = "official";
      assertCreditAllowed(invoiceCompany);
      const agentBase = state.agents[invoiceCompany].base;
      const crossCompany = mixedCompanies || !cartCompanies.has(invoiceCompany);
      const customer_id = await resolveCustomerId(invoiceCompany);
      if (requested_customer_id && !customer_id) {
        setStatus("Customer not found on Official. Proceeding as guest.", "warn");
      }

      // Pre-open receipt window to reduce popup blocking.
      const receiptWin = window.open("about:blank", "_blank", "noopener,noreferrer,width=420,height=820");

      const receipt_meta = {
        pilot: {
          mode: "flag-to-official",
          invoice_company: invoiceCompany,
          line_companies: Array.from(cartCompanies.values()),
          cross_company: crossCompany,
          flagged_for_adjustment: true,
          customer_id_requested: requested_customer_id,
          customer_id_applied: customer_id,
          note: "Flagged: invoice issued by Official for later review."
        }
      };

      let res;
      try {
        res = await jpost(agentBase, "/api/sale", {
          cart: mapCart(state.cart),
          customer_id,
          payment_method,
          receipt_meta,
          skip_stock_moves: crossCompany ? true : false
        });
      } catch (e) {
        try { if (receiptWin) receiptWin.close(); } catch (_e2) {}
        throw e;
      }

      if (receiptWin) receiptWin.location = `${agentBase}/receipt/last`;
      else setStatus("Receipt popup blocked. Use Receipt button.", "warn");

      try { await jpost(agentBase, "/api/sync/push", {}); } catch (e) {}

      state.cart = [];
      renderCart();
      el("scan").value = "";
      el("results").innerHTML = "";
      setScanMeta("Flagged sale queued on Official. Receipt opened.");
      setStatus(`Sale queued (official): ${res.event_id || "ok"}`, "ok");
      return;
    }

    // Mixed cart: automatically split into two invoices (one per company) with a single Pay.
    if (mixedCompanies) {
      if (payment_method === "credit") {
        throw new Error("Split invoices currently support cash/card/transfer only. Use Flag to invoice Official, or sell per-company.");
      }

      const groupId = `split-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const companiesInOrder = ["official", "unofficial"].filter((k) => state.cart.some((c) => c.companyKey === k));
      const receiptWindows = {};
      for (const k of companiesInOrder) {
        receiptWindows[k] = window.open("about:blank", "_blank", "noopener,noreferrer,width=420,height=820");
      }

      const customerByCompany = {};
      if (requested_customer_id) {
        for (const k of companiesInOrder) {
          customerByCompany[k] = await resolveCustomerId(k);
        }
        const missing = companiesInOrder.filter((k) => !customerByCompany[k]);
        if (missing.length) {
          setStatus(`Customer not found in: ${missing.join(", ")}. Those invoices will be guest sales.`, "warn");
        }
      }

      setScanMeta(`Issuing ${companiesInOrder.length} invoices…`);
      const done = [];

      for (const companyKey of companiesInOrder) {
        const agentBase = state.agents[companyKey].base;
        const lines = state.cart.filter((c) => c.companyKey === companyKey);
        if (!lines.length) continue;

        setScanMeta(`Issuing ${companyKey} invoice…`);
        const customer_id = requested_customer_id ? (customerByCompany[companyKey] || null) : null;
        const receipt_meta = {
          pilot: {
            mode: "split-by-company",
            split_group_id: groupId,
            invoice_company: companyKey,
            line_companies: [companyKey],
            cross_company: false,
            flagged_for_adjustment: false,
            customer_id_requested: requested_customer_id,
            customer_id_applied: customer_id,
            note: null
          }
        };

        let res;
        try {
          res = await jpost(agentBase, "/api/sale", {
            cart: mapCart(lines),
            customer_id,
            payment_method,
            receipt_meta,
            skip_stock_moves: false
          });
        } catch (e) {
          // Close the blank receipt popup for the failing company (if any).
          try { if (receiptWindows[companyKey]) receiptWindows[companyKey].close(); } catch (_e2) {}
          throw e;
        }

        done.push({ companyKey, event_id: res.event_id || "ok", agentBase });

        // Best-effort push right away.
        try { await jpost(agentBase, "/api/sync/push", {}); } catch (e) {}

        // Remove only the successfully invoiced lines so retries won't duplicate.
        state.cart = state.cart.filter((c) => c.companyKey !== companyKey);
        renderCart();

        const w = receiptWindows[companyKey];
        if (w) w.location = `${agentBase}/receipt/last`;
      }

      el("scan").value = "";
      el("results").innerHTML = "";
      setScanMeta("Split sale complete. Receipts opened.");
      setStatus(`Split sale queued: ${done.map((d) => `${d.companyKey} ${d.event_id}`).join(" · ")}`, "ok");
      return;
    }

    // Single-company (or intentionally forced) flow: issue one invoice on selected invoice company.
    const invoiceCompany = effectiveInvoiceCompany();
    assertCreditAllowed(invoiceCompany);
    const agentBase = state.agents[invoiceCompany].base;
    const crossCompany = cartCompanies.size > 1 || (cartCompanies.size === 1 && !cartCompanies.has(invoiceCompany));
    const customer_id = await resolveCustomerId(invoiceCompany);
    if (requested_customer_id && !customer_id) {
      setStatus(`Customer not found on ${invoiceCompany}. Proceeding as guest.`, "warn");
    }

      const receiptWin = window.open("about:blank", "_blank", "noopener,noreferrer,width=420,height=820");
      const receipt_meta = {
        pilot: {
          mode: "single",
          invoice_company: invoiceCompany,
          line_companies: Array.from(cartCompanies.values()),
          cross_company: crossCompany,
          flagged_for_adjustment: crossCompany,
          customer_id_requested: requested_customer_id,
          customer_id_applied: customer_id,
          note: crossCompany
            ? "Cross-company invoice: stock moves were skipped; requires later intercompany/adjustment handling."
            : null
        }
      };

    let res;
    try {
      res = await jpost(agentBase, "/api/sale", {
        cart: mapCart(state.cart),
        customer_id,
        payment_method,
        receipt_meta,
        // If cross-company, ask backend to skip stock moves to keep the pilot unblocked.
        skip_stock_moves: crossCompany ? true : false
      });
    } catch (e) {
      try { if (receiptWin) receiptWin.close(); } catch (_e2) {}
      throw e;
    }

    if (receiptWin) receiptWin.location = `${agentBase}/receipt/last`;
    else setStatus("Receipt popup blocked. Use Receipt button.", "warn");

    try { await jpost(agentBase, "/api/sync/push", {}); } catch (e) {}

    state.cart = [];
    renderCart();
    el("scan").value = "";
    el("results").innerHTML = "";
    setScanMeta("Sale queued and receipt opened.");
    setStatus(`Sale queued: ${res.event_id || "ok"}`, "ok");
  } finally {
    setButtonBusy("payBtn", false);
  }
}

function wire() {
  let resizeRaf = 0;
  function onViewportResize() {
    if (resizeRaf) window.cancelAnimationFrame(resizeRaf);
    resizeRaf = window.requestAnimationFrame(() => {
      resizeRaf = 0;
      applyResponsiveLayout();
    });
  }

  el("otherAgentUrl").addEventListener("change", async () => {
    try {
      await loadCaches();
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
  });
  el("syncBtn").addEventListener("click", async () => {
    try {
      await syncBoth();
    } catch (e) {
      setStatus(`Sync error: ${e.message}`);
    }
  });
  el("pushBtn").addEventListener("click", async () => {
    try {
      await pushBoth();
    } catch (e) {
      setStatus(`Push error: ${e.message}`);
    }
  });
  el("reconnectBothBtn").addEventListener("click", async () => {
    try {
      await reconnectBoth();
    } catch (e) {
      setStatus(`Reconnect error: ${e.message}`);
    }
  });
  el("loginBtn").addEventListener("click", async () => {
    try {
      await cashierPinBoth();
    } catch (e) {
      setStatus(`Login error: ${e.message}`);
    }
  });
  const managerBtn = el("managerBtn");
  if (managerBtn) {
    managerBtn.addEventListener("click", () => {
      openManagerDialog().catch((e) => setManagerStatus(`Error: ${e.message}`, true));
    });
  }
  el("settingsBtn").addEventListener("click", () => {
    openSettingsDialog().catch((e) => setSettingsStatus(`Error: ${e.message}`, true));
  });
  const openCartBtn = el("openCartBtn");
  if (openCartBtn) openCartBtn.addEventListener("click", openCartModal);
  const cartCloseBtn = el("cartCloseBtn");
  if (cartCloseBtn) cartCloseBtn.addEventListener("click", closeCartModal);
  const cartBackdrop = el("cartBackdrop");
  if (cartBackdrop) cartBackdrop.addEventListener("click", closeCartModal);
  const themeToggleBtn = el("themeToggle");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      toggleTheme();
    });
  }
  const densityToggleBtn = el("densityToggle");
  if (densityToggleBtn) {
    densityToggleBtn.addEventListener("click", () => {
      toggleDensityMode();
    });
  }
  el("settingsCancel").addEventListener("click", closeSettingsModal);
  el("settingsBackdrop").addEventListener("click", closeSettingsModal);
  el("settingsSave").addEventListener("click", () => {
    saveSettingsDialog().catch((e) => setSettingsStatus(`Save failed: ${e.message}`, true));
  });
  const managerBackdrop = el("managerBackdrop");
  if (managerBackdrop) managerBackdrop.addEventListener("click", closeManagerModal);
  const adminSuggestBtn = el("adminSuggestBtn");
  if (adminSuggestBtn) {
    adminSuggestBtn.addEventListener("click", async () => {
      try {
        const cfg = state.configs?.official || (await jget(state.agents.official.base, "/api/config"));
        const apiBase = String(cfg?.api_base_url || "").trim();
        el("adminUrl").value = suggestAdminUrlFromApiBase(apiBase);
        setManagerStatus("Suggested Admin URL.");
      } catch (e) {
        setManagerStatus(`Suggest failed: ${e.message}`, true);
      }
    });
  }
  const adminOpenBtn = el("adminOpenBtn");
  if (adminOpenBtn) adminOpenBtn.addEventListener("click", () => managerOpenAdmin().catch((e) => setManagerStatus(`Open failed: ${e.message}`, true)));
  const managerUnlockBtn = el("managerUnlockBtn");
  if (managerUnlockBtn) managerUnlockBtn.addEventListener("click", () => managerUnlock().catch((e) => setManagerStatus(`Unlock failed: ${e.message}`, true)));
  const managerSetPinBtn = el("managerSetPinBtn");
  if (managerSetPinBtn) managerSetPinBtn.addEventListener("click", () => managerSetPin().catch((e) => setManagerStatus(`Set PIN failed: ${e.message}`, true)));
  const managerLockBtn = el("managerLockBtn");
  if (managerLockBtn) managerLockBtn.addEventListener("click", managerLock);
  const managerResetPinBtn = el("managerResetPinBtn");
  if (managerResetPinBtn) managerResetPinBtn.addEventListener("click", managerResetPin);
  el("focusScanBtn").addEventListener("click", () => {
    el("scan").focus();
    setScanMeta("Scan field focused.");
  });
  el("clearSearchBtn").addEventListener("click", () => {
    el("scan").value = "";
    el("results").innerHTML = "";
    state.lastLookup = null;
    state.ui.lookupResults = [];
    state.ui.lookupActiveIndex = -1;
    state.ui.lookupQuery = "";
    setScanMeta("Search cleared.");
    el("scan").focus();
  });
  el("clearCartBtn").addEventListener("click", () => {
    if (!state.cart.length) return;
    const ok = window.confirm("Clear all cart lines?");
    if (!ok) return;
    state.cart = [];
    renderCart();
    setStatus("Cart cleared.", "warn");
  });
  el("flagOfficial").addEventListener("change", () => {
    updateUiFacts();
    if (el("flagOfficial")?.checked) {
      setStatus("Flag enabled: Pay will invoice on Official for review later.", "warn");
    } else {
      setStatus("Flag disabled.", "info");
    }
  });
  el("quickAgent").addEventListener("change", () => {
    prefillQuickFormForAgent(selectedQuickAgent());
    setQuickStatus("");
  });
  el("quickCompany").addEventListener("change", async () => {
    try {
      await quickLoadBranches(selectedQuickAgent(), String(el("quickCompany")?.value || "").trim());
    } catch (e) {
      setQuickStatus(`Branch load failed: ${e.message}`, true);
    }
  });
  el("quickSignIn").addEventListener("click", async () => {
    try {
      await quickSignIn();
    } catch (e) {
      setQuickStatus(`Sign-in failed: ${e.message}`, true);
    }
  });
  el("quickApply").addEventListener("click", async () => {
    try {
      await quickRegisterAndApply();
    } catch (e) {
      setQuickStatus(`Quick Connect failed: ${e.message}`, true);
    }
  });
  el("receiptBtn").addEventListener("click", () => {
    window.open(`/receipt/last`, "_blank", "noopener,noreferrer,width=420,height=820");
  });
  el("customerSearchBtn").addEventListener("click", async () => {
    try {
      await customerSearch({ live: false });
    } catch (e) {
      setStatus(`Customer search error: ${e.message}`);
    }
  });
  el("customerCreateToggleBtn").addEventListener("click", () => {
    const panel = el("customerCreatePanel");
    const open = !!panel && panel.classList.contains("hidden");
    setCustomerCreatePanel(open);
  });
  el("customerCreateCancelBtn").addEventListener("click", () => {
    setCustomerCreatePanel(false);
  });
  el("customerCreateBtn").addEventListener("click", async () => {
    try {
      await createCustomerFromPos();
    } catch (e) {
      setCustomerCreateStatus(`Create failed: ${e.message}`, true);
      setStatus(`Customer create error: ${e.message}`, "error");
    }
  });
  const liveCustomerSearch = (() => {
    let timer = null;
    return () => {
      if (timer) clearTimeout(timer);
      const q = String(el("customerQuery")?.value || "").trim();
      if (!q) {
        clearCustomerResults();
        return;
      }
      timer = setTimeout(() => {
        customerSearch({ query: q, live: true, limit: 6 }).catch((e) => {
          setStatus(`Customer search error: ${e.message}`, "warn");
        });
      }, 220);
    };
  })();
  el("customerQuery").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveCustomerResultsActive(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Tab" && !e.shiftKey) {
      if (selectTopCustomerMatch()) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (selectTopCustomerMatch()) return;
      customerSearch({ live: false }).catch((err) => setStatus(`Customer search error: ${err.message}`));
    }
  });
  el("customerQuery").addEventListener("input", () => {
    liveCustomerSearch();
  });
  el("customerId").addEventListener("input", () => {
    const raw = String(el("customerId").value || "").trim();
    setCustomerSelection(raw, raw);
  });

  // Barcode scanners behave like a very fast keyboard + trailing Enter.
  // This lets scanning work even if the cursor isn't in the Scan field,
  // as long as the user isn't currently typing in another input.
  const scanCapture = (() => {
    let buf = "";
    let resetTimer = null;
    function reset() {
      buf = "";
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = null;
    }
    function isTextInputTarget(t) {
      const eln = t && t.nodeType === 1 ? t : null;
      if (!eln) return false;
      const tag = String(eln.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (eln.isContentEditable) return true;
      return false;
    }
    function onKeyDown(e) {
      if (!e) return;
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextInputTarget(e.target)) return;
      const settingsOpen = !el("settingsModal")?.classList.contains("hidden");
      if (settingsOpen) return;
      const managerOpen = isManagerModalOpen();
      if (managerOpen) return;

      const k = String(e.key || "");
      if (k === "Enter") {
        const q = String(buf || "").trim();
        if (!q) return;
        e.preventDefault();
        try {
          el("scan").value = q;
          doLookupAndRender({ query: q, live: false, silent: false });
          if (state.lastLookup?.item) addToCart(state.lastLookup.companyKey, state.lastLookup.item);
        } finally {
          reset();
        }
        return;
      }

      // Only capture normal printable characters.
      if (k.length !== 1) return;
      if (/\s/.test(k)) return;

      buf += k;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(reset, 260);
    }
    return { onKeyDown, reset };
  })();

  function doLookupAndRender(opts = {}) {
    const q = String(opts.query ?? el("scan")?.value ?? "").trim();
    if (!q) {
      state.lastLookup = null;
      state.ui.lookupResults = [];
      state.ui.lookupActiveIndex = -1;
      state.ui.lookupQuery = "";
      el("results").innerHTML = "";
      if (!opts.silent) setScanMeta("Waiting for input…");
      return;
    }
    const matches = lookupMatches(q);
    setLookupResults(matches, q);
    renderResults(matches, { silentMeta: !!opts.silent });
    const a = activeLookup();
    if (a?.item) {
      const many = matches.length > 1 ? ` · ${matches.length} matches (use ↑/↓)` : "";
      setScanMeta(`${opts.live ? "Live match" : "Match"}: ${a.item.name || a.item.sku || a.item.id} (${a.companyKey})${many}`);
    } else if (!opts.silent) {
      setScanMeta("No result for current input.");
    }
  }

  // Keep the result panel in sync when item caches refresh (e.g., after auto-sync).
  state.ui.refreshLookup = () => {
    doLookupAndRender({ live: true, silent: true });
  };

  const liveScanLookup = (() => {
    let timer = null;
    return () => {
      if (timer) clearTimeout(timer);
      const q = String(el("scan")?.value || "").trim();
      if (!q) {
        doLookupAndRender({ query: "", silent: true });
        setScanMeta("Waiting for input…");
        return;
      }
      timer = setTimeout(() => {
        doLookupAndRender({ query: q, live: true, silent: true });
      }, 120);
    };
  })();

  el("scan").addEventListener("input", () => {
    liveScanLookup();
  });

  el("scan").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const delta = e.key === "ArrowDown" ? 1 : -1;
      if (moveLookupActive(delta)) {
        e.preventDefault();
        const a = activeLookup();
        if (a?.item) {
          const many = (state.ui.lookupResults || []).length > 1 ? ` · ${(state.ui.lookupResults || []).length} matches` : "";
          setScanMeta(`Selected: ${a.item.name || a.item.sku || a.item.id} (${a.companyKey})${many}`);
        }
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const q = String(el("scan")?.value || "").trim();
      const a0 = activeLookup();
      if (q && q === String(state.ui.lookupQuery || "") && a0?.item) {
        addToCart(a0.companyKey, a0.item);
        return;
      }
      doLookupAndRender({ live: false, silent: false });
      const a1 = activeLookup();
      if (a1?.item) addToCart(a1.companyKey, a1.item);
    }
  });
  el("addBtn").addEventListener("click", () => {
    const q = String(el("scan")?.value || "").trim();
    const a0 = activeLookup();
    if (q && q === String(state.ui.lookupQuery || "") && a0?.item) {
      addToCart(a0.companyKey, a0.item);
      return;
    }
    doLookupAndRender({ live: false, silent: false });
    const a1 = activeLookup();
    if (a1?.item) addToCart(a1.companyKey, a1.item);
  });
  el("payBtn").addEventListener("click", async () => {
    try {
      await pay();
    } catch (e) {
      setStatus(`Pay error: ${e.message}`, "error");
    }
  });
  el("invoiceCompany").addEventListener("change", () => {
    renderEdgeBadges();
    updateUiFacts();
    const m = getInvoiceCompany();
    if (m === "auto") setStatus("Checkout mode: Auto (split by item).", "info");
    else setStatus(`Checkout mode: Force ${m}.`, "info");
    liveCustomerSearch();
  });
  el("otherAgentUrl").addEventListener("input", () => {
    // Update badges quickly when the other agent URL is changed.
    refreshEdgeStatusBoth();
  });

  document.addEventListener("keydown", scanCapture.onKeyDown);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isManagerModalOpen()) {
      closeManagerModal();
      return;
    }
  });
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = String(e.key || "").toLowerCase();
    if (k === "k") {
      e.preventDefault();
      el("scan").focus();
      setScanMeta("Scan shortcut used.");
      return;
    }
    if (e.key === "Enter") {
      const settingsOpen = !el("settingsModal").classList.contains("hidden");
      if (settingsOpen) return;
      const managerOpen = isManagerModalOpen();
      if (managerOpen) return;
      e.preventDefault();
      pay().catch((err) => setStatus(`Pay error: ${err.message}`, "error"));
    }
  });
  // Start edge polling.
  window.addEventListener("resize", onViewportResize);
  window.addEventListener("orientationchange", onViewportResize);
  applyResponsiveLayout();
  startEdgePolling();
}

async function main() {
  try {
    setOtherAgentBase();
    // Determine cashier_id first so theme can be loaded per cashier on startup.
    try {
      const changed = await hydrateCashierContext();
      if (changed) {
        // no-op; initTheme below will pick up the cashierId
      }
    } catch (_e) {
      // Ignore cashier hydration failures; default theme still applies.
    }
    initTheme();
    initDensityMode();
    wire();
    const apiReady = await ensureOfficialAgentApiAvailable();
    if (!apiReady) return;
    await loadCaches();
    startAutoSyncPullBoth();
    maybeAutoSyncPullBoth({ reason: "boot" });
    renderCart();
    setCustomerSelection(String(el("customerId")?.value || "").trim(), String(el("customerId")?.value || "").trim());
    setScanMeta("Waiting for input…");
    el("scan").focus();
  } catch (e) {
    setStatus(`Init error: ${e.message}`, "error");
  }
}

main();
