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
  // Cart lines include agent/company attribution.
  cart: [],
  lastLookup: null
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
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function jpost(base, path, payload) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function getInvoiceCompany() {
  return el("invoiceCompany").value === "official" ? "official" : "unofficial";
}

function otherAgentUrl() {
  return String(el("otherAgentUrl").value || "").trim() || "http://localhost:7072";
}

function setStatus(msg) {
  el("status").textContent = msg;
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

function openSettingsModal() {
  el("settingsBackdrop").classList.remove("hidden");
  el("settingsModal").classList.remove("hidden");
}

function closeSettingsModal() {
  el("settingsModal").classList.add("hidden");
  el("settingsBackdrop").classList.add("hidden");
  setSettingsStatus("");
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
  clearAgentConfigForm("official");
  clearAgentConfigForm("unofficial");

  const results = await Promise.allSettled([loadAgentConfig("official"), loadAgentConfig("unofficial")]);
  setSettingsBusy(false);

  const failed = [];
  if (results[0].status === "rejected") failed.push("Official");
  if (results[1].status === "rejected") failed.push("Unofficial");

  if (!failed.length) {
    setSettingsStatus("Loaded. Edit fields then save.");
    return;
  }
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

function renderResults(pick) {
  const root = el("results");
  root.innerHTML = "";
  if (!pick) {
    root.innerHTML = `<div class="hint">No match. Try Sync Both.</div>`;
    return;
  }
  const { companyKey, item } = pick;
  const tagClass = companyKey === "official" ? "official" : "unofficial";
  const tagText = companyKey === "official" ? "Official" : "Unofficial";
  const price = toNum(item.price_usd || 0);
  root.innerHTML = `
    <div class="result">
      <div class="meta">
        <div class="name">${escapeHtml(item.name || item.sku || item.id)}</div>
        <div class="sub mono">SKU: ${escapeHtml(item.sku || "-")} · Barcode: ${escapeHtml(item.barcode || "-")} · USD ${fmtUsd(price)}</div>
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
}

async function syncBoth() {
  setOtherAgentBase();
  setStatus("Syncing both agents…");
  const a = state.agents.official.base;
  const b = state.agents.unofficial.base;
  await Promise.all([
    jpost(a, "/api/sync/pull", {}),
    jpost(b, "/api/sync/pull", {})
  ]);
  await loadCaches();
  setStatus("Synced.");
}

async function pushBoth() {
  setOtherAgentBase();
  setStatus("Pushing both agents…");
  const a = state.agents.official.base;
  const b = state.agents.unofficial.base;
  await Promise.allSettled([
    jpost(a, "/api/sync/push", {}),
    jpost(b, "/api/sync/push", {})
  ]);
  setStatus("Pushed (check agent outbox if offline).");
  await refreshEdgeStatusBoth();
}

async function reconnectBoth() {
  setOtherAgentBase();
  setStatus("Reconnect: checking edge…");
  await refreshEdgeStatusBoth();
  const off = [];
  for (const k of ["official", "unofficial"]) {
    if (state.edge[k]?.ok === false) off.push(k);
  }
  if (off.length) {
    setStatus(`Edge offline for: ${off.join(", ")}. Fix LAN/edge then retry.`);
    return;
  }
  try {
    setStatus("Reconnect: Sync Both…");
    await syncBoth();
    setStatus("Reconnect: Push Both…");
    await pushBoth();
    const pendO = Number(state.edge.official?.pending || 0);
    const pendU = Number(state.edge.unofficial?.pending || 0);
    if (pendO === 0 && pendU === 0) setStatus("Back online. Queues cleared.");
    else setStatus(`Back online. Queued: official ${pendO}, unofficial ${pendU}.`);
  } catch (e) {
    setStatus(`Reconnect error: ${e.message}`);
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

  setStatus(`Ready. Official: ${state.items.official.length} item(s), Unofficial: ${state.items.unofficial.length} item(s).`);
}

async function cashierPinBoth() {
  setOtherAgentBase();
  const pin = window.prompt("Cashier PIN (logs in on BOTH agents):");
  if (!pin) return;
  setStatus("Logging in cashier on both agents…");
  const a = state.agents.official.base;
  const b = state.agents.unofficial.base;
  const payload = { pin: String(pin).trim() };
  const [ra, rb] = await Promise.allSettled([jpost(a, "/api/cashiers/login", payload), jpost(b, "/api/cashiers/login", payload)]);
  if (ra.status === "rejected" || rb.status === "rejected") {
    const ea = ra.status === "rejected" ? ra.reason?.message : null;
    const eb = rb.status === "rejected" ? rb.reason?.message : null;
    throw new Error(`login failed: ${ea || ""} ${eb || ""}`.trim());
  }
  setStatus("Cashier logged in on both.");
}

async function customerSearch() {
  setOtherAgentBase();
  const q = String(el("customerQuery").value || "").trim();
  if (!q) return;
  const invoiceCompany = getInvoiceCompany();
  const base = state.agents[invoiceCompany].base;
  setStatus(`Searching customers (${invoiceCompany})…`);
  const res = await jget(base, `/api/customers?query=${encodeURIComponent(q)}&limit=30`);
  const rows = res.customers || [];
  const root = el("customerResults");
  root.innerHTML = "";
  if (!rows.length) {
    root.innerHTML = `<div class="hint">No customer matches.</div>`;
    setStatus("No customer matches.");
    return;
  }
  for (const c of rows) {
    const div = document.createElement("div");
    div.className = "custRow";
    div.innerHTML = `
      <div>
        <div class="name">${escapeHtml(c.name || c.id)}</div>
        <div class="id">${escapeHtml(c.id)}</div>
      </div>
      <div class="tag ${invoiceCompany === "official" ? "official" : "unofficial"}">${invoiceCompany}</div>
    `;
    div.addEventListener("click", () => {
      el("customerId").value = String(c.id || "").trim();
      root.innerHTML = "";
    });
    root.appendChild(div);
  }
  setStatus(`Customers: ${rows.length}`);
}

async function pay() {
  if (!state.cart.length) throw new Error("empty cart");
  setOtherAgentBase();

  const invoiceCompany = getInvoiceCompany();
  const agentBase = state.agents[invoiceCompany].base;
  const payment_method = el("payment").value || "cash";
  const customer_id = String(el("customerId").value || "").trim() || null;
  if (payment_method === "credit" && state.edge[invoiceCompany]?.ok === false) {
    throw new Error("credit is disabled while edge is offline");
  }
  if (payment_method === "credit" && !customer_id) {
    throw new Error("credit sale requires customer_id");
  }

  const cartCompanies = new Set(state.cart.map((c) => c.companyKey));
  const crossCompany = cartCompanies.size > 1 || (cartCompanies.size === 1 && !cartCompanies.has(invoiceCompany));
  const flag = !!el("flagOfficial").checked;

  const receipt_meta = {
    pilot: {
      invoice_company: invoiceCompany,
      line_companies: Array.from(cartCompanies.values()),
      cross_company: crossCompany,
      flagged_for_adjustment: flag || crossCompany,
      note: crossCompany
        ? "Cross-company invoice: stock moves were skipped; requires later intercompany/adjustment handling."
        : (flag ? "Flagged for later adjustment." : null)
    }
  };

  // If cross-company, ask backend to skip stock moves to keep the pilot unblocked.
  const skip_stock_moves = crossCompany ? true : false;

  // Send the cart to the chosen agent's /api/sale.
  const res = await jpost(agentBase, "/api/sale", {
    cart: state.cart.map((c) => ({
      id: c.id,
      sku: c.sku,
      name: c.name,
      barcode: c.barcode,
      price_usd: c.price_usd,
      price_lbp: c.price_lbp,
      qty: c.qty
    })),
    customer_id,
    payment_method,
    receipt_meta,
    skip_stock_moves
  });

  // Open receipt window on the invoice agent (receipt is stored per-agent).
  window.open(`${agentBase}/receipt/last`, "_blank", "noopener,noreferrer,width=420,height=820");

  // Best-effort push right away.
  try {
    await jpost(agentBase, "/api/sync/push", {});
  } catch (e) {
    // offline: keep outbox pending
  }

  // Reset UI cart.
  state.cart = [];
  renderCart();
  el("scan").value = "";
  el("results").innerHTML = "";
  setStatus(`Sale queued: ${res.event_id || "ok"}`);
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
  el("receiptBtn").addEventListener("click", () => {
    window.open(`/receipt/last`, "_blank", "noopener,noreferrer,width=420,height=820");
  });
  el("customerSearchBtn").addEventListener("click", async () => {
    try {
      await customerSearch();
    } catch (e) {
      setStatus(`Customer search error: ${e.message}`);
    }
  });
  el("customerQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      customerSearch().catch((err) => setStatus(`Customer search error: ${err.message}`));
    }
  });

  function doLookupAndRender() {
    const q = String(el("scan").value || "").trim();
    if (!q) return;
    const pick = pickItem(q);
    state.lastLookup = pick;
    renderResults(pick);
  }

  el("scan").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doLookupAndRender();
      // Fast cashier flow: if there is a match, add immediately.
      if (state.lastLookup?.item) addToCart(state.lastLookup.companyKey, state.lastLookup.item);
    }
  });
  el("addBtn").addEventListener("click", () => {
    doLookupAndRender();
    if (state.lastLookup?.item) addToCart(state.lastLookup.companyKey, state.lastLookup.item);
  });
  el("payBtn").addEventListener("click", async () => {
    try {
      await pay();
    } catch (e) {
      setStatus(`Pay error: ${e.message}`);
    }
  });
  el("invoiceCompany").addEventListener("change", () => {
    renderEdgeBadges();
  });
  el("otherAgentUrl").addEventListener("input", () => {
    // Update badges quickly when the other agent URL is changed.
    refreshEdgeStatusBoth();
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
    el("scan").focus();
  } catch (e) {
    setStatus(`Init error: ${e.message}`);
  }
}

main();
