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
    customerLabel: "Walk-in",
    customerLookupSeq: 0,
    customerResults: [],
    customerActiveIndex: -1
  }
};

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
  return el("invoiceCompany").value === "official" ? "official" : "unofficial";
}

function otherAgentUrl() {
  return String(el("otherAgentUrl").value || "").trim() || "http://localhost:7072";
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

function setCustomerSelection(id, label = "") {
  const cid = String(id || "").trim();
  const customerInput = el("customerId");
  if (customerInput) customerInput.value = cid;
  state.ui.customerLabel = cid ? (String(label || cid).trim() || cid) : "Walk-in";
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
  const invoiceCompany = getInvoiceCompany();
  const cartCompanies = new Set(state.cart.map((c) => c.companyKey));
  const mixedCompanies = cartCompanies.size > 1;
  const flagToOfficial = !!el("flagOfficial")?.checked;
  const cartSummary = el("cartSummary");
  if (cartSummary) {
    const mode = flagToOfficial
      ? " · Flag: Official"
      : (mixedCompanies ? " · Split: Official+Unofficial" : "");
    cartSummary.textContent = `Cart: ${lineCount} line(s), ${qtyCount} item(s)${mode}`;
  }
  const activeCustomer = el("activeCustomer");
  if (activeCustomer) activeCustomer.textContent = `Customer: ${state.ui.customerLabel}`;
  const tItems = el("tItems");
  if (tItems) tItems.textContent = String(qtyCount);
  const inv = el("tInvoiceCompany");
  if (inv) {
    if (flagToOfficial) inv.textContent = "Official (flagged)";
    else if (mixedCompanies) inv.textContent = "Split";
    else inv.textContent = invoiceCompany === "official" ? "Official" : "Unofficial";
  }

  // Disable credit when the cart would produce split invoices, to avoid partial failures
  // due to customer/account mismatches across companies.
  const creditOpt = el("payment")?.querySelector?.('option[value="credit"]');
  if (creditOpt) creditOpt.disabled = mixedCompanies && !flagToOfficial;

  // Make the Pay button communicate split/flag mode without adding more clicks.
  const payBtn = el("payBtn");
  if (payBtn && !payBtn.classList.contains("isBusy")) {
    if (flagToOfficial) payBtn.textContent = "Pay (Official Flag)";
    else if (mixedCompanies) payBtn.textContent = "Pay (Split)";
    else payBtn.textContent = "Pay";
  }
}

function setOtherAgentBase() {
  state.agents.unofficial.base = otherAgentUrl();
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
    const st = state.edge[key] || { ok: null, pending: 0, latency_ms: null };
    n.classList.remove("edgeOk", "edgeOffline", "edgeUnknown");
    if (st.ok === true) {
      n.classList.add("edgeOk");
      const ms = Number(st.latency_ms || 0);
      n.textContent = `${key}: OK${ms ? ` (${ms}ms)` : ""} · ${Number(st.pending || 0)} queued`;
    } else if (st.ok === false) {
      n.classList.add("edgeOffline");
      n.textContent = `${key}: OFFLINE · ${Number(st.pending || 0)} queued`;
    } else {
      n.classList.add("edgeUnknown");
      n.textContent = `${key}: …`;
    }
  }

  // Disable credit on the selected invoice agent when its edge is offline.
  const inv = getInvoiceCompany();
  const creditOpt = el("payment")?.querySelector?.('option[value="credit"]');
  if (creditOpt) creditOpt.disabled = state.edge[inv]?.ok === false;
}

async function refreshEdgeStatusBoth() {
  setOtherAgentBase();
  for (const key of ["official", "unofficial"]) {
    const base = state.agents[key].base;
    try {
      const res = await jget(base, "/api/edge/status");
      state.edge[key] = {
        ok: !!res.edge_ok,
        latency_ms: res.edge_latency_ms ?? null,
        pending: Number(res.outbox_pending || 0)
      };
    } catch (e) {
      state.edge[key] = {
        ok: false,
        latency_ms: null,
        pending: state.edge[key]?.pending || 0
      };
    }
  }
  renderEdgeBadges();
}

function findByBarcode(companyKey, barcode) {
  const bcs = state.barcodes[companyKey] || [];
  const by = new Map();
  for (const b of bcs) {
    if (!b?.barcode) continue;
    by.set(String(b.barcode).trim(), b);
  }
  const hit = by.get(String(barcode).trim());
  if (hit?.item_id) {
    const items = state.items[companyKey] || [];
    const m = new Map(items.map((i) => [String(i.id), i]));
    return m.get(String(hit.item_id)) || null;
  }
  // fallback: items.barcode
  const items = state.items[companyKey] || [];
  const bc = String(barcode).trim();
  return items.find((i) => String(i.barcode || "").trim() === bc) || null;
}

function pickItem(barcodeOrText) {
  const q = String(barcodeOrText || "").trim();
  if (!q) return null;

  // Priority rule: default unofficial-first, unless invoice company is official.
  const inv = getInvoiceCompany();
  const first = inv === "official" ? "official" : "unofficial";
  const second = inv === "official" ? "unofficial" : "official";

  const it1 = findByBarcode(first, q);
  if (it1) return { companyKey: first, item: it1, reason: `${first}-barcode` };
  const it2 = findByBarcode(second, q);
  if (it2) return { companyKey: second, item: it2, reason: `${second}-barcode` };

  // Search by SKU/name contains, in priority order.
  const norm = q.toLowerCase();
  const items1 = state.items[first] || [];
  let hit = items1.find((i) => String(i.sku || "").toLowerCase() === norm) ||
            items1.find((i) => String(i.name || "").toLowerCase().includes(norm));
  if (hit) return { companyKey: first, item: hit, reason: `${first}-search` };

  const items2 = state.items[second] || [];
  hit = items2.find((i) => String(i.sku || "").toLowerCase() === norm) ||
        items2.find((i) => String(i.name || "").toLowerCase().includes(norm));
  if (hit) return { companyKey: second, item: hit, reason: `${second}-search` };

  return null;
}

function renderResults(pick, opts = {}) {
  const root = el("results");
  root.innerHTML = "";
  if (!pick) {
    root.innerHTML = `<div class="hint">No match. Try Sync Both or check barcode typing.</div>`;
    if (!opts.silentMeta) setScanMeta("No result for current input.");
    return;
  }
  const { companyKey, item, reason } = pick;
  const tagClass = companyKey === "official" ? "official" : "unofficial";
  const tagText = companyKey === "official" ? "Official" : "Unofficial";
  const price = toNum(item.price_usd || 0);
  const reasonLabel = String(reason || "").replace("-", " · ");
  root.innerHTML = `
    <div class="result">
      <div class="meta">
        <div class="name">${escapeHtml(item.name || item.sku || item.id)}</div>
        <div class="sub mono">SKU: ${escapeHtml(item.sku || "-")} · Barcode: ${escapeHtml(item.barcode || "-")} · USD ${fmtUsd(price)}</div>
        <div class="sub mono">Match: ${escapeHtml(reasonLabel || "search")}</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-end">
        <div class="tag ${tagClass}">${tagText}</div>
        <button class="btn" id="addFromResult">Add</button>
      </div>
    </div>
  `;
  el("addFromResult").addEventListener("click", () => addToCart(companyKey, item));
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
  root.innerHTML = "";
  if (!state.cart.length) {
    root.innerHTML = `<div class="hint">Cart is empty.</div>`;
  } else {
    for (const c of state.cart) {
      const tagClass = c.companyKey === "official" ? "official" : "unofficial";
      const tagText = c.companyKey === "official" ? "Official" : "Unofficial";
      const line = toNum(c.price_usd) * toNum(c.qty);
      const div = document.createElement("div");
      div.className = "cartItem";
      div.innerHTML = `
        <div>
          <div class="title">${escapeHtml(c.name || c.sku || c.id)}</div>
          <div class="small mono">SKU: ${escapeHtml(c.sku || "-")} · USD ${fmtUsd(c.price_usd)} · Line ${fmtUsd(line)}</div>
        </div>
        <div class="tag ${tagClass}">${tagText}</div>
        <div class="qty">
          <button data-k="${c.key}" data-d="-1">-</button>
          <div class="n">${escapeHtml(c.qty)}</div>
          <button data-k="${c.key}" data-d="1">+</button>
        </div>
        <div class="remove" data-r="${c.key}">DEL</div>
      `;
      root.appendChild(div);
    }
    root.querySelectorAll("button[data-k]").forEach((b) => {
      b.addEventListener("click", () => changeQty(b.getAttribute("data-k"), Number(b.getAttribute("data-d") || 0)));
    });
    root.querySelectorAll(".remove").forEach((d) => {
      d.addEventListener("click", () => removeFromCart(d.getAttribute("data-r")));
    });
  }

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

async function loadCaches() {
  setOtherAgentBase();
  const a = state.agents.official.base;
  const b = state.agents.unofficial.base;

  const [ai, ab, bi, bb] = await Promise.all([
    jget(a, "/api/items"),
    jget(a, "/api/barcodes"),
    jget(b, "/api/items"),
    jget(b, "/api/barcodes")
  ]);
  state.items.official = ai.items || [];
  state.barcodes.official = ab.barcodes || [];
  state.items.unofficial = bi.items || [];
  state.barcodes.unofficial = bb.barcodes || [];

  setStatus(`Ready. Official: ${state.items.official.length} item(s), Unofficial: ${state.items.unofficial.length} item(s).`, "ok");
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
    const [ra, rb] = await Promise.allSettled([jpost(a, "/api/cashiers/login", payload), jpost(b, "/api/cashiers/login", payload)]);
    if (ra.status === "rejected" || rb.status === "rejected") {
      const ea = ra.status === "rejected" ? ra.reason?.message : null;
      const eb = rb.status === "rejected" ? rb.reason?.message : null;
      throw new Error(`login failed: ${ea || ""} ${eb || ""}`.trim());
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
  const list = Array.isArray(rows) ? rows : [];
  state.ui.customerResults = list;
  state.ui.customerActiveIndex = list.length ? 0 : -1;
  if (!list.length) {
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
}

function selectTopCustomerMatch() {
  return selectActiveCustomerMatch();
}

async function customerSearch(opts = {}) {
  setOtherAgentBase();
  const q = String(opts.query ?? el("customerQuery")?.value ?? "").trim();
  const live = !!opts.live;
  const limit = Number(opts.limit || 30);
  if (!q) {
    state.ui.customerLookupSeq += 1;
    clearCustomerResults();
    return [];
  }
  const invoiceCompany = opts.companyKey || getInvoiceCompany();
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
  const invoiceCompany = getInvoiceCompany();
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
  const customer_id = String(el("customerId").value || "").trim() || null;
  if (payment_method === "credit" && !customer_id) {
    throw new Error("credit sale requires customer_id");
  }

  const cartCompanies = new Set(state.cart.map((c) => c.companyKey));
  const flag = !!el("flagOfficial")?.checked;
  const mixedCompanies = cartCompanies.size > 1;

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

      // Pre-open receipt window to reduce popup blocking.
      const receiptWin = window.open("about:blank", "_blank", "noopener,noreferrer,width=420,height=820");

      const receipt_meta = {
        pilot: {
          mode: "flag-to-official",
          invoice_company: invoiceCompany,
          line_companies: Array.from(cartCompanies.values()),
          cross_company: crossCompany,
          flagged_for_adjustment: true,
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

      setScanMeta(`Issuing ${companiesInOrder.length} invoices…`);
      const done = [];

      for (const companyKey of companiesInOrder) {
        const agentBase = state.agents[companyKey].base;
        const lines = state.cart.filter((c) => c.companyKey === companyKey);
        if (!lines.length) continue;

        setScanMeta(`Issuing ${companyKey} invoice…`);
        const receipt_meta = {
          pilot: {
            mode: "split-by-company",
            split_group_id: groupId,
            invoice_company: companyKey,
            line_companies: [companyKey],
            cross_company: false,
            flagged_for_adjustment: false,
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
    const invoiceCompany = getInvoiceCompany();
    assertCreditAllowed(invoiceCompany);
    const agentBase = state.agents[invoiceCompany].base;
    const crossCompany = cartCompanies.size > 1 || (cartCompanies.size === 1 && !cartCompanies.has(invoiceCompany));

      const receiptWin = window.open("about:blank", "_blank", "noopener,noreferrer,width=420,height=820");
      const receipt_meta = {
        pilot: {
          mode: "single",
          invoice_company: invoiceCompany,
          line_companies: Array.from(cartCompanies.values()),
          cross_company: crossCompany,
          flagged_for_adjustment: crossCompany,
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
  el("settingsBtn").addEventListener("click", () => {
    openSettingsDialog().catch((e) => setSettingsStatus(`Error: ${e.message}`, true));
  });
  el("settingsCancel").addEventListener("click", closeSettingsModal);
  el("settingsBackdrop").addEventListener("click", closeSettingsModal);
  el("settingsSave").addEventListener("click", () => {
    saveSettingsDialog().catch((e) => setSettingsStatus(`Save failed: ${e.message}`, true));
  });
  el("focusScanBtn").addEventListener("click", () => {
    el("scan").focus();
    setScanMeta("Scan field focused.");
  });
  el("clearSearchBtn").addEventListener("click", () => {
    el("scan").value = "";
    el("results").innerHTML = "";
    state.lastLookup = null;
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
        customerSearch({ query: q, live: true, limit: 12 }).catch((e) => {
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

  function doLookupAndRender(opts = {}) {
    const q = String(opts.query ?? el("scan")?.value ?? "").trim();
    if (!q) {
      state.lastLookup = null;
      el("results").innerHTML = "";
      if (!opts.silent) setScanMeta("Waiting for input…");
      return;
    }
    const pick = pickItem(q);
    state.lastLookup = pick;
    renderResults(pick, { silentMeta: !!opts.silent });
    if (pick?.item) {
      setScanMeta(`${opts.live ? "Live match" : "Match"}: ${pick.item.name || pick.item.sku || pick.item.id} (${pick.companyKey})`);
    } else if (!opts.silent) {
      setScanMeta("No result for current input.");
    }
  }

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
    if (e.key === "Enter") {
      e.preventDefault();
      doLookupAndRender({ live: false, silent: false });
      // Fast cashier flow: if there is a match, add immediately.
      if (state.lastLookup?.item) addToCart(state.lastLookup.companyKey, state.lastLookup.item);
    }
  });
  el("addBtn").addEventListener("click", () => {
    doLookupAndRender({ live: false, silent: false });
    if (state.lastLookup?.item) addToCart(state.lastLookup.companyKey, state.lastLookup.item);
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
    setStatus(`Invoice company set to ${getInvoiceCompany()}.`, "info");
    liveCustomerSearch();
  });
  el("otherAgentUrl").addEventListener("input", () => {
    // Update badges quickly when the other agent URL is changed.
    refreshEdgeStatusBoth();
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
      e.preventDefault();
      pay().catch((err) => setStatus(`Pay error: ${err.message}`, "error"));
    }
  });
  // Start edge polling.
  refreshEdgeStatusBoth();
  setInterval(refreshEdgeStatusBoth, 3000);
}

async function main() {
  try {
    setOtherAgentBase();
    wire();
    await loadCaches();
    renderCart();
    setCustomerSelection(String(el("customerId")?.value || "").trim(), String(el("customerId")?.value || "").trim());
    setScanMeta("Waiting for input…");
    el("scan").focus();
  } catch (e) {
    setStatus(`Init error: ${e.message}`, "error");
  }
}

main();
