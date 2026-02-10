const SESSION_KEY = "pos_admin_session_token";

function getSessionToken() {
  try {
    return localStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

function setSessionToken(token) {
  try {
    if (!token) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, token);
  } catch {}
}

async function unlockWithPin() {
  const pin = window.prompt("Admin PIN required to use this POS (LAN mode). Enter PIN:");
  if (!pin) throw new Error("Admin PIN required.");
  const res = await fetch(`/api/auth/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token) throw new Error("Invalid admin PIN.");
  setSessionToken(data.token);
}

async function apiRequest(method, path, payload, retry = true) {
  const headers = { "Content-Type": "application/json" };
  const tok = getSessionToken();
  if (tok) headers["X-POS-Session"] = tok;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(payload || {}) : undefined
  });
  if (res.ok) return res.json();

  const status = res.status;
  const data = await res.json().catch(() => null);
  const errCode = data?.error;

  if (retry && (status === 401 || status === 503) && errCode === "pos_auth_required") {
    await unlockWithPin();
    return apiRequest(method, path, payload, false);
  }

  const msg = data?.error || (await res.text().catch(() => "")) || `HTTP ${status}`;
  throw new Error(msg);
}

const api = {
  async get(path) {
    return apiRequest("GET", path);
  },
  async post(path, payload) {
    return apiRequest("POST", path, payload);
  }
};

const state = {
  items: [],
  barcodes: [],
  cashiers: [],
  promotions: [],
  cart: [],
  config: null,
  shiftId: "",
  cashierId: "",
  cashierName: "-",
  scanBuffer: "",
  lastScanTime: 0,
  modalOpen: null,
  customerPickerTarget: null,
  lotContext: null,
  lotBatches: [],
  edge: { ok: null, latency_ms: null, pending: 0, error: "" }
};

const el = (id) => document.getElementById(id);

function setText(id, text) {
  const n = el(id);
  if (n) n.textContent = text;
}

function isInputFocused() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = (a.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function showModal(id) {
  state.modalOpen = id;
  el("backdrop").classList.remove("hidden");
  el(id).classList.remove("hidden");
  // Focus first input, if present.
  const first = el(id).querySelector("input,select,textarea,button");
  if (first) first.focus();
}

function hideModal(id) {
  el(id).classList.add("hidden");
  el("backdrop").classList.add("hidden");
  state.modalOpen = null;
}

function fmtUsd(n) {
  return Number(n || 0).toFixed(2);
}

function fmtLbp(n) {
  return Math.round(Number(n || 0)).toLocaleString();
}

function toNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function getRate() {
  return toNum(state.config?.exchange_rate || 0);
}

function getCurrency() {
  return (state.config?.pricing_currency || "USD").toUpperCase();
}

function getDefaultCustomerId() {
  return (state.config?.default_customer_id || "").trim();
}

function requireManualLotSelection() {
  try {
    return !!state.config?.inventory_policy?.require_manual_lot_selection;
  } catch {
    return false;
  }
}

function isTrackedForLot(item) {
  if (!item) return false;
  if (item.track_batches) return true;
  if (item.track_expiry) return true;
  const minDays = Number(item.min_shelf_life_days_for_sale || 0);
  return Number.isFinite(minDays) && minDays > 0;
}

function cartKey(itemId, batchNo, expiryDate, uom, qtyFactor) {
  const bn = (batchNo || "").trim();
  const ex = (expiryDate || "").trim();
  const u = (uom || "").trim().toUpperCase();
  const f = Number(qtyFactor || 1);
  return `${String(itemId || "")}|${bn}|${ex}|${u}|${Number.isFinite(f) ? f : 1}`;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCustomerLabel(c) {
  if (!c) return "None";
  const mem = (c.membership_no || "").trim();
  const bits = [];
  bits.push(c.name || c.id);
  if (mem) bits.push(`#${mem}`);
  return bits.join(" · ");
}

function computeTotals() {
  const fxRate = getRate();
  let base_usd = 0;
  let base_lbp = 0;
  let tax_lbp = 0;

  const defaultTaxCodeId = state.config?.tax_code_id || null;
  const vatCodes = state.config?.vat_codes && typeof state.config.vat_codes === "object" ? state.config.vat_codes : null;
  const hasVatCodes = vatCodes && Object.keys(vatCodes).length > 0;
  const legacyVatRate = Number(state.config?.vat_rate || 0);

  for (const i of state.cart) {
    const qtyBase = Number(i.qty || 0);
    const lineUsd = Number(i.price_usd || 0) * qtyBase;
    let lineLbp = Number(i.price_lbp || 0) * qtyBase;
    if (!lineLbp && fxRate) lineLbp = lineUsd * fxRate;
    base_usd += lineUsd;
    base_lbp += lineLbp;

    let vatRate = legacyVatRate;
    if (hasVatCodes) {
      const tcid = i.tax_code_id || defaultTaxCodeId;
      vatRate = tcid ? Number(vatCodes[String(tcid)] || 0) : 0;
      if (!vatRate && legacyVatRate && tcid && defaultTaxCodeId && String(tcid) === String(defaultTaxCodeId)) {
        vatRate = legacyVatRate;
      }
    }
    if (vatRate) tax_lbp += lineLbp * vatRate;
  }

  const tax_usd = fxRate ? tax_lbp / fxRate : 0;
  return {
    base_usd,
    base_lbp,
    tax_usd,
    tax_lbp,
    total_usd: base_usd + tax_usd,
    total_lbp: base_lbp + tax_lbp
  };
}

async function hydrateCustomerLabels() {
  // Settings default customer
  const defaultId = (el("customerId")?.value || "").trim() || getDefaultCustomerId();
  if (el("customerId")) el("customerId").value = defaultId || "";
  let defC = null;
  if (defaultId) {
    try {
      const r = await api.get(`/customers/by-id?customer_id=${encodeURIComponent(defaultId)}`);
      defC = r.customer || null;
    } catch (e) {
      defC = null;
    }
  }
  setText("settingsCustomerLabel", formatCustomerLabel(defC));

  // Pay modal selected customer
  const payId = (el("payCustomerId")?.value || "").trim();
  let payC = null;
  if (payId) {
    try {
      const r = await api.get(`/customers/by-id?customer_id=${encodeURIComponent(payId)}`);
      payC = r.customer || null;
    } catch (e) {
      payC = null;
    }
  }
  setText("payCustomerLabel", formatCustomerLabel(payC));
}

async function localCreditCheck(customerId) {
  try {
    const r = await api.get(`/customers/by-id?customer_id=${encodeURIComponent(customerId)}`);
    const c = r.customer || null;
    if (!c) return true;
    const total = computeTotals();
    const creditUsd = total.total_usd || 0;
    const creditLbp = total.total_lbp || 0;
    const limUsd = Number(c.credit_limit_usd || 0);
    const limLbp = Number(c.credit_limit_lbp || 0);
    const balUsd = Number(c.credit_balance_usd || 0);
    const balLbp = Number(c.credit_balance_lbp || 0);
    if (limUsd && balUsd + creditUsd > limUsd + 1e-6) {
      setText("payStatus", "Credit limit exceeded (USD) for this customer.");
      return false;
    }
    if (limLbp && balLbp + creditLbp > limLbp + 1e-3) {
      setText("payStatus", "Credit limit exceeded (LBP) for this customer.");
      return false;
    }
    return true;
  } catch (e) {
    return true;
  }
}

function openCustomerPicker(target) {
  state.customerPickerTarget = target;
  el("custPickQuery").value = "";
  el("custPickList").innerHTML = "";
  setText("custPickStatus", "");
  showModal("customerPickerModal");
  refreshCustomerPicker();
}

async function refreshCustomerPicker() {
  const q = (el("custPickQuery").value || "").trim();
  setText("custPickStatus", "Loading...");
  try {
    const res = await api.get(`/customers?query=${encodeURIComponent(q)}&limit=60`);
    const rows = res.customers || [];
    renderCustomerPicker(rows);
    setText("custPickStatus", rows.length ? "" : "No matches.");
  } catch (err) {
    setText("custPickStatus", err.message || String(err));
  }
}

function renderCustomerPicker(rows) {
  const root = el("custPickList");
  root.innerHTML = "";
  for (const c of rows) {
    const div = document.createElement("div");
    div.className = "item";
    const mem = (c.membership_no || "").trim();
    const left = document.createElement("div");
    left.innerHTML = `<div>${escapeHtml(c.name || "")}</div><div class="meta">${escapeHtml(mem ? "#" + mem : c.phone || "")}</div>`;
    const right = document.createElement("div");
    right.className = "meta";
    right.textContent = Number(c.credit_balance_usd || 0) ? `Bal USD ${Number(c.credit_balance_usd).toFixed(2)}` : "";
    div.appendChild(left);
    div.appendChild(right);
    div.addEventListener("click", async () => {
      const id = c.id;
      if (state.customerPickerTarget === "settings") {
        el("customerId").value = id;
      } else if (state.customerPickerTarget === "pay") {
        el("payCustomerId").value = id;
      }
      hideModal("customerPickerModal");
      await hydrateCustomerLabels();
    });
    root.appendChild(div);
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isPromoActive(promo) {
  if (!promo) return false;
  if (promo.is_active === false) return false;
  const today = todayIso();
  if (promo.starts_on && String(promo.starts_on) > today) return false;
  if (promo.ends_on && String(promo.ends_on) < today) return false;
  return true;
}

function bestPromoRule(itemId, qty) {
  const q = Number(qty || 0);
  if (!itemId || q <= 0) return null;
  let best = null;

  for (const promo of state.promotions || []) {
    if (!isPromoActive(promo)) continue;
    const pri = Number(promo.priority || 0);
    const rules = (promo.items || []).filter((r) => r && r.item_id === itemId);
    if (!rules.length) continue;
    const eligible = rules
      .map((r) => ({ ...r, _min: Number(r.min_qty || 0) }))
      .filter((r) => r._min > 0 && r._min <= q)
      .sort((a, b) => b._min - a._min)[0];
    if (!eligible) continue;

    const cand = { promo, rule: eligible, priority: pri, min_qty: eligible._min };
    if (!best) {
      best = cand;
      continue;
    }
    if (cand.priority > best.priority) best = cand;
    else if (cand.priority === best.priority && cand.min_qty > best.min_qty) best = cand;
  }
  return best;
}

function computeUnitPricesWithPromo(line) {
  const rate = getRate();
  const baseUsd = toNum(line.base_price_usd ?? line.price_usd ?? 0);
  const baseLbp = toNum(line.base_price_lbp ?? line.price_lbp ?? 0);
  const qty = toNum(line.qty || 0);

  const picked = bestPromoRule(line.id, qty);
  if (!picked) {
    return {
      price_usd: baseUsd,
      price_lbp: baseLbp,
      promo_code: "",
      promo_name: "",
      applied_promotion_id: null,
      applied_promotion_item_id: null,
      pre_discount_unit_price_usd: baseUsd,
      pre_discount_unit_price_lbp: baseLbp,
      discount_pct: 0
    };
  }

  const promo = picked.promo;
  const rule = picked.rule;

  let usd = baseUsd;
  let lbp = baseLbp;

  const promoUsd = toNum(rule.promo_price_usd || 0);
  const promoLbp = toNum(rule.promo_price_lbp || 0);
  const disc = toNum(rule.discount_pct || 0);

  if (promoUsd > 0 || promoLbp > 0) {
    usd = promoUsd > 0 ? promoUsd : (rate ? promoLbp / rate : 0);
    lbp = promoLbp > 0 ? promoLbp : (rate ? promoUsd * rate : 0);
  } else if (disc > 0) {
    usd = baseUsd * (1 - disc);
    lbp = baseLbp ? baseLbp * (1 - disc) : (rate ? usd * rate : 0);
  }

  return {
    price_usd: usd,
    price_lbp: lbp,
    promo_code: promo.code || "",
    promo_name: promo.name || "",
    applied_promotion_id: promo.id || null,
    applied_promotion_item_id: rule.id || null,
    pre_discount_unit_price_usd: baseUsd,
    pre_discount_unit_price_lbp: baseLbp,
    discount_pct: disc > 0 ? disc : 0
  };
}

function repriceCart() {
  for (const line of state.cart) {
    const p = computeUnitPricesWithPromo(line);
    line.price_usd = p.price_usd;
    line.price_lbp = p.price_lbp;
    line.promo_code = p.promo_code;
    line.promo_name = p.promo_name;
    line.applied_promotion_id = p.applied_promotion_id;
    line.applied_promotion_item_id = p.applied_promotion_item_id;
    line.pre_discount_unit_price_usd = p.pre_discount_unit_price_usd;
    line.pre_discount_unit_price_lbp = p.pre_discount_unit_price_lbp;
    line.discount_pct = p.discount_pct;
    // Let the backend resolve discount amounts consistently (keep as explicit zeros).
    line.discount_amount_usd = 0;
    line.discount_amount_lbp = 0;
  }
}

function renderHeader() {
  setText("cashierName", state.cashierName || "-");
  if (state.shiftId) {
    setText("shiftStatus", `Open · ${state.shiftId.slice(0, 8)}`);
  } else {
    setText("shiftStatus", "Closed");
  }
  renderEdgeStatus();
}

function renderEdgeStatus() {
  const badge = el("edgeBanner");
  const q = el("edgeQueue");
  if (!badge || !q) return;

  const ok = state.edge.ok;
  const pending = Number(state.edge.pending || 0);
  q.textContent = `${pending} queued`;

  badge.classList.remove("edge-ok", "edge-offline", "edge-unknown");
  if (ok === true) {
    const ms = Number(state.edge.latency_ms || 0);
    badge.classList.add("edge-ok");
    badge.textContent = `EDGE OK${ms ? ` (${ms}ms)` : ""}`;
  } else if (ok === false) {
    badge.classList.add("edge-offline");
    badge.textContent = "EDGE OFFLINE";
  } else {
    badge.classList.add("edge-unknown");
    badge.textContent = "EDGE …";
  }

  // Disable high-risk actions while edge is unreachable.
  const creditOpt = el("paymentMethod")?.querySelector?.('option[value="credit"]');
  if (creditOpt) creditOpt.disabled = ok === false;
  const returnBtn = el("return");
  if (returnBtn) {
    returnBtn.disabled = ok === false;
    returnBtn.title = ok === false ? "Returns disabled when edge is offline." : "";
  }
}

async function refreshEdgeStatus() {
  try {
    const res = await api.get("/edge/status");
    state.edge.ok = !!res.edge_ok;
    state.edge.latency_ms = res.edge_latency_ms ?? null;
    state.edge.pending = Number(res.outbox_pending || 0);
    state.edge.error = res.edge_error || "";
  } catch (err) {
    state.edge.ok = false;
    state.edge.latency_ms = null;
    state.edge.pending = state.edge.pending || 0;
    state.edge.error = String(err?.message || err || "");
  } finally {
    renderEdgeStatus();
  }
}

function renderItems(list) {
  const container = el("items");
  container.innerHTML = "";
  list.forEach((item) => {
    const card = document.createElement("div");
    card.className = "item";
    card.innerHTML = `
      <h3>${item.name}</h3>
      <small>${item.sku || ""}</small>
      <div>${item.price_usd || 0} USD · ${item.price_lbp || 0} LBP</div>
    `;
    card.addEventListener("click", () => addToCart(item, 1));
    container.appendChild(card);
  });
}

function renderCart() {
  const container = el("cart");
  container.innerHTML = "";
  state.cart.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    const promo = item.promo_code ? `<div class="meta">Promo: ${escapeHtml(item.promo_code)}</div>` : "";
    const uomLabel = (item.uom || item.unit_of_measure || "").trim();
    const qtyEntered = toNum(item.qty_entered ?? item.qty ?? 0);
    const qtyFactor = toNum(item.qty_factor ?? 1) || 1;
    const enteredUsd = (item.price_usd || 0) * qtyFactor;
    const enteredLbp = (item.price_lbp || 0) * qtyFactor;
    row.innerHTML = `
      <div>
        <div>${item.name}</div>
        <div class="meta">${fmtUsd(item.price_usd || 0)} USD · ${fmtLbp(item.price_lbp || 0)} LBP</div>
        ${qtyFactor !== 1 && uomLabel ? `<div class="meta">Per ${escapeHtml(uomLabel)}: ${fmtUsd(enteredUsd)} USD · ${fmtLbp(enteredLbp)} LBP</div>` : ""}
        <div class="meta">${qtyEntered}${uomLabel ? ` ${escapeHtml(uomLabel)}` : ""}${qtyFactor !== 1 ? ` (x${qtyFactor})` : ""}</div>
        ${promo}
      </div>
      <div class="qty">
        <button data-id="${item.id}" data-action="dec">-</button>
        <span>${qtyEntered}</span>
        <button data-id="${item.id}" data-action="inc">+</button>
      </div>
    `;
    row.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        const stepEntered = 1;
        const factor = toNum(item.qty_factor ?? 1) || 1;
        if (action === "inc") {
          item.qty_entered = toNum(item.qty_entered ?? item.qty ?? 0) + stepEntered;
          item.qty = toNum(item.qty ?? 0) + factor * stepEntered;
        }
        if (action === "dec") {
          const nextEntered = Math.max(stepEntered, toNum(item.qty_entered ?? item.qty ?? 0) - stepEntered);
          const deltaEntered = nextEntered - toNum(item.qty_entered ?? item.qty ?? 0);
          item.qty_entered = nextEntered;
          item.qty = Math.max(factor * stepEntered, toNum(item.qty ?? 0) + factor * deltaEntered);
        }
        repriceCart();
        renderCart();
        updateTotals();
      });
    });
    container.appendChild(row);
  });
}

function updateTotals() {
  repriceCart();
  const totals = computeTotals();
  setText("totalUsd", fmtUsd(totals.total_usd || 0));
  setText("totalLbp", fmtLbp(totals.total_lbp || 0));
  const loyaltyRate = toNum(state.config?.loyalty_rate || 0);
  setText("loyaltyPoints", loyaltyRate ? fmtUsd((totals.base_usd || 0) * loyaltyRate) : "0");
}

function addToCart(item, qty) {
  const inc = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const needsLot = isTrackedForLot(item) && (item.track_batches || item.track_expiry || requireManualLotSelection());
  if (needsLot) {
    openLotModal(item, inc, (item.unit_of_measure || "").trim() || null, 1);
    return;
  }
  addCartLine(item, inc, null, null, (item.unit_of_measure || "").trim() || null, 1);
  repriceCart();
  renderCart();
  updateTotals();
}

function addToCartWithUom(item, qtyEntered, uom, qtyFactor) {
  const entered = Number.isFinite(qtyEntered) && qtyEntered > 0 ? qtyEntered : 1;
  const factor = toNum(qtyFactor ?? 1) || 1;
  const needsLot = isTrackedForLot(item) && (item.track_batches || item.track_expiry || requireManualLotSelection());
  if (needsLot) {
    openLotModal(item, entered, uom, factor);
    return;
  }
  addCartLine(item, entered, null, null, uom, factor);
  repriceCart();
  renderCart();
  updateTotals();
}

function addCartLine(item, incEntered, batchNo, expiryDate, uom, qtyFactor) {
  const factor = toNum(qtyFactor ?? 1) || 1;
  const entered = Number.isFinite(incEntered) && incEntered > 0 ? incEntered : 1;
  const u = (uom || item.unit_of_measure || "").trim() || null;
  const key = cartKey(item.id, batchNo, expiryDate, u, factor);
  const existing = state.cart.find(
    (i) => cartKey(i.id, i.batch_no, i.expiry_date, i.uom, i.qty_factor) === key
  );
  if (existing) {
    existing.qty_entered = toNum(existing.qty_entered ?? existing.qty ?? 0) + entered;
    existing.qty = toNum(existing.qty ?? 0) + entered * factor;
    return;
  }
  state.cart.push({
    ...item,
    uom: u,
    qty_factor: factor,
    qty_entered: entered,
    qty: entered * factor, // base qty
    base_price_usd: toNum(item.price_usd || 0),
    base_price_lbp: toNum(item.price_lbp || 0),
    promo_code: "",
    promo_name: "",
    batch_no: (batchNo || "").trim() || null,
    expiry_date: (expiryDate || "").trim() || null
  });
}

function validateIsoDate(s) {
  const v = (s || "").trim();
  if (!v) return true;
  // Basic YYYY-MM-DD check; input[type=date] already normalizes.
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function openLotModal(item, qtyEntered, uom, qtyFactor) {
  state.lotContext = { item, qtyEntered, uom, qtyFactor };
  state.lotBatches = [];
  setText("lotSubtitle", `${item.name} · Qty ${qtyEntered}`);
  el("lotBatchNo").value = "";
  el("lotExpiryDate").value = "";
  el("lotBatches").innerHTML = "";
  setText("lotStatus", "");
  showModal("lotModal");
  // Best-effort: load on-hand batches when online (otherwise manual entry works).
  loadLotBatches();
}

function renderLotBatches() {
  const container = el("lotBatches");
  container.innerHTML = "";
  const rows = state.lotBatches || [];
  rows.slice(0, 60).forEach((b) => {
    const batchNo = (b.batch_no || "").trim() || "unbatched";
    const exp = b.expiry_date ? String(b.expiry_date).slice(0, 10) : "";
    const onHand = Number(b.on_hand || 0);
    const card = document.createElement("div");
    card.className = "item";
    const metaBits = [];
    metaBits.push(escapeHtml(batchNo));
    if (exp) metaBits.push(`exp ${escapeHtml(exp)}`);
    card.innerHTML = `
      <div>
        <div class="meta">${metaBits.join(" · ")}</div>
        <div class="meta">On hand: ${Number.isFinite(onHand) ? onHand : 0}</div>
      </div>
    `;
    card.addEventListener("click", () => {
      el("lotBatchNo").value = b.batch_no || "";
      if (exp) el("lotExpiryDate").value = exp;
    });
    container.appendChild(card);
  });
}

async function loadLotBatches() {
  if (!state.lotContext?.item?.id) return;
  const itemId = state.lotContext.item.id;
  const wh = (state.config?.warehouse_id || "").trim();
  if (!wh) {
    setText("lotStatus", "No warehouse configured for this POS device.");
    state.lotBatches = [];
    renderLotBatches();
    return;
  }
  setText("lotStatus", "Loading...");
  try {
    const res = await api.get(`/items/${encodeURIComponent(itemId)}/batches?warehouse_id=${encodeURIComponent(wh)}&limit=60`);
    const rows = res.batches || [];
    state.lotBatches = rows;
    renderLotBatches();
    setText("lotStatus", rows.length ? `${rows.length} on-hand batches` : "No on-hand batches found (enter manually).");
  } catch (e) {
    state.lotBatches = [];
    renderLotBatches();
    setText("lotStatus", "Offline or unavailable (enter manually).");
  }
}

function confirmLotAdd() {
  const ctx = state.lotContext;
  if (!ctx?.item) return;
  const item = ctx.item;
  const qtyEntered = Number(ctx.qtyEntered || 1) || 1;
  const uom = (ctx.uom || item.unit_of_measure || "").trim() || null;
  const qtyFactor = toNum(ctx.qtyFactor ?? 1) || 1;

  const batchNo = (el("lotBatchNo").value || "").trim();
  const expiryDate = (el("lotExpiryDate").value || "").trim();

  const policy = requireManualLotSelection();
  const tracked = isTrackedForLot(item);
  const requireBatch = !!item.track_batches;
  // If policy requires manual selection and the item is tracked-but-not-batched, require expiry entry.
  const requireExpiry = !!item.track_expiry || (policy && tracked && !item.track_batches);

  if (requireBatch && !batchNo) {
    setText("lotStatus", "Batch number is required for this item.");
    return;
  }
  if (requireExpiry && !expiryDate) {
    setText("lotStatus", "Expiry date is required for this item.");
    return;
  }
  if (!validateIsoDate(expiryDate)) {
    setText("lotStatus", "Expiry date must be YYYY-MM-DD.");
    return;
  }

  hideModal("lotModal");
  state.lotContext = null;
  addCartLine(item, qtyEntered, batchNo || null, expiryDate || null, uom, qtyFactor);
  repriceCart();
  renderCart();
  updateTotals();
}

async function loadItems() {
  const data = await api.get("/items");
  state.items = data.items || [];
  renderItems(state.items);
}

async function loadBarcodes() {
  try {
    const data = await api.get("/barcodes");
    state.barcodes = data.barcodes || [];
  } catch {
    state.barcodes = [];
  }
}

async function loadCashiers() {
  try {
    const data = await api.get("/cashiers");
    state.cashiers = data.cashiers || [];
  } catch {
    state.cashiers = [];
  }
}

async function loadPromotions() {
  try {
    const data = await api.get("/promotions");
    const rows = data.promotions || [];
    // Agent returns [{ id, name, rules, updated_at }]. Keep rules only.
    state.promotions = rows.map((p) => p.rules).filter(Boolean);
  } catch {
    state.promotions = [];
  }
  repriceCart();
}

function resolveCashierName(cashierId) {
  if (!cashierId) return "-";
  const c = state.cashiers.find((x) => x.id === cashierId);
  return c?.name || cashierId.slice(0, 8);
}

function filterItems() {
  const term = (el("search").value || "").toLowerCase();
  const needle = term.trim();
  if (!needle) {
    renderItems(state.items);
    return;
  }
  const hitIds = new Set(
    state.barcodes
      .filter((b) => (b.barcode || "").toLowerCase().includes(needle))
      .map((b) => b.item_id)
  );
  const list = state.items.filter(
    (i) =>
      (i.name || "").toLowerCase().includes(needle) ||
      (i.sku || "").toLowerCase().includes(needle) ||
      (i.barcode || "").toLowerCase().includes(needle) ||
      hitIds.has(i.id)
  );
  renderItems(list);
}

async function loadConfig() {
  const data = await api.get("/config");
  state.config = data;
  state.shiftId = data.shift_id || "";
  state.cashierId = data.cashier_id || "";
  state.cashierName = resolveCashierName(state.cashierId);

  el("rate").value = data.exchange_rate || 0;
  el("currency").value = data.pricing_currency || "USD";
  el("customerId").value = data.default_customer_id || "";
}

async function saveSettings() {
  const payload = {
    exchange_rate: toNum(el("rate").value),
    pricing_currency: el("currency").value || "USD",
    default_customer_id: (el("customerId").value || "").trim()
  };
  const res = await api.post("/config", payload);
  state.config = res.config;
  hideModal("settingsModal");
  updateTotals();
  renderHeader();
  setText("saleStatus", "Settings saved.");
}

async function loadShiftStatus() {
  try {
    const res = await api.post("/shift/status", {});
    const shift = res.shift || null;
    state.shiftId = shift ? shift.id : "";
    if (state.config) {
      state.config.shift_id = state.shiftId;
    }
    renderHeader();
  } catch {
    // Keep local shift_id if server is unreachable.
    renderHeader();
  }
}

async function syncPull() {
  setText("syncStatus", "Syncing...");
  try {
    const res = await api.post("/sync/pull", {});
    await loadCashiers();
    await loadItems();
    await loadBarcodes();
    await loadPromotions();
    await loadConfig();
    await loadShiftStatus();
    setText(
      "syncStatus",
      `OK · ${res.items || 0} items · ${res.cashiers || 0} cashiers · ${res.promotions || 0} promos`
    );
    if (!state.cashierId) {
      setText("loginStatus", state.cashiers.length ? "" : "No cashiers cached yet. Create cashiers in Admin, then Sync.");
      showModal("loginModal");
    }
  } catch (err) {
    setText("syncStatus", `Error`);
    setText("saleStatus", `Sync error: ${err.message}`);
  }
}

async function syncPush() {
  setText("syncStatus", "Pushing...");
  try {
    const res = await api.post("/sync/push", {});
    setText("syncStatus", `Sent ${res.sent || 0}`);
    if ((res.rejected || []).length) {
      setText("saleStatus", `Some events rejected. Check Admin Outbox.`);
    }
    // Refresh the edge banner/queue after pushing.
    refreshEdgeStatus();
  } catch (err) {
    setText("syncStatus", `Error`);
    setText("saleStatus", `Push error: ${err.message}`);
  }
}

async function reconnectChecklist() {
  setText("saleStatus", "");
  setText("syncStatus", "Reconnect...");
  await refreshEdgeStatus();
  if (state.edge.ok === false) {
    setText("syncStatus", "EDGE OFFLINE");
    setText("saleStatus", "Edge is offline. Check LAN cable/WiFi, then try Reconnect again.");
    return;
  }
  try {
    setText("syncStatus", "Pull + Push...");
    await syncPull();
    await syncPush();
    await refreshEdgeStatus();
    const pending = Number(state.edge.pending || 0);
    if (pending === 0) setText("saleStatus", "Back online. Queue cleared.");
    else setText("saleStatus", `Back online. Still ${pending} queued (will retry).`);
  } catch (err) {
    setText("syncStatus", "Error");
    setText("saleStatus", `Reconnect error: ${err.message}`);
  }
}

async function loginCashier() {
  const pin = (el("loginPin").value || "").trim();
  setText("loginStatus", "Checking...");
  try {
    const res = await api.post("/cashiers/login", { pin });
    state.config = res.config;
    state.cashierId = res.cashier?.id || res.config?.cashier_id || "";
    await loadCashiers();
    state.cashierName = resolveCashierName(state.cashierId);
    el("loginPin").value = "";
    hideModal("loginModal");
    renderHeader();
    setText("saleStatus", `Logged in as ${state.cashierName}`);
  } catch (err) {
    // Server returns JSON like {"error": "...", "hint": "..."} but our `api` helper
    // throws `Error(await res.text())`, so parse it best-effort.
    let msg = "Login failed.";
    try {
      const parsed = JSON.parse(err.message || "{}");
      msg = parsed.hint || parsed.error || msg;
    } catch {
      msg = String(err.message || msg);
    }
    setText("loginStatus", msg);
  }
}

async function lockPos() {
  try {
    await api.post("/cashiers/logout", {});
  } catch {
    // ignore
  } finally {
    state.cashierId = "";
    state.cashierName = "-";
    renderHeader();
    setText("loginStatus", "");
    showModal("loginModal");
  }
}

async function openShift() {
  const payload = {
    opening_cash_usd: toNum(el("shiftOpenUsd").value),
    opening_cash_lbp: toNum(el("shiftOpenLbp").value),
    notes: (el("shiftOpenNotes").value || "").trim() || null
  };
  setText("saleStatus", "Opening shift...");
  try {
    const res = await api.post("/shift/open", payload);
    const shift = res.shift || null;
    state.shiftId = shift ? shift.id : "";
    await loadConfig();
    hideModal("shiftOpenModal");
    renderHeader();
    setText("saleStatus", state.shiftId ? "Shift opened." : "Shift open failed.");
  } catch (err) {
    setText("saleStatus", `Open failed: ${err.message}`);
  }
}

async function closeShift() {
  const payload = {
    closing_cash_usd: toNum(el("shiftCloseUsd").value),
    closing_cash_lbp: toNum(el("shiftCloseLbp").value),
    notes: (el("shiftCloseNotes").value || "").trim() || null
  };
  setText("saleStatus", "Closing shift...");
  try {
    const res = await api.post("/shift/close", payload);
    state.shiftId = "";
    await loadConfig();
    hideModal("shiftCloseModal");
    renderHeader();
    const v = res.shift?.variance_usd || 0;
    setText("saleStatus", `Shift closed. Variance USD ${v}`);
  } catch (err) {
    setText("saleStatus", `Close failed: ${err.message}`);
  }
}

function openShiftDialog() {
  el("shiftOpenUsd").value = "";
  el("shiftOpenLbp").value = "";
  el("shiftOpenNotes").value = "";
  showModal("shiftOpenModal");
}

function closeShiftDialog() {
  el("shiftCloseUsd").value = "";
  el("shiftCloseLbp").value = "";
  el("shiftCloseNotes").value = "";
  showModal("shiftCloseModal");
}

function openPayDialog() {
  if (!state.cart.length) return;
  el("paymentMethod").value = "cash";
  el("payCustomerId").value = getDefaultCustomerId() || "";
  setText("payStatus", "");
  hydrateCustomerLabels();
  showModal("payModal");
  renderEdgeStatus();
}

function openReceiptWindow() {
  const w = window.open("/receipt/last", "_blank", "noopener,noreferrer,width=420,height=820");
  if (!w) {
    setText("saleStatus", "Receipt ready. Pop-up blocked; use the Receipt button.");
  }
}

async function confirmPay() {
  if (!state.cart.length) return;
  const method = el("paymentMethod").value || "cash";
  const customerId = (el("payCustomerId").value || "").trim() || null;
  if (method === "credit" && state.edge.ok === false) {
    setText("payStatus", "Credit is disabled when the edge server is offline.");
    return;
  }
  if (method === "credit" && !customerId) {
    setText("payStatus", "Credit sale requires a customer.");
    return;
  }
  if (method === "credit" && customerId) {
    const ok = await localCreditCheck(customerId);
    if (!ok) return;
  }

  const payload = {
    cart: state.cart.map((i) => ({
      id: i.id,
      qty: i.qty, // base qty (inventory)
      qty_entered: i.qty_entered ?? i.qty,
      uom: i.uom || i.unit_of_measure || null,
      qty_factor: i.qty_factor ?? 1,
      price_usd: i.price_usd || 0,
      price_lbp: i.price_lbp || 0,
      pre_discount_unit_price_usd: i.pre_discount_unit_price_usd || 0,
      pre_discount_unit_price_lbp: i.pre_discount_unit_price_lbp || 0,
      discount_pct: i.discount_pct || 0,
      discount_amount_usd: i.discount_amount_usd || 0,
      discount_amount_lbp: i.discount_amount_lbp || 0,
      applied_promotion_id: i.applied_promotion_id || null,
      applied_promotion_item_id: i.applied_promotion_item_id || null,
      batch_no: i.batch_no || null,
      expiry_date: i.expiry_date || null
    })),
    exchange_rate: getRate(),
    pricing_currency: getCurrency(),
    customer_id: customerId,
    payment_method: method,
    shift_id: state.shiftId || null,
    cashier_id: state.cashierId || null
  };

  setText("payStatus", "Queueing...");
  try {
    const res = await api.post("/sale", payload);
    hideModal("payModal");
    setText("saleStatus", `Queued sale: ${res.event_id}`);
    state.cart = [];
    renderCart();
    updateTotals();
    openReceiptWindow();
  } catch (err) {
    setText("payStatus", `Error: ${err.message}`);
  }
}

function openReturnDialog() {
  if (!state.cart.length) return;
  if (state.edge.ok === false) {
    setText("saleStatus", "Returns are disabled while edge is offline. Reconnect to edge and try again.");
    return;
  }
  el("refundMethod").value = "cash";
  el("returnInvoiceId").value = "";
  setText("returnStatus", "");
  showModal("returnModal");
}

async function confirmReturn() {
  if (!state.cart.length) return;
  const refundMethod = el("refundMethod").value || "cash";
  const invoiceId = (el("returnInvoiceId").value || "").trim() || null;
  const payload = {
    cart: state.cart.map((i) => ({
      id: i.id,
      qty: i.qty, // base qty
      qty_entered: i.qty_entered ?? i.qty,
      uom: i.uom || i.unit_of_measure || null,
      qty_factor: i.qty_factor ?? 1,
      price_usd: i.price_usd || 0,
      price_lbp: i.price_lbp || 0,
      pre_discount_unit_price_usd: i.pre_discount_unit_price_usd || 0,
      pre_discount_unit_price_lbp: i.pre_discount_unit_price_lbp || 0,
      discount_pct: i.discount_pct || 0,
      discount_amount_usd: i.discount_amount_usd || 0,
      discount_amount_lbp: i.discount_amount_lbp || 0,
      applied_promotion_id: i.applied_promotion_id || null,
      applied_promotion_item_id: i.applied_promotion_item_id || null,
      batch_no: i.batch_no || null,
      expiry_date: i.expiry_date || null
    })),
    exchange_rate: getRate(),
    pricing_currency: getCurrency(),
    invoice_id: invoiceId,
    refund_method: refundMethod,
    shift_id: state.shiftId || null,
    cashier_id: state.cashierId || null
  };
  setText("returnStatus", "Queueing...");
  try {
    const res = await api.post("/return", payload);
    hideModal("returnModal");
    setText("saleStatus", `Queued return: ${res.event_id}`);
    state.cart = [];
    renderCart();
    updateTotals();
    openReceiptWindow();
  } catch (err) {
    setText("returnStatus", `Error: ${err.message}`);
  }
}

function openCashDialog() {
  if (!state.shiftId) {
    setText("saleStatus", "Open a shift before recording cash movements.");
    return;
  }
  el("cashType").value = "cash_in";
  el("cashUsd").value = "";
  el("cashLbp").value = "";
  el("cashNotes").value = "";
  setText("cashStatus", "");
  showModal("cashModal");
}

async function confirmCashMove() {
  const payload = {
    movement_type: el("cashType").value,
    amount_usd: toNum(el("cashUsd").value),
    amount_lbp: toNum(el("cashLbp").value),
    notes: (el("cashNotes").value || "").trim() || null,
    shift_id: state.shiftId || null,
    cashier_id: state.cashierId || null
  };
  if (!payload.movement_type) {
    setText("cashStatus", "Choose a type.");
    return;
  }
  if (payload.amount_usd <= 0 && payload.amount_lbp <= 0) {
    setText("cashStatus", "Enter an amount.");
    return;
  }

  setText("cashStatus", "Queueing...");
  try {
    const res = await api.post("/cash-movement", payload);
    hideModal("cashModal");
    setText("saleStatus", `Queued cash movement: ${res.event_id}`);
  } catch (err) {
    setText("cashStatus", `Error: ${err.message}`);
  }
}

function openSettingsDialog() {
  el("rate").value = state.config?.exchange_rate || 0;
  el("currency").value = state.config?.pricing_currency || "USD";
  el("customerId").value = state.config?.default_customer_id || "";
  hydrateCustomerLabels();
  showModal("settingsModal");
}

function bind() {
  el("search").addEventListener("input", filterItems);

  el("reconnectBtn").addEventListener("click", reconnectChecklist);
  el("syncPull").addEventListener("click", syncPull);
  el("syncPush").addEventListener("click", syncPush);
  el("settingsBtn").addEventListener("click", openSettingsDialog);
  el("receiptBtn").addEventListener("click", openReceiptWindow);

  el("shiftBtn").addEventListener("click", () => (state.shiftId ? closeShiftDialog() : openShiftDialog()));
  el("cashBtn").addEventListener("click", openCashDialog);
  el("lockBtn").addEventListener("click", lockPos);

  el("clear").addEventListener("click", () => {
    state.cart = [];
    renderCart();
    updateTotals();
    setText("saleStatus", "");
  });

  el("pay").addEventListener("click", openPayDialog);
  el("return").addEventListener("click", openReturnDialog);

  // Login
  el("loginBtn").addEventListener("click", loginCashier);
  el("loginPin").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginCashier();
  });

  // Shift modals
  el("shiftOpenCancel").addEventListener("click", () => hideModal("shiftOpenModal"));
  el("shiftOpenConfirm").addEventListener("click", openShift);
  el("shiftCloseCancel").addEventListener("click", () => hideModal("shiftCloseModal"));
  el("shiftCloseConfirm").addEventListener("click", closeShift);

  // Cash modal
  el("cashCancel").addEventListener("click", () => hideModal("cashModal"));
  el("cashConfirm").addEventListener("click", confirmCashMove);

  // Settings modal
  el("settingsCancel").addEventListener("click", () => hideModal("settingsModal"));
  el("settingsSave").addEventListener("click", saveSettings);
  el("settingsPickCustomer").addEventListener("click", () => openCustomerPicker("settings"));
  el("settingsClearCustomer").addEventListener("click", async () => {
    el("customerId").value = "";
    await hydrateCustomerLabels();
  });

  // Lot modal (batch/expiry pick-confirm).
  el("lotLoad").addEventListener("click", loadLotBatches);
  el("lotCancel").addEventListener("click", () => {
    state.lotContext = null;
    hideModal("lotModal");
  });
  el("lotConfirm").addEventListener("click", confirmLotAdd);
  el("lotBatchNo").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmLotAdd();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      state.lotContext = null;
      hideModal("lotModal");
    }
  });
  el("lotExpiryDate").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmLotAdd();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      state.lotContext = null;
      hideModal("lotModal");
    }
  });

  // Pay modal
  el("payCancel").addEventListener("click", () => hideModal("payModal"));
  el("payConfirm").addEventListener("click", confirmPay);
  el("payPickCustomer").addEventListener("click", () => openCustomerPicker("pay"));
  el("payClearCustomer").addEventListener("click", async () => {
    el("payCustomerId").value = "";
    await hydrateCustomerLabels();
  });

  // Customer picker modal
  el("custPickCancel").addEventListener("click", () => hideModal("customerPickerModal"));
  el("custPickRefresh").addEventListener("click", refreshCustomerPicker);
  el("custPickQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") refreshCustomerPicker();
    if (e.key === "Escape") hideModal("customerPickerModal");
  });

  // Return modal
  el("returnCancel").addEventListener("click", () => hideModal("returnModal"));
  el("returnConfirm").addEventListener("click", confirmReturn);

  // Backdrop click closes modals except login (lock screen).
  el("backdrop").addEventListener("click", () => {
    if (state.modalOpen && state.modalOpen !== "loginModal") hideModal(state.modalOpen);
  });

  // Barcode scanning (only when no modal open and no input is focused).
  document.addEventListener("keydown", (event) => {
    if (state.modalOpen) return;
    if (isInputFocused()) return;

    const now = Date.now();
    const gap = now - state.lastScanTime;
    state.lastScanTime = now;
    if (gap > 100) state.scanBuffer = "";

    if (event.key === "Enter") {
      const code = state.scanBuffer.trim();
      state.scanBuffer = "";
      if (!code) return;
      const needle = code.toLowerCase();

      const direct = state.items.find(
        (i) =>
          (i.barcode || "").toLowerCase() === needle ||
          (i.sku || "").toLowerCase() === needle
      );
      if (direct) {
        addToCartWithUom(direct, 1, (direct.unit_of_measure || "").trim() || null, 1);
        return;
      }

      const bc = state.barcodes.find((b) => (b.barcode || "").toLowerCase() === needle);
      if (bc) {
        const it = state.items.find((i) => i.id === bc.item_id);
        if (!it) return;
        const factor = toNum(bc.qty_factor || 1);
        const qtyFactor = factor > 0 ? factor : 1;
        const uom = (bc.uom_code || it.unit_of_measure || "").trim() || null;
        addToCartWithUom(it, 1, uom, qtyFactor);
      }
      return;
    }

    if (event.key.length === 1) {
      state.scanBuffer += event.key;
    }
  });
}

async function boot() {
  await loadCashiers();
  await loadConfig();
  await loadShiftStatus();
  await loadItems();
  await loadBarcodes();
  await loadPromotions();
  updateTotals();
  renderHeader();
  // Live edge connectivity + queued events indicator.
  refreshEdgeStatus();
  setInterval(refreshEdgeStatus, 3000);

  if (!state.cashierId) {
    setText(
      "loginStatus",
      state.cashiers.length ? "" : "No cashiers cached yet. Create cashiers in Admin, then Sync."
    );
    showModal("loginModal");
  }
}

bind();
boot();
