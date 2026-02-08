// Web Admin (static) UI.
// This is a "power admin" client for driving the backend API quickly.

const storage = {
  get(key, fallback) {
    return localStorage.getItem(key) || fallback;
  },
  has(key) {
    return localStorage.getItem(key) !== null;
  },
  set(key, value) {
    localStorage.setItem(key, value);
  },
  remove(key) {
    localStorage.removeItem(key);
  }
};

const api = {
  base() {
    return storage.get("apiBase", "http://localhost:8000");
  },
  companyId() {
    return storage.get("companyId", "");
  },
  token() {
    return storage.get("authToken", "");
  },
  headers() {
    const companyId = api.companyId();
    const token = api.token();
    const headers = { "Content-Type": "application/json" };
    if (companyId) headers["X-Company-Id"] = companyId;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  },
  async get(path) {
    const res = await fetch(`${api.base()}${path}`, { headers: api.headers() });
    if (!res.ok) throw new Error(await res.text());
    return res;
  },
  async post(path, body) {
    const res = await fetch(`${api.base()}${path}`, {
      method: "POST",
      headers: api.headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async patch(path, body) {
    const res = await fetch(`${api.base()}${path}`, {
      method: "PATCH",
      headers: api.headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
};

const el = (id) => document.getElementById(id);

function toast(message, tone = "ok", timeoutMs = 2800) {
  const root = el("toastRoot");
  if (!root) return;
  const t = document.createElement("div");
  t.className = `toast ${tone === "bad" ? "toast--bad" : "toast--ok"}`;
  t.textContent = message;
  root.appendChild(t);
  window.setTimeout(() => {
    try {
      t.remove();
    } catch {
      // ignore
    }
  }, Math.max(800, timeoutMs));
}

function setConnBadge(text, tone) {
  const badge = el("connStatus");
  const mirror = el("connStatusMirror");
  for (const node of [badge, mirror]) {
    if (!node) continue;
    node.textContent = text;
    node.dataset.tone = tone || "bad";
  }
}

function formatNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number);
}

function formatCurrency(value, code) {
  if (code === "USD") return `$${formatNumber(value)}`;
  return `LBP ${formatNumber(value)}`;
}

function setMetric(id, value, formatter = formatNumber) {
  const target = el(id);
  if (!target) return;
  target.textContent = formatter(value);
}

function setStatus(text) {
  const status = el("statusBlock");
  if (!status) return;
  status.textContent = text;
}

function renderTable(target, rows) {
  if (!target) return;
  if (!rows || rows.length === 0) {
    target.innerHTML = `<div class="p-4 text-sm text-slate-700/80">No data.</div>`;
    return;
  }

  // Normalize rows to plain objects.
  const safeRows = rows.map((r) => (r && typeof r === "object" ? r : { value: r }));
  const headers = Object.keys(safeRows[0] || {});

  const table = document.createElement("table");
  table.className = "table";

  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h.replace(/_/g, " ");
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  const tbody = document.createElement("tbody");
  safeRows.forEach((row) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      const val = row[h];
      const text = val === null || val === undefined ? "" : String(val);
      // "IDs feel terrible" UX fix: render common ids in monospace and make them easy to copy.
      const isLikelyId = h === "id" || h.endsWith("_id") || h.endsWith("_uuid");
      if (isLikelyId && text) {
        const code = document.createElement("code");
        code.textContent = text;
        code.title = "Click to copy";
        code.style.cursor = "copy";
        code.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(text);
            toast("Copied", "ok", 1200);
          } catch {
            // ignore
          }
        });
        td.appendChild(code);
      } else {
        td.textContent = text;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);

  target.innerHTML = "";
  target.appendChild(table);
}

function loadConnection() {
  const apiBase = el("apiBase");
  const companyId = el("companyId");
  if (apiBase) apiBase.value = api.base();
  if (companyId) companyId.value = api.companyId();
  const sessionCompany = el("sessionCompany");
  if (sessionCompany) sessionCompany.value = api.companyId();
}

async function testConnection() {
  setConnBadge("Testing...", "bad");
  try {
    const res = await fetch(`${api.base()}/health`);
    if (!res.ok) throw new Error("API not reachable");
    setConnBadge("Connected", "ok");
    toast("API connected", "ok");
  } catch (err) {
    setConnBadge("Disconnected", "bad");
    toast(`API error: ${err.message}`, "bad", 4200);
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), Math.max(200, timeoutMs || 800));
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    window.clearTimeout(t);
  }
}

async function autoDetectApiBase() {
  // Only auto-detect if the user hasn't explicitly configured an API base.
  if (storage.has("apiBase")) return;

  const candidates = ["http://localhost:8000", "http://localhost:8001"];
  for (const base of candidates) {
    try {
      const res = await fetchWithTimeout(`${base}/health`, 900);
      if (!res.ok) continue;
      storage.set("apiBase", base);
      loadConnection();
      setConnBadge("Connected", "ok");
      toast(`Using API: ${base}`, "ok", 2400);
      return;
    } catch {
      // try next
    }
  }
}

const SUBTITLE = {
  dashboard: "Fast “power admin” UI for ops, purchasing, inventory, and accounting.",
  items: "SKUs, barcodes, reorder settings, dual pricing.",
  inventory: "Stock positions and adjustments.",
  customers: "Credit limits and contact details.",
  sales: "Invoices, returns, and payments.",
  suppliers: "Vendors and sourcing profiles.",
  purchases: "Purchase orders, receipts, supplier invoices.",
  intercompany: "Issue stock between entities and settle balances.",
  accounting: "Trial balance and posting defaults.",
  coa: "Templates, accounts, and mappings.",
  reports: "VAT, GL, and inventory valuation exports.",
  ai: "Recommendations for replenishment and CRM.",
  "ai-settings": "Auto-execution rules for AI agents.",
  config: "Exchange rates, tax codes, payment mapping.",
  devices: "Register POS devices and rotate tokens.",
  users: "Provision users, roles, and permissions.",
  auth: "Login and switch company context."
};

function showSection(name) {
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.toggle("active", section.dataset.section === name);
  });
  document.querySelectorAll(".nav__item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === name);
  });

  const label =
    document.querySelector(`.nav__item[data-section="${name}"]`)?.textContent?.trim() ||
    name.replace("-", " ");
  const title = el("pageTitle");
  if (title) title.textContent = label;
  const subtitle = el("pageSubtitle");
  if (subtitle) subtitle.textContent = SUBTITLE[name] || "";

  try {
    document.title = `${label} · AH Trading Admin`;
  } catch {
    // ignore
  }
}

function openOverlay(which) {
  const overlay = el("overlay");
  const conn = el("modalConn");
  const cmdk = el("modalCmdk");
  if (!overlay || !conn || !cmdk) return;

  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");

  conn.style.display = which === "connection" ? "" : "none";
  cmdk.style.display = which === "cmdk" ? "" : "none";

  if (which === "connection") {
    loadConnection();
    el("apiBase")?.focus();
  } else if (which === "cmdk") {
    el("cmdkInput")?.focus();
    renderCmdk();
  }
}

function closeOverlay() {
  const overlay = el("overlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
}

function cmdkItems() {
  const items = [];
  document.querySelectorAll(".nav__item").forEach((btn) => {
    const section = btn.dataset.section;
    const label = btn.textContent.trim();
    if (!section || !label) return;
    items.push({ section, label });
  });
  return items;
}

function renderCmdk() {
  const q = (el("cmdkInput")?.value || "").trim().toLowerCase();
  const results = el("cmdkResults");
  if (!results) return;

  const list = cmdkItems()
    .filter((it) => {
      if (!q) return true;
      return it.label.toLowerCase().includes(q) || it.section.toLowerCase().includes(q);
    })
    .slice(0, 12);

  results.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "p-3 text-sm text-slate-700/80";
    empty.textContent = "No results.";
    results.appendChild(empty);
    return;
  }

  list.forEach((it) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className =
      "btn btn-outline w-full justify-start !px-3 !py-2 text-left";
    b.innerHTML = `<span class="kbd">↵</span> <span>${it.label}</span> <span class="ml-auto text-xs text-slate-700/70">${it.section}</span>`;
    b.addEventListener("click", () => {
      closeOverlay();
      showSection(it.section);
    });
    results.appendChild(b);
  });
}

async function login() {
  const status = el("loginStatus");
  if (status) status.textContent = "Logging in...";
  try {
    const res = await api.post("/auth/login", {
      email: el("loginEmail").value,
      password: el("loginPassword").value
    });
    storage.set("authToken", res.token);
    if (status) status.textContent = `Logged in. Companies: ${(res.companies || []).join(", ")}`;
    renderTable(el("sessionInfo"), [{ token: res.token, user_id: res.user_id }]);
    toast("Logged in", "ok");
    loadMetrics();
  } catch (err) {
    if (status) status.textContent = `Error: ${err.message}`;
    toast(`Login error: ${err.message}`, "bad", 4200);
  }
}

async function logout() {
  try {
    await api.post("/auth/logout", {});
  } catch {
    // ignore
  }
  storage.remove("authToken");
  const status = el("loginStatus");
  if (status) status.textContent = "Logged out";
  renderTable(el("sessionInfo"), []);
  toast("Logged out", "ok");
}

function setCompanyFromSession() {
  const value = el("sessionCompany").value.trim();
  if (value) storage.set("companyId", value);
  const c = el("companyId");
  if (c) c.value = value;
  toast("Company updated", "ok");
  loadMetrics();
}

async function loadMetrics() {
  if (!api.companyId()) {
    setStatus("Set company ID");
    return;
  }
  try {
    const res = await api.get("/reports/metrics");
    const data = await res.json();
    const metrics = data.metrics || {};
    setMetric("metricSalesUsd", metrics.sales_today_usd, (v) => formatCurrency(v, "USD"));
    setMetric("metricSalesLbp", metrics.sales_today_lbp, (v) => formatCurrency(v, "LBP"));
    setMetric("metricPurchasesUsd", metrics.purchases_today_usd, (v) => formatCurrency(v, "USD"));
    setMetric("metricPurchasesLbp", metrics.purchases_today_lbp, (v) => formatCurrency(v, "LBP"));
    setMetric("metricArUsd", metrics.ar_usd, (v) => formatCurrency(v, "USD"));
    setMetric("metricArLbp", metrics.ar_lbp, (v) => formatCurrency(v, "LBP"));
    setMetric("metricApUsd", metrics.ap_usd, (v) => formatCurrency(v, "USD"));
    setMetric("metricApLbp", metrics.ap_lbp, (v) => formatCurrency(v, "LBP"));
    setMetric("metricStockUsd", metrics.stock_value_usd, (v) => formatCurrency(v, "USD"));
    setMetric("metricStockLbp", metrics.stock_value_lbp, (v) => formatCurrency(v, "LBP"));
    setMetric("metricLowStock", metrics.low_stock_count, formatNumber);
    setMetric("metricItems", metrics.items_count, formatNumber);
    setMetric("metricCustomers", metrics.customers_count, formatNumber);
    setMetric("metricSuppliers", metrics.suppliers_count, formatNumber);
    setStatus("Live");
    setConnBadge("Connected", "ok");
  } catch {
    setStatus("Metrics unavailable");
  }
}

async function addRate() {
  const payload = {
    rate_date: el("rateDate").value,
    rate_type: el("rateType").value || "market",
    usd_to_lbp: Number(el("usdToLbp").value || 0)
  };
  await api.post("/config/exchange-rates", payload);
  await loadRates();
  toast("Rate added", "ok");
}

async function loadRates() {
  const res = await api.get("/config/exchange-rates");
  const data = await res.json();
  renderTable(el("ratesList"), data.rates);
}

async function addTax() {
  const payload = {
    name: el("taxName").value,
    rate: Number(el("taxRate").value || 0),
    tax_type: "vat",
    reporting_currency: "LBP"
  };
  await api.post("/config/tax-codes", payload);
  await loadTax();
  toast("Tax code added", "ok");
}

async function loadTax() {
  const res = await api.get("/config/tax-codes");
  const data = await res.json();
  renderTable(el("taxList"), data.tax_codes);
}

async function loadPaymentMethods() {
  const res = await api.get("/config/payment-methods");
  const data = await res.json();
  renderTable(el("paymentMethodsList"), data.methods);
}

async function savePaymentMethod() {
  const payload = {
    method: el("payMapMethod").value,
    role_code: el("payRoleCode").value
  };
  await api.post("/config/payment-methods", payload);
  await loadPaymentMethods();
  toast("Payment mapping saved", "ok");
}

async function loadDevices() {
  const res = await api.get("/pos/devices");
  const data = await res.json();
  renderTable(el("devicesList"), data.devices);
}

async function registerDevice() {
  if (!api.companyId()) {
    setStatus("Set company ID");
    return;
  }
  const code = el("deviceCode").value.trim();
  if (!code) return;
  const branchId = el("deviceBranchId").value.trim();
  const query = new URLSearchParams();
  query.append("company_id", api.companyId());
  query.append("device_code", code);
  if (branchId) query.append("branch_id", branchId);
  const res = await api.post(`/pos/devices/register?${query.toString()}`, {});
  renderTable(el("deviceRegisterOutput"), [res]);
  await loadDevices();
  toast("Device registered", "ok");
}

async function resetDeviceToken() {
  const deviceId = el("deviceResetId").value.trim();
  if (!deviceId) return;
  const res = await api.post(`/pos/devices/${deviceId}/reset-token`, {});
  renderTable(el("deviceResetOutput"), [res]);
  await loadDevices();
  toast("Token reset", "ok");
}

async function loadItems() {
  const res = await api.get("/items");
  const data = await res.json();
  renderTable(el("itemsList"), data.items);
}

async function addItem() {
  const payload = {
    sku: el("itemSku").value,
    name: el("itemName").value,
    unit_of_measure: el("itemUom").value || "pcs",
    barcode: el("itemBarcode").value || null,
    reorder_point: Number(el("itemReorderPoint").value || 0),
    reorder_qty: Number(el("itemReorderQty").value || 0)
  };
  await api.post("/items", payload);
  await loadItems();
  toast("Item created", "ok");
}

async function addPrice() {
  const payload = {
    price_usd: Number(el("priceUsd").value || 0),
    price_lbp: Number(el("priceLbp").value || 0),
    effective_from: el("priceFrom").value
  };
  await api.post(`/items/${el("priceItemId").value}/prices`, payload);
  toast("Price saved", "ok");
}

async function loadCustomers() {
  const res = await api.get("/customers");
  const data = await res.json();
  renderTable(el("customersList"), data.customers);
}

async function addCustomer() {
  const payload = {
    name: el("customerName").value,
    phone: el("customerPhone").value || null,
    email: el("customerEmail").value || null,
    credit_limit_usd: Number(el("customerLimitUsd").value || 0),
    credit_limit_lbp: Number(el("customerLimitLbp").value || 0)
  };
  await api.post("/customers", payload);
  await loadCustomers();
  toast("Customer created", "ok");
}

async function loadSuppliers() {
  const res = await api.get("/suppliers");
  const data = await res.json();
  renderTable(el("suppliersList"), data.suppliers);
}

async function addSupplier() {
  const payload = {
    name: el("supplierName").value,
    phone: el("supplierPhone").value || null,
    email: el("supplierEmail").value || null
  };
  await api.post("/suppliers", payload);
  await loadSuppliers();
  toast("Supplier created", "ok");
}

async function mapSupplierItem() {
  const supplierId = el("mapSupplierId").value;
  const payload = {
    item_id: el("mapItemId").value,
    is_primary: el("mapPrimary").value === "true",
    lead_time_days: Number(el("mapLead").value || 0),
    min_order_qty: Number(el("mapMinQty").value || 0),
    last_cost_usd: Number(el("mapCostUsd").value || 0),
    last_cost_lbp: Number(el("mapCostLbp").value || 0)
  };
  await api.post(`/suppliers/${supplierId}/items`, payload);
  toast("Mapping saved", "ok");
}

async function loadStock() {
  const query = new URLSearchParams();
  if (el("stockItemId").value) query.append("item_id", el("stockItemId").value);
  if (el("stockWarehouseId").value) query.append("warehouse_id", el("stockWarehouseId").value);
  const res = await api.get(`/inventory/stock?${query.toString()}`);
  const data = await res.json();
  renderTable(el("stockList"), data.stock);
}

async function adjustStock() {
  const payload = {
    item_id: el("adjItemId").value,
    warehouse_id: el("adjWarehouseId").value,
    qty_in: Number(el("adjQtyIn").value || 0),
    qty_out: Number(el("adjQtyOut").value || 0),
    unit_cost_usd: Number(el("adjCostUsd").value || 0),
    unit_cost_lbp: Number(el("adjCostLbp").value || 0)
  };
  await api.post("/inventory/adjust", payload);
  await loadStock();
  toast("Adjustment posted", "ok");
}

async function loadSales() {
  const res = await api.get("/sales/invoices");
  const data = await res.json();
  renderTable(el("salesList"), data.invoices);
}

async function loadReturns() {
  const res = await api.get("/sales/returns");
  const data = await res.json();
  renderTable(el("returnsList"), data.returns);
}

async function postPayment() {
  const payload = {
    invoice_id: el("payInvoiceId").value,
    method: el("paySalesMethod").value,
    amount_usd: Number(el("payUsd").value || 0),
    amount_lbp: Number(el("payLbp").value || 0)
  };
  await api.post("/sales/payments", payload);
  toast("Payment posted", "ok");
}

async function loadOrders() {
  const res = await api.get("/purchases/orders");
  const data = await res.json();
  renderTable(el("ordersList"), data.orders);
}

async function loadReceipts() {
  const res = await api.get("/purchases/receipts");
  const data = await res.json();
  renderTable(el("receiptsList"), data.receipts);
}

async function loadSupplierInvoices() {
  const res = await api.get("/purchases/invoices");
  const data = await res.json();
  renderTable(el("supplierInvoicesList"), data.invoices);
}

async function createPO() {
  const qty = Number(el("poQty").value || 0);
  const costUsd = Number(el("poCostUsd").value || 0);
  const costLbp = Number(el("poCostLbp").value || 0);
  const payload = {
    supplier_id: el("poSupplierId").value,
    exchange_rate: Number(el("poRate").value || 0),
    lines: [
      {
        item_id: el("poItemId").value,
        qty,
        unit_cost_usd: costUsd,
        unit_cost_lbp: costLbp,
        line_total_usd: qty * costUsd,
        line_total_lbp: qty * costLbp
      }
    ]
  };
  await api.post("/purchases/orders", payload);
  await loadOrders();
  toast("PO created", "ok");
}

async function issueIntercompany() {
  const payload = {
    source_company_id: el("icSourceCompany").value,
    issue_company_id: el("icIssueCompany").value,
    sell_company_id: el("icSellCompany").value,
    source_invoice_id: el("icInvoice").value,
    warehouse_id: el("icWarehouse").value,
    lines: [
      {
        item_id: el("icItem").value,
        qty: Number(el("icQty").value || 0),
        unit_cost_usd: Number(el("icCostUsd").value || 0),
        unit_cost_lbp: Number(el("icCostLbp").value || 0)
      }
    ]
  };
  await api.post("/intercompany/issue", payload);
  toast("Intercompany issue posted", "ok");
}

async function settleIntercompany() {
  const payload = {
    from_company_id: el("icFromCompany").value,
    to_company_id: el("icToCompany").value,
    amount_usd: Number(el("icAmountUsd").value || 0),
    amount_lbp: Number(el("icAmountLbp").value || 0),
    exchange_rate: Number(el("icRate").value || 0),
    method: el("icMethod").value
  };
  await api.post("/intercompany/settle", payload);
  toast("Intercompany settlement posted", "ok");
}

async function loadTrial() {
  const res = await api.get("/reports/trial-balance");
  const data = await res.json();
  renderTable(el("trialBalance"), data.trial_balance);
}

async function loadDefaults() {
  const res = await api.get("/config/account-defaults");
  const data = await res.json();
  renderTable(el("defaultsList"), data.defaults);
}

async function saveDefaults() {
  const payload = {
    role_code: el("defRole").value,
    account_code: el("defAccount").value
  };
  await api.post("/config/account-defaults", payload);
  await loadDefaults();
  toast("Defaults saved", "ok");
}

async function loadVat() {
  const period = el("vatPeriod").value;
  const format = el("vatFormat").value;
  const query = new URLSearchParams();
  if (period) query.append("period", period);
  if (format) query.append("format", format);
  const res = await api.get(`/reports/vat?${query.toString()}`);
  if (format === "csv") {
    const text = await res.text();
    el("vatOutput").innerHTML = `<pre class="p-3 text-xs overflow-auto">${escapeHtml(text)}</pre>`;
  } else {
    const data = await res.json();
    renderTable(el("vatOutput"), data.vat);
  }
}

async function loadGL() {
  const start = el("glStart").value;
  const end = el("glEnd").value;
  const format = el("glFormat").value;
  const query = new URLSearchParams();
  if (start) query.append("start_date", start);
  if (end) query.append("end_date", end);
  if (format) query.append("format", format);
  const res = await api.get(`/reports/gl?${query.toString()}`);
  if (format === "csv") {
    const text = await res.text();
    el("glOutput").innerHTML = `<pre class="p-3 text-xs overflow-auto">${escapeHtml(text)}</pre>`;
  } else {
    const data = await res.json();
    renderTable(el("glOutput"), data.gl);
  }
}

async function loadInventoryValuation() {
  const format = el("invFormat").value;
  const query = new URLSearchParams();
  if (format) query.append("format", format);
  const res = await api.get(`/reports/inventory-valuation?${query.toString()}`);
  if (format === "csv") {
    const text = await res.text();
    el("invOutput").innerHTML = `<pre class="p-3 text-xs overflow-auto">${escapeHtml(text)}</pre>`;
  } else {
    const data = await res.json();
    renderTable(el("invOutput"), data.inventory);
  }
}

async function loadAI() {
  const res = await api.get("/ai/recommendations");
  const data = await res.json();
  renderTable(el("aiList"), data.recommendations);
}

async function loadAISettings() {
  const res = await api.get("/ai/settings");
  const data = await res.json();
  renderTable(el("aiSettingsList"), data.settings);
}

async function saveAISettings() {
  const payload = {
    agent_code: el("aiAgentCode").value,
    auto_execute: el("aiAuto").value === "true",
    max_amount_usd: Number(el("aiMaxAmount").value || 0),
    max_actions_per_day: Number(el("aiMaxActions").value || 0)
  };
  await api.post("/ai/settings", payload);
  await loadAISettings();
  toast("AI settings saved", "ok");
}

async function loadTemplates() {
  const res = await api.get("/coa/templates");
  const data = await res.json();
  renderTable(el("templatesList"), data.templates);
}

async function cloneTemplate() {
  const payload = {
    template_code: el("cloneTemplateCode").value,
    effective_from: el("cloneEffectiveFrom").value
  };
  await api.post("/coa/clone", payload);
  toast("Template cloned", "ok");
}

async function loadAccounts() {
  const res = await api.get("/coa/accounts");
  const data = await res.json();
  renderTable(el("accountsList"), data.accounts);
}

async function updateAccount() {
  const isPostable = el("accountPostable").value;
  const payload = { name_en: el("accountNameEn").value || null };
  if (isPostable) payload.is_postable = isPostable === "true";
  await api.patch(`/coa/accounts/${el("accountId").value}`, payload);
  toast("Account updated", "ok");
}

async function loadMappings() {
  const res = await api.get("/coa/mappings");
  const data = await res.json();
  renderTable(el("mappingsList"), data.mappings);
}

async function createMapping() {
  const payload = {
    source_account_id: el("mapSourceAccount").value,
    target_template_account_id: el("mapTargetAccount").value,
    mapping_type: "direct",
    effective_from: el("mapEffectiveFrom").value
  };
  await api.post("/coa/mappings", payload);
  await loadMappings();
  toast("Mapping created", "ok");
}

async function loadUsers() {
  const res = await api.get("/users");
  const data = await res.json();
  renderTable(el("usersList"), data.users);
}

async function createUser() {
  const payload = {
    email: el("userEmail").value,
    password: el("userPassword").value
  };
  await api.post("/users", payload);
  await loadUsers();
  toast("User created", "ok");
}

async function loadRoles() {
  const res = await api.get("/users/roles");
  const data = await res.json();
  renderTable(el("rolesList"), data.roles);
}

async function createRole() {
  const payload = { name: el("roleName").value };
  await api.post("/users/roles", payload);
  await loadRoles();
  toast("Role created", "ok");
}

async function assignRole() {
  const payload = {
    user_id: el("assignUserId").value,
    role_id: el("assignRoleId").value
  };
  await api.post("/users/roles/assign", payload);
  toast("Role assigned", "ok");
}

async function loadPermissions() {
  const res = await api.get("/users/permissions");
  const data = await res.json();
  renderTable(el("permissionsList"), data.permissions);
}

async function loadRolePermissions() {
  const roleId = el("permRoleId").value;
  if (!roleId) return;
  const res = await api.get(`/users/roles/${roleId}/permissions`);
  const data = await res.json();
  renderTable(el("rolePermissionsList"), data.permissions);
}

async function assignPermission() {
  const payload = {
    role_id: el("permRoleId").value,
    permission_code: el("permCode").value
  };
  await api.post("/users/roles/permissions", payload);
  await loadRolePermissions();
  toast("Permission assigned", "ok");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function bind() {
  document.querySelectorAll(".nav__item").forEach((btn) => {
    btn.addEventListener("click", () => showSection(btn.dataset.section));
  });
  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => showSection(btn.dataset.open));
  });

  el("openConn")?.addEventListener("click", () => openOverlay("connection"));
  el("openCmdk")?.addEventListener("click", () => openOverlay("cmdk"));
  el("topSearch")?.addEventListener("click", () => openOverlay("cmdk"));

  const overlay = el("overlay");
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });
  overlay?.querySelectorAll("[data-close]")?.forEach((b) => b.addEventListener("click", closeOverlay));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openOverlay("cmdk");
    }
  });
  el("cmdkInput")?.addEventListener("input", renderCmdk);

  el("saveConn")?.addEventListener("click", () => {
    storage.set("apiBase", el("apiBase").value.trim());
    storage.set("companyId", el("companyId").value.trim());
    setConnBadge("Saved", "ok");
    toast("Connection saved", "ok");
    loadMetrics();
  });
  el("testConn")?.addEventListener("click", testConnection);

  el("addRate")?.addEventListener("click", addRate);
  el("addTax")?.addEventListener("click", addTax);
  el("loadPaymentMethods")?.addEventListener("click", loadPaymentMethods);
  el("savePaymentMethod")?.addEventListener("click", savePaymentMethod);
  el("registerDevice")?.addEventListener("click", registerDevice);
  el("resetDeviceToken")?.addEventListener("click", resetDeviceToken);
  el("loadDevices")?.addEventListener("click", loadDevices);

  el("addItem")?.addEventListener("click", addItem);
  el("loadItems")?.addEventListener("click", loadItems);
  el("addPrice")?.addEventListener("click", addPrice);

  el("addCustomer")?.addEventListener("click", addCustomer);
  el("loadCustomers")?.addEventListener("click", loadCustomers);

  el("addSupplier")?.addEventListener("click", addSupplier);
  el("loadSuppliers")?.addEventListener("click", loadSuppliers);
  el("mapSupplierItem")?.addEventListener("click", mapSupplierItem);

  el("loadStock")?.addEventListener("click", loadStock);
  el("adjustStock")?.addEventListener("click", adjustStock);

  el("loadSales")?.addEventListener("click", loadSales);
  el("loadReturns")?.addEventListener("click", loadReturns);
  el("postPayment")?.addEventListener("click", postPayment);

  el("loadOrders")?.addEventListener("click", loadOrders);
  el("loadReceipts")?.addEventListener("click", loadReceipts);
  el("loadSupplierInvoices")?.addEventListener("click", loadSupplierInvoices);
  el("createPO")?.addEventListener("click", createPO);

  el("issueIntercompany")?.addEventListener("click", issueIntercompany);
  el("settleIntercompany")?.addEventListener("click", settleIntercompany);

  el("loadTrial")?.addEventListener("click", loadTrial);
  el("loadDefaults")?.addEventListener("click", loadDefaults);
  el("saveDefaults")?.addEventListener("click", saveDefaults);

  el("loadVat")?.addEventListener("click", loadVat);
  el("loadGL")?.addEventListener("click", loadGL);
  el("loadInv")?.addEventListener("click", loadInventoryValuation);

  el("loadAI")?.addEventListener("click", loadAI);
  el("saveAI")?.addEventListener("click", saveAISettings);
  el("loadAISettings")?.addEventListener("click", loadAISettings);

  el("loadTemplates")?.addEventListener("click", loadTemplates);
  el("cloneTemplate")?.addEventListener("click", cloneTemplate);
  el("loadAccounts")?.addEventListener("click", loadAccounts);
  el("updateAccount")?.addEventListener("click", updateAccount);
  el("createMapping")?.addEventListener("click", createMapping);
  el("loadMappings")?.addEventListener("click", loadMappings);

  el("loadUsers")?.addEventListener("click", loadUsers);
  el("createUser")?.addEventListener("click", createUser);
  el("loadRoles")?.addEventListener("click", loadRoles);
  el("createRole")?.addEventListener("click", createRole);
  el("assignRole")?.addEventListener("click", assignRole);
  el("loadPermissions")?.addEventListener("click", loadPermissions);
  el("assignPermission")?.addEventListener("click", assignPermission);
  el("loadRolePermissions")?.addEventListener("click", loadRolePermissions);

  el("login")?.addEventListener("click", login);
  el("logout")?.addEventListener("click", logout);
  el("setCompany")?.addEventListener("click", setCompanyFromSession);

  // Sidebar collapse (simple CSS swap).
  el("toggleSidebar")?.addEventListener("click", () => {
    const sidebar = el("sidebar");
    if (!sidebar) return;
    sidebar.classList.toggle("sidebar--collapsed");
  });
}

function init() {
  loadConnection();
  bind();
  showSection("dashboard");
  setStatus("Ready");
  // Best-effort: pick the right local API port, then check health and load metrics.
  autoDetectApiBase().finally(() => {
    testConnection();
    loadMetrics();
  });
}

init();
