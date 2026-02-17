<script>
  import { onMount, tick } from "svelte";
  import Shell from "./components/Shell.svelte";
  import ProductGrid from "./components/ProductGrid.svelte";
  import Cart from "./components/Cart.svelte";
  import CustomerSelect from "./components/CustomerSelect.svelte";
  import PaymentModal from "./components/PaymentModal.svelte";
  import SaleSummary from "./components/SaleSummary.svelte";
  import ItemLookup from "./components/ItemLookup.svelte";
  import SettingsScreen from "./components/SettingsScreen.svelte";
  import {
    cartCompaniesSet as cartCompaniesSetFromLines,
    effectiveInvoiceCompany as effectiveInvoiceCompanyFor,
    findMissingCompanyItems as findMissingCompanyItemsForCompany,
    pickCompanyForAmbiguousMatch,
    primaryCompanyFromCart as primaryCompanyFromLines,
  } from "./lib/unified-sale-flow.js";

  const API_BASE_STORAGE_KEY = "pos_ui_api_base";
  const SESSION_STORAGE_KEY = "pos_ui_session_token";
  const OTHER_AGENT_URL_STORAGE_KEY = "pos_ui_other_agent_url";
  const UNOFFICIAL_SESSION_STORAGE_KEY = "pos_ui_session_token_unofficial";
  const INVOICE_MODE_STORAGE_KEY = "pos_ui_invoice_company_mode";
  const FLAG_OFFICIAL_STORAGE_KEY = "pos_ui_flag_official";
  const THEME_STORAGE_KEY = "pos_ui_theme";
  const SCREEN_STORAGE_KEY = "pos_ui_screen";
  const DEFAULT_API_BASE = "/api";
  const DEFAULT_OTHER_AGENT_URL = "http://localhost:7072";

  // These are seeded in backend/db/seeds/seed_companies.sql and used in sample POS configs.
  const OFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";
  const UNOFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000002";

  // Utility functions
  const toNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  
  const toRate = (value) => toNum(value, 0);

  const normalizeApiBase = (value) => {
    let v = (value || "").trim();
    if (!v) return DEFAULT_API_BASE;
    if (v.startsWith("http://") || v.startsWith("https://")) {
      return v.endsWith("/") ? v.slice(0, -1) : v;
    }
    return v.startsWith("/") ? (v.endsWith("/") ? v.slice(0, -1) : v) : `/${v}`;
  };

  const makeIntentId = () => {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch (_) {}
    return `${Date.now()}-${Math.random().toString(16).slice(2, 12)}`;
  };

  // State
  let apiBase = normalizeApiBase(DEFAULT_API_BASE);
  let sessionToken = "";
  let otherAgentUrl = DEFAULT_OTHER_AGENT_URL;
  let unofficialSessionToken = "";
  let showOtherAgentModal = false;
  let otherAgentDraftUrl = "";
  
  let status = "Booting...";
  let unofficialStatus = "Pending";
  let unofficialLocked = false;
  let loading = false;
  let notice = "";
  let error = "";
  let pendingCheckoutMethod = "";
  let checkoutIntentId = "";
  let bgSyncWarnAt = 0;
  let bgSyncPushInFlight = { official: false, unofficial: false };
  let fetchDataPending = false;
  let fetchDataPendingBackground = true;
  let fetchDataDrainPromise = null;

  // Unified: map "official/unofficial" keys onto (origin agent) + (other agent).
  // If the UI is loaded from the Unofficial agent, we flip routing automatically.
  let originCompanyKey = "official";
  let otherCompanyKey = "unofficial";
  
  let config = {
    company_id: "",
    cashier_id: "",
    pricing_currency: "USD",
    exchange_rate: 0,
    vat_rate: 0,
    tax_code_id: null,
    print_base_url: "",
    receipt_printer: "",
    receipt_print_copies: 1,
    auto_print_receipt: false,
    invoice_printer: "",
    invoice_print_copies: 1,
    auto_print_invoice: false,
    require_manager_approval_credit: false,
    require_manager_approval_returns: false,
    require_manager_approval_cross_company: false,
    outbox_stale_warn_minutes: 5,
  };
  let edge = null;
  let unofficialEdge = null;
  
  let items = [];
  let barcodes = [];
  let barcodesByItemIdOrigin = new Map();
  let customers = [];
  let cashiers = [];
  let outbox = [];
  let lastReceipt = null;
  let promotions = [];

  let unofficialConfig = {
    company_id: "",
    cashier_id: "",
    pricing_currency: "USD",
    exchange_rate: 0,
    vat_rate: 0,
    tax_code_id: null,
    print_base_url: "",
    receipt_printer: "",
    receipt_print_copies: 1,
    auto_print_receipt: false,
    invoice_printer: "",
    invoice_print_copies: 1,
    auto_print_invoice: false,
    require_manager_approval_credit: false,
    require_manager_approval_returns: false,
    require_manager_approval_cross_company: false,
    outbox_stale_warn_minutes: 5,
  };
  let unofficialItems = [];
  let unofficialBarcodes = [];
  let barcodesByItemIdOther = new Map();
  let unofficialCustomers = [];
  let unofficialCashiers = [];
  let unofficialOutbox = [];
  let unofficialLastReceipt = null;
  let unofficialPromotions = [];

  // Search & Cart State
  let scanTerm = "";
  let cart = [];
  let activeCustomer = null;

  // Unified invoice routing
  let invoiceCompanyMode = "auto"; // "auto" | "official" | "unofficial"
  let flagOfficial = false;

  // Layout
  let catalogCollapsed = true;
  
  // Customer Select State
  let customerSearch = "";
  let customerResults = [];
  let customerSearching = false;
  let addCustomerMode = false;
  let customerDraft = { name: "", phone: "", email: "" };
  let _customerSearchSeq = 0;
  let _customerRemoteTimer = null;
  const CUSTOMER_REMOTE_SEARCH_DEBOUNCE_MS = 180;

  // Theme
  let theme = "dark"; // "dark" | "light"

  // Screens
  let activeScreen = "pos"; // "pos" | "items" | "settings"
  let itemLookupQuery = "";
  let itemLookupAutoPick = 0;
  
  // Checkout State
  let showPaymentModal = false;
  let saleMode = "sale"; // "sale" | "return"

  // Admin unlock (POS agent can require a local admin PIN when LAN-exposed)
  let showAdminPinModal = false;
  let adminPin = "";
  let adminPinMode = "unlock"; // "unlock" | "set"
  let adminPinEl = null;

  // Printing settings
  let showPrintingModal = false;
  let printersOfficial = [];
  let printersUnofficial = [];
  let printingStatus = "";
  let printingError = "";
  // Official: A4 invoice PDF
  let printOfficial = { printer: "", copies: 1, auto: false, baseUrl: "" };
  let printUnofficial = { printer: "", copies: 1, auto: false };

  // Cashier
  let showCashierModal = false;
  let cashierPin = "";
  let cashierPinEl = null;

  // Shift
  let showShiftModal = false;
  let shift = null;
  let openingCashUsd = 0;
  let openingCashLbp = 0;
  let closingCashUsd = 0;
  let closingCashLbp = 0;

  // Derived
  $: activeCashier = cashiers.find((c) => c.id === config.cashier_id);
  $: cashierName = activeCashier ? activeCashier.name : (config.cashier_id ? "Unknown" : "Not Signed In");
  const _isoAgeMinutes = (iso) => {
    const t = Date.parse(String(iso || ""));
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, (Date.now() - t) / 60000);
  };
  $: outboxOldestMinutes = (() => {
    let maxMin = 0;
    for (const ev of ([]).concat(outbox || [], unofficialOutbox || [])) {
      maxMin = Math.max(maxMin, _isoAgeMinutes(ev?.created_at));
    }
    return maxMin;
  })();
  $: outboxWarnMinutes = Math.max(1, toNum(config?.outbox_stale_warn_minutes, 5) || 5);
  $: syncBadge = (() => {
    const o = (outbox || []).length;
    const u = (unofficialOutbox || []).length;
    const queued = o + u;
    if (status !== "Ready") return `Offline · queued ${queued}`;
    if (queued > 0 && outboxOldestMinutes >= outboxWarnMinutes) {
      return `Stale · queued ${queued} · oldest ${Math.round(outboxOldestMinutes)}m`;
    }
    if (queued > 0) return `Syncing · queued ${queued}`;
    return "Synced";
  })();
  $: hasConnection = status === "Ready";

  $: originCompanyKey = (config.company_id === UNOFFICIAL_COMPANY_ID) ? "unofficial" : "official";
  $: otherCompanyKey = originCompanyKey === "official" ? "unofficial" : "official";
  
  $: currencyPrimary = (config.pricing_currency || "USD").toUpperCase();
  $: shiftText = config.shift_id ? "Shift: Open" : "Shift: Closed";
  $: checkoutTotal = currencyPrimary === "LBP" ? (totals.totalLbp || 0) : (totals.totalUsd || 0);
  
  $: cartSubtotals = (() => {
    let subtotalUsd = 0;
    let subtotalLbpRaw = 0;
    let officialSubtotalUsd = 0;
    let unofficialSubtotalUsd = 0;
    for (const ln of cart || []) {
      const qty = toNum(ln?.qty, 0);
      const extUsd = toNum(ln?.price_usd, 0) * qty;
      const extLbp = toNum(ln?.price_lbp, 0) * qty;
      subtotalUsd += extUsd;
      subtotalLbpRaw += extLbp;
      if (ln?.companyKey === "unofficial") unofficialSubtotalUsd += extUsd;
      else officialSubtotalUsd += extUsd;
    }
    return { subtotalUsd, subtotalLbpRaw, officialSubtotalUsd, unofficialSubtotalUsd };
  })();

  // Totals Calculation
  $: totals = (() => {
    const rate = toRate(config.exchange_rate);
    const vatRate = toRate(config.vat_rate);
    const subtotalUsd = toNum(cartSubtotals?.subtotalUsd, 0);
    const subtotalLbpRaw = toNum(cartSubtotals?.subtotalLbpRaw, 0);
    const subtotalLbp = subtotalLbpRaw === 0 && rate > 0 ? subtotalUsd * rate : subtotalLbpRaw;
    const taxUsd = subtotalUsd * vatRate;
    const taxLbp = subtotalLbp * vatRate;
    return {
      subtotalUsd,
      subtotalLbp,
      taxUsd,
      taxLbp,
      totalUsd: subtotalUsd + taxUsd,
      totalLbp: subtotalLbp + taxLbp,
      vatRate
    };
  })();

  $: totalsByCompany = (() => {
    const cfgOff = (otherCompanyKey === "official") ? unofficialConfig : config;
    const cfgUn = (otherCompanyKey === "unofficial") ? unofficialConfig : config;
    const vOff = toRate(cfgOff.vat_rate);
    const vUn = toRate(cfgUn.vat_rate);
    const offSub = toNum(cartSubtotals?.officialSubtotalUsd, 0);
    const unSub = toNum(cartSubtotals?.unofficialSubtotalUsd, 0);
    return {
      official: { subtotalUsd: offSub, taxUsd: offSub * vOff, totalUsd: offSub + (offSub * vOff) },
      unofficial: { subtotalUsd: unSub, taxUsd: unSub * vUn, totalUsd: unSub + (unSub * vUn) },
    };
  })();

  const _itemHay = (e) => `${e?.sku || ""} ${e?.name || ""} ${e?.barcode || ""}`.toLowerCase();

  const _buildBarcodeIndex = (list) => {
    const m = new Map();
    for (const b of list || []) {
      const key = (b?.barcode || "").trim();
      if (!key) continue;
      if (!m.has(key)) m.set(key, b);
    }
    return m;
  };

  const _buildItemsById = (list) => {
    const m = new Map();
    for (const it of list || []) {
      if (it?.id) m.set(String(it.id), it);
    }
    return m;
  };

  const _buildItemsBySku = (list) => {
    const m = new Map();
    for (const it of list || []) {
      const sku = String(it?.sku || "").trim().toLowerCase();
      if (!sku) continue;
      if (!m.has(sku)) m.set(sku, it);
    }
    return m;
  };

  $: barcodeIndexOrigin = _buildBarcodeIndex(barcodes);
  $: barcodeIndexOther = _buildBarcodeIndex(unofficialBarcodes);
  $: itemsByIdOrigin = _buildItemsById(items);
  $: itemsByIdOther = _buildItemsById(unofficialItems);
  $: itemsBySkuOrigin = _buildItemsBySku(items);
  $: itemsBySkuOther = _buildItemsBySku(unofficialItems);

  const _buildBarcodesByItemId = (list) => {
    const m = new Map();
    for (const b of list || []) {
      const itemId = b?.item_id;
      if (!itemId) continue;
      const k = String(itemId);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(b);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => (toNum(b?.is_primary, 0) - toNum(a?.is_primary, 0)));
      m.set(k, arr);
    }
    return m;
  };

  $: barcodesByItemIdOrigin = _buildBarcodesByItemId(barcodes);
  $: barcodesByItemIdOther = _buildBarcodesByItemId(unofficialBarcodes);

  const _buildUomOptionsByItemId = (itemsList, barcodesByItemId) => {
    const out = new Map();
    for (const item of itemsList || []) {
      const itemId = String(item?.id || "").trim();
      if (!itemId) continue;

      const baseUom = String(item?.unit_of_measure || "pcs") || "pcs";
      const rows = barcodesByItemId?.get(itemId) || [];
      const opts = [];
      const seen = new Set();

      const pushOpt = (uom, qty_factor, label, is_primary = false) => {
        const u = String(uom || "").trim() || baseUom;
        const f = toNum(qty_factor, 1) || 1;
        const key = `${u}|${f}`;
        if (seen.has(key)) return;
        seen.add(key);
        opts.push({
          uom: u,
          qty_factor: f,
          label: String(label || "").trim() || (f !== 1 ? `${u} x${f}` : u),
          is_primary: !!is_primary,
        });
      };

      pushOpt(baseUom, 1, baseUom, true);
      for (const b of rows) {
        const u = b?.uom_code || baseUom;
        const f = toNum(b?.qty_factor, 1) || 1;
        if (String(u).trim() === String(baseUom).trim() && f === 1) continue;
        pushOpt(u, f, b?.label || "", !!b?.is_primary);
      }
      opts.sort((a, b) => {
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        return toNum(a.qty_factor, 1) - toNum(b.qty_factor, 1);
      });
      out.set(itemId, opts);
    }
    return out;
  };

  $: uomOptionsByItemIdOrigin = _buildUomOptionsByItemId(items, barcodesByItemIdOrigin);
  $: uomOptionsByItemIdOther = _buildUomOptionsByItemId(unofficialItems, barcodesByItemIdOther);

  $: itemsOriginTagged = (items || []).map((i) => ({ ...i, companyKey: originCompanyKey, _hay: _itemHay(i) }));
  $: itemsOtherTagged = (unofficialItems || []).map((i) => ({ ...i, companyKey: otherCompanyKey, _hay: _itemHay(i) }));
  $: allItemsTagged = ([]).concat(itemsOriginTagged || [], itemsOtherTagged || []);

  const uomOptionsFor = (item) => {
    const companyKey = item?.companyKey || "official";
    const itemId = String(item?.id || "").trim();
    const baseUom = String(item?.unit_of_measure || "pcs") || "pcs";
    if (!itemId) return [{ uom: baseUom, qty_factor: 1, label: baseUom, is_primary: true }];
    const map = companyKey === otherCompanyKey ? uomOptionsByItemIdOther : uomOptionsByItemIdOrigin;
    const opts = map?.get(itemId);
    if (Array.isArray(opts) && opts.length > 0) return opts;
    return [{ uom: baseUom, qty_factor: 1, label: baseUom, is_primary: true }];
  };

  $: scanSuggestions = (() => {
    const q = scanTerm.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    const pushMatches = (list) => {
      for (const e of list || []) {
        if (!e) continue;
        const hay = String(e?._hay || _itemHay(e));
        if (hay.includes(q)) out.push(e);
        if (out.length >= 24) break;
      }
    };
    pushMatches(itemsOriginTagged);
    pushMatches(itemsOtherTagged);
    return out.slice(0, 24);
  })();

  $: allItems = ([]).concat(items || [], unofficialItems || []);

  const companyLabel = (obj) => {
    const k = obj?.companyKey;
    if (k === "official") return "Official";
    if (k === "unofficial") return "Unofficial";
    return "";
  };

  const companyTone = (obj) => {
    const k = obj?.companyKey;
    if (k === "official" || k === "unofficial") return k;
    return "";
  };

  // API Client
  const _normalizeAgentOrigin = (value) => {
    let v = String(value || "").trim();
    if (!v) return "";
    if (v.endsWith("/")) v = v.slice(0, -1);
    return v;
  };

  const _agentApiPrefix = (companyKey) => {
    if (companyKey === otherCompanyKey) return `${_normalizeAgentOrigin(otherAgentUrl)}${apiBase}`;
    return apiBase;
  };

  const _agentReceiptUrl = (companyKey) => {
    if (companyKey === otherCompanyKey) return `${_normalizeAgentOrigin(otherAgentUrl)}/receipt/last`;
    return "/receipt/last";
  };

  const requestHeaders = (companyKey = "official") => {
    const h = { "Content-Type": "application/json" };
    const tok = companyKey === otherCompanyKey ? unofficialSessionToken : sessionToken;
    if (tok) h["X-POS-Session"] = tok;
    return h;
  };

  const apiCallFor = async (companyKey, path, options = {}) => {
    const prefix = _agentApiPrefix(companyKey);
    const url = `${prefix}${path.startsWith("/") ? path : "/" + path}`;
    const timeoutMs = Math.max(
      1000,
      toNum(options?.timeoutMs, companyKey === otherCompanyKey ? 7000 : 9000),
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res = null;
    try {
      res = await fetch(url, {
        method: options.method || "GET",
        headers: requestHeaders(companyKey),
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      if (e?.name === "AbortError") {
        const err = new Error(`Request timed out after ${timeoutMs}ms`);
        err.status = 408;
        err.payload = { error: "timeout", timeout_ms: timeoutMs };
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { raw: text };
    }
    
    if (!res.ok) {
      const err = new Error(data?.error || res.statusText);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  };

  const cfgForCompanyKey = (companyKey) => (companyKey === otherCompanyKey ? unofficialConfig : config);

  const printAfterSale = async (companyKey, eventId = "", receiptWin = null) => {
    const cfg = cfgForCompanyKey(companyKey) || {};
    const eid = String(eventId || "").trim();

    if (companyKey === "official") {
      const auto = !!cfg.auto_print_invoice;
      if (auto && eid) {
        try {
          await apiCallFor(companyKey, "/invoices/print-by-event", { method: "POST", body: { event_id: eid } });
          try { if (receiptWin) receiptWin.close(); } catch (_) {}
          return;
        } catch (_) {
          // Fall back to opening the PDF if direct printing fails.
        }
      }
      if (eid) {
        try {
          const resolved = await apiCallFor(companyKey, "/invoices/resolve-by-event", { method: "POST", body: { event_id: eid } });
          const invId = String(resolved?.invoice_id || "").trim();
          const pb = String(cfg.print_base_url || "").trim().replace(/\/+$/, "");
          if (invId && pb) {
            const u = `${pb}/exports/sales-invoices/${encodeURIComponent(invId)}/pdf?inline=1`;
            if (receiptWin) receiptWin.location = u;
            else window.open(u, "_blank", "noopener,noreferrer");
            return;
          }
        } catch (_) {}
      }
      try { if (receiptWin) receiptWin.close(); } catch (_) {}
      return;
    }

    // Unofficial: thermal receipt.
    const auto = !!cfg.auto_print_receipt;
    if (auto) {
      try {
        await apiCallFor(companyKey, "/receipts/print-last", { method: "POST", body: {} });
        try { if (receiptWin) receiptWin.close(); } catch (_) {}
        return;
      } catch (_) {
        // Fall back to the printable HTML view if direct printing isn't available.
      }
    }
    try {
      if (receiptWin) receiptWin.location = _agentReceiptUrl(companyKey);
      else window.open(_agentReceiptUrl(companyKey), "_blank", "noopener,noreferrer");
    } catch (_) {}
  };

  // Wrapper for the agent serving this UI (origin).
  const apiCall = (path, options = {}) => apiCallFor(originCompanyKey, path, options);

  // Actions
  const reportNotice = (msg) => { notice = msg; setTimeout(() => notice = "", 3000); };
  const reportError = (msg) => { alert(msg); error = msg; }; // Simple alert for now, can be improved

  const queueSyncPush = (companyKey) => {
    const key = companyKey === "unofficial" ? "unofficial" : "official";
    if (bgSyncPushInFlight[key]) return;
    bgSyncPushInFlight = { ...bgSyncPushInFlight, [key]: true };
    // Never block cashier flow on cloud latency. Push in background best-effort.
    Promise.resolve()
      .then(() => apiCallFor(companyKey, "/sync/push", { method: "POST", body: {} }))
      .catch(() => {
        const now = Date.now();
        if (now - bgSyncWarnAt < 15000) return;
        bgSyncWarnAt = now;
        const msg = "Saved locally. Cloud sync is retrying in background.";
        notice = msg;
        setTimeout(() => {
          if (notice === msg) notice = "";
        }, 4000);
      })
      .finally(() => {
        bgSyncPushInFlight = { ...bgSyncPushInFlight, [key]: false };
      });
  };

  const setSessionToken = (companyKey, token) => {
    const t = (token || "").trim();
    if (companyKey === otherCompanyKey) {
      unofficialSessionToken = t;
      if (t) localStorage.setItem(UNOFFICIAL_SESSION_STORAGE_KEY, t);
      else localStorage.removeItem(UNOFFICIAL_SESSION_STORAGE_KEY);
      return;
    }
    sessionToken = t;
    if (t) localStorage.setItem(SESSION_STORAGE_KEY, t);
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  };

  // Mock Data
  const MOCK_ITEMS = Array.from({ length: 12 }).map((_, i) => ({
    id: `item-${i}`,
    sku: `SKU-${1000 + i}`,
    name: `Premium Product ${i + 1}`,
    price_usd: (5 + i * 2.5).toFixed(2),
    price_lbp: ((5 + i * 2.5) * 89500).toFixed(0),
    unit_of_measure: "pcs"
  }));

  const MOCK_Customers = [
    { id: "c1", name: "John Doe", phone: "555-0123" },
    { id: "c2", name: "Jane Smith", phone: "555-9876" }
  ];

  const openAdminPinModal = async () => {
    showAdminPinModal = true;
    await tick();
    try { adminPinEl?.focus(); } catch (_) {}
  };

  const openCashierModal = async () => {
    showCashierModal = true;
    await tick();
    try { cashierPinEl?.focus(); } catch (_) {}
  };

  const runFetchData = async ({ background = false } = {}) => {
    const showBusy = !background;
    try {
      if (showBusy) loading = true;
      const results = await Promise.allSettled([
        apiCall("/config"),
        apiCall("/items"),
        apiCall("/barcodes"),
        apiCall("/customers"),
        apiCall("/cashiers"),
        apiCall("/outbox"),
        apiCall("/edge/status"),
        apiCall("/receipts/last"),
        apiCall("/promotions"),
      ]);

      const cfgRes = results[0];
      if (cfgRes.status === "rejected") {
        const p = cfgRes.reason?.payload;
        if (p?.error === "pos_auth_required") {
          status = "Locked";
          // If the agent is protected and the PIN isn't set yet, the API returns a hint.
          adminPinMode = (p?.hint && String(p.hint).includes("admin PIN")) ? "set" : "unlock";
          openAdminPinModal();
          return;
        }
        throw cfgRes.reason;
      }

      const cfg = cfgRes.value || {};
      config = { ...config, ...cfg };

      const setIfOk = (idx, setter, fallback) => {
        const r = results[idx];
        if (r.status === "fulfilled") setter(r.value);
        else if (fallback !== undefined) setter(fallback);
      };

      setIfOk(1, (v) => (items = v.items || []));
      setIfOk(2, (v) => (barcodes = v.barcodes || []), []);
      setIfOk(3, (v) => (customers = v.customers || []), []);
      setIfOk(4, (v) => (cashiers = v.cashiers || []), []);
      setIfOk(5, (v) => (outbox = v.outbox || []), []);
      setIfOk(6, (v) => (edge = v), null);
      setIfOk(7, (v) => (lastReceipt = v?.receipt?.receipt || v?.receipt || null), null);
      setIfOk(8, (v) => (promotions = v.promotions || []), []);

      status = "Ready";

      // Unofficial agent (best-effort; the UI still works as single-company if unreachable)
      try {
        const uOrigin = _normalizeAgentOrigin(otherAgentUrl);
        if (!uOrigin) {
          unofficialStatus = "Disabled";
          unofficialLocked = false;
          unofficialItems = [];
          unofficialBarcodes = [];
          unofficialCustomers = [];
          unofficialCashiers = [];
          unofficialOutbox = [];
          unofficialEdge = null;
          unofficialLastReceipt = null;
        } else {
          const uResults = await Promise.allSettled([
            apiCallFor(otherCompanyKey, "/config"),
            apiCallFor(otherCompanyKey, "/items"),
            apiCallFor(otherCompanyKey, "/barcodes"),
            apiCallFor(otherCompanyKey, "/customers"),
            apiCallFor(otherCompanyKey, "/cashiers"),
            apiCallFor(otherCompanyKey, "/outbox"),
            apiCallFor(otherCompanyKey, "/edge/status"),
            apiCallFor(otherCompanyKey, "/receipts/last"),
            apiCallFor(otherCompanyKey, "/promotions"),
          ]);

          const uCfgRes = uResults[0];
          if (uCfgRes.status === "fulfilled") {
            unofficialConfig = { ...unofficialConfig, ...(uCfgRes.value || {}) };
            unofficialLocked = false;
            const setIfOkU = (idx, setter, fallback) => {
              const r = uResults[idx];
              if (r.status === "fulfilled") setter(r.value);
              else if (fallback !== undefined) setter(fallback);
            };
            setIfOkU(1, (v) => (unofficialItems = v.items || []), []);
            setIfOkU(2, (v) => (unofficialBarcodes = v.barcodes || []), []);
            setIfOkU(3, (v) => (unofficialCustomers = v.customers || []), []);
            setIfOkU(4, (v) => (unofficialCashiers = v.cashiers || []), []);
            setIfOkU(5, (v) => (unofficialOutbox = v.outbox || []), []);
            setIfOkU(6, (v) => (unofficialEdge = v), null);
            setIfOkU(7, (v) => (unofficialLastReceipt = v?.receipt?.receipt || v?.receipt || null), null);
            setIfOkU(8, (v) => (unofficialPromotions = v.promotions || []), []);
            unofficialStatus = "Ready";
          } else {
            const p = uCfgRes.reason?.payload;
            if (p?.error === "pos_auth_required") {
              unofficialStatus = "Locked";
              unofficialLocked = true;
              if (!showAdminPinModal) {
                adminPinMode = "unlock";
                openAdminPinModal();
              }
            } else {
              unofficialStatus = "Offline";
              unofficialLocked = false;
            }
          }
        }
      } catch (_) {
        unofficialStatus = "Offline";
        unofficialLocked = false;
      }

      // Promotions can affect cart pricing (min qty tiers). Reprice after refresh.
      try { cart = (cart || []).map((ln) => applyPromotionToLine(ln)); } catch (_) {}
    } catch(e) {
      console.warn("API Error", e);
      error = e?.message || String(e);
      status = "Offline";
      // If we don't have any real data loaded yet, keep a minimal demo catalog
      // so the UI isn't blank (useful during design/dev).
      if (!items || items.length === 0) items = MOCK_ITEMS;
      if (!customers || customers.length === 0) customers = MOCK_Customers;
      if (!unofficialItems || unofficialItems.length === 0) unofficialItems = [];
    } finally {
      if (showBusy) loading = false;
    }
  };

  const fetchData = async ({ background = false } = {}) => {
    fetchDataPending = true;
    fetchDataPendingBackground = fetchDataPendingBackground && !!background;

    if (fetchDataDrainPromise) {
      return fetchDataDrainPromise;
    }

    fetchDataDrainPromise = (async () => {
      while (fetchDataPending) {
        const nextBackground = fetchDataPendingBackground;
        fetchDataPending = false;
        fetchDataPendingBackground = true;
        await runFetchData({ background: nextBackground });
      }
    })();

    try {
      await fetchDataDrainPromise;
    } finally {
      fetchDataDrainPromise = null;
    }
  };

  // Cart Logic
  let _promoTodayYmd = "";
  let _promoTodayTickAt = 0;
  const promoNowYmd = () => {
    const now = Date.now();
    if (!_promoTodayYmd || (now - _promoTodayTickAt) > 60000) {
      _promoTodayTickAt = now;
      _promoTodayYmd = new Date(now).toISOString().slice(0, 10);
    }
    return _promoTodayYmd;
  };

  const _promoIsActive = (promoRules) => {
    const r = promoRules || {};
    if (r.is_active === false) return false;
    const today = promoNowYmd();
    const s = String(r.starts_on || "").slice(0, 10);
    const e = String(r.ends_on || "").slice(0, 10);
    if (s && today < s) return false;
    if (e && today > e) return false;
    return true;
  };

  const _normDiscPct = (raw) => {
    let p = toNum(raw, 0);
    // Allow 0..100 as a convenience.
    if (p > 1 && p <= 100) p = p / 100;
    if (p < 0) p = 0;
    if (p > 1) p = 1;
    return p;
  };

  const _buildPromoCandidatesByItem = (list) => {
    const out = new Map();
    let rowIndex = 0;
    for (const p of list || []) {
      const rules = p?.rules || p?.rules_json || p?.rules || p;
      const r = rules && typeof rules === "object" ? rules : (p?.rules || {});
      const items = Array.isArray(r?.items) ? r.items : [];
      const promoKey = String(p?.id || r?.id || `promo-${rowIndex}`);
      const priority = toNum(r?.priority, toNum(p?.priority, 0));
      for (const it of items) {
        const itemId = String(it?.item_id || "").trim();
        if (!itemId) continue;
        if (!out.has(itemId)) out.set(itemId, []);
        out.get(itemId).push({
          promo: r,
          promoRow: p,
          promoItem: it,
          promoKey,
          minQty: toNum(it?.min_qty, 0),
          priority,
        });
      }
      rowIndex += 1;
    }
    return out;
  };

  $: promoCandidatesByItemOrigin = _buildPromoCandidatesByItem(promotions);
  $: promoCandidatesByItemOther = _buildPromoCandidatesByItem(unofficialPromotions);

  const _bestPromoForLine = (line) => {
    const companyKey = line?.companyKey || "official";
    const itemId = String(line?.id || "").trim();
    if (!itemId) return null;

    const qtyBase = Math.max(0, toNum(line?.qty_entered, 0) * toNum(line?.qty_factor, 1));
    if (qtyBase <= 0) return null;
    const promoMap = companyKey === otherCompanyKey ? promoCandidatesByItemOther : promoCandidatesByItemOrigin;
    const candidates = promoMap?.get(itemId) || [];
    if (!candidates.length) return null;

    const listUsd = toNum(line?.list_price_usd, toNum(line?.price_usd, 0));
    const listLbp = toNum(line?.list_price_lbp, toNum(line?.price_lbp, 0));
    const cfg = cfgForCompanyKey(companyKey) || {};
    const ex = toNum(cfg.exchange_rate, 0);

    const bestTierByPromo = new Map();
    for (const cand of candidates) {
      if (qtyBase < toNum(cand?.minQty, 0)) continue;
      const prev = bestTierByPromo.get(cand.promoKey);
      if (!prev || toNum(cand.minQty, 0) > toNum(prev.minQty, 0)) {
        bestTierByPromo.set(cand.promoKey, cand);
      }
    }
    if (bestTierByPromo.size === 0) return null;

    let best = null;
    let bestScore = -1;
    for (const cand of bestTierByPromo.values()) {
      const r = cand.promo;
      if (!_promoIsActive(r)) continue;
      const it = cand.promoItem;

      const promoUsd = toNum(it?.promo_price_usd, 0);
      const promoLbp = toNum(it?.promo_price_lbp, 0);
      const discPct = _normDiscPct(it?.discount_pct);

      let unitUsd = listUsd;
      let unitLbp = listLbp;
      if (promoUsd > 0 || promoLbp > 0) {
        if (promoUsd > 0) unitUsd = promoUsd;
        if (promoLbp > 0) unitLbp = promoLbp;
        if (promoUsd > 0 && promoLbp <= 0 && ex > 0) unitLbp = promoUsd * ex;
        if (promoLbp > 0 && promoUsd <= 0 && ex > 0) unitUsd = promoLbp / ex;
      } else if (discPct > 0) {
        if (listUsd > 0) unitUsd = listUsd * (1 - discPct);
        if (listLbp > 0) unitLbp = listLbp * (1 - discPct);
        if (listUsd > 0 && listLbp <= 0 && ex > 0) unitLbp = unitUsd * ex;
        if (listLbp > 0 && listUsd <= 0 && ex > 0) unitUsd = unitLbp / ex;
      } else {
        continue;
      }

      // Score by discount pct when possible; tie-break by promo priority.
      let pctScore = 0;
      if (listUsd > 0 && unitUsd > 0) pctScore = Math.max(0, (listUsd - unitUsd) / listUsd);
      else if (listLbp > 0 && unitLbp > 0) pctScore = Math.max(0, (listLbp - unitLbp) / listLbp);
      const score = pctScore * 1000 + toNum(cand?.priority, 0);
      if (score > bestScore) {
        bestScore = score;
        best = { promo: r, promoRow: cand.promoRow, promoItem: it, unitUsd, unitLbp, pctScore };
      }
    }
    return best;
  };

  const applyPromotionToLine = (line) => {
    const ln = { ...(line || {}) };
    const listUsd = toNum(ln.list_price_usd, toNum(ln.price_usd, 0));
    const listLbp = toNum(ln.list_price_lbp, toNum(ln.price_lbp, 0));
    ln.list_price_usd = listUsd;
    ln.list_price_lbp = listLbp;

    const best = _bestPromoForLine(ln);
    if (!best) {
      // Clear promo metadata and revert unit prices to list.
      ln.price_usd = listUsd;
      ln.price_lbp = listLbp;
      ln.pre_discount_unit_price_usd = 0;
      ln.pre_discount_unit_price_lbp = 0;
      ln.discount_pct = 0;
      ln.discount_amount_usd = 0;
      ln.discount_amount_lbp = 0;
      ln.applied_promotion_id = null;
      ln.applied_promotion_item_id = null;
      return ln;
    }

    ln.price_usd = toNum(best.unitUsd, listUsd);
    ln.price_lbp = toNum(best.unitLbp, listLbp);
    ln.pre_discount_unit_price_usd = listUsd;
    ln.pre_discount_unit_price_lbp = listLbp;
    ln.discount_pct = toNum(best.pctScore, 0);
    ln.discount_amount_usd = 0;
    ln.discount_amount_lbp = 0;
    ln.applied_promotion_id = String(best.promo?.id || best.promoRow?.id || "") || null;
    ln.applied_promotion_item_id = String(best.promoItem?.id || "") || null;
    return ln;
  };

  const _cartLineKey = (companyKey, itemId, qtyFactor, uom) => {
    const k = companyKey === "unofficial" ? "unofficial" : "official";
    const factor = toNum(qtyFactor, 1) || 1;
    const u = String(uom || "").trim();
    return `${k}|${String(itemId || "")}|${String(factor)}|${u}`;
  };

  $: cartLineIndexByKey = (() => {
    const m = new Map();
    for (let i = 0; i < (cart || []).length; i += 1) {
      const ln = cart[i];
      m.set(_cartLineKey(ln?.companyKey, ln?.id, ln?.qty_factor, ln?.uom || ln?.unit_of_measure), i);
    }
    return m;
  })();

  const buildLine = (item, qtyEntered = 1, extra = {}) => {
    const companyKey = extra.companyKey || item.companyKey || "official";
    const qtyFactor = toNum(extra.qty_factor, 1) || 1;
    const qtyBase = toNum(qtyEntered, 0) * qtyFactor;
    const uom = extra.uom || extra.uom_code || item.unit_of_measure || "pcs";
    const lineKey = _cartLineKey(companyKey, item.id, qtyFactor, uom);
    const ln = {
      key: lineKey,
      companyKey,
      id: item.id,
      sku: item.sku,
      name: item.name,
      unit_of_measure: item.unit_of_measure || "pcs",
      // list_* are stable; price_* may be discounted by promos.
      list_price_usd: toNum(item.price_usd),
      list_price_lbp: toNum(item.price_lbp),
      price_usd: toNum(item.price_usd),
      price_lbp: toNum(item.price_lbp),
      qty_factor: qtyFactor,
      qty_entered: toNum(qtyEntered, 0),
      qty: qtyBase,
      uom,
      tax_code_id: item.tax_code_id,
      batch_no: extra.batch_no || null,
      expiry_date: extra.expiry_date || null,
      pre_discount_unit_price_usd: 0,
      pre_discount_unit_price_lbp: 0,
      discount_pct: 0,
      discount_amount_usd: 0,
      discount_amount_lbp: 0,
      applied_promotion_id: null,
      applied_promotion_item_id: null,
    };
    return applyPromotionToLine(ln);
  };

  const addToCart = (item, extra = {}) => {
    const companyKey = extra.companyKey || item.companyKey || "official";
    const qtyFactor = toNum(extra.qty_factor, 1) || 1;
    const uom = extra.uom || extra.uom_code || item.unit_of_measure || "pcs";
    const qtyEntered = Math.max(1, toNum(extra.qty_entered, 1) || 1);
    const existingIdx = toNum(
      cartLineIndexByKey.get(_cartLineKey(companyKey, item.id, qtyFactor, uom)),
      -1,
    );
    if (existingIdx >= 0) {
      const copy = [...cart];
      copy[existingIdx].qty_entered = toNum(copy[existingIdx].qty_entered, 0) + qtyEntered;
      copy[existingIdx].qty = toNum(copy[existingIdx].qty_entered, 0) * qtyFactor;
      copy[existingIdx] = applyPromotionToLine(copy[existingIdx]);
      cart = copy;
    } else {
      cart = [buildLine(item, qtyEntered, { companyKey, qty_factor: qtyFactor, uom }), ...cart];
    }
    scanTerm = "";
    checkoutIntentId = "";
    reportNotice(`Added ${item.name}`);
    return true;
  };

  const cartCompaniesSet = (lines = cart) => cartCompaniesSetFromLines(lines);

  const primaryCompanyFromCart = (lines = cart) => primaryCompanyFromLines(lines);

  const effectiveInvoiceCompany = () => effectiveInvoiceCompanyFor({
    invoiceCompanyMode,
    originCompanyKey,
    cart,
  });

  const addByBarcode = (barcode) => {
    const code = (barcode || "").trim();
    if (!code) return false;

    const pick = (companyKey) => {
      const idx = companyKey === otherCompanyKey ? barcodeIndexOther : barcodeIndexOrigin;
      const b = idx?.get(code);
      if (!b) return null;
      const itemsById = companyKey === otherCompanyKey ? itemsByIdOther : itemsByIdOrigin;
      const item = itemsById?.get(String(b.item_id));
      if (!item) return null;
      return { b, item };
    };

    const mO = pick("official");
    const mU = pick("unofficial");
    if (!mO && !mU) return false;

    const companyKey = pickCompanyForAmbiguousMatch({
      invoiceCompanyMode,
      originCompanyKey,
      cart,
      availableCompanies: [mO ? "official" : null, mU ? "unofficial" : null],
    });

    const preferred = companyKey === "unofficial" ? mU : mO;
    const chosen = preferred || mO || mU;
    if (!chosen?.b || !chosen?.item) return false;
    const selectedCompanyKey = preferred ? companyKey : (chosen === mU ? "unofficial" : "official");

    const qtyFactor = toNum(chosen.b.qty_factor, 1) || 1;
    const uom = (chosen.b.uom_code || chosen.item.unit_of_measure || "pcs");
    const it = { ...chosen.item, companyKey: selectedCompanyKey };
    return addToCart(it, { companyKey: selectedCompanyKey, qty_factor: qtyFactor, uom });
  };

  const addBySkuExact = (sku) => {
    const key = (sku || "").trim().toLowerCase();
    if (!key) return false;
    const findIn = (companyKey) => {
      const idx = companyKey === otherCompanyKey ? itemsBySkuOther : itemsBySkuOrigin;
      const it = idx?.get(key);
      return it ? { ...it, companyKey } : null;
    };
    const a = findIn(originCompanyKey);
    const b = findIn(otherCompanyKey);
    if (!a && !b) return false;
    if (a && !b) { addToCart(a); return true; }
    if (b && !a) { addToCart(b); return true; }
    // Both match: pick based on invoice mode / cart.
    const companyKey = pickCompanyForAmbiguousMatch({
      invoiceCompanyMode,
      originCompanyKey,
      cart,
      availableCompanies: [a?.companyKey, b?.companyKey],
    });
    addToCart(companyKey === b.companyKey ? b : a);
    return true;
  };

  const findMissingCompanyItems = (companyKey, lines) => findMissingCompanyItemsForCompany({
    companyKey,
    lines,
    otherCompanyKey,
    itemsByIdOrigin,
    itemsByIdOther,
  });

  const handleScanKeyDown = (e) => {
    if (e.key !== "Enter") return false;
    e.preventDefault();
    const term = scanTerm.trim();
    if (!term) return false;
    if (addByBarcode(term)) {
      scanTerm = "";
      return true;
    }
    if (addBySkuExact(term)) {
      scanTerm = "";
      return true;
    }
    return false;
  };

  const onInvoiceCompanyModeChange = (v) => {
    const vv = String(v || "auto").trim().toLowerCase();
    invoiceCompanyMode = (vv === "official" || vv === "unofficial") ? vv : "auto";
    try { localStorage.setItem(INVOICE_MODE_STORAGE_KEY, invoiceCompanyMode); } catch (_) {}
  };

  const onFlagOfficialChange = (v) => {
    flagOfficial = !!v;
    try { localStorage.setItem(FLAG_OFFICIAL_STORAGE_KEY, flagOfficial ? "1" : "0"); } catch (_) {}
  };

  const configureOtherAgent = async () => {
    // Legacy entry point; keep for now but route to Settings.
    otherAgentDraftUrl = otherAgentUrl || DEFAULT_OTHER_AGENT_URL;
    setActiveScreen("settings");
  };

  const configurePrinting = async () => {
    showPrintingModal = true;
    printingStatus = "Loading printers...";
    printingError = "";

    // Seed from current configs (per-company mapping, regardless of which agent we’re served from).
    const offCfg = cfgForCompanyKey("official") || {};
    const unCfg = cfgForCompanyKey("unofficial") || {};
    printOfficial = {
      printer: String(offCfg.invoice_printer || "").trim(),
      copies: Math.max(1, Math.min(10, toNum(offCfg.invoice_print_copies, 1))),
      auto: !!offCfg.auto_print_invoice,
      baseUrl: String(offCfg.print_base_url || "").trim(),
    };
    printUnofficial = {
      printer: String(unCfg.receipt_printer || "").trim(),
      copies: Math.max(1, Math.min(10, toNum(unCfg.receipt_print_copies, 1))),
      auto: !!unCfg.auto_print_receipt,
    };

    const results = await Promise.allSettled([
      apiCallFor("official", "/printers"),
      apiCallFor("unofficial", "/printers"),
    ]);
    const rOff = results[0].status === "fulfilled" ? results[0].value : null;
    const rUn = results[1].status === "fulfilled" ? results[1].value : null;
    printersOfficial = Array.isArray(rOff?.printers) ? rOff.printers : [];
    printersUnofficial = Array.isArray(rUn?.printers) ? rUn.printers : [];

    // Auto-select OS default if config is empty.
    if (!printOfficial.printer && rOff?.default_printer) printOfficial.printer = String(rOff.default_printer);
    if (!printUnofficial.printer && rUn?.default_printer) printUnofficial.printer = String(rUn.default_printer);

    const offErr = results[0].status === "rejected" ? (results[0].reason?.message || "Official printer query failed") : (rOff?.error || "");
    const unErr = results[1].status === "rejected" ? (results[1].reason?.message || "Unofficial printer query failed") : (rUn?.error || "");
    const errs = [offErr, unErr].filter(Boolean).join(" | ");
    if (errs) printingError = errs;
    printingStatus = "";
  };

  const savePrinting = async () => {
    printingStatus = "Saving...";
    printingError = "";
    try {
      await Promise.all([
        apiCallFor("official", "/config", {
          method: "POST",
          body: {
            print_base_url: (printOfficial.baseUrl || "").trim() || "",
            invoice_printer: (printOfficial.printer || "").trim() || "",
            invoice_print_copies: Math.max(1, Math.min(10, toNum(printOfficial.copies, 1))),
            auto_print_invoice: !!printOfficial.auto,
          }
        }),
        apiCallFor("unofficial", "/config", {
          method: "POST",
          body: {
            receipt_printer: (printUnofficial.printer || "").trim() || "",
            receipt_print_copies: Math.max(1, Math.min(10, toNum(printUnofficial.copies, 1))),
            auto_print_receipt: !!printUnofficial.auto,
          }
        }),
      ]);
      await fetchData();
      printingStatus = "Saved.";
      setTimeout(() => printingStatus = "", 1200);
    } catch (e) {
      printingError = e?.message || "Failed to save printer settings";
      printingStatus = "";
    }
  };

  const testPrint = async (companyKey) => {
    printingStatus = "Testing print...";
    printingError = "";
    try {
      const p = companyKey === "official" ? (printOfficial.printer || "") : (printUnofficial.printer || "");
      await apiCallFor(companyKey, "/printers/test", { method: "POST", body: { printer: p } });
      printingStatus = "Test sent.";
      setTimeout(() => printingStatus = "", 1200);
    } catch (e) {
      printingError = e?.message || "Test print failed";
      printingStatus = "";
    }
  };

  const saveOtherAgent = async () => {
    const raw = String(otherAgentDraftUrl || "").trim();
    const v = _normalizeAgentOrigin(raw);
    otherAgentUrl = v;
    try { localStorage.setItem(OTHER_AGENT_URL_STORAGE_KEY, v); } catch (_) {}
    showOtherAgentModal = false;
    await fetchData();
    reportNotice(v ? `Other agent set: ${v}` : "Other agent disabled");
  };

  const toggleCatalog = () => {
    catalogCollapsed = !catalogCollapsed;
  };

  const toggleTheme = () => {
    theme = theme === "light" ? "dark" : "light";
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (_) {}
    try { document.documentElement.dataset.theme = theme; } catch (_) {}
  };

  const setActiveScreen = (scr) => {
    const v = (scr === "items" || scr === "settings") ? scr : "pos";
    activeScreen = v;
    try { localStorage.setItem(SCREEN_STORAGE_KEY, v); } catch (_) {}
    if (v === "items") {
      // Move scan focus to lookup, keep the POS scan field free.
      itemLookupAutoPick++;
    }
  };

  const saveConfigFor = async (companyKey, payload) => {
    const body = { ...(payload || {}) };
    const res = await apiCallFor(companyKey, "/config", { method: "POST", body });
    if (companyKey === otherCompanyKey) unofficialConfig = { ...unofficialConfig, ...(res?.config || {}) };
    else config = { ...config, ...(res?.config || {}) };
    await fetchData();
    return res;
  };

  const testEdgeFor = async (companyKey) => {
    return await apiCallFor(companyKey, "/edge/status", { method: "GET" });
  };

  const syncPullFor = async (companyKey) => {
    await apiCallFor(companyKey, "/sync/pull", { method: "POST", body: {} });
    await fetchData();
  };

  const syncPushFor = async (companyKey) => {
    await apiCallFor(companyKey, "/sync/push", { method: "POST", body: {} });
    await fetchData();
  };

  const resolveByTerm = (term) => {
    const code = String(term || "").trim();
    if (!code) return null;

    const pick = (companyKey) => {
      const idx = companyKey === otherCompanyKey ? barcodeIndexOther : barcodeIndexOrigin;
      const b = idx?.get(code);
      if (!b) return null;
      const itemsById = companyKey === otherCompanyKey ? itemsByIdOther : itemsByIdOrigin;
      const item = itemsById?.get(String(b.item_id));
      if (!item) return null;
      return { b, item: { ...item, companyKey } };
    };

    const mO = pick("official");
    const mU = pick("unofficial");
    if (mO && !mU) return mO;
    if (mU && !mO) return mU;
    if (mO && mU) {
      const companyKey = pickCompanyForAmbiguousMatch({
        invoiceCompanyMode,
        originCompanyKey,
        cart,
        availableCompanies: ["official", "unofficial"],
      });
      return companyKey === "unofficial" ? mU : mO;
    }

    // Try exact SKU as fallback.
    const key = code.toLowerCase();
    const findIn = (companyKey) => {
      const idx = companyKey === otherCompanyKey ? itemsBySkuOther : itemsBySkuOrigin;
      const it = idx?.get(key);
      return it ? { b: null, item: { ...it, companyKey } } : null;
    };
    const a = findIn(originCompanyKey);
    const b = findIn(otherCompanyKey);
    if (a && !b) return a;
    if (b && !a) return b;
    if (a && b) {
      const companyKey = pickCompanyForAmbiguousMatch({
        invoiceCompanyMode,
        originCompanyKey,
        cart,
        availableCompanies: [a?.item?.companyKey, b?.item?.companyKey],
      });
      return companyKey === b.item.companyKey ? b : a;
    }
    return null;
  };

  const loadBatchesFor = async (companyKey, itemId) => {
    return await apiCallFor(companyKey, `/items/${encodeURIComponent(String(itemId))}/batches`);
  };

  const updateLineQty = (index, qty) => {
    const parsed = Number(qty);
    if (!Number.isFinite(parsed)) return;
    const q = Math.max(0, parsed);
    if (q === 0) {
      removeLine(index);
      return;
    }
    const copy = [...cart];
    copy[index].qty_entered = q;
    copy[index].qty = q * toNum(copy[index].qty_factor, 1);
    copy[index] = applyPromotionToLine(copy[index]);
    cart = copy;
    checkoutIntentId = "";
  };

  const uomOptionsForLine = (line) => {
    const companyKey = line?.companyKey || "official";
    const itemId = String(line?.id || "").trim();
    const baseUom = String(line?.unit_of_measure || "pcs") || "pcs";
    if (!itemId) return [{ uom: baseUom, qty_factor: 1, label: baseUom, is_primary: true }];
    // uomOptionsFor() reads barcode maps; it only needs {id, unit_of_measure, companyKey}.
    return uomOptionsFor({ id: itemId, unit_of_measure: baseUom, companyKey });
  };

  const updateLineUom = (index, opt) => {
    const copy = [...cart];
    const cur = copy[index];
    if (!cur) return;

    const nextUom = String(opt?.uom || cur.uom || cur.unit_of_measure || "pcs").trim() || "pcs";
    const nextFactor = Math.max(1e-9, toNum(opt?.qty_factor, 1) || 1);

    // If nothing changes, do nothing.
    if (String(cur.uom || "") === nextUom && toNum(cur.qty_factor, 1) === nextFactor) return;

    const targetIdx = cartLineIndexByKey.get(_cartLineKey(cur.companyKey, cur.id, nextFactor, nextUom));

    // Move qty_entered to the new UOM context (keep entered number, recompute base qty).
    const qe = Math.max(1, toNum(cur.qty_entered, 1) || 1);
    const updated = {
      ...cur,
      qty_factor: nextFactor,
      uom: nextUom,
      qty: qe * nextFactor,
      key: _cartLineKey(cur.companyKey, cur.id, nextFactor, nextUom)
    };

    if (targetIdx !== undefined && targetIdx !== index) {
      // Merge into existing line for that UOM.
      const tgt = { ...copy[targetIdx] };
      tgt.qty_entered = toNum(tgt.qty_entered, 0) + qe;
      tgt.qty = toNum(tgt.qty_entered, 0) * nextFactor;
      copy[targetIdx] = applyPromotionToLine(tgt);
      copy.splice(index, 1);
      cart = copy;
      checkoutIntentId = "";
      return;
    }

    copy[index] = applyPromotionToLine(updated);
    cart = copy;
    checkoutIntentId = "";
  };

  const removeLine = (index) => {
    cart = cart.filter((_, i) => i !== index);
    checkoutIntentId = "";
  };

  const clearCartAll = () => {
    cart = [];
    checkoutIntentId = "";
  };

  const _benchmarkRng = (seedValue) => {
    let seed = (Number(seedValue) >>> 0) || 1;
    return () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  };

  const _benchmarkPool = () => {
    const pool = [];
    for (const it of items || []) pool.push({ ...it, companyKey: originCompanyKey });
    for (const it of unofficialItems || []) pool.push({ ...it, companyKey: otherCompanyKey });
    if (pool.length > 0) return pool;
    return (MOCK_ITEMS || []).map((it) => ({ ...it, companyKey: originCompanyKey }));
  };

  const _roundMs = (n) => Math.round(toNum(n, 0) * 100) / 100;

  const runStressBenchmark = async (lineCountRaw = 200) => {
    const lineCount = Math.max(50, Math.min(2000, Math.trunc(toNum(lineCountRaw, 200) || 200)));
    const pool = _benchmarkPool();
    if (!pool.length) throw new Error("No items available for benchmark.");

    const snapshotCart = (cart || []).map((ln) => ({ ...(ln || {}) }));
    const snapshotCustomer = activeCustomer;
    const startedAt = performance.now();

    try {
      const rng = _benchmarkRng(0x9e3779b9 ^ lineCount ^ pool.length);
      const tBuild0 = performance.now();
      const generated = [];
      for (let i = 0; i < lineCount; i += 1) {
        const pickIdx = Math.floor(rng() * pool.length) % pool.length;
        const item = pool[pickIdx] || pool[0];
        const opts = uomOptionsFor(item) || [];
        const picked = opts.length ? opts[i % opts.length] : null;
        const qtyEntered = 1 + (i % 4);
        const line = buildLine(item, qtyEntered, {
          companyKey: item.companyKey,
          qty_factor: toNum(picked?.qty_factor, 1) || 1,
          uom: String(picked?.uom || item?.unit_of_measure || "pcs"),
        });
        line.key = `${line.key}|bench|${i}`;
        generated.push(line);
      }
      const tBuild1 = performance.now();

      cart = generated;
      await tick();
      const tRender1 = performance.now();

      const tPartial0 = performance.now();
      const step = Math.max(1, Math.floor(lineCount / 50));
      const partial = [...generated];
      for (let i = 0; i < partial.length; i += step) {
        const ln = partial[i];
        if (!ln) continue;
        const qe = ((toNum(ln.qty_entered, 1) + 1) % 5) + 1;
        partial[i] = applyPromotionToLine({
          ...ln,
          qty_entered: qe,
          qty: qe * toNum(ln.qty_factor, 1),
        });
      }
      cart = partial;
      await tick();
      const tPartial1 = performance.now();

      const tReprice0 = performance.now();
      cart = (cart || []).map((ln) => applyPromotionToLine(ln));
      await tick();
      const tReprice1 = performance.now();

      const mid = Math.max(0, Math.min((cart || []).length - 1, Math.floor(lineCount / 2)));
      const tSingle0 = performance.now();
      if ((cart || []).length > 0) {
        updateLineQty(mid, toNum(cart[mid]?.qty_entered, 1) + 1);
        await tick();
      }
      const tSingle1 = performance.now();

      let uomUpdateMs = null;
      const tUom0 = performance.now();
      let toggled = false;
      for (let i = 0; i < (cart || []).length; i += 1) {
        const opts = uomOptionsForLine(cart[i]) || [];
        if (opts.length <= 1) continue;
        const curU = String(cart[i]?.uom || cart[i]?.unit_of_measure || "");
        const curF = toNum(cart[i]?.qty_factor, 1) || 1;
        const curIdx = opts.findIndex((o) => String(o?.uom || "") === curU && (toNum(o?.qty_factor, 1) || 1) === curF);
        const nextIdx = ((curIdx >= 0 ? curIdx : 0) + 1) % opts.length;
        updateLineUom(i, opts[nextIdx]);
        toggled = true;
        break;
      }
      if (toggled) {
        await tick();
        uomUpdateMs = _roundMs(performance.now() - tUom0);
      }

      const finishedAt = performance.now();
      return {
        line_count: lineCount,
        pool_items: pool.length,
        started_at: new Date().toISOString(),
        build_cart_ms: _roundMs(tBuild1 - tBuild0),
        first_render_ms: _roundMs(tRender1 - tBuild1),
        partial_reprice_ms: _roundMs(tPartial1 - tPartial0),
        full_reprice_ms: _roundMs(tReprice1 - tReprice0),
        single_qty_update_ms: _roundMs(tSingle1 - tSingle0),
        single_uom_update_ms: uomUpdateMs,
        total_benchmark_ms: _roundMs(finishedAt - startedAt),
      };
    } finally {
      cart = snapshotCart;
      activeCustomer = snapshotCustomer;
      await tick();
    }
  };

  // Customer Logic
  const searchCustomers = async () => {
    const term = customerSearch.trim();
    if (!term) {
      if (_customerRemoteTimer) {
        clearTimeout(_customerRemoteTimer);
        _customerRemoteTimer = null;
      }
      customerResults = [];
      return;
    }
    try {
      const seq = ++_customerSearchSeq;
      customerSearching = true;
      const companyKey = effectiveInvoiceCompany();
      const q = term.toLowerCase();
      const source = companyKey === otherCompanyKey ? (unofficialCustomers || []) : (customers || []);
      const local = source
        .filter((c) => {
          const name = String(c?.name || "").toLowerCase();
          const phone = String(c?.phone || "").toLowerCase();
          const email = String(c?.email || "").toLowerCase();
          const id = String(c?.id || "").toLowerCase();
          const membership = String(c?.membership_no || "").toLowerCase();
          return name.includes(q) || phone.includes(q) || email.includes(q) || id.includes(q) || membership.includes(q);
        })
        .slice(0, 30);

      // Show local hits immediately for zero-latency typing.
      customerResults = local;
      if (local.length >= 12) return;

      await new Promise((resolve) => {
        if (_customerRemoteTimer) clearTimeout(_customerRemoteTimer);
        _customerRemoteTimer = setTimeout(() => {
          _customerRemoteTimer = null;
          resolve();
        }, CUSTOMER_REMOTE_SEARCH_DEBOUNCE_MS);
      });
      if (seq !== _customerSearchSeq) return;

      const res = await apiCallFor(companyKey, `/customers?query=${encodeURIComponent(term)}`);
      if (seq !== _customerSearchSeq) return;
      const remote = Array.isArray(res?.customers) ? res.customers : [];
      const seen = new Set();
      const merged = [];
      for (const r of [...local, ...remote]) {
        const id = String(r?.id || "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(r);
        if (merged.length >= 30) break;
      }
      customerResults = merged;
    } catch(e) { reportError(e.message); }
    finally { customerSearching = false; }
  };

  const selectCustomer = (c) => {
    activeCustomer = c;
    customerSearch = "";
    customerResults = [];
  };
  
  const createCustomer = async () => {
    try {
      const companyKey = effectiveInvoiceCompany();
      const res = await apiCallFor(companyKey, "/customers/create", { method: "POST", body: customerDraft });
      if (res.customer) {
        selectCustomer(res.customer);
        addCustomerMode = false;
        customerDraft = { name: "", phone: "", email: "" };
        fetchData();
      }
    } catch(e) { reportError(e.message); }
  };

  // Checkout
  const handleCheckoutRequest = () => {
    if (cart.length === 0) return;
    if (!checkoutIntentId) checkoutIntentId = makeIntentId();
    showPaymentModal = true;
  };

  const handleProcessSale = async (method) => {
    showPaymentModal = false;
    loading = true;
    let payment_method = String(method || "cash").trim().toLowerCase();
    pendingCheckoutMethod = "";
    const checkoutIntent = checkoutIntentId || makeIntentId();
    checkoutIntentId = checkoutIntent;
    
    try {
      // Returns: enforce company-correct routing (single company or split by company).
      if (saleMode !== "sale") {
        const mapReturnLines = (lines) => {
          return (lines || []).map((line) => ({
            id: line.id,
            qty: toNum(line.qty, 0),
            qty_factor: toNum(line.qty_factor, 1),
            qty_entered: toNum(line.qty_entered, 0),
            uom: line.uom || line.unit_of_measure,
            price_usd: toNum(line.price_usd, 0),
            price_lbp: toNum(line.price_lbp, 0),
            tax_code_id: line.tax_code_id,
            batch_no: line.batch_no || null,
            expiry_date: line.expiry_date || null,
          }));
        };
        const cfgFor = (companyKey) => (companyKey === otherCompanyKey ? unofficialConfig : config);
        const returnForCompany = async (companyKey, lines) => {
          const cfg = cfgFor(companyKey);
          return apiCallFor(companyKey, "/return", {
            method: "POST",
            body: {
              idempotency_key: `${checkoutIntent}:return:${companyKey}`,
              cart: mapReturnLines(lines),
              customer_id: null,
              payment_method,
              pricing_currency: cfg.pricing_currency,
              exchange_rate: cfg.exchange_rate,
              shift_id: cfg.shift_id || null,
              cashier_id: cfg.cashier_id || null,
            },
          });
        };

        const cartCompanies = cartCompaniesSet();
        const mixedCompanies = cartCompanies.size > 1;
        if (mixedCompanies) {
          const companiesInOrder = ["official", "unofficial"].filter((k) => cart.some((c) => c.companyKey === k));
          const done = [];
          const failed = [];
          for (const companyKey of companiesInOrder) {
            const lines = cart.filter((c) => c.companyKey === companyKey);
            if (!lines.length) continue;
            try {
              const res = await returnForCompany(companyKey, lines);
              done.push({ companyKey, event_id: res?.event_id || "ok" });
              queueSyncPush(companyKey);
              cart = cart.filter((c) => c.companyKey !== companyKey);
              try { window.open(_agentReceiptUrl(companyKey), "_blank", "noopener,noreferrer"); } catch (_) {}
            } catch (e) {
              failed.push({ companyKey, error: e?.message || String(e) });
            }
          }
          await fetchData();
          if (failed.length) {
            const okText = done.length ? `Completed: ${done.map((d) => `${d.companyKey} ${d.event_id}`).join(" · ")}. ` : "";
            const failText = failed.map((f) => `${f.companyKey}: ${f.error}`).join(" | ");
            reportError(`${okText}Split return incomplete. Failed: ${failText}`);
            return;
          }
          cart = [];
          activeCustomer = null;
          checkoutIntentId = "";
          reportNotice(`Split return complete: ${done.map((d) => `${d.companyKey} ${d.event_id}`).join(" · ")}`);
          return;
        }

        const returnCompany = primaryCompanyFromCart() || originCompanyKey;
        const lines = cartCompanies.size === 1 ? cart.filter((c) => (c.companyKey || originCompanyKey) === returnCompany) : cart;
        const res = await returnForCompany(returnCompany, lines);
        queueSyncPush(returnCompany);
        reportNotice(`Return complete (${returnCompany}): ${res.event_id}`);
        cart = [];
        activeCustomer = null;
        checkoutIntentId = "";
        await fetchData();
        try { window.open(_agentReceiptUrl(returnCompany), "_blank", "noopener,noreferrer"); } catch (_) {}
        return;
      }

      const requested_customer_id = (activeCustomer?.id || "").trim() || null;
      if (payment_method === "credit" && !requested_customer_id) {
        reportError("Credit sales require a customer.");
        return;
      }

      const cartCompanies = cartCompaniesSet();
      const mixedCompanies = cartCompanies.size > 1;
      const inferredPrimary = primaryCompanyFromCart();
      const invForPay = effectiveInvoiceCompany();
      const crossCompanyCredit = !!inferredPrimary && !mixedCompanies && invForPay !== inferredPrimary;
      if (!flagOfficial && crossCompanyCredit && payment_method === "credit") {
        reportError("Credit is disabled for cross-company invoices. Use cash/card/transfer, or Flag to invoice Official for review.");
        return;
      }

      const resolveCustomerId = async (companyKey) => {
        if (!requested_customer_id) return null;
        try {
          const res = await apiCallFor(companyKey, `/customers/by-id?customer_id=${encodeURIComponent(requested_customer_id)}`);
          const ok = !!(res && res.customer && res.customer.id);
          if (!ok && payment_method === "credit") {
            throw new Error(`Customer not found on ${companyKey}. Credit sale requires a valid customer.`);
          }
          return ok ? requested_customer_id : null;
        } catch (e) {
          if (payment_method === "credit") throw e;
          return null;
        }
      };

      const mapCartLines = (lines) => {
        return (lines || []).map((line) => ({
          id: line.id,
          sku: line.sku,
          name: line.name,
          price_usd: toNum(line.price_usd, 0),
          price_lbp: toNum(line.price_lbp, 0),
          pre_discount_unit_price_usd: toNum(line.pre_discount_unit_price_usd, 0),
          pre_discount_unit_price_lbp: toNum(line.pre_discount_unit_price_lbp, 0),
          discount_pct: toNum(line.discount_pct, 0),
          discount_amount_usd: toNum(line.discount_amount_usd, 0),
          discount_amount_lbp: toNum(line.discount_amount_lbp, 0),
          applied_promotion_id: line.applied_promotion_id || null,
          applied_promotion_item_id: line.applied_promotion_item_id || null,
          qty: toNum(line.qty, 0),
          qty_factor: toNum(line.qty_factor, 1),
          qty_entered: toNum(line.qty_entered, 0),
          uom: line.uom || line.unit_of_measure,
          tax_code_id: line.tax_code_id,
          batch_no: line.batch_no || null,
          expiry_date: line.expiry_date || null,
        }));
      };

      const cfgFor = (companyKey) => (companyKey === otherCompanyKey ? unofficialConfig : config);

      // Flag override: issue ONE invoice on Official for later review (even if items are mixed).
      if (flagOfficial) {
        const invoiceCompany = "official";
        const crossCompany = mixedCompanies || !cartCompanies.has(invoiceCompany);
        if (crossCompany) {
          const missing = findMissingCompanyItems(invoiceCompany, cart);
          if (missing.length) {
            reportError(
              `Flag to Official cannot proceed: ${missing.length} item(s) are not present in Official catalog. Use Auto (Split) or remove those lines.`,
            );
            return;
          }
        }
        const customer_id = await resolveCustomerId(invoiceCompany);
        if (requested_customer_id && !customer_id) {
          reportNotice("Customer not found on Official. Proceeding as walk-in.");
        }

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

        // Pre-open receipt window to reduce popup blocking.
        let receiptWin = null;
        try { receiptWin = window.open("about:blank", "_blank", "noopener,noreferrer"); } catch (_) {}

        const cfg = cfgFor(invoiceCompany);
        const res = await apiCallFor(invoiceCompany, "/sale", {
          method: "POST",
          body: {
            idempotency_key: `${checkoutIntent}:sale:${invoiceCompany}:flag`,
            cart: mapCartLines(cart),
            customer_id,
            payment_method,
            receipt_meta,
            pricing_currency: cfg.pricing_currency,
            exchange_rate: cfg.exchange_rate,
            shift_id: cfg.shift_id || null,
            cashier_id: cfg.cashier_id || null,
            skip_stock_moves: crossCompany ? true : false,
          }
        });

        queueSyncPush(invoiceCompany);

        cart = [];
        activeCustomer = null;
        checkoutIntentId = "";
        fetchData();
        reportNotice(`Sale queued (official): ${res.event_id || "ok"}`);
        await printAfterSale(invoiceCompany, res?.event_id || "", receiptWin);
        return;
      }

      // Mixed cart: automatically split into two invoices (one per company) with a single Pay.
      if (mixedCompanies) {
        if (payment_method === "credit") {
          reportError("Split invoices support cash/card/transfer only. Use Flag to invoice Official, or sell per-company.");
          return;
        }

        const groupId = `split-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const companiesInOrder = ["official", "unofficial"].filter((k) => cart.some((c) => c.companyKey === k));

        const customerByCompany = {};
        if (requested_customer_id) {
          for (const k of companiesInOrder) customerByCompany[k] = await resolveCustomerId(k);
          const missing = companiesInOrder.filter((k) => !customerByCompany[k]);
          if (missing.length) reportNotice(`Customer not found on: ${missing.join(", ")}. Those invoices will be walk-in.`);
        }

        const receiptWins = {};
        for (const k of companiesInOrder) {
          try { receiptWins[k] = window.open("about:blank", "_blank", "noopener,noreferrer"); } catch (_) {}
        }

        const done = [];
        const failed = [];
        for (const companyKey of companiesInOrder) {
          const lines = cart.filter((c) => c.companyKey === companyKey);
          if (!lines.length) continue;

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

          const cfg = cfgFor(companyKey);
          try {
            const res = await apiCallFor(companyKey, "/sale", {
              method: "POST",
              body: {
                idempotency_key: `${checkoutIntent}:sale:${companyKey}:split`,
                cart: mapCartLines(lines),
                customer_id,
                payment_method,
                receipt_meta,
                pricing_currency: cfg.pricing_currency,
                exchange_rate: cfg.exchange_rate,
                shift_id: cfg.shift_id || null,
                cashier_id: cfg.cashier_id || null,
                skip_stock_moves: false,
              }
            });

            done.push({ companyKey, event_id: res.event_id || "ok" });
            queueSyncPush(companyKey);

            // Remove only the successfully invoiced lines.
            cart = cart.filter((c) => c.companyKey !== companyKey);
            const w = receiptWins[companyKey];
            await printAfterSale(companyKey, res?.event_id || "", w);
          } catch (e) {
            failed.push({ companyKey, error: e?.message || String(e) });
            try {
              const w = receiptWins[companyKey];
              if (w && w.close) w.close();
            } catch (_) {}
          }
        }

        fetchData();
        if (failed.length) {
          const okText = done.length ? `Completed: ${done.map((d) => `${d.companyKey} ${d.event_id}`).join(" · ")}. ` : "";
          const failText = failed.map((f) => `${f.companyKey}: ${f.error}`).join(" | ");
          reportError(`${okText}Split sale incomplete. Failed: ${failText}`);
          return;
        }
        cart = [];
        activeCustomer = null;
        checkoutIntentId = "";
        reportNotice(`Split sale queued: ${done.map((d) => `${d.companyKey} ${d.event_id}`).join(" · ")}`);
        return;
      }

      // Single-company (or intentionally forced) flow.
      const invoiceCompany = effectiveInvoiceCompany();
      const crossCompany = cartCompanies.size > 1 || (cartCompanies.size === 1 && !cartCompanies.has(invoiceCompany));
      if (crossCompany) {
        const missing = findMissingCompanyItems(invoiceCompany, cart);
        if (missing.length) {
          reportError(
            `${invoiceCompany} invoice cannot include ${missing.length} item(s) missing from that catalog. Use Auto (Split) or change invoice mode.`,
          );
          return;
        }
      }
      const customer_id = await resolveCustomerId(invoiceCompany);
      if (requested_customer_id && !customer_id) {
        reportNotice(`Customer not found on ${invoiceCompany}. Proceeding as walk-in.`);
      }

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
            ? "Cross-company invoice: stock moves were skipped; requires later review/adjustment."
            : null
        }
      };

      let receiptWin = null;
      try { receiptWin = window.open("about:blank", "_blank", "noopener,noreferrer"); } catch (_) {}

      const cfg = cfgFor(invoiceCompany);
      const res = await apiCallFor(invoiceCompany, "/sale", {
        method: "POST",
        body: {
          idempotency_key: `${checkoutIntent}:sale:${invoiceCompany}:single`,
          cart: mapCartLines(cart),
          customer_id,
          payment_method,
          receipt_meta,
          pricing_currency: cfg.pricing_currency,
          exchange_rate: cfg.exchange_rate,
          shift_id: cfg.shift_id || null,
          cashier_id: cfg.cashier_id || null,
          skip_stock_moves: crossCompany ? true : false,
        }
      });

      queueSyncPush(invoiceCompany);

      reportNotice(`Sale queued: ${res.event_id || "ok"}`);
      cart = [];
      activeCustomer = null;
      checkoutIntentId = "";
      fetchData();
      await printAfterSale(invoiceCompany, res?.event_id || "", receiptWin);
    } catch(e) {
      const p = e?.payload;
      if (p?.error === "pos_auth_required") {
        status = "Locked";
        adminPinMode = "unlock";
        openAdminPinModal();
      } else if (p?.error === "manager_approval_required") {
        pendingCheckoutMethod = payment_method;
        adminPinMode = "unlock";
        openAdminPinModal();
        reportNotice("Manager approval required. Enter admin PIN to continue.");
      } else {
        reportError(e.message);
      }
    } finally {
      loading = false;
    }
  };

  const syncPull = async () => {
    try {
      loading = true;
      const results = await Promise.allSettled([
        apiCallFor("official", "/sync/pull", { method: "POST", body: {} }),
        apiCallFor("unofficial", "/sync/pull", { method: "POST", body: {} }),
      ]);
      const o = results[0].status === "fulfilled" ? results[0].value : null;
      const u = results[1].status === "fulfilled" ? results[1].value : null;
      reportNotice(
        `Pulled: Off items ${o?.sync?.catalog?.count ?? "?"}, Un items ${u?.sync?.catalog?.count ?? "?"}`
      );
      await fetchData();
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const syncPush = async () => {
    try {
      loading = true;
      const results = await Promise.allSettled([
        apiCallFor("official", "/sync/push", { method: "POST", body: {} }),
        apiCallFor("unofficial", "/sync/push", { method: "POST", body: {} }),
      ]);
      const o = results[0].status === "fulfilled" ? results[0].value : null;
      const u = results[1].status === "fulfilled" ? results[1].value : null;
      reportNotice(
        `Pushed: Off ${o?.sent ?? 0}, Un ${u?.sent ?? 0}`
      );
      await fetchData();
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const cashierLogin = async () => {
    const pin = (cashierPin || "").trim();
    if (!pin) return;
    try {
      loading = true;
      const res = await apiCall("/cashiers/login", { method: "POST", body: { pin } });
      config = { ...config, ...(res.config || {}) };
      showCashierModal = false;
      cashierPin = "";
      await fetchData();
      reportNotice(`Signed in: ${res?.cashier?.name || "Cashier"}`);
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const cashierLogout = async () => {
    try {
      loading = true;
      const res = await apiCall("/cashiers/logout", { method: "POST", body: {} });
      config = { ...config, ...(res.config || {}) };
      await fetchData();
      reportNotice("Signed out");
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const adminPinSubmit = async () => {
    const pin = (adminPin || "").trim();
    if (!pin) return;
    try {
      loading = true;
      let unlockMsg = "Unlocked";
      if (adminPinMode === "set") {
        await apiCall("/admin/pin/set", { method: "POST", body: { pin } });
        adminPinMode = "unlock";
      }
      const res = await apiCall("/auth/pin", { method: "POST", body: { pin } });
      setSessionToken(originCompanyKey, res?.token || "");
      if (unofficialLocked || unofficialStatus === "Locked") {
        try {
          const resUn = await apiCallFor(otherCompanyKey, "/auth/pin", { method: "POST", body: { pin } });
          setSessionToken(otherCompanyKey, resUn?.token || "");
          unofficialLocked = false;
          unofficialStatus = "Ready";
        } catch (_) {
          unlockMsg = "Primary unlocked. Secondary is still locked.";
          unofficialLocked = true;
          unofficialStatus = "Locked";
        }
      }
      showAdminPinModal = false;
      adminPin = "";
      await fetchData();
      reportNotice(unlockMsg);
      const retryMethod = String(pendingCheckoutMethod || "").trim().toLowerCase();
      pendingCheckoutMethod = "";
      if (retryMethod) {
        setTimeout(() => {
          handleProcessSale(retryMethod);
        }, 0);
      }
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const shiftRefresh = async () => {
    try {
      loading = true;
      const res = await apiCall("/shift/status", { method: "POST", body: {} });
      shift = res?.shift || null;
      await fetchData();
      reportNotice(shift ? "Shift is open" : "No open shift");
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const shiftOpen = async () => {
    try {
      loading = true;
      const res = await apiCall("/shift/open", {
        method: "POST",
        body: {
          opening_cash_usd: toNum(openingCashUsd, 0),
          opening_cash_lbp: toNum(openingCashLbp, 0),
          cashier_id: config.cashier_id || null,
        },
      });
      shift = res?.shift || null;
      await fetchData();
      reportNotice("Shift opened");
      showShiftModal = false;
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const shiftClose = async () => {
    try {
      loading = true;
      const res = await apiCall("/shift/close", {
        method: "POST",
        body: {
          closing_cash_usd: toNum(closingCashUsd, 0),
          closing_cash_lbp: toNum(closingCashLbp, 0),
          cashier_id: config.cashier_id || null,
        },
      });
      shift = res?.shift || null;
      await fetchData();
      reportNotice("Shift closed");
      showShiftModal = false;
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  // Lifecycle
  onMount(() => {
    const stored = localStorage.getItem(API_BASE_STORAGE_KEY);
    if (stored) apiBase = stored;
    sessionToken = localStorage.getItem(SESSION_STORAGE_KEY) || "";
    unofficialSessionToken = localStorage.getItem(UNOFFICIAL_SESSION_STORAGE_KEY) || "";
    otherAgentUrl = localStorage.getItem(OTHER_AGENT_URL_STORAGE_KEY) || DEFAULT_OTHER_AGENT_URL;
    invoiceCompanyMode = localStorage.getItem(INVOICE_MODE_STORAGE_KEY) || "auto";
    flagOfficial = localStorage.getItem(FLAG_OFFICIAL_STORAGE_KEY) === "1";

    theme = localStorage.getItem(THEME_STORAGE_KEY) || "dark";
    if (theme !== "light" && theme !== "dark") theme = "dark";
    try { document.documentElement.dataset.theme = theme; } catch (_) {}

    const storedScreen = localStorage.getItem(SCREEN_STORAGE_KEY) || "pos";
    activeScreen = (storedScreen === "items") ? "items" : "pos";

    fetchData();

    const poll = setInterval(() => {
      if (document.hidden) return;
      fetchData({ background: true });
    }, 30000); // Polling legacy style
    const pushPoll = setInterval(() => {
      if (document.hidden) return;
      if (config?.device_id) queueSyncPush(originCompanyKey);
      if (unofficialConfig?.device_id) queueSyncPush(otherCompanyKey);
    }, 12000);
    const onVisibilityChange = () => {
      if (!document.hidden) fetchData({ background: true });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Global barcode scan capture (keyboard-wedge scanners often type fast chars + Enter).
    // Captures scans even if focus isn't in the scan box, but avoids stealing normal typing.
    let buf = "";
    let lastAt = 0;
    let clearTimer = null;

    const reset = () => {
      buf = "";
      lastAt = 0;
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
    };

    const isTextInput = (el) => {
      const tag = (el?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      return !!el?.isContentEditable;
    };

    const onKeyDown = (e) => {
      if (!e) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const active = document.activeElement;
      const focusedInText = isTextInput(active);
      const isScanField = !!active?.getAttribute?.("data-scan-input");

      // Don't hijack normal typing in other fields (customer search, etc.).
      if (focusedInText && !isScanField) return;

      if (e.key === "Enter") {
        const term = buf.trim();
        if (term && term.length >= 4) {
          if (activeScreen === "items") {
            itemLookupQuery = term;
            itemLookupAutoPick++;
          } else if (activeScreen === "pos") {
            // Attempt immediate add by barcode/SKU. Keep scanTerm for visibility.
            scanTerm = term;
            const ok = addByBarcode(term) || addBySkuExact(term);
            if (ok) scanTerm = "";
          }
        }
        reset();
        return;
      }

      if (typeof e.key === "string" && e.key.length === 1) {
        const now = Date.now();
        const dt = lastAt ? (now - lastAt) : 0;
        // Scanner bursts are typically < 30ms between keys; anything slower is likely manual typing.
        if (dt && dt > 60) buf = "";
        buf += e.key;
        lastAt = now;
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(reset, 250);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      clearInterval(poll);
      clearInterval(pushPoll);
      if (_customerRemoteTimer) {
        clearTimeout(_customerRemoteTimer);
        _customerRemoteTimer = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("keydown", onKeyDown, true);
      reset();
    };
  });

  const _edgeState = (st) => {
    if (!st) return "Pending";
    if (st.edge_ok === false) return "Offline";
    if (st.edge_ok === true && st.edge_auth_ok === true) return "Online";
    if (st.edge_ok === true && st.edge_auth_ok === false) return "Auth";
    return "Unknown";
  };

  const getEdgeStateText = () => {
    return `Off ${_edgeState(edge)} · Un ${_edgeState(unofficialEdge)}`;
  };
</script>

<Shell 
  status={status} 
  edgeStateText={getEdgeStateText()} 
  syncBadge={syncBadge}
  hasConnection={hasConnection}
  cashierName={cashierName}
  shiftText={shiftText}
  showTabs={true}
>
  <svelte:fragment slot="tabs">
    {@const tabBase = "px-4 py-2 rounded-full text-xs font-extrabold border transition-colors whitespace-nowrap"}
    {@const tabOn = "bg-accent/20 text-accent border-accent/30 hover:bg-accent/30"}
    {@const tabOff = "bg-ink/5 text-muted border-ink/10 hover:bg-ink/10 hover:text-ink"}

    <button
      class={`${tabBase} ${activeScreen === "pos" ? tabOn : tabOff}`}
      on:click={() => setActiveScreen("pos")}
      type="button"
      title="Cashier POS screen"
    >
      POS
    </button>
    <button
      class={`${tabBase} ${activeScreen === "items" ? tabOn : tabOff}`}
      on:click={() => setActiveScreen("items")}
      type="button"
      title="Item lookup & details"
    >
      Items
    </button>
    <button
      class={`${tabBase} ${activeScreen === "settings" ? tabOn : tabOff}`}
      on:click={() => setActiveScreen("settings")}
      type="button"
      title="Connectivity & setup"
    >
      Settings
    </button>
  </svelte:fragment>

  <svelte:fragment slot="top-actions">
    {@const topBtnBase = "px-3 py-2 rounded-full text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors whitespace-nowrap"}
    {@const topBtnActive = "bg-accent/20 text-accent border-accent/30 hover:bg-accent/30"}
    <button
      class={topBtnBase}
      on:click={syncPull}
      disabled={loading}
      title="Pull latest catalog/master data"
    >
      Sync Pull
    </button>
    <button
      class={topBtnBase}
      on:click={syncPush}
      disabled={loading}
      title="Push outbox events to edge"
    >
      Sync Push
    </button>
    <button
      class={topBtnBase}
      on:click={openCashierModal}
      disabled={loading}
      title="Cashier login"
    >
      Cashier
    </button>
    <button
      class={topBtnBase}
      on:click={() => { showShiftModal = true; shiftRefresh(); }}
      disabled={loading}
      title="Shift open/close"
    >
      Shift
    </button>
    <button
      class={topBtnBase}
      on:click={() => { try { window.open('/receipt/last', '_blank', 'noopener,noreferrer'); } catch (_) {} }}
      title="Open printable last receipt"
    >
      Receipt
    </button>
    <button
      class={topBtnBase}
      on:click={configurePrinting}
      disabled={loading}
      title="Detect printers and map each company to a printer"
    >
      Printing
    </button>
    <button
      class={topBtnBase}
      on:click={configureOtherAgent}
      disabled={loading}
      title="Open config/settings"
    >
      Config
    </button>
    {#if activeScreen === "pos"}
      <button
        class={`${topBtnBase} ${saleMode === "return" ? topBtnActive : "text-muted"}`}
        on:click={() => { saleMode = (saleMode === "sale" ? "return" : "sale"); }}
        title="Toggle return mode"
      >
        {saleMode === "sale" ? "Sale" : "Return"}
      </button>
    {/if}
    {#if config.cashier_id}
      <button
        class={topBtnBase}
        on:click={cashierLogout}
        disabled={loading}
        title="Cashier logout"
      >
        Logout
      </button>
    {/if}

    <button
      class="h-9 w-9 rounded-full border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors flex items-center justify-center"
      on:click={toggleTheme}
      title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      aria-label="Toggle theme"
    >
      {#if theme === "light"}
        <!-- Sun -->
        <svg class="w-4 h-4 text-ink/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364-1.414 1.414M7.05 16.95l-1.414 1.414m0-11.314L7.05 7.05m9.9 9.9 1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" />
        </svg>
      {:else}
        <!-- Moon -->
        <svg class="w-4 h-4 text-ink/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
        </svg>
      {/if}
    </button>
  </svelte:fragment>

  {#if activeScreen === "pos"}
    <div
      class={`grid h-full gap-6 ${
        catalogCollapsed
          ? "grid-cols-1 lg:grid-cols-[72px_1fr_420px]"
          : "grid-cols-1 lg:grid-cols-[minmax(420px,1fr)_520px_420px]"
      }`}
    >
      <!-- Catalog Column (collapsible) -->
      {#if catalogCollapsed}
        <section class="glass-panel rounded-2xl h-full overflow-hidden flex flex-col items-center justify-between p-3">
          <button
            class="w-full py-3 rounded-xl bg-ink/5 hover:bg-ink/10 border border-ink/10 text-xs font-bold text-muted transition-colors"
            on:click={toggleCatalog}
            title="Show Catalog"
          >
            Catalog
          </button>
          <div class="text-[10px] text-muted rotate-90 whitespace-nowrap select-none opacity-70">
            Scan anywhere
          </div>
          <button
            class="w-full py-3 rounded-xl bg-accent/20 hover:bg-accent/30 border border-accent/30 text-xs font-bold text-accent transition-colors"
            on:click={() => {
              const scanEl = document.querySelector('[data-scan-input="1"]');
              if (scanEl && scanEl.focus) scanEl.focus();
            }}
            title="Focus scan"
          >
            Scan
          </button>
        </section>
      {:else}
        <ProductGrid
          items={allItems}
          bind:scanTerm={scanTerm}
          suggestions={scanSuggestions}
          addToCart={addToCart}
          uomOptionsFor={uomOptionsFor}
          collapseCatalog={toggleCatalog}
          currencyPrimary={currencyPrimary}
          onScanKeyDown={handleScanKeyDown}
          companyLabel={companyLabel}
          companyTone={companyTone}
        />
      {/if}

      <!-- Cart Column (only scrollable region is inside Cart list) -->
      <div class="h-full min-h-0">
        <Cart
          cart={cart}
          config={config}
          updateQty={updateLineQty}
          uomOptionsForLine={uomOptionsForLine}
          updateUom={updateLineUom}
          removeLine={removeLine}
          clearCart={clearCartAll}
          companyLabelForLine={companyLabel}
          companyToneForLine={companyTone}
        />
      </div>

      <!-- Right Column: Customer + Current Sale -->
      <div class="h-full min-h-0 flex flex-col gap-4 overflow-visible relative z-0">
        <CustomerSelect
          bind:customerSearch={customerSearch}
          bind:activeCustomer={activeCustomer}
          customerResults={customerResults}
          customerSearching={customerSearching}
          bind:addCustomerMode={addCustomerMode}
          bind:customerDraft={customerDraft}
          searchCustomers={searchCustomers}
          selectCustomer={selectCustomer}
          createCustomer={createCustomer}
        />

        <div class="flex-1 min-h-0 overflow-hidden relative z-0">
          <SaleSummary
            cart={cart}
            totals={totals}
            totalsByCompany={totalsByCompany}
            originCompanyKey={originCompanyKey}
            invoiceCompanyMode={invoiceCompanyMode}
            flagOfficial={flagOfficial}
            onInvoiceCompanyModeChange={onInvoiceCompanyModeChange}
            onFlagOfficialChange={onFlagOfficialChange}
            onCheckout={handleCheckoutRequest}
          />
        </div>
      </div>
    </div>
  {:else if activeScreen === "items"}
    <ItemLookup
      items={allItemsTagged}
      bind:query={itemLookupQuery}
      autoPick={itemLookupAutoPick}
      isActive={activeScreen === "items"}
      otherCompanyKey={otherCompanyKey}
      barcodesByItemIdOrigin={barcodesByItemIdOrigin}
      barcodesByItemIdOther={barcodesByItemIdOther}
      uomOptionsFor={uomOptionsFor}
      companyLabel={companyLabel}
      companyTone={companyTone}
      addToCart={addToCart}
      loadBatches={loadBatchesFor}
      resolveByTerm={resolveByTerm}
    />
  {:else}
    <SettingsScreen
      officialConfig={config}
      unofficialConfig={unofficialConfig}
      unofficialEnabled={!!_normalizeAgentOrigin(otherAgentUrl)}
      unofficialStatus={unofficialStatus}
      otherAgentUrl={otherAgentUrl}
      bind:otherAgentDraftUrl={otherAgentDraftUrl}
      saveOtherAgent={saveOtherAgent}
      saveConfigFor={saveConfigFor}
      testEdgeFor={testEdgeFor}
      syncPullFor={syncPullFor}
      syncPushFor={syncPushFor}
      runStressBenchmark={runStressBenchmark}
    />
  {/if}
</Shell>

<PaymentModal
  isOpen={showPaymentModal}
  total={checkoutTotal}
  currency={currencyPrimary}
  mode={saleMode}
  onConfirm={handleProcessSale}
  onCancel={() => showPaymentModal = false}
/>

{#if showCashierModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      class="absolute inset-0 bg-black/80 backdrop-blur-sm"
      type="button"
      aria-label="Close cashier login"
      on:click={() => showCashierModal = false}
    ></button>
    <div class="relative w-full max-w-sm bg-surface border border-ink/10 rounded-2xl shadow-2xl overflow-hidden z-10">
      <div class="p-6 border-b border-ink/10 text-center">
        <h2 class="text-xl font-bold text-ink">Cashier Login</h2>
        <p class="text-sm text-muted mt-1">Enter PIN</p>
      </div>
      <div class="p-6 space-y-4">
        <label class="sr-only" for="cashier-pin">PIN</label>
        <input
          class="w-full bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono text-lg tracking-widest focus:ring-2 focus:ring-accent/50 focus:outline-none"
          type="password"
          bind:value={cashierPin}
          bind:this={cashierPinEl}
          id="cashier-pin"
          placeholder="PIN"
          on:keydown={(e) => e.key === 'Enter' && cashierLogin()}
        />
        <div class="flex gap-3">
          <button
            class="flex-1 py-3 px-4 rounded-xl border border-ink/10 text-muted hover:text-ink hover:bg-ink/5 font-medium transition-colors"
            on:click={() => showCashierModal = false}
            type="button"
          >
            Cancel
          </button>
          <button
            class="flex-[2] py-3 px-4 rounded-xl bg-accent text-white font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98]"
            on:click={cashierLogin}
            disabled={loading}
            type="button"
          >
            Sign In
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showAdminPinModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      class="absolute inset-0 bg-black/80 backdrop-blur-sm"
      type="button"
      aria-label="Close admin PIN modal"
      on:click={() => showAdminPinModal = false}
    ></button>
    <div class="relative w-full max-w-sm bg-surface border border-ink/10 rounded-2xl shadow-2xl overflow-hidden z-10">
      <div class="p-6 border-b border-ink/10 text-center">
        <h2 class="text-xl font-bold text-ink">{adminPinMode === "set" ? "Set Admin PIN" : "Unlock POS"}</h2>
        <p class="text-sm text-muted mt-1">
          {adminPinMode === "set" ? "This is required when the POS agent is protected." : "Enter admin PIN to continue."}
        </p>
      </div>
      <div class="p-6 space-y-4">
        <label class="sr-only" for="admin-pin">{adminPinMode === "set" ? "New Admin PIN" : "Admin PIN"}</label>
        <input
          class="w-full bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono text-lg tracking-widest focus:ring-2 focus:ring-accent/50 focus:outline-none"
          type="password"
          bind:value={adminPin}
          bind:this={adminPinEl}
          id="admin-pin"
          placeholder="Admin PIN"
          on:keydown={(e) => e.key === 'Enter' && adminPinSubmit()}
        />
        <div class="flex gap-3">
          <button
            class="flex-1 py-3 px-4 rounded-xl border border-ink/10 text-muted hover:text-ink hover:bg-ink/5 font-medium transition-colors"
            on:click={() => showAdminPinModal = false}
            type="button"
          >
            Cancel
          </button>
          <button
            class="flex-[2] py-3 px-4 rounded-xl bg-accent text-white font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98]"
            on:click={adminPinSubmit}
            disabled={loading}
            type="button"
          >
            {adminPinMode === "set" ? "Set & Unlock" : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showShiftModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      class="absolute inset-0 bg-black/80 backdrop-blur-sm"
      type="button"
      aria-label="Close shift"
      on:click={() => showShiftModal = false}
    ></button>
    <div class="relative w-full max-w-lg bg-surface border border-ink/10 rounded-2xl shadow-2xl overflow-hidden z-10">
      <div class="p-6 border-b border-ink/10 flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold text-ink">Shift</h2>
          <p class="text-sm text-muted mt-1">{config.shift_id ? "Open shift detected" : "No open shift"}</p>
        </div>
        <button
          class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
          on:click={shiftRefresh}
          disabled={loading}
          title="Refresh"
        >
          Refresh
        </button>
      </div>

      <div class="p-6 space-y-5">
        {#if !config.shift_id}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-muted" for="shift-opening-usd">Opening Cash (USD)</label>
              <input
                id="shift-opening-usd"
                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                type="number"
                step="0.01"
                bind:value={openingCashUsd}
              />
            </div>
            <div>
              <label class="text-xs text-muted" for="shift-opening-lbp">Opening Cash (LBP)</label>
              <input
                id="shift-opening-lbp"
                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                type="number"
                step="1"
                bind:value={openingCashLbp}
              />
            </div>
          </div>
          <button
            class="w-full py-3 px-4 rounded-xl bg-accent text-white font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98] disabled:opacity-60"
            on:click={shiftOpen}
            disabled={loading}
          >
            Open Shift
          </button>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-muted" for="shift-closing-usd">Closing Cash (USD)</label>
              <input
                id="shift-closing-usd"
                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                type="number"
                step="0.01"
                bind:value={closingCashUsd}
              />
            </div>
            <div>
              <label class="text-xs text-muted" for="shift-closing-lbp">Closing Cash (LBP)</label>
              <input
                id="shift-closing-lbp"
                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                type="number"
                step="1"
                bind:value={closingCashLbp}
              />
            </div>
          </div>
          <button
            class="w-full py-3 px-4 rounded-xl bg-red-500 text-white font-bold hover:bg-red-400 transition-all active:scale-[0.98] disabled:opacity-60"
            on:click={shiftClose}
            disabled={loading}
          >
            Close Shift
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if showOtherAgentModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      class="absolute inset-0 bg-black/80 backdrop-blur-sm"
      type="button"
      aria-label="Close other agent"
      on:click={() => showOtherAgentModal = false}
    ></button>
    <div class="relative w-full max-w-lg bg-surface border border-ink/10 rounded-2xl shadow-2xl overflow-hidden z-10">
      <div class="p-6 border-b border-ink/10 flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold text-ink">Other Agent</h2>
          <p class="text-sm text-muted mt-1">Set the second company agent URL (usually `http://127.0.0.1:7072`).</p>
        </div>
        <button
          class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
          on:click={() => showOtherAgentModal = false}
        >
          Close
        </button>
      </div>
      <div class="p-6 space-y-4">
        <label class="text-xs text-muted" for="other-agent-url">Other Agent URL (blank disables Unified mode)</label>
        <input
          id="other-agent-url"
          class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
          placeholder="http://127.0.0.1:7072"
          bind:value={otherAgentDraftUrl}
          on:keydown={(e) => e.key === "Enter" && saveOtherAgent()}
        />
        <div class="flex gap-3 justify-end">
          <button
            class="py-3 px-4 rounded-xl border border-ink/10 text-muted hover:text-ink hover:bg-ink/5 font-medium transition-colors"
            on:click={() => { otherAgentDraftUrl = ""; }}
            type="button"
          >
            Disable
          </button>
          <button
            class="py-3 px-4 rounded-xl bg-accent text-white font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98]"
            on:click={saveOtherAgent}
            disabled={loading}
            type="button"
          >
            Save & Reconnect
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showPrintingModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      class="absolute inset-0 bg-black/80 backdrop-blur-sm"
      type="button"
      aria-label="Close printing settings"
      on:click={() => showPrintingModal = false}
    ></button>
    <div class="relative w-full max-w-2xl bg-surface border border-ink/10 rounded-2xl shadow-2xl overflow-hidden z-10">
      <div class="p-6 border-b border-ink/10 flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold text-ink">Printing</h2>
          <p class="text-sm text-muted mt-1">Detect printers per agent and map Official invoices (A4) and Unofficial receipts (thermal).</p>
        </div>
        <button
          class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
          on:click={() => showPrintingModal = false}
        >
          Close
        </button>
      </div>

      <div class="p-6 space-y-4">
        {#if printingError}
          <div class="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-ink/90">
            {printingError}
          </div>
        {/if}

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
	          <div class="rounded-2xl border border-ink/10 bg-ink/5 p-4 space-y-3">
	            <div class="text-[11px] font-extrabold uppercase tracking-wider text-muted">Official</div>
	            <div>
	              <label class="text-xs text-muted" for="print-official-printer">Printer</label>
	              <select id="print-official-printer" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-3 py-2 text-sm" bind:value={printOfficial.printer}>
	                <option value="">(None)</option>
	                {#each printersOfficial as p}
	                  <option value={p.name}>{p.name}{p.is_default ? " (default)" : ""}</option>
	                {/each}
	              </select>
	            </div>
	            <div>
	              <label class="text-xs text-muted" for="print-official-admin-url">Admin URL (for A4 invoice PDFs)</label>
	              <input
	                id="print-official-admin-url"
	                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-3 py-2 text-sm font-mono"
	                placeholder="http://127.0.0.1:3000"
	                bind:value={printOfficial.baseUrl}
	              />
	              <div class="mt-1 text-[11px] text-muted">Must serve `/exports/sales-invoices/.../pdf`.</div>
	            </div>
            <div class="flex items-center justify-between gap-3">
              <label class="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" bind:checked={printOfficial.auto} />
                Auto print invoices (A4 PDF)
              </label>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted">Copies</span>
                <input class="w-16 bg-bg/50 border border-ink/10 rounded-xl px-3 py-2 text-sm" type="number" min="1" max="10" bind:value={printOfficial.copies} />
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="py-2 px-3 rounded-xl border border-ink/10 text-muted hover:text-ink hover:bg-ink/5 font-medium transition-colors text-xs"
                on:click={() => testPrint("official")}
                type="button"
              >
                Test
              </button>
            </div>
          </div>

	          <div class="rounded-2xl border border-ink/10 bg-ink/5 p-4 space-y-3">
	            <div class="text-[11px] font-extrabold uppercase tracking-wider text-muted">Unofficial</div>
	            <div>
	              <label class="text-xs text-muted" for="print-unofficial-printer">Printer</label>
	              <select id="print-unofficial-printer" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-3 py-2 text-sm" bind:value={printUnofficial.printer}>
	                <option value="">(None)</option>
	                {#each printersUnofficial as p}
	                  <option value={p.name}>{p.name}{p.is_default ? " (default)" : ""}</option>
	                {/each}
	              </select>
	            </div>
            <div class="flex items-center justify-between gap-3">
              <label class="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" bind:checked={printUnofficial.auto} />
                Auto print receipts
              </label>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted">Copies</span>
                <input class="w-16 bg-bg/50 border border-ink/10 rounded-xl px-3 py-2 text-sm" type="number" min="1" max="10" bind:value={printUnofficial.copies} />
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="py-2 px-3 rounded-xl border border-ink/10 text-muted hover:text-ink hover:bg-ink/5 font-medium transition-colors text-xs"
                on:click={() => testPrint("unofficial")}
                type="button"
              >
                Test
              </button>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3">
          <div class="text-xs text-muted">{printingStatus}</div>
          <div class="flex items-center gap-2">
            <button
              class="py-3 px-4 rounded-xl border border-ink/10 text-muted hover:text-ink hover:bg-ink/5 font-medium transition-colors"
              on:click={configurePrinting}
              type="button"
            >
              Refresh
            </button>
            <button
              class="py-3 px-4 rounded-xl bg-accent text-white font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98]"
              on:click={savePrinting}
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
