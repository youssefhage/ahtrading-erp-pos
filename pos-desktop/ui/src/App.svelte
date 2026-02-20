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
  import posUiPackage from "../package.json";
  import {
    cartCompaniesSet as cartCompaniesSetFromLines,
    effectiveInvoiceCompany as effectiveInvoiceCompanyFor,
    findMissingCompanyItems as findMissingCompanyItemsForCompany,
    pickCompanyForAmbiguousMatch,
    primaryCompanyFromCart as primaryCompanyFromLines,
  } from "./lib/unified-sale-flow.js";
  import {
    assertPaymentsWithinTotals,
    buildSalePaymentsForSettlement,
    normalizeSettlementCurrency,
    saleIdempotencyKeyForCompany,
  } from "./lib/unified-checkout.js";

  const API_BASE_STORAGE_KEY = "pos_ui_api_base";
  const SESSION_STORAGE_KEY = "pos_ui_session_token";
  const OTHER_AGENT_URL_STORAGE_KEY = "pos_ui_other_agent_url";
  const UNOFFICIAL_SESSION_STORAGE_KEY = "pos_ui_session_token_unofficial";
  const INVOICE_MODE_STORAGE_KEY = "pos_ui_invoice_company_mode";
  const FLAG_OFFICIAL_STORAGE_KEY = "pos_ui_flag_official";
  const VAT_DISPLAY_MODE_STORAGE_KEY = "pos_ui_vat_display_mode";
  const PRICE_DISPLAY_CONTROLS_STORAGE_KEY = "pos_ui_price_display_controls";
  const THEME_STORAGE_KEY = "pos_ui_theme";
  const SCREEN_STORAGE_KEY = "pos_ui_screen";
  const WEB_CONFIG_OFFICIAL_STORAGE_KEY = "pos_web_config_official";
  const WEB_CONFIG_UNOFFICIAL_STORAGE_KEY = "pos_web_config_unofficial";
  const WEB_LOCAL_OUTBOX_STORAGE_KEY = "pos_web_local_outbox_v1";
  const WEB_LOCAL_AUDIT_STORAGE_KEY = "pos_web_local_audit_v1";
  const CASHIER_MANAGER_META_STORAGE_KEY = "pos_ui_cashier_manager_meta_v1";
  const CART_DRAFTS_STORAGE_KEY = "pos_ui_cart_drafts_v1";
  const CART_DRAFT_KEEP_COPY_STORAGE_KEY = "pos_ui_cart_drafts_keep_copy_on_resume";
  const DEFAULT_API_BASE = "/api";
  const DEFAULT_OTHER_AGENT_URL = "http://localhost:7072";
  const WEB_LOCAL_OUTBOX_MAX = 800;
  const WEB_LOCAL_AUDIT_MAX = 500;
  const CART_DRAFTS_MAX = 50;
  const MANAGER_APPROVAL_TTL_MS = 2 * 60 * 1000;
  const POS_UI_VERSION = String(posUiPackage?.version || "").trim() || "dev";

  // These are seeded in backend/db/seeds/seed_companies.sql and used in sample POS configs.
  const OFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";
  const UNOFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000002";
  const RECEIPT_TEMPLATE_OPTIONS = [
    { id: "classic", label: "Classic", desc: "Balanced receipt with key metadata." },
    { id: "compact", label: "Compact", desc: "Minimal receipt for faster printing." },
    { id: "detailed", label: "Detailed", desc: "Adds SKU and unit price details." },
  ];
  const INVOICE_TEMPLATE_OPTIONS = [
    { id: "official_classic", label: "Official Classic", desc: "Full official A4 with detailed sections." },
    { id: "official_compact", label: "Official Compact", desc: "Condensed official A4 for faster reading." },
    { id: "standard", label: "Standard", desc: "General invoice layout (non-official style)." },
  ];
  const SHORTCUT_GUIDE_SECTIONS = [
    {
      title: "Global",
      items: [
        { keys: "Esc", action: "Close open menus/drawers (More, Drafts, Shortcuts)." },
        { keys: "Barcode scan + Enter/Tab", action: "Auto-detect scanner input and add item / fill Item Lookup." },
      ],
    },
    {
      title: "POS Catalog Search",
      items: [
        { keys: "Arrow Down / Arrow Up", action: "Move highlighted search result." },
        { keys: "Enter / Numpad Enter / Tab", action: "Add highlighted item to cart." },
        { keys: "Alt+U", action: "Cycle UOM forward for highlighted item." },
        { keys: "Alt+Shift+U", action: "Cycle UOM backward for highlighted item." },
        { keys: "Alt+1..9", action: "Select UOM option index 1..9." },
        { keys: "Enter / Space (on focused item row)", action: "Add focused result row to cart." },
      ],
    },
    {
      title: "Item Lookup Screen",
      items: [
        { keys: "Arrow Down / Arrow Up", action: "Move highlighted result." },
        { keys: "Enter", action: "Select highlighted item." },
        { keys: "Escape", action: "Clear lookup query." },
      ],
    },
    {
      title: "Customer Search",
      items: [
        { keys: "Arrow Down / Arrow Up", action: "Move highlighted customer result." },
        { keys: "Enter", action: "Select highlighted customer (or run immediate search if none highlighted)." },
        { keys: "Escape", action: "Clear customer highlight." },
      ],
    },
    {
      title: "Quick Form Actions",
      items: [
        { keys: "Enter (Cart Draft name)", action: "Save current cart as draft." },
        { keys: "Enter (Cashier PIN)", action: "Sign in cashier." },
        { keys: "Enter (Admin PIN)", action: "Unlock / approve with admin PIN." },
        { keys: "Enter (Other Agent URL)", action: "Save and reconnect." },
        { keys: "Enter (Cart qty field)", action: "Commit qty edit and blur field." },
      ],
    },
  ];

  // Utility functions
  const toNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  
  const toRate = (value) => toNum(value, 0);

  const normalizeCompanyKey = (companyKey) => (
    String(companyKey || "").trim().toLowerCase() === "unofficial" ? "unofficial" : "official"
  );

  const _readJsonStorage = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  };
  const _readStorage = (key, fallback = "") => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : raw;
    } catch (_) {
      return fallback;
    }
  };
  const _writeStorage = (key, value) => {
    try { localStorage.setItem(key, String(value)); } catch (_) {}
  };
  const _removeStorage = (key) => {
    try { localStorage.removeItem(key); } catch (_) {}
  };

  const _managerRoleNames = ["manager", "admin", "owner", "supervisor"];
  const _cashierLooksManager = (cashier) => {
    if (!cashier || typeof cashier !== "object") return false;
    if (cashier.is_manager === true || cashier.is_admin === true || cashier.can_manager_approve === true) return true;
    const role = String(cashier.role || cashier.type || "").trim().toLowerCase();
    if (_managerRoleNames.includes(role)) return true;
    const roles = Array.isArray(cashier.roles) ? cashier.roles : [];
    if (roles.some((r) => _managerRoleNames.includes(String(r || "").trim().toLowerCase()))) return true;
    const perms = Array.isArray(cashier.permissions) ? cashier.permissions : [];
    return perms.some((p) => {
      const key = String(p || "").trim().toLowerCase();
      return key.includes("manager") || key.includes("approve") || key.includes("admin");
    });
  };
  const _cashierHasManagerMetadata = (cashier) => {
    if (!cashier || typeof cashier !== "object") return false;
    const hasKey = (k) => Object.prototype.hasOwnProperty.call(cashier, k);
    if (hasKey("is_manager") || hasKey("is_admin") || hasKey("can_manager_approve")) return true;
    if (hasKey("role") || hasKey("type")) return true;
    if (Array.isArray(cashier.roles) || Array.isArray(cashier.permissions)) return true;
    return false;
  };

  const normalizeVatRate = (value) => {
    let rate = toNum(value, 0);
    if (rate > 1 && rate <= 100) rate = rate / 100;
    return Math.max(0, rate);
  };

  const normalizeVatDisplayMode = (value) => {
    const mode = String(value || "").trim().toLowerCase();
    if (mode === "ex" || mode === "inc" || mode === "both") return mode;
    return "both";
  };

  const normalizeApiBase = (value) => {
    let v = (value || "").trim();
    if (!v) return DEFAULT_API_BASE;
    if (v.startsWith("http://") || v.startsWith("https://")) {
      return v.endsWith("/") ? v.slice(0, -1) : v;
    }
    return v.startsWith("/") ? (v.endsWith("/") ? v.slice(0, -1) : v) : `/${v}`;
  };

  const _isLoopbackHost = (hostRaw) => {
    const h = String(hostRaw || "").trim().toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
  };

  const _normalizeOriginUrl = (value) => {
    let v = String(value || "").trim();
    if (!v) return "";
    if (v.endsWith("/")) v = v.slice(0, -1);
    return v;
  };

  const _currentLoopbackAgentContext = () => {
    try {
      if (typeof window === "undefined" || !window.location) return null;
      const protocol = String(window.location.protocol || "http:").trim() || "http:";
      const hostname = String(window.location.hostname || "").trim();
      if (!_isLoopbackHost(hostname)) return null;
      const currentPort = String(window.location.port || "").trim();
      const currentOrigin = _normalizeOriginUrl(window.location.origin || `${protocol}//${hostname}${currentPort ? `:${currentPort}` : ""}`);
      return {
        currentPort,
        currentOrigin,
        officialOrigin: `${protocol}//${hostname}:7070`,
        unofficialOrigin: `${protocol}//${hostname}:7072`,
      };
    } catch (_) {
      return null;
    }
  };

  const _defaultOtherAgentUrlForCurrentHost = () => {
    const ctx = _currentLoopbackAgentContext();
    if (!ctx) return DEFAULT_OTHER_AGENT_URL;
    if (ctx.currentPort === "7070") return ctx.unofficialOrigin;
    if (ctx.currentPort === "7072") return ctx.officialOrigin;
    return DEFAULT_OTHER_AGENT_URL;
  };

  const _sanitizeOtherAgentUrl = (value) => {
    const candidate = _normalizeOriginUrl(value);
    if (!candidate) return "";
    const ctx = _currentLoopbackAgentContext();
    if (!ctx) return candidate;
    // Avoid pointing the "other company" route back to this same agent.
    if (candidate !== ctx.currentOrigin) return candidate;
    if (ctx.currentPort === "7070") return ctx.unofficialOrigin;
    if (ctx.currentPort === "7072") return ctx.officialOrigin;
    return candidate;
  };

  const _detectOriginCompanyKey = (companyId) => {
    const ctx = _currentLoopbackAgentContext();
    if (ctx?.currentPort === "7072") return "unofficial";
    if (ctx?.currentPort === "7070") return "official";
    return String(companyId || "").trim() === UNOFFICIAL_COMPANY_ID ? "unofficial" : "official";
  };

  const _probeAgentHealth = async (base) => {
    const b = normalizeApiBase(base || DEFAULT_API_BASE);
    const url = `${b}/health`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    try {
      const res = await fetch(url, { method: "GET", signal: controller.signal });
      const text = await res.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (_) {
        payload = null;
      }
      // Local POS agent contract: /api/health -> { "ok": true }.
      // Backend contract usually includes fields like {status, service, db,...}.
      const localAgentLike =
        !!payload &&
        typeof payload === "object" &&
        payload.ok === true &&
        !Object.prototype.hasOwnProperty.call(payload, "service") &&
        !Object.prototype.hasOwnProperty.call(payload, "db");
      return { ok: res.ok, status: res.status, localAgentLike, payload };
    } catch (_) {
      return { ok: false, status: 0, localAgentLike: false, payload: null };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const _isAbsoluteHttpUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());

  const _normalizeCloudApiBase = (value) => {
    const v = String(value || "").trim();
    if (!v) return "";
    if (v.startsWith("/")) {
      return normalizeApiBase(v);
    }
    const raw = _isAbsoluteHttpUrl(v) ? v : `https://${v}`;
    try {
      const u = new URL(raw);
      let path = String(u.pathname || "/").replace(/\/+$/, "");
      // Most operators type only the host; default to the API prefix.
      if (!path || path === "/") path = "/api";
      u.pathname = path;
      u.search = "";
      u.hash = "";
      return u.toString().replace(/\/+$/, "");
    } catch (_) {
      return raw.endsWith("/") ? raw.slice(0, -1) : raw;
    }
  };

  const _cloudSetupCall = async (
    apiBaseUrl,
    path,
    { method = "GET", token = "", companyId = "", body = null, timeoutMs = 20000 } = {},
  ) => {
    const base = _normalizeCloudApiBase(apiBaseUrl);
    if (!base) throw new Error("Cloud API URL is required.");
    const p = String(path || "").replace(/^\/+/, "");
    const url = `${base}/${p}`;
    const headers = { "Content-Type": "application/json" };
    const auth = String(token || "").trim();
    const cid = String(companyId || "").trim();
    if (auth) headers.Authorization = `Bearer ${auth}`;
    if (cid) headers["X-Company-Id"] = cid;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.max(1000, toNum(timeoutMs, 20000)));
    try {
      const res = await fetch(url, {
        method: String(method || "GET").toUpperCase(),
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (_) {
        payload = text ? { raw: text } : null;
      }
      if (!res.ok) {
        const msg = payload?.detail || payload?.error || res.statusText || `HTTP ${res.status}`;
        const err = new Error(String(msg));
        err.status = res.status;
        err.payload = payload;
        throw err;
      }
      return payload || {};
    } catch (e) {
      if (e?.name === "AbortError") {
        const err = new Error("Cloud setup request timed out.");
        err.status = 408;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const makeIntentId = () => {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch (_) {}
    return `${Date.now()}-${Math.random().toString(16).slice(2, 12)}`;
  };

  const makeUuid = () => {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch (_) {}
    const hex = "0123456789abcdef";
    const r = () => hex[Math.floor(Math.random() * 16)];
    let out = "";
    for (let i = 0; i < 36; i += 1) {
      if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
      else if (i === 14) out += "4";
      else if (i === 19) out += ["8", "9", "a", "b"][Math.floor(Math.random() * 4)];
      else out += r();
    }
    return out;
  };

  const makeEmptyCustomerDraft = () => ({
    name: "",
    phone: "",
    email: "",
    party_type: "individual",
    customer_type: "retail",
    legal_name: "",
    membership_no: "",
    payment_terms_days: "",
    tax_id: "",
    vat_no: "",
    notes: "",
    marketing_opt_in: false,
    is_active: true,
  });

  const _normalizeScanCode = (value) => {
    let v = String(value || "");
    // Remove control chars scanners may inject (FNC/GS/CR/LF) and trim.
    v = v.replace(/[\u0000-\u001F\u007F]/g, "").trim();
    // Common GS1 keyboard-wedge prefix.
    if (v.startsWith("]C1")) v = v.slice(3);
    return v.trim();
  };

  const _scanKeyVariants = (value) => {
    const out = [];
    const seen = new Set();
    const push = (v) => {
      const s = String(v || "").trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };
    const raw = String(value || "");
    const norm = _normalizeScanCode(raw);
    push(raw);
    push(norm);
    push(raw.toLowerCase());
    push(norm.toLowerCase());
    return out;
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
  let bgPullWarnAt = 0;
  let bgSyncPushInFlight = { official: false, unofficial: false };
  let bgSyncPullInFlight = { official: false, unofficial: false };
  let fetchDataPending = false;
  let fetchDataPendingBackground = true;
  let fetchDataDrainPromise = null;
  let webHostUnsupported = false;
  let webSetupFirstTime = false;
  let webHostHint = "";
  let runtimeVersionText = `pos-web v${POS_UI_VERSION}`;
  let webEventInvoiceMap = new Map();
  let webCatalogCache = new Map();
  let webLocalOutboxByCompany = { official: [], unofficial: [] };
  let webAuditByCompany = { official: [], unofficial: [] };
  let cashierManagerMetaByCompany = { official: null, unofficial: null };
  let managerApprovalUntilByCompany = { official: 0, unofficial: 0 };
  let managerApprovalPendingCompanies = [];
  const WEB_CATALOG_CACHE_TTL_MS = 15000;

  const activateWebHostUnsupported = (hint = "") => {
    webHostUnsupported = true;
    webHostHint = String(hint || "").trim();
    const hasSavedCloudConfig =
      (!!String(config?.device_id || "").trim() && !!String(config?.device_token || "").trim()) ||
      (!!String(unofficialConfig?.device_id || "").trim() && !!String(unofficialConfig?.device_token || "").trim());
    status = hasSavedCloudConfig ? "Ready" : "Web Setup Mode";
    error = "";
    if (!hasSavedCloudConfig) {
      activeScreen = "settings";
      try { localStorage.setItem(SCREEN_STORAGE_KEY, "settings"); } catch (_) {}
    }
  };

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
    receipt_template: "classic",
    receipt_company_name: "AH Trading",
    receipt_footer_text: "",
    invoice_printer: "",
    invoice_print_copies: 1,
    auto_print_invoice: false,
    invoice_template: "official_classic",
    require_manager_approval_credit: false,
    require_manager_approval_returns: false,
    require_manager_approval_cross_company: false,
    outbox_stale_warn_minutes: 5,
  };
  
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
    receipt_template: "classic",
    receipt_company_name: "AH Trading",
    receipt_footer_text: "",
    invoice_printer: "",
    invoice_print_copies: 1,
    auto_print_invoice: false,
    invoice_template: "official_classic",
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
  let vatDisplayMode = "both"; // "ex" | "inc" | "both"
  let showPriceDisplayControls = false;

  // Layout
  let catalogCollapsed = true;
  
  // Customer Select State
  let customerSearch = "";
  let customerResults = [];
  let customerSearching = false;
  let addCustomerMode = false;
  let customerDraft = makeEmptyCustomerDraft();
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
  let checkoutInFlight = false;

  // Admin unlock (POS agent can require a local admin PIN when LAN-exposed)
  let showAdminPinModal = false;
  let adminPin = "";
  let adminPinMode = "unlock"; // "unlock" | "set"
  let adminPinEl = null;

  // Printing settings
  let showPrintingModal = false;
  let showQueueDrawer = false;
  let showAuditDrawer = false;
  let showCartDraftsDrawer = false;
  let showShortcutsGuide = false;
  let showTopMoreActions = false;
  let topMoreActionsButtonEl = null;
  let topMoreMenuEl = null;
  let topMoreMenuStyle = "left: 8px; top: 56px; width: 224px;";
  const TOP_MORE_MENU_WIDTH = 224;
  let auditLoading = false;
  let auditEvents = [];
  let queueRetryingKeys = new Set();
  let showQueuePayloadModal = false;
  let queuePayloadLoading = false;
  let queuePayloadError = "";
  let queuePayloadEvent = null;
  let queuePayloadText = "";
  let cartDraftName = "";
  let cartDrafts = [];
  let keepDraftCopyOnResume = false;
  let printersOfficial = [];
  let printersUnofficial = [];
  let printingStatus = "";
  let printingError = "";
  // Official: A4 invoice PDF
  let printOfficial = { printer: "", copies: 1, auto: false, baseUrl: "", template: "official_classic" };
  let printUnofficial = { printer: "", copies: 1, auto: false, template: "classic", companyName: "AH Trading", footerText: "" };

  // Cashier
  let showCashierModal = false;
  let cashierCompanyKey = "official";
  let cashierPin = "";
  let cashierLoginCashierId = "";
  let cashierPinEl = null;
  let cashierOfficialManager = false;
  let cashierUnofficialManager = false;

  // Shift
  let showShiftModal = false;
  let shiftCompanyKey = "official";
  let shift = null;
  let unofficialShift = null;
  let openingCashUsd = 0;
  let openingCashLbp = 0;
  let closingCashUsd = 0;
  let closingCashLbp = 0;
  let shiftClosingTouchedByCompany = { official: false, unofficial: false };
  let shiftCashMappingByCompany = { official: null, unofficial: null };
  let shiftCashMethodsByCompany = { official: [], unofficial: [] };
  const _shiftMoney = (value, fallback = null) => {
    if (value == null || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const _shiftPickMoney = (obj, keys = [], fallback = null) => {
    for (const key of keys || []) {
      const v = _shiftMoney(obj?.[key], null);
      if (v != null) return v;
    }
    return fallback;
  };
  const _shiftCompany = (companyKey = shiftCompanyKey) => normalizeCompanyKey(companyKey || shiftCompanyKey || originCompanyKey);
  const _shiftClosingTouched = (companyKey = shiftCompanyKey) => {
    const key = _shiftCompany(companyKey);
    return !!(shiftClosingTouchedByCompany || {})[key];
  };
  const _setShiftClosingTouched = (companyKey = shiftCompanyKey, touched = true) => {
    const key = _shiftCompany(companyKey);
    shiftClosingTouchedByCompany = {
      ...(shiftClosingTouchedByCompany || {}),
      [key]: !!touched,
    };
  };
  const _setShiftCashSetup = (companyKey = shiftCompanyKey, cashMethods = [], hasCashMethodMapping = null) => {
    const key = _shiftCompany(companyKey);
    const normalizedMethods = Array.isArray(cashMethods)
      ? cashMethods
        .map((m) => String(m || "").trim())
        .filter((m) => !!m)
      : [];
    shiftCashMethodsByCompany = {
      ...(shiftCashMethodsByCompany || {}),
      [key]: normalizedMethods,
    };
    const mappingFlag = typeof hasCashMethodMapping === "boolean"
      ? hasCashMethodMapping
      : (normalizedMethods.length > 0 ? true : null);
    shiftCashMappingByCompany = {
      ...(shiftCashMappingByCompany || {}),
      [key]: mappingFlag,
    };
  };
  const _shiftHasCashMapping = (companyKey = shiftCompanyKey) => {
    const key = _shiftCompany(companyKey);
    return (shiftCashMappingByCompany || {})[key];
  };
  const _shiftCashMethods = (companyKey = shiftCompanyKey) => {
    const key = _shiftCompany(companyKey);
    return Array.isArray((shiftCashMethodsByCompany || {})[key]) ? (shiftCashMethodsByCompany || {})[key] : [];
  };
  const _setShiftIdForCompany = (companyKey, shiftId = "") => {
    const key = normalizeCompanyKey(companyKey);
    const nextShiftId = String(shiftId || "").trim();
    if (key === otherCompanyKey) {
      unofficialConfig = { ...unofficialConfig, shift_id: nextShiftId };
    } else {
      config = { ...config, shift_id: nextShiftId };
    }
  };
  const _shiftExpectedUsdFrom = (srcShift, fallback = 0) => (
    toNum(_shiftPickMoney(srcShift || {}, ["expected_closing_cash_usd", "expected_cash_usd", "cash_expected_usd"], _shiftPickMoney(srcShift || {}, ["opening_cash_usd", "opening_usd"], fallback)), 0)
  );
  const _shiftExpectedLbpFrom = (srcShift, fallback = 0) => (
    toNum(_shiftPickMoney(srcShift || {}, ["expected_closing_cash_lbp", "expected_cash_lbp", "cash_expected_lbp"], _shiftPickMoney(srcShift || {}, ["opening_cash_lbp", "opening_lbp"], fallback)), 0)
  );
  const _applyShiftExpectedToClosing = (companyKey = shiftCompanyKey, srcShift = shift, { preserveTouched = true } = {}) => {
    if (preserveTouched && _shiftClosingTouched(companyKey)) return;
    closingCashUsd = _shiftExpectedUsdFrom(srcShift, closingCashUsd);
    closingCashLbp = _shiftExpectedLbpFrom(srcShift, closingCashLbp);
    _setShiftClosingTouched(companyKey, false);
  };
  const markShiftClosingEdited = (companyKey = shiftCompanyKey) => {
    _setShiftClosingTouched(companyKey, true);
  };
  const shiftResetClosingToExpected = (companyKey = shiftCompanyKey) => {
    _applyShiftExpectedToClosing(companyKey, shift, { preserveTouched: false });
  };

  // Derived
  $: activeCashierOfficial = cashiers.find((c) => c.id === config.cashier_id);
  $: activeCashierUnofficial = unofficialCashiers.find((c) => c.id === unofficialConfig.cashier_id);
  $: cashierOfficialName = activeCashierOfficial ? activeCashierOfficial.name : (config.cashier_id ? "Unknown" : "Not Signed In");
  $: cashierUnofficialName = activeCashierUnofficial ? activeCashierUnofficial.name : (unofficialConfig.cashier_id ? "Unknown" : "Not Signed In");
  $: cashierName = `O:${cashierOfficialName} · U:${cashierUnofficialName}`;
  $: selectedCashierCompanyKey = normalizeCompanyKey(cashierCompanyKey || originCompanyKey);
  $: selectedCashierId = selectedCashierCompanyKey === otherCompanyKey
    ? String(unofficialConfig?.cashier_id || "").trim()
    : String(config?.cashier_id || "").trim();
  $: selectedCashierName = selectedCashierCompanyKey === otherCompanyKey ? cashierUnofficialName : cashierOfficialName;
  $: selectedCashierSignedIn = !!selectedCashierId;
  $: cashierChoices = selectedCashierCompanyKey === otherCompanyKey ? unofficialCashiers : cashiers;
  $: {
    const options = Array.isArray(cashierChoices) ? cashierChoices : [];
    const ids = new Set(options.map((c) => String(c?.id || "").trim()).filter((id) => !!id));
    let nextSelected = String(cashierLoginCashierId || "").trim();
    if (!nextSelected || !ids.has(nextSelected)) {
      const currentSignedIn = String(selectedCashierId || "").trim();
      nextSelected = ids.has(currentSignedIn)
        ? currentSignedIn
        : String(options?.[0]?.id || "").trim();
    }
    if (nextSelected !== cashierLoginCashierId) cashierLoginCashierId = nextSelected;
  }
  $: cashierModalSubtitle = selectedCashierSignedIn
    ? `${selectedCashierName} is signed in for selected company. Enter PIN to switch cashier, or sign out current.`
    : "No cashier is signed in for selected company. Enter PIN to sign in.";
  const _normalizeCashierManagerMeta = (value) => {
    if (!value || typeof value !== "object") return null;
    const cashier_id = String(value?.cashier_id || "").trim();
    if (!cashier_id) return null;
    const manager_badge = value?.manager_badge;
    return {
      cashier_id,
      manager_badge: manager_badge === true ? true : (manager_badge === false ? false : null),
      updated_at: String(value?.updated_at || "").trim() || null,
    };
  };
  const _persistCashierManagerMeta = () => {
    try { localStorage.setItem(CASHIER_MANAGER_META_STORAGE_KEY, JSON.stringify(cashierManagerMetaByCompany || {})); } catch (_) {}
  };
  const _setCashierManagerMetaFor = (companyKey, cashier) => {
    const key = normalizeCompanyKey(companyKey);
    const cashier_id = String(cashier?.id || "").trim();
    if (!cashier_id) return;
    const manager_badge = _cashierHasManagerMetadata(cashier) ? _cashierLooksManager(cashier) : null;
    const nextMeta = {
      cashier_id,
      manager_badge,
      updated_at: new Date().toISOString(),
    };
    cashierManagerMetaByCompany = {
      ...(cashierManagerMetaByCompany || {}),
      [key]: nextMeta,
    };
    _persistCashierManagerMeta();
  };
  const _clearCashierManagerMetaFor = (companyKey) => {
    const key = normalizeCompanyKey(companyKey);
    if (!cashierManagerMetaByCompany?.[key]) return;
    cashierManagerMetaByCompany = {
      ...(cashierManagerMetaByCompany || {}),
      [key]: null,
    };
    _persistCashierManagerMeta();
  };
  const _syncCashierManagerMetaFor = (companyKey) => {
    const key = normalizeCompanyKey(companyKey);
    const currentCashierId = String(cashierIdForCompany(key) || "").trim();
    const cached = _normalizeCashierManagerMeta(cashierManagerMetaByCompany?.[key]);
    const cachedCashierId = String(cached?.cashier_id || "").trim();
    if (!currentCashierId) {
      if (cached) _clearCashierManagerMetaFor(key);
      return;
    }
    if (cached && cachedCashierId !== currentCashierId) {
      _clearCashierManagerMetaFor(key);
    }
  };
  const _managerBadgeForCompany = (companyKey, activeCashier = null) => {
    const key = normalizeCompanyKey(companyKey);
    const currentCashierId = String(cashierIdForCompany(key) || "").trim();
    if (!currentCashierId) return false;
    if (_cashierHasManagerMetadata(activeCashier) && _cashierLooksManager(activeCashier)) return true;
    const cached = _normalizeCashierManagerMeta(cashierManagerMetaByCompany?.[key]);
    if (!cached) return false;
    if (String(cached.cashier_id || "").trim() !== currentCashierId) return false;
    return cached.manager_badge === true;
  };
  $: _syncCashierManagerMetaFor("official");
  $: _syncCashierManagerMetaFor("unofficial");
  $: cashierOfficialManager = _managerBadgeForCompany("official", activeCashierOfficial);
  $: cashierUnofficialManager = _managerBadgeForCompany("unofficial", activeCashierUnofficial);
  const _isoAgeMinutes = (iso) => {
    const t = Date.parse(String(iso || ""));
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, (Date.now() - t) / 60000);
  };
  const _queueAgeText = (iso) => {
    const mins = Math.round(_isoAgeMinutes(iso));
    if (!Number.isFinite(mins) || mins <= 0) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
  };
  const _shortQueueEventId = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "—";
    if (raw.length <= 12) return raw;
    return `${raw.slice(0, 8)}…${raw.slice(-4)}`;
  };
  const _queueEventId = (ev) => String(ev?.event_id || ev?.id || "").trim();
  const _queueCompanyKey = (ev) => (
    String(ev?.companyKey || "").trim().toLowerCase() === "unofficial" ? "unofficial" : "official"
  );
  const _queueRetryKey = (ev) => {
    const eventId = _queueEventId(ev);
    if (!eventId) return "";
    return `${_queueCompanyKey(ev)}:${eventId}`;
  };
  const _queueStatus = (ev) => String(ev?.status || "pending").trim().toLowerCase();
  const _isQueueLocalEvent = (ev) => {
    const source = String(ev?.source || "").trim().toLowerCase();
    return source === "local" || _queueEventId(ev).startsWith("local-");
  };
  const _queueNeedsAdminRequeue = (ev) => _queueStatus(ev) === "dead" && !_isQueueLocalEvent(ev);
  const _isQueueRetrying = (ev) => {
    const key = _queueRetryKey(ev);
    return !!key && queueRetryingKeys.has(key);
  };
  const _copyText = async (value) => {
    const text = String(value || "");
    if (!text) throw new Error("Nothing to copy.");
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(ta);
    if (!copied) throw new Error("Clipboard is not available.");
  };
  const _positionTopMoreActionsMenu = () => {
    if (!showTopMoreActions) return;
    if (!topMoreActionsButtonEl || typeof window === "undefined") return;
    const rect = topMoreActionsButtonEl.getBoundingClientRect();
    const viewportWidth = Math.max(0, Number(window.innerWidth) || 0);
    const viewportHeight = Math.max(0, Number(window.innerHeight) || 0);
    const pad = 8;
    let left = Math.round(rect.right - TOP_MORE_MENU_WIDTH);
    if (viewportWidth > 0) {
      left = Math.max(pad, Math.min(left, viewportWidth - TOP_MORE_MENU_WIDTH - pad));
    }
    let top = Math.round(rect.bottom + 8);
    if (viewportHeight > 0) {
      top = Math.min(top, Math.max(pad, viewportHeight - 16));
    }
    topMoreMenuStyle = `left: ${left}px; top: ${top}px; width: ${TOP_MORE_MENU_WIDTH}px;`;
  };
  const closeTopMoreActions = () => {
    showTopMoreActions = false;
  };
  const _elContainsTarget = (el, target) => (
    !!el && !!target && typeof el.contains === "function" && el.contains(target)
  );
  const toggleTopMoreActions = () => {
    showTopMoreActions = !showTopMoreActions;
    if (showTopMoreActions) {
      requestAnimationFrame(() => _positionTopMoreActionsMenu());
    }
  };
  const _companyForStorage = (companyKey) => normalizeCompanyKey(companyKey);
  const _trimArray = (rows, maxRows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (list.length <= maxRows) return list;
    return list.slice(0, maxRows);
  };
  const _persistWebLocalOutbox = () => {
    try { localStorage.setItem(WEB_LOCAL_OUTBOX_STORAGE_KEY, JSON.stringify(webLocalOutboxByCompany || {})); } catch (_) {}
  };
  const _persistWebAudit = () => {
    try { localStorage.setItem(WEB_LOCAL_AUDIT_STORAGE_KEY, JSON.stringify(webAuditByCompany || {})); } catch (_) {}
  };
  const _webLocalOutboxRowsFor = (companyKey) => {
    const key = _companyForStorage(companyKey);
    return Array.isArray(webLocalOutboxByCompany?.[key]) ? webLocalOutboxByCompany[key] : [];
  };
  const _setWebLocalOutboxRowsFor = (companyKey, rows) => {
    const key = _companyForStorage(companyKey);
    webLocalOutboxByCompany = {
      ...(webLocalOutboxByCompany || {}),
      [key]: _trimArray(rows, WEB_LOCAL_OUTBOX_MAX),
    };
    _persistWebLocalOutbox();
  };
  const _appendWebLocalOutboxEvent = (companyKey, eventType, payload, idempotencyKey = "") => {
    const key = _companyForStorage(companyKey);
    const nowIso = new Date().toISOString();
    const localEventId = `local-${makeUuid()}`;
    const ev = {
      id: localEventId,
      event_id: localEventId,
      event_type: String(eventType || "").trim(),
      payload,
      payload_json: payload,
      created_at: nowIso,
      status: "pending",
      source: "local",
      idempotency_key: String(idempotencyKey || "").trim() || null,
      retry_count: 0,
      last_error: "",
      next_attempt_at: null,
      acked_at: null,
      remote_event_id: "",
    };
    const rows = [ev, ..._webLocalOutboxRowsFor(key)];
    _setWebLocalOutboxRowsFor(key, rows);
    return ev;
  };
  const _patchWebLocalOutboxEvent = (companyKey, eventId, patch = {}) => {
    const key = _companyForStorage(companyKey);
    let updated = null;
    const rows = _webLocalOutboxRowsFor(key).map((row) => {
      const rowId = String(row?.event_id || row?.id || "").trim();
      if (rowId !== String(eventId || "").trim()) return row;
      updated = { ...(row || {}), ...(patch || {}) };
      return updated;
    });
    _setWebLocalOutboxRowsFor(key, rows);
    return updated;
  };
  const _removeWebLocalOutboxEvent = (companyKey, eventId) => {
    const key = _companyForStorage(companyKey);
    const target = String(eventId || "").trim();
    const rows = _webLocalOutboxRowsFor(key).filter((row) => String(row?.event_id || row?.id || "").trim() !== target);
    _setWebLocalOutboxRowsFor(key, rows);
  };
  const _findWebLocalOutboxEvent = (companyKey, eventId) => {
    const target = String(eventId || "").trim();
    if (!target) return null;
    return _webLocalOutboxRowsFor(companyKey).find((row) => String(row?.event_id || row?.id || "").trim() === target) || null;
  };
  const _webAuditRowsFor = (companyKey) => {
    const key = _companyForStorage(companyKey);
    return Array.isArray(webAuditByCompany?.[key]) ? webAuditByCompany[key] : [];
  };
  const _appendWebAudit = (companyKey, row = {}) => {
    const key = _companyForStorage(companyKey);
    const withTime = {
      created_at: new Date().toISOString(),
      action: String(row?.action || "").trim() || "pos.action",
      company_id: String(cfgForCompanyKey(key)?.company_id || "").trim() || null,
      cashier_id: String(row?.cashier_id || "").trim() || null,
      shift_id: String(row?.shift_id || "").trim() || null,
      event_id: String(row?.event_id || "").trim() || null,
      status: String(row?.status || "").trim() || null,
      details: row?.details ?? null,
      source: "web-local",
    };
    const rows = [withTime, ..._webAuditRowsFor(key)];
    webAuditByCompany = {
      ...(webAuditByCompany || {}),
      [key]: _trimArray(rows, WEB_LOCAL_AUDIT_MAX),
    };
    _persistWebAudit();
    return withTime;
  };
  const _managerApprovalValidFor = (companyKey) => {
    const key = _companyForStorage(companyKey);
    const until = toNum(managerApprovalUntilByCompany?.[key], 0);
    return until > Date.now();
  };
  const _markManagerApprovedFor = (companyKey, ttlMs = MANAGER_APPROVAL_TTL_MS) => {
    const key = _companyForStorage(companyKey);
    managerApprovalUntilByCompany = {
      ...(managerApprovalUntilByCompany || {}),
      [key]: Date.now() + Math.max(1000, toNum(ttlMs, MANAGER_APPROVAL_TTL_MS)),
    };
  };
  $: outboxOldestMinutes = (() => {
    let maxMin = 0;
    for (const ev of ([]).concat(outbox || [], unofficialOutbox || [])) {
      maxMin = Math.max(maxMin, _isoAgeMinutes(ev?.created_at));
    }
    return maxMin;
  })();
  $: outboxWarnMinutes = Math.max(1, toNum(config?.outbox_stale_warn_minutes, 5) || 5);
  const _isReadyStatus = (value) => String(value || "").trim().toLowerCase() === "ready";
  $: syncBadge = (() => {
    const o = (outbox || []).length;
    const u = (unofficialOutbox || []).length;
    const queued = o + u;
    if (!_isReadyStatus(status) || !_isReadyStatus(unofficialStatus)) return `Offline · queued ${queued}`;
    if (queued > 0 && outboxOldestMinutes >= outboxWarnMinutes) {
      return `Stale · queued ${queued} · oldest ${Math.round(outboxOldestMinutes)}m`;
    }
    if (queued > 0) return `Syncing · queued ${queued}`;
    return "Synced";
  })();
  $: queuedEventsTotal = ((outbox || []).length + (unofficialOutbox || []).length);
  $: queueEvents = (() => {
    const withCompany = [];
    for (const ev of (outbox || [])) withCompany.push({ ...(ev || {}), companyKey: "official" });
    for (const ev of (unofficialOutbox || [])) withCompany.push({ ...(ev || {}), companyKey: "unofficial" });
    withCompany.sort((a, b) => (Date.parse(String(b?.created_at || "")) || 0) - (Date.parse(String(a?.created_at || "")) || 0));
    return withCompany;
  })();
  $: queueOfficialCount = (outbox || []).length;
  $: queueUnofficialCount = (unofficialOutbox || []).length;
  $: queueFailedCount = queueEvents.filter((ev) => _queueStatus(ev) === "failed").length;
  $: queueDeadCount = queueEvents.filter((ev) => _queueStatus(ev) === "dead").length;
  $: queueManualRequeueCount = queueEvents.filter((ev) => _queueNeedsAdminRequeue(ev)).length;
  $: allCompaniesConnected = _isReadyStatus(status) && _isReadyStatus(unofficialStatus);
  $: syncNeedsAttention = (!allCompaniesConnected) || queuedEventsTotal > 0 || outboxOldestMinutes >= outboxWarnMinutes;
  $: syncPullHint = "Auto refresh runs in background. Use this only when you need immediate updates after catalog/customer changes.";
  $: syncPushHint = queuedEventsTotal > 0
    ? `Send ${queuedEventsTotal} queued event${queuedEventsTotal === 1 ? "" : "s"} now. Auto retry is already running.`
    : "Auto push is already running. Use this only if receipts are delayed in Admin.";
  $: syncActionHelp = (!allCompaniesConnected)
    ? "Auto sync is retrying. Use Send Queue after connection is back."
    : "Auto sync is on. Use Send Queue only if queued events stay pending. Use Refresh Now after Admin updates.";
  $: originCompanyKey = _detectOriginCompanyKey(config.company_id);
  $: otherCompanyKey = originCompanyKey === "official" ? "unofficial" : "official";
  $: webSetupFirstTime = webHostUnsupported && !_hasCloudDeviceConfig(originCompanyKey);
  
  $: currencyPrimary = (config.pricing_currency || "USD").toUpperCase();
  $: shiftText = `O:${config.shift_id ? "Open" : "Closed"} · U:${unofficialConfig.shift_id ? "Open" : "Closed"}`;
  $: selectedShiftOpen = !!shiftIdForCompany(shiftCompanyKey || originCompanyKey);
  $: selectedShiftCashierName = normalizeCompanyKey(shiftCompanyKey || originCompanyKey) === "unofficial"
    ? cashierUnofficialName
    : cashierOfficialName;
  $: selectedShiftHasCashMapping = _shiftHasCashMapping(shiftCompanyKey || originCompanyKey);
  $: selectedShiftCashMethods = _shiftCashMethods(shiftCompanyKey || originCompanyKey);
  $: selectedShiftCashMethodsLabel = (selectedShiftCashMethods || []).join(", ");
  $: shiftOpeningUsd = _shiftPickMoney(shift || {}, ["opening_cash_usd", "opening_usd"], 0);
  $: shiftOpeningLbp = _shiftPickMoney(shift || {}, ["opening_cash_lbp", "opening_lbp"], 0);
  $: shiftExpectedCloseUsd = (() => {
    const direct = _shiftPickMoney(shift || {}, ["expected_closing_cash_usd", "expected_cash_usd", "cash_expected_usd"], null);
    if (direct != null) return direct;
    return shiftOpeningUsd;
  })();
  $: shiftExpectedCloseLbp = (() => {
    const direct = _shiftPickMoney(shift || {}, ["expected_closing_cash_lbp", "expected_cash_lbp", "cash_expected_lbp"], null);
    if (direct != null) return direct;
    return shiftOpeningLbp;
  })();
  $: shiftVarianceUsd = toNum(closingCashUsd, 0) - toNum(shiftExpectedCloseUsd, 0);
  $: shiftVarianceLbp = toNum(closingCashLbp, 0) - toNum(shiftExpectedCloseLbp, 0);
  $: checkoutTotal = currencyPrimary === "LBP" ? (totals.totalLbp || 0) : (totals.totalUsd || 0);
  const cfgForCompanyKey = (companyKey) => (companyKey === otherCompanyKey ? unofficialConfig : config);
  const cashierIdForCompany = (companyKey, explicitCashierId = "") => {
    const direct = String(explicitCashierId || "").trim();
    if (direct) return direct;
    const cfg = cfgForCompanyKey(companyKey) || {};
    const own = String(cfg?.cashier_id || "").trim();
    if (own) return own;
    return "";
  };
  const shiftIdForCompany = (companyKey, explicitShiftId = "") => {
    const direct = String(explicitShiftId || "").trim();
    if (direct) return direct;
    const cfg = cfgForCompanyKey(companyKey) || {};
    return String(cfg?.shift_id || "").trim();
  };
  const ensureCashierForCompanies = (companyKeys, actionLabel = "checkout") => {
    const unique = Array.from(new Set((companyKeys || []).map((k) => normalizeCompanyKey(k))));
    const missing = unique.filter((k) => !cashierIdForCompany(k));
    if (!missing.length) return true;
    cashierCompanyKey = missing[0] || originCompanyKey;
    showCashierModal = true;
    reportError(`Cashier sign-in required before ${actionLabel}. Missing cashier for: ${missing.join(", ")}.`);
    return false;
  };
  const ensureShiftForCompanies = (companyKeys, actionLabel = "checkout") => {
    const unique = Array.from(new Set((companyKeys || []).map((k) => normalizeCompanyKey(k))));
    const missing = unique.filter((k) => !shiftIdForCompany(k));
    if (!missing.length) return true;
    shiftCompanyKey = missing[0] || originCompanyKey;
    showShiftModal = true;
    Promise.resolve().then(() => shiftRefresh(shiftCompanyKey, { quiet: true })).catch(() => {});
    reportError(`Open shift required before ${actionLabel}. Missing shift for: ${missing.join(", ")}.`);
    return false;
  };

  const vatCodesForCompanyKey = (companyKey) => {
    const cfg = cfgForCompanyKey(companyKey) || {};
    const raw = cfg?.vat_codes;
    const map = {};
    if (!raw) return map;

    if (Array.isArray(raw)) {
      for (const row of raw) {
        const id = String(row?.id || "").trim();
        if (!id) continue;
        map[id] = normalizeVatRate(row?.rate);
      }
      return map;
    }

    if (typeof raw === "object") {
      for (const [key, value] of Object.entries(raw)) {
        const id = String(key || "").trim();
        if (!id) continue;
        const rate = (value && typeof value === "object") ? value?.rate : value;
        map[id] = normalizeVatRate(rate);
      }
    }
    return map;
  };

  const vatRateForLine = (line) => {
    const companyKey = line?.companyKey || "official";
    const cfg = cfgForCompanyKey(companyKey) || {};
    const defaultRate = normalizeVatRate(cfg?.vat_rate);
    const defaultTaxCodeId = String(cfg?.tax_code_id || "").trim();
    const taxCodeId = String(line?.tax_code_id || defaultTaxCodeId || "").trim();
    if (!taxCodeId) return 0;

    const vatCodes = vatCodesForCompanyKey(companyKey);
    const hasVatCodes = Object.keys(vatCodes).length > 0;
    const hasRateForCode = Object.prototype.hasOwnProperty.call(vatCodes, taxCodeId);

    if (hasRateForCode) return normalizeVatRate(vatCodes[taxCodeId]);
    if (taxCodeId === defaultTaxCodeId) return defaultRate;
    if (hasVatCodes) return 0;
    return defaultRate;
  };

  const cartLineAmounts = (line) => {
    const companyKey = line?.companyKey === "unofficial" ? "unofficial" : "official";
    const qty = Math.max(0, toNum(line?.qty, 0));
    const baseUsd = toNum(line?.price_usd, 0) * qty;
    const rawBaseLbp = toNum(line?.price_lbp, 0) * qty;
    const cfg = cfgForCompanyKey(companyKey) || {};
    const fallbackEx = toNum(cfg?.exchange_rate, toNum(config?.exchange_rate, 0));
    const baseLbp = rawBaseLbp === 0 && fallbackEx > 0 ? baseUsd * fallbackEx : rawBaseLbp;
    const vatRate = vatRateForLine(line);
    const taxUsd = baseUsd * vatRate;
    const taxLbp = baseLbp * vatRate;
    return { companyKey, baseUsd, baseLbp, taxUsd, taxLbp };
  };

  $: cartVatSnapshot = (() => {
    const byCompany = {
      official: { subtotalUsd: 0, taxUsd: 0, totalUsd: 0 },
      unofficial: { subtotalUsd: 0, taxUsd: 0, totalUsd: 0 },
    };
    let subtotalUsd = 0;
    let subtotalLbp = 0;
    let taxUsd = 0;
    let taxLbp = 0;

    for (const ln of cart || []) {
      const row = cartLineAmounts(ln);
      subtotalUsd += row.baseUsd;
      subtotalLbp += row.baseLbp;
      taxUsd += row.taxUsd;
      taxLbp += row.taxLbp;
      const bucket = row.companyKey === "unofficial" ? byCompany.unofficial : byCompany.official;
      bucket.subtotalUsd += row.baseUsd;
      bucket.taxUsd += row.taxUsd;
    }

    byCompany.official.totalUsd = byCompany.official.subtotalUsd + byCompany.official.taxUsd;
    byCompany.unofficial.totalUsd = byCompany.unofficial.subtotalUsd + byCompany.unofficial.taxUsd;
    return { subtotalUsd, subtotalLbp, taxUsd, taxLbp, byCompany };
  })();

  // Totals Calculation
  $: totals = (() => {
    const subtotalUsd = toNum(cartVatSnapshot?.subtotalUsd, 0);
    const subtotalLbp = toNum(cartVatSnapshot?.subtotalLbp, 0);
    const taxUsd = toNum(cartVatSnapshot?.taxUsd, 0);
    const taxLbp = toNum(cartVatSnapshot?.taxLbp, 0);
    const vatRate = subtotalUsd > 0 ? (taxUsd / subtotalUsd) : 0;
    return {
      subtotalUsd,
      subtotalLbp,
      taxUsd,
      taxLbp,
      totalUsd: subtotalUsd + taxUsd,
      totalLbp: subtotalLbp + taxLbp,
      vatRate,
    };
  })();

  $: totalsByCompany = (() => {
    const byCompany = cartVatSnapshot?.byCompany || {};
    return {
      official: byCompany.official || { subtotalUsd: 0, taxUsd: 0, totalUsd: 0 },
      unofficial: byCompany.unofficial || { subtotalUsd: 0, taxUsd: 0, totalUsd: 0 },
    };
  })();
  const _roundUsd = (value) => Math.max(0, Math.round((toNum(value, 0) + 1e-9) * 100) / 100);
  const _sumLineTotalUsd = (lines) => {
    let total = 0;
    for (const ln of (lines || [])) {
      const row = cartLineAmounts(ln);
      total += toNum(row.baseUsd, 0) + toNum(row.taxUsd, 0);
    }
    return _roundUsd(total);
  };
  const _assertSplitTotalsConsistent = (groups = []) => {
    let grouped = 0;
    for (const g of (groups || [])) grouped += _sumLineTotalUsd(g?.lines || []);
    const cartTotal = _roundUsd(totals?.totalUsd || 0);
    const delta = Math.abs(_roundUsd(grouped) - cartTotal);
    if (delta > 0.01) {
      throw new Error(`Checkout guardrail: split totals mismatch by ${delta.toFixed(2)} USD.`);
    }
  };
  const _companyListText = (keys = []) => (
    Array.from(new Set((keys || []).map((k) => normalizeCompanyKey(k)))).map((k) => (k === "unofficial" ? "Unofficial" : "Official")).join(", ")
  );
  const requiredCompaniesForCheckout = () => {
    const companies = cartCompaniesSet();
    if (!companies.size) return [];
    if (saleMode !== "sale") {
      if (companies.size > 1) return ["official", "unofficial"].filter((k) => companies.has(k));
      return [primaryCompanyFromCart() || originCompanyKey];
    }
    if (flagOfficial) return ["official"];
    if (companies.size > 1 && invoiceCompanyMode === "auto") {
      return ["official", "unofficial"].filter((k) => companies.has(k));
    }
    return [effectiveInvoiceCompany()];
  };
  $: checkoutRequiredCompanies = requiredCompaniesForCheckout();
  $: checkoutMissingCashiers = checkoutRequiredCompanies.filter((k) => !cashierIdForCompany(k));
  $: checkoutMissingShifts = checkoutRequiredCompanies.filter((k) => !shiftIdForCompany(k));
  $: checkoutBlockReason = (() => {
    if (!cart.length) return "";
    if (checkoutMissingCashiers.length) return `Cashier sign-in required: ${_companyListText(checkoutMissingCashiers)}.`;
    if (checkoutMissingShifts.length) return `Open shift required: ${_companyListText(checkoutMissingShifts)}.`;
    return "";
  })();
  $: checkoutBlocked = !!checkoutBlockReason;

  const _itemHay = (e) => `${e?.sku || ""} ${e?.name || ""} ${e?.barcode || ""}`.toLowerCase();

  const _buildBarcodeIndex = (list) => {
    const m = new Map();
    for (const b of list || []) {
      const keys = _scanKeyVariants(b?.barcode || "");
      if (!keys.length) continue;
      for (const key of keys) {
        if (!m.has(key)) m.set(key, b);
      }
    }
    return m;
  };

  const _findBarcodeInIndex = (idx, code) => {
    for (const key of _scanKeyVariants(code)) {
      const hit = idx?.get(key);
      if (hit) return hit;
    }
    return null;
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
  const _normalizeAgentOrigin = (value) => _normalizeOriginUrl(value);

  const _hasOtherAgentOrigin = () => !!_normalizeAgentOrigin(otherAgentUrl);

  const _companyUsesCloudTransport = (companyKey) => {
    if (webHostUnsupported) return true;
    if (companyKey !== otherCompanyKey) return false;
    // Desktop fallback: when no second local agent URL is set,
    // route unofficial traffic through cloud-device APIs.
    return !_hasOtherAgentOrigin();
  };

  const _hasCloudDeviceConfig = (companyKey) => {
    const cfg = cfgForCompanyKey(companyKey) || {};
    return !!String(cfg.device_id || "").trim() && !!String(cfg.device_token || "").trim();
  };

  const _agentApiPrefix = (companyKey) => {
    if (companyKey === otherCompanyKey) {
      if (webHostUnsupported) return apiBase;
      return `${_normalizeAgentOrigin(otherAgentUrl)}${apiBase}`;
    }
    return apiBase;
  };

  const _agentReceiptUrl = (companyKey) => {
    if (companyKey === otherCompanyKey) return `${_normalizeAgentOrigin(otherAgentUrl)}/receipt/last`;
    return "/receipt/last";
  };

  const _webConfigStorageKey = (companyKey) => (
    companyKey === otherCompanyKey ? WEB_CONFIG_UNOFFICIAL_STORAGE_KEY : WEB_CONFIG_OFFICIAL_STORAGE_KEY
  );

  const _setCfgForCompanyKey = (companyKey, patch = {}) => {
    const current = cfgForCompanyKey(companyKey) || {};
    const nextCfg = { ...current, ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(patch || {}, "device_token")) {
      nextCfg.has_device_token = !!String(nextCfg.device_token || "").trim();
    } else if (typeof nextCfg.has_device_token !== "boolean") {
      nextCfg.has_device_token = !!String(nextCfg.device_token || "").trim();
    }
    if (companyKey === otherCompanyKey) unofficialConfig = nextCfg;
    else config = nextCfg;
    if (Object.prototype.hasOwnProperty.call(patch || {}, "company_id")) {
      _invalidateWebCatalogCache(companyKey);
    }
    try { localStorage.setItem(_webConfigStorageKey(companyKey), JSON.stringify(nextCfg)); } catch (_) {}
    return nextCfg;
  };

  const _sanitizeConfigPatch = (patch = {}) => {
    const body = { ...(patch || {}) };
    // VAT is derived from company master config (/pos/config), never user-edited.
    delete body.vat_rate;
    delete body.vat_codes;
    return body;
  };

  const requestHeaders = (companyKey = "official") => {
    const h = { "Content-Type": "application/json" };
    const tok = companyKey === otherCompanyKey ? unofficialSessionToken : sessionToken;
    if (tok) h["X-POS-Session"] = tok;
    if (webHostUnsupported) {
      const cfg = cfgForCompanyKey(companyKey);
      const deviceId = String(cfg?.device_id || "").trim();
      const deviceToken = String(cfg?.device_token || "").trim();
      if (deviceId) h["X-Device-Id"] = deviceId;
      if (deviceToken) h["X-Device-Token"] = deviceToken;
    }
    return h;
  };

  const _webPosApiBaseFor = (companyKey) => {
    const cfg = cfgForCompanyKey(companyKey) || {};
    const candidate = String(cfg.cloud_api_base_url || cfg.api_base_url || apiBase || "").trim();
    const normalized = _normalizeCloudApiBase(candidate || apiBase || "/api");
    return normalized || "/api";
  };

  const _webPosCall = async (companyKey, path, { method = "GET", body = null, timeoutMs = 18000 } = {}) => {
    const cfg = cfgForCompanyKey(companyKey) || {};
    const deviceId = String(cfg.device_id || "").trim();
    const deviceToken = String(cfg.device_token || "").trim();
    if (!deviceId || !deviceToken) {
      const err = new Error("Device is not connected. Run Express Setup first.");
      err.status = 400;
      throw err;
    }

    const base = _webPosApiBaseFor(companyKey);
    const p = String(path || "").replace(/^\/+/, "");
    const url = `${base}/${p}`;
    const headers = {
      "Content-Type": "application/json",
      "X-Device-Id": deviceId,
      "X-Device-Token": deviceToken,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.max(1000, toNum(timeoutMs, 18000)));
    try {
      const res = await fetch(url, {
        method: String(method || "GET").toUpperCase(),
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = text ? { raw: text } : null; }
      if (!res.ok) {
        const msg = data?.detail || data?.error || res.statusText || `HTTP ${res.status}`;
        const err = new Error(String(msg));
        err.status = res.status;
        err.payload = data;
        throw err;
      }
      return data || {};
    } catch (e) {
      if (e?.name === "AbortError") {
        const err = new Error("Cloud POS request timed out.");
        err.status = 408;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const _isDeviceTokenError = (errLike) => {
    const statusCode = toNum(errLike?.status, 0);
    const msg = String(errLike?.message || errLike?.detail || errLike || "").trim().toLowerCase();
    if (statusCode === 401 || statusCode === 403) {
      if (msg.includes("device token") || msg.includes("missing device") || msg.includes("device credentials")) return true;
    }
    return msg.includes("invalid device token");
  };

  const _invalidateWebCatalogCache = (companyKey = null) => {
    if (companyKey == null) {
      webCatalogCache = new Map();
      return;
    }
    const next = new Map(webCatalogCache);
    next.delete(String(companyKey || ""));
    webCatalogCache = next;
  };

  const _getWebCatalog = async (companyKey, cfg, { force = false } = {}) => {
    const key = String(companyKey || "");
    const now = Date.now();
    const cached = webCatalogCache.get(key);
    if (!force && cached?.data && (now - toNum(cached.at, 0)) <= WEB_CATALOG_CACHE_TTL_MS) {
      return cached.data;
    }
    if (!force && cached?.promise) {
      return await cached.promise;
    }
    const companyId = String(cfg?.company_id || "").trim();
    const q = companyId ? `?company_id=${encodeURIComponent(companyId)}` : "";
    const promise = _webPosCall(companyKey, `/pos/catalog${q}`, { method: "GET" })
      .then((res) => ({ items: Array.isArray(res?.items) ? res.items : [] }));
    webCatalogCache.set(key, { ...cached, promise });
    try {
      const data = await promise;
      webCatalogCache.set(key, { at: Date.now(), data, promise: null });
      return data;
    } catch (e) {
      webCatalogCache.delete(key);
      throw e;
    }
  };

  const _toVatCodeMap = (vatCodes) => {
    const map = {};
    for (const row of vatCodes || []) {
      const id = String(row?.id || "").trim();
      if (!id) continue;
      map[id] = normalizeVatRate(row?.rate);
    }
    return map;
  };

  const _withDualAmounts = (usd, lbp, exchangeRate) => {
    let u = toNum(usd, 0);
    let l = toNum(lbp, 0);
    const ex = toNum(exchangeRate, 0);
    if (l === 0 && ex > 0 && u !== 0) l = u * ex;
    if (u === 0 && ex > 0 && l !== 0) u = l / ex;
    return { usd: u, lbp: l };
  };

  const _buildSalePayloadWeb = (cartLines, cfg, payload = {}) => {
    const exchangeRate = toNum(payload.exchange_rate, toNum(cfg.exchange_rate, 0));
    const pricingCurrency = String(payload.pricing_currency || cfg.pricing_currency || "USD").toUpperCase();
    const settlementCurrency = normalizeSettlementCurrency(pricingCurrency);
    const defaultTaxCodeId = payload.tax_code_id || cfg.tax_code_id || null;
    const vatRate = normalizeVatRate(cfg.vat_rate);
    const vatCodes = (cfg.vat_codes && typeof cfg.vat_codes === "object") ? cfg.vat_codes : {};

    let baseUsd = 0;
    let baseLbp = 0;
    const lines = (cartLines || []).map((line) => {
      const qty = Math.max(0, toNum(line.qty, 0));
      const qtyFactor = Math.max(1e-9, toNum(line.qty_factor, 1));
      const qtyEntered = line.qty_entered != null ? toNum(line.qty_entered, 0) : (qty / qtyFactor);
      const unitUsd = toNum(line.price_usd, 0);
      const unitLbp = toNum(line.price_lbp, 0);
      const totals = _withDualAmounts(unitUsd * qty, unitLbp * qty, exchangeRate);
      baseUsd += totals.usd;
      baseLbp += totals.lbp;
      return {
        item_id: String(line.id || "").trim(),
        tax_code_id: line.tax_code_id || null,
        qty,
        uom: line.uom || line.unit_of_measure || null,
        qty_factor: qtyFactor,
        qty_entered: qtyEntered,
        unit_price_usd: unitUsd,
        unit_price_lbp: unitLbp,
        unit_price_entered_usd: unitUsd * qtyFactor,
        unit_price_entered_lbp: unitLbp * qtyFactor,
        pre_discount_unit_price_usd: toNum(line.pre_discount_unit_price_usd, 0),
        pre_discount_unit_price_lbp: toNum(line.pre_discount_unit_price_lbp, 0),
        discount_pct: toNum(line.discount_pct, 0),
        discount_amount_usd: toNum(line.discount_amount_usd, 0),
        discount_amount_lbp: toNum(line.discount_amount_lbp, 0),
        applied_promotion_id: line.applied_promotion_id || null,
        applied_promotion_item_id: line.applied_promotion_item_id || null,
        line_total_usd: totals.usd,
        line_total_lbp: totals.lbp,
        unit_cost_usd: 0,
        unit_cost_lbp: 0,
        batch_no: line.batch_no || null,
        expiry_date: line.expiry_date || null,
      };
    });

    let taxUsd = 0;
    let taxLbp = 0;
    const taxBreakdown = [];
    const hasVatCodes = Object.keys(vatCodes).length > 0;
    if (vatRate || hasVatCodes) {
      const baseByTax = new Map();
      for (const ln of lines) {
        const taxCodeId = String(ln.tax_code_id || defaultTaxCodeId || "").trim();
        if (!taxCodeId) continue;
        if (hasVatCodes && !Object.prototype.hasOwnProperty.call(vatCodes, taxCodeId) && String(defaultTaxCodeId || "") !== taxCodeId) {
          continue;
        }
        if (!baseByTax.has(taxCodeId)) baseByTax.set(taxCodeId, { usd: 0, lbp: 0 });
        const b = baseByTax.get(taxCodeId);
        b.usd += toNum(ln.line_total_usd, 0);
        b.lbp += toNum(ln.line_total_lbp, 0);
      }
      for (const [taxCodeId, b] of baseByTax.entries()) {
        let rate = Object.prototype.hasOwnProperty.call(vatCodes, taxCodeId) ? normalizeVatRate(vatCodes[taxCodeId]) : vatRate;
        if (!rate && String(defaultTaxCodeId) === taxCodeId) rate = vatRate;
        const lineTaxLbp = b.lbp * rate;
        const lineTaxUsd = exchangeRate > 0 ? (lineTaxLbp / exchangeRate) : 0;
        taxUsd += lineTaxUsd;
        taxLbp += lineTaxLbp;
        taxBreakdown.push({
          tax_code_id: taxCodeId,
          base_usd: b.usd,
          base_lbp: b.lbp,
          tax_usd: lineTaxUsd,
          tax_lbp: lineTaxLbp,
          tax_date: new Date().toISOString().slice(0, 10),
        });
      }
    }
    const taxCodeForBlock = defaultTaxCodeId || (taxBreakdown[0]?.tax_code_id || null);
    const hasTax = taxBreakdown.length > 0 || taxUsd !== 0 || taxLbp !== 0;

    const totalUsd = Math.round((baseUsd + taxUsd + 1e-9) * 100) / 100;
    const totalLbp = Math.round(baseLbp + taxLbp + 1e-9);
    const paymentMethod = String(payload.payment_method || "cash").trim().toLowerCase();
    const payments = buildSalePaymentsForSettlement({
      paymentMethod,
      totalUsd,
      totalLbp,
      settlementCurrency,
    });
    assertPaymentsWithinTotals({
      paymentMethod,
      settlementCurrency,
      totalUsd,
      totalLbp,
      payments,
    });

    return {
      invoice_no: null,
      exchange_rate: exchangeRate,
      pricing_currency: pricingCurrency,
      settlement_currency: settlementCurrency,
      customer_id: payload.customer_id || null,
      warehouse_id: cfg.warehouse_id || null,
      shift_id: payload.shift_id || cfg.shift_id || null,
      cashier_id: payload.cashier_id || cfg.cashier_id || null,
      lines,
      tax: hasTax ? {
        tax_code_id: taxCodeForBlock,
        base_usd: baseUsd,
        base_lbp: baseLbp,
        tax_usd: taxUsd,
        tax_lbp: taxLbp,
        tax_date: new Date().toISOString().slice(0, 10),
      } : null,
      tax_breakdown: taxBreakdown,
      payments,
      loyalty_points: baseUsd * toNum(cfg.loyalty_rate, 0),
      receipt_meta: payload.receipt_meta || null,
      skip_stock_moves: !!payload.skip_stock_moves,
    };
  };

  const _buildReturnPayloadWeb = (cartLines, cfg, payload = {}) => {
    const salePayload = _buildSalePayloadWeb(cartLines, cfg, {
      ...payload,
      payment_method: payload.refund_method || payload.payment_method || "cash",
      customer_id: null,
    });
    return {
      return_no: null,
      invoice_id: payload.invoice_id || null,
      exchange_rate: salePayload.exchange_rate,
      pricing_currency: salePayload.pricing_currency,
      settlement_currency: salePayload.settlement_currency,
      warehouse_id: salePayload.warehouse_id,
      shift_id: salePayload.shift_id,
      cashier_id: salePayload.cashier_id,
      refund_method: String(payload.refund_method || payload.payment_method || "cash").trim().toLowerCase(),
      lines: salePayload.lines,
      tax: salePayload.tax,
      tax_breakdown: salePayload.tax_breakdown || [],
      receipt_meta: payload.receipt_meta || null,
      skip_stock_moves: !!payload.skip_stock_moves,
    };
  };

  const _isPermanentCloudError = (err) => {
    const statusCode = toNum(err?.status, 0);
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) return true;
    const msg = String(err?.message || "").trim().toLowerCase();
    if (!msg) return false;
    return (
      msg.includes("payment exceeds invoice total")
      || msg.includes("payments exceed invoice total")
      || msg.includes("checkout guardrail")
      || msg.includes("missing")
      || msg.includes("invalid")
    );
  };

  const _nextRetryIso = (retryCount = 0) => {
    const steps = [20, 45, 90, 180, 300, 600];
    const idx = Math.max(0, Math.min(steps.length - 1, toNum(retryCount, 0)));
    return new Date(Date.now() + (steps[idx] * 1000)).toISOString();
  };

  const _submitAndProcessPosEventWebRemote = async (
    companyKey,
    eventType,
    payload,
    idempotencyKey = "",
    forcedEventId = "",
  ) => {
    const key = String(idempotencyKey || "").trim();
    const cfg = cfgForCompanyKey(companyKey) || {};
    const eventId = String(forcedEventId || "").trim() || makeUuid();
    const createdAt = new Date().toISOString();
    const submitRes = await _webPosCall(companyKey, "/pos/outbox/submit", {
      method: "POST",
      body: {
        company_id: cfg.company_id || null,
        device_id: cfg.device_id,
        events: [{ event_id: eventId, event_type: eventType, payload, created_at: createdAt, idempotency_key: key || null }],
      },
    });
    const rejected = Array.isArray(submitRes?.rejected) ? submitRes.rejected : [];
    const rejectedCurrent = rejected.find((r) => String(r?.event_id || "") === eventId);
    if (rejectedCurrent) {
      const msg = String(rejectedCurrent?.error || "outbox submit rejected");
      throw new Error(msg);
    }
    const acceptedMeta = Array.isArray(submitRes?.accepted_meta) ? submitRes.accepted_meta : [];
    const meta = acceptedMeta.find((m) => String(m?.event_id || "") === eventId) || acceptedMeta[0] || null;
    const duplicateReplay = String(meta?.status || "") === "duplicate";
    const processEventId = String(meta?.existing_event_id || meta?.event_id || eventId).trim() || eventId;

    const processed = await _webPosCall(companyKey, "/pos/outbox/process-one", {
      method: "POST",
      body: { event_id: processEventId, force: true },
    });
    const out = {
      event_id: processEventId,
      edge_accepted: true,
      idempotent_replay: duplicateReplay,
      invoice_id: processed?.invoice_id || null,
      invoice_no: processed?.invoice_no || null,
    };
    if (out.invoice_id) webEventInvoiceMap.set(processEventId, out.invoice_id);
    return out;
  };
  const _submitAndProcessPosEventWeb = async (companyKey, eventType, payload, idempotencyKey = "") => {
    const localEvent = _appendWebLocalOutboxEvent(companyKey, eventType, payload, idempotencyKey);
    const action = eventType === "sale.returned" ? "return.submit" : "sale.submit";
    _appendWebAudit(companyKey, {
      action,
      cashier_id: String(payload?.cashier_id || "").trim() || null,
      shift_id: String(payload?.shift_id || "").trim() || null,
      event_id: String(localEvent?.event_id || "").trim(),
      status: "queued_local",
      details: { event_type: eventType, idempotency_key: idempotencyKey || null },
    });
    try {
      const remote = await _submitAndProcessPosEventWebRemote(companyKey, eventType, payload, idempotencyKey);
      _removeWebLocalOutboxEvent(companyKey, localEvent?.event_id || "");
      _appendWebAudit(companyKey, {
        action,
        cashier_id: String(payload?.cashier_id || "").trim() || null,
        shift_id: String(payload?.shift_id || "").trim() || null,
        event_id: String(remote?.event_id || "").trim() || null,
        status: "acked",
        details: { event_type: eventType, idempotent_replay: !!remote?.idempotent_replay },
      });
      return remote;
    } catch (e) {
      const retryCount = toNum(localEvent?.retry_count, 0) + 1;
      const permanent = _isPermanentCloudError(e);
      const nextStatus = permanent ? "dead" : "failed";
      const updated = _patchWebLocalOutboxEvent(companyKey, localEvent?.event_id || "", {
        status: nextStatus,
        retry_count: retryCount,
        last_error: e?.message || String(e),
        next_attempt_at: permanent ? null : _nextRetryIso(retryCount),
      });
      _appendWebAudit(companyKey, {
        action,
        cashier_id: String(payload?.cashier_id || "").trim() || null,
        shift_id: String(payload?.shift_id || "").trim() || null,
        event_id: String(localEvent?.event_id || "").trim(),
        status: nextStatus,
        details: { event_type: eventType, error: e?.message || String(e) },
      });
      if (permanent) {
        const err = new Error(e?.message || "Cloud processing rejected this event.");
        err.status = e?.status || 409;
        err.payload = e?.payload || null;
        throw err;
      }
      return {
        event_id: String(updated?.event_id || localEvent?.event_id || "").trim(),
        edge_accepted: true,
        sync_deferred: true,
        queued_local: true,
        idempotent_replay: false,
      };
    }
  };

  const _escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const _fmtMoney = (value, digits = 2) => {
    const n = toNum(value, 0);
    return n.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  };

  const _fmtDateTime = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return raw;
    return new Date(ms).toLocaleString();
  };

  const _resolveInvoiceByEventWeb = async (companyKey, eventId) => {
    const eid = String(eventId || "").trim();
    if (!eid) throw new Error("event_id is required");
    const cached = webEventInvoiceMap.get(eid);
    if (cached) return { event_id: eid, invoice_id: cached };
    const processed = await _webPosCall(companyKey, "/pos/outbox/process-one", {
      method: "POST",
      body: { event_id: eid, force: true },
    });
    const invoiceId = String(processed?.invoice_id || "").trim();
    if (invoiceId) webEventInvoiceMap.set(eid, invoiceId);
    return { event_id: eid, invoice_id: invoiceId || null };
  };

  const _fetchInvoiceDetailWeb = async (companyKey, invoiceId) => {
    const invId = String(invoiceId || "").trim();
    if (!invId) throw new Error("invoice_id is required");
    return await _webPosCall(companyKey, `/pos/sales-invoices/${encodeURIComponent(invId)}`, { method: "GET" });
  };

  const _fetchLastReceiptDetailWeb = async (companyKey) => {
    return await _webPosCall(companyKey, "/pos/receipts/last", { method: "GET" });
  };

  const _openManagedPrintWindow = () => {
    try {
      const w = window.open("", "_blank");
      if (w) return w;
    } catch (_) {}
    try {
      const w = window.open("about:blank", "_blank");
      if (w) return w;
    } catch (_) {}
    return null;
  };

  const _openPrintWindowWithHtml = (html, receiptWin = null) => {
    let win = receiptWin;
    try {
      if (!win || win.closed) {
        win = _openManagedPrintWindow();
      }
    } catch (_) {
      win = null;
    }
    if (!win) {
      throw new Error("Unable to open print window. Please allow popups for this site.");
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
      try { win.focus(); win.print(); } catch (_) {}
    }, 80);
    return win;
  };

  const _renderInvoicePrintHtmlWeb = (companyKey, detail, cfg, { thermal = false } = {}) => {
    const inv = (detail && detail.invoice && typeof detail.invoice === "object") ? detail.invoice : {};
    const lines = Array.isArray(detail?.lines) ? detail.lines : [];
    const payments = Array.isArray(detail?.payments) ? detail.payments : [];
    const taxLines = Array.isArray(detail?.tax_lines) ? detail.tax_lines : [];
    const taxUsd = taxLines.length
      ? taxLines.reduce((s, r) => s + toNum(r?.tax_usd, 0), 0)
      : Math.max(0, toNum(inv?.total_usd, 0) - toNum(inv?.subtotal_usd, 0));
    const taxLbp = taxLines.length
      ? taxLines.reduce((s, r) => s + toNum(r?.tax_lbp, 0), 0)
      : Math.max(0, toNum(inv?.total_lbp, 0) - toNum(inv?.subtotal_lbp, 0));

    const fallbackName = companyKey === "official" ? "Official Invoice" : "Sales Receipt";
    const companyName = String(cfg?.receipt_company_name || fallbackName).trim() || fallbackName;
    const footerText = String(cfg?.receipt_footer_text || "").trim();
    const docNo = String(inv?.receipt_no || inv?.invoice_no || "").trim();
    const docDate = _fmtDateTime(inv?.created_at || inv?.invoice_date || "");
    const customerName = String(inv?.customer_name || "Walk-in Customer").trim();
    const paymentHtml = payments.length
      ? payments
        .map((p) => {
          const method = _escapeHtml(String(p?.method || "payment").toUpperCase());
          const usd = _fmtMoney(p?.amount_usd, 2);
          const lbp = _fmtMoney(p?.amount_lbp, 2);
          return `<div>${method}: USD ${usd} | LBP ${lbp}</div>`;
        })
        .join("")
      : "<div>Unpaid / Credit</div>";

    const lineRows = thermal
      ? lines.map((ln) => `
          <tr>
            <td>${_escapeHtml(String(ln?.item_name || ln?.item_sku || "Item"))}</td>
            <td class="r">${_fmtMoney(ln?.qty, 2)}</td>
            <td class="r">${_fmtMoney(ln?.line_total_lbp, 2)}</td>
          </tr>
        `).join("")
      : lines.map((ln, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${_escapeHtml(String(ln?.item_name || ln?.item_sku || "Item"))}</td>
            <td class="r">${_fmtMoney(ln?.qty, 2)}</td>
            <td class="r">${_fmtMoney(ln?.unit_price_usd, 2)}</td>
            <td class="r">${_fmtMoney(ln?.line_total_usd, 2)}</td>
            <td class="r">${_fmtMoney(ln?.line_total_lbp, 2)}</td>
          </tr>
        `).join("");

    const pageSize = thermal ? "80mm auto" : "A4";
    const margin = thermal ? "4mm" : "10mm";
    const thCols = thermal
      ? "<th>Item</th><th class='r'>Qty</th><th class='r'>LBP</th>"
      : "<th>#</th><th>Item</th><th class='r'>Qty</th><th class='r'>Unit USD</th><th class='r'>Line USD</th><th class='r'>Line LBP</th>";
    const noLinesColspan = thermal ? 3 : 6;

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${_escapeHtml(docNo || "Print")}</title>
  <style>
    @page { size: ${pageSize}; margin: ${margin}; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; margin: 0; }
    .wrap { padding: 8px; }
    .hd { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    .name { font-weight: 700; font-size: ${thermal ? "14px" : "18px"}; }
    .muted { color: #555; font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: 12px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: ${thermal ? "11px" : "12px"}; }
    th, td { border-bottom: 1px solid #ddd; padding: 4px 2px; text-align: left; vertical-align: top; }
    th { font-weight: 700; }
    .r { text-align: right; }
    .tot { margin-top: 8px; font-size: 12px; }
    .tot .row { display: flex; justify-content: space-between; margin: 2px 0; }
    .tot .bold { font-weight: 700; border-top: 1px solid #111; padding-top: 4px; margin-top: 4px; }
    .pay { margin-top: 8px; font-size: 12px; }
    .foot { margin-top: 10px; font-size: 11px; color: #444; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hd">
      <div class="name">${_escapeHtml(companyName)}</div>
      <div class="muted">${thermal ? "RECEIPT" : "INVOICE"}</div>
    </div>
    <div class="grid">
      <div><strong>No:</strong> ${_escapeHtml(docNo || "-")}</div>
      <div><strong>Date:</strong> ${_escapeHtml(docDate || "-")}</div>
      <div><strong>Customer:</strong> ${_escapeHtml(customerName)}</div>
      <div><strong>Status:</strong> ${_escapeHtml(String(inv?.status || "").toUpperCase() || "-")}</div>
    </div>
    <table>
      <thead><tr>${thCols}</tr></thead>
      <tbody>${lineRows || `<tr><td colspan="${noLinesColspan}">No lines</td></tr>`}</tbody>
    </table>
    <div class="tot">
      <div class="row"><span>Subtotal USD</span><span>USD ${_fmtMoney(inv?.subtotal_usd, 2)}</span></div>
      <div class="row"><span>VAT USD</span><span>USD ${_fmtMoney(taxUsd, 2)}</span></div>
      <div class="row"><span>Total USD</span><span>USD ${_fmtMoney(inv?.total_usd, 2)}</span></div>
      <div class="row bold"><span>Total LBP</span><span>LBP ${_fmtMoney(inv?.total_lbp, 2)}</span></div>
      <div class="row"><span>VAT LBP</span><span>LBP ${_fmtMoney(taxLbp, 2)}</span></div>
    </div>
    <div class="pay"><strong>Payments</strong>${paymentHtml}</div>
    ${footerText ? `<div class="foot">${_escapeHtml(footerText)}</div>` : ""}
  </div>
</body>
</html>`;
  };

  const _printInvoiceDetailWeb = async (companyKey, detail, receiptWin = null, { thermal = false } = {}) => {
    const cfg = cfgForCompanyKey(companyKey) || {};
    const html = _renderInvoicePrintHtmlWeb(companyKey, detail || {}, cfg, { thermal });
    _openPrintWindowWithHtml(html, receiptWin);
    return { ok: true, invoice_id: detail?.invoice?.id || null };
  };

  const _resolvePrintBaseUrl = (companyKey, cfg = null) => {
    const localCfg = cfg || cfgForCompanyKey(companyKey) || {};
    const explicit = _normalizeOriginUrl(String(localCfg?.print_base_url || "").trim());
    if (explicit) return explicit;
    const fromApi = _adminBaseFromApiBase(_webPosApiBaseFor(companyKey));
    if (fromApi) return fromApi;
    try {
      return _normalizeOriginUrl(String(window?.location?.origin || "").trim());
    } catch (_) {
      return "";
    }
  };

  const _invoicePdfUrlFromCfg = (companyKey, cfg, invoiceId) => {
    const invId = String(invoiceId || "").trim();
    const pb = _resolvePrintBaseUrl(companyKey, cfg);
    if (!invId || !pb) return "";
    const tplRaw = String(cfg?.invoice_template || "official_classic").trim().toLowerCase();
    const tpl = (tplRaw === "official_classic" || tplRaw === "official_compact" || tplRaw === "standard")
      ? tplRaw
      : "official_classic";
    return `${pb}/exports/sales-invoices/${encodeURIComponent(invId)}/pdf?inline=1&template=${encodeURIComponent(tpl)}`;
  };

  const _receiptPdfUrlFromCfg = (companyKey, cfg, invoiceId) => {
    const invId = String(invoiceId || "").trim();
    const pb = _resolvePrintBaseUrl(companyKey, cfg);
    if (!invId || !pb) return "";
    return `${pb}/exports/sales-receipts/${encodeURIComponent(invId)}/pdf?inline=1`;
  };

  const _openPrintWindowWithUrl = (url, receiptWin = null) => {
    const u = String(url || "").trim();
    if (!u) return false;
    try {
      if (receiptWin && !receiptWin.closed) {
        receiptWin.location = u;
        return true;
      }
    } catch (_) {}
    try {
      window.open(u, "_blank", "noopener,noreferrer");
      return true;
    } catch (_) {}
    return false;
  };

  const _printInvoiceByEventWeb = async (companyKey, eventId, receiptWin = null, { thermal = false } = {}) => {
    const resolved = await _resolveInvoiceByEventWeb(companyKey, eventId);
    const invoiceId = String(resolved?.invoice_id || "").trim();
    if (!invoiceId) throw new Error("invoice not found for event");
    if (thermal && companyKey !== "official") {
      const cfg = cfgForCompanyKey(companyKey) || {};
      const pdfUrl = _receiptPdfUrlFromCfg(companyKey, cfg, invoiceId);
      if (_openPrintWindowWithUrl(pdfUrl, receiptWin)) {
        return { ok: true, event_id: resolved.event_id, invoice_id: invoiceId };
      }
    }
    if (!thermal && companyKey === "official") {
      const cfg = cfgForCompanyKey(companyKey) || {};
      const pdfUrl = _invoicePdfUrlFromCfg(companyKey, cfg, invoiceId);
      if (_openPrintWindowWithUrl(pdfUrl, receiptWin)) {
        return { ok: true, event_id: resolved.event_id, invoice_id: invoiceId };
      }
    }
    const detail = await _fetchInvoiceDetailWeb(companyKey, invoiceId);
    await _printInvoiceDetailWeb(companyKey, detail, receiptWin, { thermal });
    return { ok: true, event_id: resolved.event_id, invoice_id: invoiceId };
  };

  const _printLastReceiptWeb = async (companyKey, receiptWin = null, { thermal = false } = {}) => {
    const res = await _fetchLastReceiptDetailWeb(companyKey);
    const detail = res?.receipt || null;
    const invoiceId = String(detail?.invoice?.id || "").trim();
    if (!invoiceId) throw new Error("No receipt found for this device.");
    if (thermal && companyKey !== "official") {
      const cfg = cfgForCompanyKey(companyKey) || {};
      const pdfUrl = _receiptPdfUrlFromCfg(companyKey, cfg, invoiceId);
      if (_openPrintWindowWithUrl(pdfUrl, receiptWin)) {
        return { ok: true, invoice_id: invoiceId };
      }
    }
    if (!thermal && companyKey === "official") {
      const cfg = cfgForCompanyKey(companyKey) || {};
      const pdfUrl = _invoicePdfUrlFromCfg(companyKey, cfg, invoiceId);
      if (_openPrintWindowWithUrl(pdfUrl, receiptWin)) {
        return { ok: true, invoice_id: invoiceId };
      }
    }
    await _printInvoiceDetailWeb(companyKey, detail, receiptWin, { thermal });
    return { ok: true, invoice_id: invoiceId };
  };

  const _resolveReturnByEventWeb = async (companyKey, eventId) => {
    const eid = String(eventId || "").trim();
    if (!eid) throw new Error("event_id is required");
    const processed = await _webPosCall(companyKey, "/pos/outbox/process-one", {
      method: "POST",
      body: { event_id: eid, force: true },
    });
    const retId = String(processed?.return_id || "").trim();
    if (retId) return { event_id: eid, return_id: retId };
    const byEvent = await _webPosCall(companyKey, `/pos/sales-returns/by-event/${encodeURIComponent(eid)}`, { method: "GET" });
    const byEventId = String(byEvent?.return?.id || "").trim();
    return { event_id: eid, return_id: byEventId || null };
  };

  const _fetchReturnDetailWeb = async (companyKey, returnId) => {
    const rid = String(returnId || "").trim();
    if (!rid) throw new Error("return_id is required");
    return await _webPosCall(companyKey, `/pos/sales-returns/${encodeURIComponent(rid)}`, { method: "GET" });
  };

  const _fetchLastReturnDetailWeb = async (companyKey) => {
    return await _webPosCall(companyKey, "/pos/sales-returns/last", { method: "GET" });
  };

  const _renderReturnPrintHtmlWeb = (companyKey, detail, cfg, { thermal = false } = {}) => {
    const ret = (detail && detail.return && typeof detail.return === "object") ? detail.return : {};
    const lines = Array.isArray(detail?.lines) ? detail.lines : [];
    const refunds = Array.isArray(detail?.refunds) ? detail.refunds : [];
    const taxLines = Array.isArray(detail?.tax_lines) ? detail.tax_lines : [];
    const taxUsd = Math.abs(taxLines.reduce((s, r) => s + toNum(r?.tax_usd, 0), 0));
    const taxLbp = Math.abs(taxLines.reduce((s, r) => s + toNum(r?.tax_lbp, 0), 0));

    const fallbackName = companyKey === "official" ? "Official Return" : "Return Receipt";
    const companyName = String(cfg?.receipt_company_name || fallbackName).trim() || fallbackName;
    const footerText = String(cfg?.receipt_footer_text || "").trim();
    const docNo = String(ret?.return_no || "").trim();
    const docDate = _fmtDateTime(ret?.created_at || "");
    const refundHtml = refunds.length
      ? refunds
        .map((r) => `<div>${_escapeHtml(String(r?.method || "refund").toUpperCase())}: USD ${_fmtMoney(r?.amount_usd, 2)} | LBP ${_fmtMoney(r?.amount_lbp, 2)}</div>`)
        .join("")
      : "<div>No refund rows</div>";
    const lineRows = lines.map((ln) => `
      <tr>
        <td>${_escapeHtml(String(ln?.item_id || "Item"))}</td>
        <td class="r">${_fmtMoney(ln?.qty, 2)}</td>
        <td class="r">${_fmtMoney(ln?.line_total_usd, 2)}</td>
        <td class="r">${_fmtMoney(ln?.line_total_lbp, 2)}</td>
      </tr>
    `).join("");

    const pageSize = thermal ? "80mm auto" : "A4";
    const margin = thermal ? "4mm" : "10mm";
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${_escapeHtml(docNo || "Return Print")}</title>
  <style>
    @page { size: ${pageSize}; margin: ${margin}; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; margin: 0; }
    .wrap { padding: 8px; }
    .hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    .name { font-weight: 700; font-size: ${thermal ? "14px" : "18px"}; }
    .muted { color: #555; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: ${thermal ? "11px" : "12px"}; }
    th, td { border-bottom: 1px solid #ddd; padding: 4px 2px; text-align: left; }
    .r { text-align: right; }
    .tot { margin-top: 8px; font-size: 12px; }
    .tot .row { display: flex; justify-content: space-between; margin: 2px 0; }
    .tot .bold { font-weight: 700; border-top: 1px solid #111; padding-top: 4px; margin-top: 4px; }
    .foot { margin-top: 10px; font-size: 11px; color: #444; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hd">
      <div class="name">${_escapeHtml(companyName)}</div>
      <div class="muted">RETURN</div>
    </div>
    <div class="muted">No: ${_escapeHtml(docNo || "-")} | Date: ${_escapeHtml(docDate || "-")}</div>
    <table>
      <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">USD</th><th class="r">LBP</th></tr></thead>
      <tbody>${lineRows || "<tr><td colspan='4'>No lines</td></tr>"}</tbody>
    </table>
    <div class="tot">
      <div class="row"><span>Total USD</span><span>USD ${_fmtMoney(ret?.total_usd, 2)}</span></div>
      <div class="row bold"><span>Total LBP</span><span>LBP ${_fmtMoney(ret?.total_lbp, 2)}</span></div>
      <div class="row"><span>VAT USD</span><span>USD ${_fmtMoney(taxUsd, 2)}</span></div>
      <div class="row"><span>VAT LBP</span><span>LBP ${_fmtMoney(taxLbp, 2)}</span></div>
      <div class="row"><span>Restocking Fee USD</span><span>USD ${_fmtMoney(ret?.restocking_fee_usd, 2)}</span></div>
      <div class="row"><span>Restocking Fee LBP</span><span>LBP ${_fmtMoney(ret?.restocking_fee_lbp, 2)}</span></div>
    </div>
    <div class="muted" style="margin-top:8px"><strong>Refunds</strong>${refundHtml}</div>
    ${footerText ? `<div class="foot">${_escapeHtml(footerText)}</div>` : ""}
  </div>
</body>
</html>`;
  };

  const _printReturnDetailWeb = async (companyKey, detail, receiptWin = null, { thermal = false } = {}) => {
    const cfg = cfgForCompanyKey(companyKey) || {};
    const html = _renderReturnPrintHtmlWeb(companyKey, detail || {}, cfg, { thermal });
    _openPrintWindowWithHtml(html, receiptWin);
    return { ok: true, return_id: detail?.return?.id || null };
  };

  const _printReturnByEventWeb = async (companyKey, eventId, receiptWin = null, { thermal = false } = {}) => {
    const resolved = await _resolveReturnByEventWeb(companyKey, eventId);
    const returnId = String(resolved?.return_id || "").trim();
    if (!returnId) throw new Error("return not found for event");
    const detail = await _fetchReturnDetailWeb(companyKey, returnId);
    await _printReturnDetailWeb(companyKey, detail, receiptWin, { thermal });
    return { ok: true, event_id: resolved.event_id, return_id: returnId };
  };

  const _printLastReturnWeb = async (companyKey, receiptWin = null, { thermal = false } = {}) => {
    const res = await _fetchLastReturnDetailWeb(companyKey);
    const detail = res?.receipt || null;
    const returnId = String(detail?.return?.id || "").trim();
    if (!returnId) throw new Error("No return receipt found for this device.");
    await _printReturnDetailWeb(companyKey, detail, receiptWin, { thermal });
    return { ok: true, return_id: returnId };
  };

  const _isManagerCashier = (cashier) => _cashierLooksManager(cashier);
  const _hasManagerMeta = (cashier) => _cashierHasManagerMetadata(cashier);
  const _managerApprovalRequiredForPayload = (cfg, eventType, payload) => {
    const pm = String(payload?.payment_method || payload?.refund_method || "").trim().toLowerCase();
    if (eventType === "sale.completed") {
      if (cfg?.require_manager_approval_credit && pm === "credit") return true;
      const pilot = payload?.receipt_meta?.pilot || {};
      if (cfg?.require_manager_approval_cross_company && (pilot?.cross_company || pilot?.flagged_for_adjustment)) return true;
      return false;
    }
    if (eventType === "sale.returned") {
      return !!cfg?.require_manager_approval_returns;
    }
    return false;
  };
  const _flushWebLocalOutbox = async (companyKey, { limit = 30, eventId = "" } = {}) => {
    const key = normalizeCompanyKey(companyKey);
    const targetId = String(eventId || "").trim();
    const nowMs = Date.now();
    const sourceRows = _webLocalOutboxRowsFor(key);
    const queue = sourceRows
      .filter((row) => {
        const rowId = String(row?.event_id || row?.id || "").trim();
        if (!rowId) return false;
        if (targetId) return rowId === targetId;
        const st = String(row?.status || "pending").trim().toLowerCase();
        if (st === "pending") return true;
        if (st !== "failed") return false;
        const nextRaw = String(row?.next_attempt_at || "").trim();
        if (!nextRaw) return true;
        const dueAt = Date.parse(nextRaw);
        return Number.isNaN(dueAt) || dueAt <= nowMs;
      })
      .sort((a, b) => (Date.parse(String(a?.created_at || "")) || 0) - (Date.parse(String(b?.created_at || "")) || 0))
      .slice(0, Math.max(1, toNum(limit, 30)));
    let sent = 0;
    const failed = [];
    for (const row of queue) {
      const rowEventId = String(row?.event_id || row?.id || "").trim();
      if (!rowEventId) continue;
      try {
        const remote = await _submitAndProcessPosEventWebRemote(
          key,
          row?.event_type,
          row?.payload || row?.payload_json || {},
          row?.idempotency_key || "",
          rowEventId.replace(/^local-/, ""),
        );
        _removeWebLocalOutboxEvent(key, rowEventId);
        sent += 1;
        _appendWebAudit(key, {
          action: "outbox.retry",
          cashier_id: String(row?.payload?.cashier_id || "").trim() || null,
          shift_id: String(row?.payload?.shift_id || "").trim() || null,
          event_id: String(remote?.event_id || rowEventId).trim(),
          status: "acked",
          details: { source: "local-outbox", remote_event_id: remote?.event_id || null },
        });
      } catch (e) {
        const retryCount = toNum(row?.retry_count, 0) + 1;
        const permanent = _isPermanentCloudError(e);
        const statusText = permanent ? "dead" : "failed";
        _patchWebLocalOutboxEvent(key, rowEventId, {
          status: statusText,
          retry_count: retryCount,
          last_error: e?.message || String(e),
          next_attempt_at: permanent ? null : _nextRetryIso(retryCount),
        });
        _appendWebAudit(key, {
          action: "outbox.retry",
          cashier_id: String(row?.payload?.cashier_id || "").trim() || null,
          shift_id: String(row?.payload?.shift_id || "").trim() || null,
          event_id: rowEventId,
          status: statusText,
          details: { source: "local-outbox", error: e?.message || String(e) },
        });
        failed.push({ event_id: rowEventId, error: e?.message || String(e) });
      }
    }
    return { sent, failed };
  };

  const _webApiCallFor = async (companyKey, path, options = {}) => {
    const rawPath = String(path || "");
    const method = String(options?.method || "GET").toUpperCase();
    const body = options?.body || {};
    const [pathnameRaw, searchRaw] = rawPath.split("?");
    const pathname = pathnameRaw.startsWith("/") ? pathnameRaw : `/${pathnameRaw}`;
    const params = new URLSearchParams(searchRaw || "");
    const cfg = cfgForCompanyKey(companyKey) || {};

    const cloudSyncStatus = async () => {
      const hasDeviceCreds = !!String(cfg?.device_id || "").trim() && !!String(cfg?.device_token || "").trim();
      if (!hasDeviceCreds) {
        return {
          ok: false,
          sync_ok: false,
          sync_auth_ok: false,
          edge_ok: false,
          edge_auth_ok: false,
          mode: "cloud-setup",
          error: "Device is not connected. Run Express Setup first.",
        };
      }
      try {
        const summary = await _webPosCall(companyKey, "/pos/outbox/device-summary", { method: "GET", timeoutMs: 8000 });
        return {
          ok: true,
          sync_ok: true,
          sync_auth_ok: true,
          edge_ok: true,
          edge_auth_ok: true,
          mode: "cloud-setup",
          summary: summary || null,
        };
      } catch (e) {
        const statusCode = toNum(e?.status, 0);
        const authFailed = statusCode === 401 || statusCode === 403;
        return {
          ok: false,
          sync_ok: false,
          sync_auth_ok: !authFailed,
          edge_ok: false,
          edge_auth_ok: !authFailed,
          mode: "cloud-setup",
          error: e?.message || String(e),
          status: statusCode || null,
        };
      }
    };

    if (method === "GET" && pathname === "/health") {
      const st = await cloudSyncStatus();
      return { ok: !!st.ok, mode: "cloud-setup", error: st.error || null };
    }
    if (method === "GET" && (pathname === "/sync/status" || pathname === "/edge/status")) {
      return await cloudSyncStatus();
    }

    if (method === "POST" && pathname === "/config") {
      const next = _setCfgForCompanyKey(companyKey, _sanitizeConfigPatch(body || {}));
      return { ok: true, config: next };
    }
    if (method === "GET" && pathname === "/config") {
      const posCfg = await _webPosCall(companyKey, "/pos/config", { method: "GET" });
      const rateRes = await _webPosCall(companyKey, "/pos/exchange-rate", { method: "GET" }).catch(() => ({}));
      const openShiftRes = await _webPosCall(companyKey, "/pos/shifts/open", { method: "GET" }).catch(() => ({}));
      const vatCodes = Array.isArray(posCfg?.vat_codes) ? posCfg.vat_codes : [];
      const policyTemplate = String(posCfg?.print_policy?.sales_invoice_pdf_template || "").trim().toLowerCase();
      const next = _setCfgForCompanyKey(companyKey, {
        company_id: String(posCfg?.company_id || cfg.company_id || "").trim(),
        device_id: String(posCfg?.device?.id || cfg.device_id || "").trim(),
        device_code: String(posCfg?.device?.device_code || cfg.device_code || "").trim(),
        branch_id: String(posCfg?.device?.branch_id || cfg.branch_id || "").trim(),
        warehouse_id: posCfg?.default_warehouse_id || cfg.warehouse_id || "",
        tax_code_id: posCfg?.default_vat_tax_code_id || posCfg?.vat?.id || cfg.tax_code_id || null,
        vat_rate: normalizeVatRate(posCfg?.vat?.rate ?? cfg.vat_rate),
        vat_codes: _toVatCodeMap(vatCodes),
        exchange_rate: toNum(rateRes?.rate?.usd_to_lbp, toNum(cfg.exchange_rate, 0)),
        pricing_currency: String(cfg.pricing_currency || posCfg?.company?.base_currency || "USD").toUpperCase(),
        shift_id: String(openShiftRes?.shift?.id || "").trim(),
        invoice_template: policyTemplate || String(cfg.invoice_template || "official_classic").trim().toLowerCase(),
      });
      return next;
    }

    if (method === "GET" && pathname === "/items") {
      const catalog = await _getWebCatalog(companyKey, cfg);
      return { items: catalog?.items || [] };
    }
    if (method === "GET" && pathname === "/barcodes") {
      const catalog = await _getWebCatalog(companyKey, cfg);
      const barcodes = [];
      for (const it of (catalog?.items || [])) {
        const itemId = String(it?.id || "").trim();
        for (const b of (it?.barcodes || [])) {
          barcodes.push({
            id: b?.id || `${itemId}:${b?.barcode || ""}`,
            item_id: itemId,
            barcode: b?.barcode,
            qty_factor: toNum(b?.qty_factor, 1),
            uom_code: b?.uom_code || it?.unit_of_measure || "pcs",
            label: b?.label || "",
            is_primary: !!b?.is_primary,
          });
        }
      }
      return { barcodes };
    }
    if (method === "GET" && pathname.startsWith("/items/") && pathname.endsWith("/batches")) {
      const itemId = pathname.slice("/items/".length, -"/batches".length);
      return await _webPosCall(companyKey, `/pos/items/${encodeURIComponent(itemId)}/batches`, { method: "GET" });
    }
    if (method === "GET" && pathname === "/customers") {
      return await _webPosCall(companyKey, "/pos/customers/catalog", { method: "GET" });
    }
    if (method === "GET" && pathname === "/customers/by-id") {
      const customerId = String(params.get("customer_id") || "").trim();
      if (!customerId) return { customer: null };
      try {
        return await _webPosCall(companyKey, `/pos/customers/${encodeURIComponent(customerId)}`, { method: "GET" });
      } catch (e) {
        if (toNum(e?.status, 0) === 404) return { customer: null };
        throw e;
      }
    }
    if (method === "POST" && pathname === "/customers/create") {
      const name = String(body?.name || "").trim();
      const phone = String(body?.phone || "").trim() || null;
      const email = String(body?.email || "").trim() || null;
      const legalName = String(body?.legal_name || "").trim() || null;
      const membershipNo = String(body?.membership_no || "").trim() || null;
      const taxId = String(body?.tax_id || "").trim() || null;
      const vatNo = String(body?.vat_no || "").trim() || null;
      const notes = String(body?.notes || "").trim() || null;
      const rawPartyType = String(body?.party_type || "individual").trim().toLowerCase();
      const rawCustomerType = String(body?.customer_type || "retail").trim().toLowerCase();
      const partyType = rawPartyType === "business" ? "business" : "individual";
      const customerType = ["retail", "wholesale", "b2b"].includes(rawCustomerType) ? rawCustomerType : "retail";
      const termsRaw = String(body?.payment_terms_days ?? "").trim();
      const parsedTerms = Number.parseInt(termsRaw || "0", 10);
      const paymentTermsDays = Number.isFinite(parsedTerms) && parsedTerms >= 0 ? parsedTerms : 0;
      return await _webPosCall(companyKey, "/pos/customers", {
        method: "POST",
        body: {
          name,
          phone,
          email,
          party_type: partyType,
          customer_type: customerType,
          legal_name: legalName,
          membership_no: membershipNo,
          tax_id: taxId,
          vat_no: vatNo,
          notes,
          marketing_opt_in: !!body?.marketing_opt_in,
          is_member: !!membershipNo,
          payment_terms_days: paymentTermsDays,
          is_active: body?.is_active !== false,
        },
      });
    }
    if (method === "GET" && pathname === "/cashiers") {
      return await _webPosCall(companyKey, "/pos/cashiers/catalog", { method: "GET" });
    }
    if (method === "POST" && pathname === "/cashiers/login") {
      const pin = String(body?.pin || "").trim();
      const cashierId = String(body?.cashier_id || "").trim();
      if (!pin) throw new Error("PIN is required.");
      if (!cashierId) throw new Error("Select cashier name.");
      let res = null;
      try {
        res = await _webPosCall(companyKey, "/pos/cashiers/verify", {
          method: "POST",
          body: { pin, cashier_id: cashierId },
        });
      } catch (e) {
        const status = toNum(e?.status, 0);
        const message = String(e?.message || "").trim();
        const lowerMessage = message.toLowerCase();
        if (status === 403 && lowerMessage.includes("not assigned")) {
          throw new Error(`Cashier is not assigned to this ${companyKey} device. Update device cashier/employee assignments in Admin.`);
        }
        if (status === 404 && lowerMessage.includes("cashier")) {
          throw new Error(`Selected cashier is no longer available for ${companyKey}. Refresh cashiers and try again.`);
        }
        if (status === 401) {
          if (lowerMessage.includes("device token") || lowerMessage.includes("device is not connected") || lowerMessage.includes("missing device")) {
            throw new Error(`Device credentials are invalid for ${companyKey}. Open Settings and reconnect this company device.`);
          }
          try {
            const cat = await _webPosCall(companyKey, "/pos/cashiers/catalog", { method: "GET" });
            const count = Array.isArray(cat?.cashiers) ? cat.cashiers.length : 0;
            if (count <= 0) {
              throw new Error(`No active cashiers available for ${companyKey}. Assign cashiers to this device in POS settings.`);
            }
          } catch (inner) {
            const innerLower = String(inner?.message || "").toLowerCase();
            if (innerLower.includes("device token") || innerLower.includes("device is not connected") || innerLower.includes("missing device")) {
              throw new Error(`Device credentials are invalid for ${companyKey}. Open Settings and reconnect this company device.`);
            }
            if (innerLower.includes("no active cashiers")) throw inner;
          }
          throw new Error(`Invalid PIN for selected ${companyKey} cashier.`);
        }
        throw e;
      }
      const next = _setCfgForCompanyKey(companyKey, { cashier_id: String(res?.cashier?.id || "").trim() });
      return { ok: true, cashier: res?.cashier || null, config: next };
    }
    if (method === "POST" && pathname === "/cashiers/logout") {
      const next = _setCfgForCompanyKey(companyKey, { cashier_id: "" });
      return { ok: true, config: next };
    }
    if (method === "GET" && pathname === "/promotions") {
      return await _webPosCall(companyKey, "/pos/promotions/catalog", { method: "GET" });
    }
    if (method === "GET" && pathname === "/outbox") {
      const [rowsRes, summaryRes] = await Promise.all([
        _webPosCall(companyKey, "/pos/outbox/device?limit=200", { method: "GET" }).catch(() => ({ outbox: [] })),
        _webPosCall(companyKey, "/pos/outbox/device-summary", { method: "GET" }).catch(() => null),
      ]);
      const rows = Array.isArray(rowsRes?.outbox) ? rowsRes.outbox : [];
      const localRows = _webLocalOutboxRowsFor(companyKey).map((row) => ({
        ...(row || {}),
        id: String(row?.event_id || row?.id || "").trim(),
        event_id: String(row?.event_id || row?.id || "").trim(),
      }));
      const seen = new Set();
      const merged = [];
      for (const row of rows.filter((r) => String(r?.status || "") !== "processed")) {
        const id = String(row?.id || row?.event_id || "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(row);
      }
      for (const row of localRows) {
        const id = String(row?.id || row?.event_id || "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(row);
      }
      return {
        outbox: merged,
        summary: {
          ...(summaryRes || {}),
          local_pending: localRows.filter((r) => String(r?.status || "").trim().toLowerCase() === "pending").length,
          local_failed: localRows.filter((r) => {
            const st = String(r?.status || "").trim().toLowerCase();
            return st === "failed" || st === "dead";
          }).length,
        },
      };
    }
    if (method === "GET" && pathname === "/audit") {
      const limit = Math.max(1, toNum(params.get("limit"), 120));
      return { audit: _webAuditRowsFor(companyKey).slice(0, limit) };
    }
    if (method === "GET" && pathname === "/outbox/event") {
      const eventId = String(params.get("event_id") || "").trim();
      if (!eventId) throw new Error("event_id is required");
      const localEvent = _findWebLocalOutboxEvent(companyKey, eventId);
      if (localEvent) {
        return {
          event: {
            ...(localEvent || {}),
            id: String(localEvent?.event_id || localEvent?.id || eventId).trim() || eventId,
            event_id: String(localEvent?.event_id || localEvent?.id || eventId).trim() || eventId,
            payload: localEvent?.payload ?? null,
          },
        };
      }
      const listRes = await _webPosCall(companyKey, "/pos/outbox/device?limit=500", { method: "GET" });
      const rows = Array.isArray(listRes?.outbox) ? listRes.outbox : [];
      const row = rows.find((r) => String(r?.id || r?.event_id || "").trim() === eventId);
      if (!row) {
        const err = new Error("event not found");
        err.status = 404;
        throw err;
      }
      let payload = row?.payload ?? row?.payload_json ?? null;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch (_) {}
      }
      return {
        event: {
          ...row,
          event_id: String(row?.id || row?.event_id || eventId).trim() || eventId,
          payload,
        },
      };
    }
    if (method === "POST" && pathname === "/outbox/retry-one") {
      const eventId = String(body?.event_id || "").trim();
      if (!eventId) throw new Error("event_id is required");
      const localEvent = _findWebLocalOutboxEvent(companyKey, eventId);
      if (localEvent) {
        const flushed = await _flushWebLocalOutbox(companyKey, { limit: 1, eventId });
        if (flushed.failed.length) {
          const err = new Error(flushed.failed[0]?.error || "Unable to retry this local event.");
          err.payload = { event_id: eventId, failed: flushed.failed };
          throw err;
        }
        return { ok: true, event_id: eventId, local: true, sent: flushed.sent };
      }
      const process = await _webPosCall(companyKey, "/pos/outbox/process-one", {
        method: "POST",
        body: { event_id: eventId },
      });
      _appendWebAudit(companyKey, {
        action: "outbox.retry",
        cashier_id: cashierIdForCompany(companyKey) || null,
        shift_id: shiftIdForCompany(companyKey) || null,
        event_id: eventId,
        status: "acked",
        details: { source: "cloud-outbox" },
      });
      return { ok: true, event_id: eventId, process };
    }
    if (method === "GET" && pathname === "/receipts/last") {
      return await _fetchLastReceiptDetailWeb(companyKey);
    }
    if (method === "GET" && pathname === "/returns/last") {
      return await _fetchLastReturnDetailWeb(companyKey);
    }
    if (method === "GET" && pathname === "/printers") {
      return {
        printers: [{ name: "Browser Print Dialog", type: "browser" }],
        default_printer: "Browser Print Dialog",
        mode: "browser",
      };
    }
    if (method === "POST" && pathname === "/printers/test") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Print Test</title></head><body style="font-family:sans-serif;padding:16px"><h3>Browser Print Test</h3><p>${new Date().toLocaleString()}</p></body></html>`;
      _openPrintWindowWithHtml(html, null);
      return { ok: true, mode: "browser" };
    }
    if (method === "POST" && pathname === "/receipts/print-last") {
      return await _printLastReceiptWeb(companyKey, null, { thermal: companyKey !== "official" });
    }
    if (method === "POST" && pathname === "/returns/print-last") {
      return await _printLastReturnWeb(companyKey, null, { thermal: companyKey !== "official" });
    }

    if (method === "POST" && pathname === "/shift/status") {
      const res = await _webPosCall(companyKey, "/pos/shifts/open", { method: "GET" });
      const shiftId = String(res?.shift?.id || "").trim();
      _setCfgForCompanyKey(companyKey, { shift_id: shiftId });
      return { shift: res?.shift || null };
    }
    if (method === "POST" && pathname === "/shift/open") {
      const cashierId = cashierIdForCompany(companyKey, body?.cashier_id);
      if (!cashierId) throw new Error("Cashier sign-in required before opening shift.");
      const res = await _webPosCall(companyKey, "/pos/shifts/open", {
        method: "POST",
        body: {
          opening_cash_usd: toNum(body?.opening_cash_usd, 0),
          opening_cash_lbp: toNum(body?.opening_cash_lbp, 0),
          cashier_id: cashierId,
        },
      });
      _setCfgForCompanyKey(companyKey, { shift_id: String(res?.shift?.id || "").trim() });
      _appendWebAudit(companyKey, {
        action: "shift.open",
        cashier_id: cashierId,
        shift_id: String(res?.shift?.id || "").trim() || null,
        event_id: null,
        status: "acked",
        details: {
          opening_cash_usd: toNum(body?.opening_cash_usd, 0),
          opening_cash_lbp: toNum(body?.opening_cash_lbp, 0),
        },
      });
      return { shift: res?.shift || null };
    }
    if (method === "POST" && pathname === "/shift/close") {
      const shiftId = String(body?.shift_id || cfg.shift_id || "").trim();
      if (!shiftId) throw new Error("No open shift.");
      const cashierId = cashierIdForCompany(companyKey, body?.cashier_id);
      if (!cashierId) throw new Error("Cashier sign-in required before closing shift.");
      const res = await _webPosCall(companyKey, `/pos/shifts/${encodeURIComponent(shiftId)}/close`, {
        method: "POST",
        body: {
          closing_cash_usd: toNum(body?.closing_cash_usd, 0),
          closing_cash_lbp: toNum(body?.closing_cash_lbp, 0),
          cashier_id: cashierId,
        },
      });
      _setCfgForCompanyKey(companyKey, { shift_id: "" });
      _appendWebAudit(companyKey, {
        action: "shift.close",
        cashier_id: cashierId,
        shift_id: shiftId,
        event_id: null,
        status: "acked",
        details: {
          closing_cash_usd: toNum(body?.closing_cash_usd, 0),
          closing_cash_lbp: toNum(body?.closing_cash_lbp, 0),
        },
      });
      return { shift: res?.shift || null };
    }

    if (method === "POST" && pathname === "/sync/pull") {
      if (!String(cfg?.device_id || "").trim() || !String(cfg?.device_token || "").trim()) {
        throw new Error("Device is not connected. Run Express Setup first.");
      }
      const sync = {};
      const failures = [];
      const pullSteps = await Promise.allSettled([
        _getWebCatalog(companyKey, cfg, { force: true }),
        _webPosCall(companyKey, "/pos/customers/catalog", { method: "GET" }),
        _webPosCall(companyKey, "/pos/cashiers/catalog", { method: "GET" }),
        _webPosCall(companyKey, "/pos/promotions/catalog", { method: "GET" }),
      ]);

      if (pullSteps[0].status === "fulfilled") sync.catalog = { mode: "snapshot", count: (pullSteps[0].value?.items || []).length };
      else failures.push(`catalog: ${pullSteps[0].reason?.message || "failed"}`);

      if (pullSteps[1].status === "fulfilled") sync.customers = { mode: "snapshot", count: (pullSteps[1].value?.customers || []).length };
      else failures.push(`customers: ${pullSteps[1].reason?.message || "failed"}`);

      if (pullSteps[2].status === "fulfilled") sync.cashiers = { mode: "snapshot", count: (pullSteps[2].value?.cashiers || []).length };
      else failures.push(`cashiers: ${pullSteps[2].reason?.message || "failed"}`);

      if (pullSteps[3].status === "fulfilled") sync.promotions = { mode: "snapshot", count: (pullSteps[3].value?.promotions || []).length };
      else failures.push(`promotions: ${pullSteps[3].reason?.message || "failed"}`);

      if (failures.length) {
        const rejectedReasons = pullSteps
          .filter((step) => step.status === "rejected")
          .map((step) => step.reason);
        const allDeviceTokenErrors = rejectedReasons.length > 0 && rejectedReasons.every((reason) => _isDeviceTokenError(reason));
        if (allDeviceTokenErrors) {
          const err = new Error(`Device credentials are invalid for ${companyKey}. Reconnect this company from Settings > Express Setup.`);
          err.payload = { sync, failures, mode: "cloud-setup", invalid_device_token: true };
          throw err;
        }
        const err = new Error(`Cloud refresh failed: ${failures.join(" | ")}`);
        err.payload = { sync, failures, mode: "cloud-setup" };
        throw err;
      }
      return { ok: true, sync, mode: "cloud-setup" };
    }
    if (method === "POST" && pathname === "/sync/push") {
      if (!String(cfg?.device_id || "").trim() || !String(cfg?.device_token || "").trim()) {
        throw new Error("Device is not connected. Run Express Setup first.");
      }
      const localRes = await _flushWebLocalOutbox(companyKey, { limit: 30 });
      const listRes = await _webPosCall(companyKey, "/pos/outbox/device?limit=150", { method: "GET" });
      const rows = Array.isArray(listRes?.outbox) ? listRes.outbox : [];
      const nowMs = Date.now();
      const queue = rows
        .filter((r) => {
          const st = String(r?.status || "");
          if (st === "pending") return true;
          if (st !== "failed") return false;
          const nextRaw = String(r?.next_attempt_at || "").trim();
          if (!nextRaw) return true;
          const dueAt = Date.parse(nextRaw);
          return Number.isNaN(dueAt) || dueAt <= nowMs;
        })
        .sort((a, b) => {
          const at = Date.parse(String(a?.created_at || "")) || 0;
          const bt = Date.parse(String(b?.created_at || "")) || 0;
          return at - bt;
        })
        .slice(0, 30);
      let sent = toNum(localRes?.sent, 0);
      const failed = Array.isArray(localRes?.failed) ? [...localRes.failed] : [];
      let cursor = 0;
      const workers = Array.from({ length: Math.min(4, queue.length) }, () => (async () => {
        while (true) {
          const idx = cursor;
          cursor += 1;
          if (idx >= queue.length) break;
          const ev = queue[idx];
          const eventId = String(ev?.id || "").trim();
          if (!eventId) continue;
          try {
            await _webPosCall(companyKey, "/pos/outbox/process-one", { method: "POST", body: { event_id: eventId } });
            sent += 1;
          } catch (e) {
            failed.push({ event_id: eventId, error: e?.message || String(e) });
          }
        }
      })());
      await Promise.all(workers);
      const summary = await _webPosCall(companyKey, "/pos/outbox/device-summary", { method: "GET" });
      if (failed.length) {
        const allDeviceTokenErrors = failed.length > 0 && failed.every((row) => _isDeviceTokenError(row?.error || ""));
        if (allDeviceTokenErrors) {
          const err = new Error(`Device credentials are invalid for ${companyKey}. Reconnect this company from Settings > Express Setup.`);
          err.payload = { sent, failed, summary: summary || null, mode: "cloud-setup", invalid_device_token: true };
          throw err;
        }
        const err = new Error(`Cloud queue push failed for ${failed.length} event(s).`);
        err.payload = { sent, failed, summary: summary || null, mode: "cloud-setup" };
        throw err;
      }
      return { ok: true, sent, failed, summary, mode: "cloud-setup" };
    }

    if (method === "POST" && pathname === "/sale") {
      const cashierId = cashierIdForCompany(companyKey, body?.cashier_id);
      if (!cashierId) throw new Error("Cashier sign-in required before sale.");
      const shiftId = shiftIdForCompany(companyKey, body?.shift_id);
      if (!shiftId) throw new Error("Open shift required before sale.");
      const payloadSale = _buildSalePayloadWeb(body?.cart || [], cfg, {
        ...(body || {}),
        cashier_id: cashierId,
        shift_id: shiftId,
      });
      if (_managerApprovalRequiredForPayload(cfg, "sale.completed", payloadSale) && !_managerApprovalValidFor(companyKey)) {
        _appendWebAudit(companyKey, {
          action: "sale.submit",
          cashier_id: cashierId,
          shift_id: shiftId,
          event_id: null,
          status: "manager_approval_required",
          details: { payment_method: String(payloadSale?.payment_method || "").trim() || null },
        });
        const err = new Error("Manager approval required. Enter manager PIN to continue.");
        err.payload = { error: "manager_approval_required", company_key: normalizeCompanyKey(companyKey) };
        throw err;
      }
      return await _submitAndProcessPosEventWeb(companyKey, "sale.completed", payloadSale, body?.idempotency_key || "");
    }
    if (method === "POST" && pathname === "/return") {
      const cashierId = cashierIdForCompany(companyKey, body?.cashier_id);
      if (!cashierId) throw new Error("Cashier sign-in required before return.");
      const shiftId = shiftIdForCompany(companyKey, body?.shift_id);
      if (!shiftId) throw new Error("Open shift required before return.");
      const payloadReturn = _buildReturnPayloadWeb(body?.cart || [], cfg, {
        ...(body || {}),
        cashier_id: cashierId,
        shift_id: shiftId,
      });
      if (_managerApprovalRequiredForPayload(cfg, "sale.returned", payloadReturn) && !_managerApprovalValidFor(companyKey)) {
        _appendWebAudit(companyKey, {
          action: "return.submit",
          cashier_id: cashierId,
          shift_id: shiftId,
          event_id: null,
          status: "manager_approval_required",
          details: { refund_method: String(payloadReturn?.refund_method || "").trim() || null },
        });
        const err = new Error("Manager approval required. Enter manager PIN to continue.");
        err.payload = { error: "manager_approval_required", company_key: normalizeCompanyKey(companyKey) };
        throw err;
      }
      return await _submitAndProcessPosEventWeb(companyKey, "sale.returned", payloadReturn, body?.idempotency_key || "");
    }
    if (method === "POST" && pathname === "/invoices/resolve-by-event") {
      const eventId = String(body?.event_id || "").trim();
      if (!eventId) throw new Error("event_id is required");
      const resolved = await _resolveInvoiceByEventWeb(companyKey, eventId);
      return { ok: true, event_id: resolved.event_id, invoice_id: resolved.invoice_id || null };
    }
    if (method === "POST" && pathname === "/invoices/print-by-event") {
      const eventId = String(body?.event_id || "").trim();
      if (!eventId) throw new Error("event_id is required");
      return await _printInvoiceByEventWeb(companyKey, eventId, null, { thermal: companyKey !== "official" });
    }

    throw new Error(`Unsupported web POS route: ${method} ${pathname}`);
  };

  const apiCallFor = async (companyKey, path, options = {}) => {
    if (_companyUsesCloudTransport(companyKey)) {
      return await _webApiCallFor(companyKey, path, options);
    }

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
      err.companyKey = normalizeCompanyKey(companyKey);
      throw err;
    }
    return data;
  };

  const printAfterSale = async (companyKey, eventId = "", receiptWin = null) => {
    const cfg = cfgForCompanyKey(companyKey) || {};
    const eid = String(eventId || "").trim();
    const isCloud = _companyUsesCloudTransport(companyKey);

    if (companyKey === "official") {
      const auto = !!cfg.auto_print_invoice;
      if (auto && eid) {
        try {
          if (isCloud) await _printInvoiceByEventWeb(companyKey, eid, receiptWin, { thermal: false });
          else await apiCallFor(companyKey, "/invoices/print-by-event", { method: "POST", body: { event_id: eid } });
          try { if (receiptWin) receiptWin.close(); } catch (_) {}
          return;
        } catch (_) {
          // Fall back to opening the PDF if direct printing fails.
        }
      }
      if (eid) {
        try {
          if (isCloud) {
            await _printInvoiceByEventWeb(companyKey, eid, receiptWin, { thermal: false });
            return;
          }
          const resolved = await apiCallFor(companyKey, "/invoices/resolve-by-event", { method: "POST", body: { event_id: eid } });
          const invId = String(resolved?.invoice_id || "").trim();
          const u = _invoicePdfUrlFromCfg(companyKey, cfg, invId);
          if (u) {
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
        if (isCloud && eid) await _printInvoiceByEventWeb(companyKey, eid, receiptWin, { thermal: true });
        else if (isCloud) await _printLastReceiptWeb(companyKey, receiptWin, { thermal: true });
        else await apiCallFor(companyKey, "/receipts/print-last", { method: "POST", body: {} });
        try { if (receiptWin) receiptWin.close(); } catch (_) {}
        return;
      } catch (_) {
        // Fall back to the printable HTML view if direct printing isn't available.
      }
    }
    if (isCloud) {
      try {
        if (eid) await _printInvoiceByEventWeb(companyKey, eid, receiptWin, { thermal: true });
        else await _printLastReceiptWeb(companyKey, receiptWin, { thermal: true });
        return;
      } catch (_) {}
    }
    try {
      if (receiptWin) receiptWin.location = _agentReceiptUrl(companyKey);
      else window.open(_agentReceiptUrl(companyKey), "_blank", "noopener,noreferrer");
    } catch (_) {}
  };

  const openReceiptPreview = async () => {
    const companyKey = effectiveInvoiceCompany();
    if (_companyUsesCloudTransport(companyKey)) {
      let receiptWin = null;
      try { receiptWin = _openManagedPrintWindow(); } catch (_) {}
      try {
        await _printLastReceiptWeb(companyKey, receiptWin, { thermal: companyKey !== "official" });
      } catch (e) {
        try { if (receiptWin) receiptWin.close(); } catch (_) {}
        reportError(e?.message || "Unable to print last receipt.");
      }
      return;
    }
    try { window.open(_agentReceiptUrl(companyKey), "_blank", "noopener,noreferrer"); } catch (_) {}
  };

  // Wrapper for the agent serving this UI (origin).
  const apiCall = (path, options = {}) => apiCallFor(originCompanyKey, path, options);

  // Actions
  const _adminBaseFromApiBase = (value) => {
    const v = String(value || "").trim();
    if (!v) return "";
    if (v.startsWith("/")) {
      try {
        const origin = String(window?.location?.origin || "").trim();
        if (!origin) return "";
        const rel = normalizeApiBase(v).replace(/\/api(?:\/.*)?$/i, "");
        return _normalizeOriginUrl(`${origin}${rel}`);
      } catch (_) {
        return "";
      }
    }
    const raw = _isAbsoluteHttpUrl(v) ? v : `https://${v}`;
    try {
      const u = new URL(raw);
      const path = String(u.pathname || "").replace(/\/+$/, "");
      const withoutApi = path.replace(/\/api(?:\/.*)?$/i, "");
      u.pathname = withoutApi || "/";
      u.search = "";
      u.hash = "";
      return _normalizeOriginUrl(u.toString());
    } catch (_) {
      return _normalizeOriginUrl(raw);
    }
  };
  const _adminOutboxLinks = () => {
    const set = new Set();
    const add = (base) => {
      const b = _normalizeOriginUrl(base);
      if (!b) return;
      try {
        const u = new URL("/system/outbox", `${b}/`);
        set.add(_normalizeOriginUrl(u.toString()));
      } catch (_) {}
    };
    add(String(cfgForCompanyKey("official")?.print_base_url || "").trim());
    add(_adminBaseFromApiBase(_webPosApiBaseFor("official")));
    add(_adminBaseFromApiBase(_webPosApiBaseFor("unofficial")));
    try { add(String(window?.location?.origin || "").trim()); } catch (_) {}
    return Array.from(set);
  };
  const reportNotice = (msg) => { notice = msg; setTimeout(() => notice = "", 3000); };
  const reportError = (msg) => { alert(msg); error = msg; }; // Simple alert for now, can be improved
  const openAdminOutbox = () => {
    const links = _adminOutboxLinks();
    const target = links[0] || "/system/outbox";
    try {
      window.open(target, "_blank", "noopener,noreferrer");
      reportNotice("Opened Admin Outbox. If you get Access Denied, ask for POS manage permission.");
    } catch (_) {
      reportError(`Open Admin Outbox manually: ${target}`);
    }
  };
  const copyAdminOutboxLink = async () => {
    const links = _adminOutboxLinks();
    const target = links[0] || "/system/outbox";
    try {
      await _copyText(target);
      reportNotice("Copied Admin Outbox link.");
    } catch (e) {
      reportError(e?.message || "Unable to copy Admin Outbox link.");
    }
  };
  const closeQueuePayloadModal = () => {
    showQueuePayloadModal = false;
    queuePayloadLoading = false;
    queuePayloadError = "";
    queuePayloadEvent = null;
    queuePayloadText = "";
  };
  const loadAuditEvents = async () => {
    auditLoading = true;
    try {
      const [offRes, unRes] = await Promise.allSettled([
        apiCallFor("official", "/audit?limit=120", { method: "GET" }),
        apiCallFor("unofficial", "/audit?limit=120", { method: "GET" }),
      ]);
      const merged = [];
      if (offRes.status === "fulfilled") {
        for (const row of (offRes.value?.audit || [])) merged.push({ ...(row || {}), companyKey: "official" });
      }
      if (unRes.status === "fulfilled") {
        for (const row of (unRes.value?.audit || [])) merged.push({ ...(row || {}), companyKey: "unofficial" });
      }
      merged.sort((a, b) => (Date.parse(String(b?.created_at || "")) || 0) - (Date.parse(String(a?.created_at || "")) || 0));
      auditEvents = merged;
    } finally {
      auditLoading = false;
    }
  };
  const openAuditDrawer = async () => {
    showAuditDrawer = true;
    await loadAuditEvents();
  };
  const copyQueueEventId = async (ev) => {
    const eventId = _queueEventId(ev);
    if (!eventId) {
      reportError("Event ID is missing.");
      return;
    }
    try {
      await _copyText(eventId);
      reportNotice(`Copied event ID ${_shortQueueEventId(eventId)}.`);
    } catch (e) {
      reportError(e?.message || "Unable to copy event ID.");
    }
  };
  const openQueuePayload = async (ev) => {
    const companyKey = _queueCompanyKey(ev);
    const eventId = _queueEventId(ev);
    if (!eventId) {
      reportError("Event ID is missing.");
      return;
    }
    showQueuePayloadModal = true;
    queuePayloadLoading = true;
    queuePayloadError = "";
    queuePayloadText = "";
    queuePayloadEvent = { ...(ev || {}), companyKey, event_id: eventId };
    try {
      const res = await apiCallFor(
        companyKey,
        `/outbox/event?event_id=${encodeURIComponent(eventId)}`,
        { method: "GET" },
      );
      const fullEvent = res?.event || {};
      const payloadRaw = fullEvent?.payload ?? fullEvent?.payload_json ?? ev?.payload ?? ev?.payload_json ?? null;
      let payload = payloadRaw;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch (_) {}
      }
      queuePayloadEvent = {
        ...(ev || {}),
        ...(fullEvent || {}),
        companyKey,
        event_id: String(fullEvent?.event_id || fullEvent?.id || eventId).trim() || eventId,
      };
      queuePayloadText = (
        payload == null
          ? "No payload available for this event."
          : (typeof payload === "string" ? payload : JSON.stringify(payload, null, 2))
      );
    } catch (e) {
      queuePayloadError = e?.message || "Unable to load event payload.";
    } finally {
      queuePayloadLoading = false;
    }
  };
  const retryQueueEvent = async (ev) => {
    const retryKey = _queueRetryKey(ev);
    const eventId = _queueEventId(ev);
    const companyKey = _queueCompanyKey(ev);
    if (!retryKey || !eventId) {
      reportError("Event ID is missing.");
      return;
    }
    if (queueRetryingKeys.has(retryKey)) return;
    const next = new Set(queueRetryingKeys);
    next.add(retryKey);
    queueRetryingKeys = next;
    try {
      const res = await apiCallFor(companyKey, "/outbox/retry-one", {
        method: "POST",
        body: { event_id: eventId },
      });
      const processMsg = String(res?.process?.error || res?.detail || "").trim();
      if (processMsg) reportNotice(`Retry sent for ${_shortQueueEventId(eventId)}. ${processMsg}`);
      else reportNotice(`Retried ${_shortQueueEventId(eventId)} successfully.`);
      await fetchData();
    } catch (e) {
      reportError(e?.message || "Unable to retry this queued event.");
    } finally {
      const clear = new Set(queueRetryingKeys);
      clear.delete(retryKey);
      queueRetryingKeys = clear;
    }
  };

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

  const queueSyncPull = (companyKey) => {
    const key = companyKey === "unofficial" ? "unofficial" : "official";
    const cfg = cfgForCompanyKey(companyKey) || {};
    if (!String(cfg?.device_id || "").trim()) return;
    if (bgSyncPullInFlight[key]) return;
    bgSyncPullInFlight = { ...bgSyncPullInFlight, [key]: true };
    Promise.resolve()
      .then(() => apiCallFor(companyKey, "/sync/pull", { method: "POST", body: {} }))
      .catch(() => {
        const now = Date.now();
        if (now - bgPullWarnAt < 30000) return;
        bgPullWarnAt = now;
        const msg = "Cloud refresh is retrying in background.";
        notice = msg;
        setTimeout(() => {
          if (notice === msg) notice = "";
        }, 3500);
      })
      .finally(() => {
        bgSyncPullInFlight = { ...bgSyncPullInFlight, [key]: false };
      });
  };

  const setSessionToken = (companyKey, token) => {
    const t = (token || "").trim();
    if (companyKey === otherCompanyKey) {
      unofficialSessionToken = t;
      if (t) _writeStorage(UNOFFICIAL_SESSION_STORAGE_KEY, t);
      else _removeStorage(UNOFFICIAL_SESSION_STORAGE_KEY);
      return;
    }
    sessionToken = t;
    if (t) _writeStorage(SESSION_STORAGE_KEY, t);
    else _removeStorage(SESSION_STORAGE_KEY);
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

  const openCashierModal = async (companyKey = originCompanyKey) => {
    cashierCompanyKey = normalizeCompanyKey(companyKey);
    showCashierModal = true;
    void fetchData({ background: true }).catch(() => {});
    await tick();
    try { cashierPinEl?.focus(); } catch (_) {}
  };

  const runFetchData = async ({ background = false } = {}) => {
    if (webHostUnsupported && !_hasCloudDeviceConfig(originCompanyKey)) {
      status = "Web Setup Mode";
      return;
    }
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
        apiCall("/receipts/last"),
        apiCall("/promotions"),
      ]);

      const cfgRes = results[0];
      if (cfgRes.status === "rejected") {
        const p = cfgRes.reason?.payload;
        if (toNum(cfgRes.reason?.status, 0) === 404 && !_isLoopbackHost(window?.location?.hostname || "")) {
          activateWebHostUnsupported("This host exposes backend APIs, not local POS-agent APIs.");
          return;
        }
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
      setIfOk(6, (v) => (lastReceipt = v?.receipt?.receipt || v?.receipt || null), null);
      setIfOk(7, (v) => (promotions = v.promotions || []), []);

      status = "Ready";

      // Unofficial agent (best-effort; in web setup mode it uses secondary cloud device config).
      try {
        const unofficialViaCloud = _companyUsesCloudTransport(otherCompanyKey);
        const hasUnofficialCloudCfg = _hasCloudDeviceConfig(otherCompanyKey);
        if (unofficialViaCloud && !hasUnofficialCloudCfg) {
          unofficialStatus = "Pending";
          unofficialLocked = false;
          unofficialItems = [];
          unofficialBarcodes = [];
          unofficialCustomers = [];
          unofficialCashiers = [];
          unofficialOutbox = [];
          unofficialLastReceipt = null;
        } else {
          const uResults = await Promise.allSettled([
            apiCallFor(otherCompanyKey, "/config"),
            apiCallFor(otherCompanyKey, "/items"),
            apiCallFor(otherCompanyKey, "/barcodes"),
            apiCallFor(otherCompanyKey, "/customers"),
            apiCallFor(otherCompanyKey, "/cashiers"),
            apiCallFor(otherCompanyKey, "/outbox"),
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
            setIfOkU(6, (v) => (unofficialLastReceipt = v?.receipt?.receipt || v?.receipt || null), null);
            setIfOkU(7, (v) => (unofficialPromotions = v.promotions || []), []);
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
    if (webHostUnsupported && !_hasCloudDeviceConfig(originCompanyKey)) return;
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
    const code = _normalizeScanCode(barcode);
    if (!code) return false;

    const pick = (companyKey) => {
      const idx = companyKey === otherCompanyKey ? barcodeIndexOther : barcodeIndexOrigin;
      const b = _findBarcodeInIndex(idx, code);
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
    const key = _normalizeScanCode(sku).toLowerCase();
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

  const addByExactSearchMatch = (term) => {
    const key = _normalizeScanCode(term).toLowerCase();
    if (!key) return false;
    const exact = [];
    for (const it of allItemsTagged || []) {
      if (!it) continue;
      const sku = String(it?.sku || "").trim().toLowerCase();
      const barcode = String(it?.barcode || "").trim().toLowerCase();
      if (sku === key || barcode === key) exact.push(it);
    }
    if (!exact.length) return false;
    const available = Array.from(new Set(exact.map((it) => it?.companyKey).filter(Boolean)));
    const companyKey = pickCompanyForAmbiguousMatch({
      invoiceCompanyMode,
      originCompanyKey,
      cart,
      availableCompanies: available,
    });
    const picked = exact.find((it) => it.companyKey === companyKey) || exact[0];
    if (!picked) return false;
    return addToCart(picked, { companyKey: picked.companyKey, qty_entered: 1 });
  };

  const findMissingCompanyItems = (companyKey, lines) => findMissingCompanyItemsForCompany({
    companyKey,
    lines,
    otherCompanyKey,
    itemsByIdOrigin,
    itemsByIdOther,
  });

  const handleScanKeyDown = (e) => {
    if (e.key !== "Enter" && e.key !== "NumpadEnter" && e.key !== "Tab") return false;
    e.preventDefault();
    const term = _normalizeScanCode(scanTerm);
    if (!term) return false;
    if (addByBarcode(term) || addBySkuExact(term) || addByExactSearchMatch(term)) {
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

  const onVatDisplayModeChange = (v) => {
    vatDisplayMode = normalizeVatDisplayMode(v);
    try { localStorage.setItem(VAT_DISPLAY_MODE_STORAGE_KEY, vatDisplayMode); } catch (_) {}
  };

  const onShowPriceDisplayControlsChange = (value) => {
    showPriceDisplayControls = value !== false;
    try { localStorage.setItem(PRICE_DISPLAY_CONTROLS_STORAGE_KEY, showPriceDisplayControls ? "1" : "0"); } catch (_) {}
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
      baseUrl: _resolvePrintBaseUrl("official", offCfg),
      template: String(offCfg.invoice_template || "official_classic").trim().toLowerCase() || "official_classic",
    };
    printUnofficial = {
      printer: String(unCfg.receipt_printer || "").trim(),
      copies: Math.max(1, Math.min(10, toNum(unCfg.receipt_print_copies, 1))),
      auto: !!unCfg.auto_print_receipt,
      template: String(unCfg.receipt_template || "classic").trim().toLowerCase() || "classic",
      companyName: String(unCfg.receipt_company_name || "AH Trading").trim() || "AH Trading",
      footerText: String(unCfg.receipt_footer_text || "").trim(),
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
            invoice_template: (printOfficial.template || "official_classic").trim().toLowerCase() || "official_classic",
          }
        }),
        apiCallFor("unofficial", "/config", {
          method: "POST",
          body: {
            receipt_printer: (printUnofficial.printer || "").trim() || "",
            receipt_print_copies: Math.max(1, Math.min(10, toNum(printUnofficial.copies, 1))),
            auto_print_receipt: !!printUnofficial.auto,
            receipt_template: (printUnofficial.template || "classic").trim().toLowerCase() || "classic",
            receipt_company_name: (printUnofficial.companyName || "").trim() || "AH Trading",
            receipt_footer_text: (printUnofficial.footerText || "").trim(),
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
    reportNotice(v ? `Other agent set: ${v}` : "Other agent URL cleared. Secondary company will use cloud mode.");
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
    showTopMoreActions = false;
    activeScreen = v;
    try { localStorage.setItem(SCREEN_STORAGE_KEY, v); } catch (_) {}
    if (v === "items") {
      // Move scan focus to lookup, keep the POS scan field free.
      itemLookupAutoPick++;
    }
  };

  const saveConfigFor = async (companyKey, payload) => {
    const body = _sanitizeConfigPatch(payload || {});
    if (_companyUsesCloudTransport(companyKey)) {
      const nextCfg = _setCfgForCompanyKey(companyKey, body);
      await fetchData();
      return { ok: true, config: nextCfg };
    }
    const res = await apiCallFor(companyKey, "/config", { method: "POST", body });
    if (companyKey === otherCompanyKey) unofficialConfig = { ...unofficialConfig, ...(res?.config || {}) };
    else config = { ...config, ...(res?.config || {}) };
    await fetchData();
    return res;
  };

  const setupLogin = async (payload) => {
    const apiBaseUrl = _normalizeCloudApiBase(payload?.api_base_url || "");
    const mfaToken = String(payload?.mfa_token || "").trim();
    const mfaCode = String(payload?.mfa_code || "").trim();
    let authRes = null;
    if (mfaToken) {
      if (!mfaCode) throw new Error("MFA code is required.");
      authRes = await _cloudSetupCall(apiBaseUrl, "auth/mfa/verify", {
        method: "POST",
        body: { mfa_token: mfaToken, code: mfaCode },
      });
    } else {
      const email = String(payload?.email || "").trim();
      const password = String(payload?.password || "");
      if (!email || !password) throw new Error("Email and password are required.");
      authRes = await _cloudSetupCall(apiBaseUrl, "auth/login", {
        method: "POST",
        body: { email, password },
      });
    }
    if (authRes?.mfa_required) {
      return {
        ok: true,
        mfa_required: true,
        mfa_token: String(authRes?.mfa_token || "").trim(),
      };
    }
    const token = String(authRes?.token || "").trim();
    if (!token) throw new Error("No session token returned.");
    const companiesRes = await _cloudSetupCall(apiBaseUrl, "companies", {
      method: "GET",
      token,
    });
    return {
      ok: true,
      mfa_required: false,
      token,
      companies: Array.isArray(companiesRes?.companies) ? companiesRes.companies : [],
      active_company_id: String(authRes?.active_company_id || "").trim() || null,
    };
  };

  const setupBranches = async (payload) => {
    const apiBaseUrl = _normalizeCloudApiBase(payload?.api_base_url || "");
    const token = String(payload?.token || "").trim();
    const companyId = String(payload?.company_id || "").trim();
    if (!token) throw new Error("Token is required.");
    if (!companyId) throw new Error("Company is required.");
    try {
      return await _cloudSetupCall(apiBaseUrl, "branches", {
        method: "GET",
        token,
        companyId,
      });
    } catch (e) {
      const status = toNum(e?.status, 0);
      if (status === 401 || status === 403) {
        return {
          ok: true,
          branches: [],
          warning: "Branches unavailable for this account; leave Branch empty.",
        };
      }
      throw e;
    }
  };

  const setupDevices = async (payload) => {
    const apiBaseUrl = _normalizeCloudApiBase(payload?.api_base_url || "");
    const token = String(payload?.token || "").trim();
    const companyId = String(payload?.company_id || "").trim();
    if (!token) throw new Error("Token is required.");
    if (!companyId) throw new Error("Company is required.");
    try {
      await _cloudSetupCall(apiBaseUrl, "auth/select-company", {
        method: "POST",
        token,
        body: { company_id: companyId },
      });
    } catch (_) {}
    try {
      const res = await _cloudSetupCall(apiBaseUrl, "pos/devices", {
        method: "GET",
        token,
        companyId,
      });
      return { ok: true, devices: Array.isArray(res?.devices) ? res.devices : [] };
    } catch (e) {
      const status = toNum(e?.status, 0);
      if (status === 401 || status === 403) {
        return {
          ok: true,
          devices: [],
          warning: "Device list unavailable for this account. Ask an admin for POS device access (pos:manage).",
        };
      }
      throw e;
    }
  };

  const setupRegisterDevice = async (payload) => {
    const apiBaseUrl = _normalizeCloudApiBase(payload?.api_base_url || "");
    const token = String(payload?.token || "").trim();
    const companyId = String(payload?.company_id || "").trim();
    const branchId = String(payload?.branch_id || "").trim();
    const deviceCode = String(payload?.device_code || "").trim();
    const resetToken = payload?.reset_token !== false;
    if (!token) throw new Error("Token is required.");
    if (!companyId) throw new Error("Company is required.");
    if (!deviceCode) throw new Error("POS code is required.");
    try {
      await _cloudSetupCall(apiBaseUrl, "auth/select-company", {
        method: "POST",
        token,
        body: { company_id: companyId },
      });
    } catch (_) {}
    const params = new URLSearchParams();
    params.set("company_id", companyId);
    params.set("device_code", deviceCode);
    params.set("reset_token", resetToken ? "true" : "false");
    if (branchId) params.set("branch_id", branchId);
    const reg = await _cloudSetupCall(apiBaseUrl, `pos/devices/register?${params.toString()}`, {
      method: "POST",
      token,
      companyId,
    });
    const deviceId = String(reg?.id || "").trim();
    const deviceToken = String(reg?.token || "").trim();
    if (!deviceId) throw new Error("Device registration failed (missing device id).");
    if (!deviceToken) throw new Error("Device exists but token was not returned. Enable reset token and retry.");
    return { ok: true, device_id: deviceId, device_token: deviceToken };
  };

  const testSyncFor = async (companyKey) => {
    if (_companyUsesCloudTransport(companyKey)) {
      return await apiCallFor(companyKey, "/sync/status", { method: "GET" });
    }
    const health = await apiCallFor(companyKey, "/health", { method: "GET" });
    return {
      sync_ok: !!health?.ok,
      sync_auth_ok: !!health?.ok,
      edge_ok: !!health?.ok,
      edge_auth_ok: !!health?.ok,
      mode: "local-agent",
    };
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
    const code = _normalizeScanCode(term);
    if (!code) return null;

    const pick = (companyKey) => {
      const idx = companyKey === otherCompanyKey ? barcodeIndexOther : barcodeIndexOrigin;
      const b = _findBarcodeInIndex(idx, code);
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

    // Final fallback: exact match against tagged items (primary barcode/SKU).
    const exact = [];
    for (const it of allItemsTagged || []) {
      const sku = String(it?.sku || "").trim().toLowerCase();
      const barcode = String(it?.barcode || "").trim().toLowerCase();
      if (sku === key || barcode === key) exact.push(it);
    }
    if (exact.length) {
      const available = Array.from(new Set(exact.map((it) => it?.companyKey).filter(Boolean)));
      const companyKey = pickCompanyForAmbiguousMatch({
        invoiceCompanyMode,
        originCompanyKey,
        cart,
        availableCompanies: available,
      });
      const picked = exact.find((it) => it.companyKey === companyKey) || exact[0];
      if (picked) return { b: null, item: { ...picked, companyKey: picked.companyKey } };
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

  const _draftNameOrDefault = (value, fallback = "") => {
    const v = String(value || "").trim().replace(/\s+/g, " ");
    if (!v) return fallback;
    return v.slice(0, 80);
  };

  const _defaultDraftName = () => {
    const d = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    return `Draft ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const _normalizeSaleMode = (value) => (String(value || "").trim().toLowerCase() === "return" ? "return" : "sale");
  const _normalizeInvoiceMode = (value) => {
    const v = String(value || "").trim().toLowerCase();
    return v === "official" || v === "unofficial" ? v : "auto";
  };

  const _snapshotDraftCustomer = (value) => {
    if (!value || typeof value !== "object") return null;
    const id = String(value?.id || "").trim();
    if (!id) return null;
    return {
      id,
      name: String(value?.name || "").trim() || id,
      phone: String(value?.phone || "").trim() || "",
      email: String(value?.email || "").trim() || "",
      membership_no: String(value?.membership_no || "").trim() || "",
      customer_type: String(value?.customer_type || "").trim() || "",
      party_type: String(value?.party_type || "").trim() || "",
    };
  };

  const _sanitizeDraftLines = (lines = []) => {
    const merged = new Map();
    for (const src of lines || []) {
      const id = String(src?.id || "").trim();
      if (!id) continue;
      const companyKey = normalizeCompanyKey(src?.companyKey);
      const qtyFactor = Math.max(1e-9, toNum(src?.qty_factor, 1) || 1);
      const qtyEnteredRaw = src?.qty_entered ?? (toNum(src?.qty, 0) / qtyFactor);
      const qtyEntered = Math.max(0, toNum(qtyEnteredRaw, 0));
      if (qtyEntered <= 0) continue;
      const uom = String(src?.uom || src?.unit_of_measure || "pcs").trim() || "pcs";
      const key = _cartLineKey(companyKey, id, qtyFactor, uom);

      const existing = merged.get(key);
      if (existing) {
        const nextQtyEntered = Math.max(0, toNum(existing.qty_entered, 0) + qtyEntered);
        const next = {
          ...existing,
          qty_entered: nextQtyEntered,
          qty: nextQtyEntered * qtyFactor,
        };
        merged.set(key, applyPromotionToLine(next));
        continue;
      }

      const line = {
        key,
        companyKey,
        id,
        sku: String(src?.sku || "").trim(),
        name: String(src?.name || "").trim() || "Item",
        unit_of_measure: String(src?.unit_of_measure || uom || "pcs").trim() || "pcs",
        list_price_usd: toNum(src?.list_price_usd, toNum(src?.price_usd, 0)),
        list_price_lbp: toNum(src?.list_price_lbp, toNum(src?.price_lbp, 0)),
        price_usd: toNum(src?.price_usd, 0),
        price_lbp: toNum(src?.price_lbp, 0),
        qty_factor: qtyFactor,
        qty_entered: qtyEntered,
        qty: qtyEntered * qtyFactor,
        uom,
        tax_code_id: src?.tax_code_id || null,
        batch_no: src?.batch_no || null,
        expiry_date: src?.expiry_date || null,
        pre_discount_unit_price_usd: toNum(src?.pre_discount_unit_price_usd, 0),
        pre_discount_unit_price_lbp: toNum(src?.pre_discount_unit_price_lbp, 0),
        discount_pct: toNum(src?.discount_pct, 0),
        discount_amount_usd: toNum(src?.discount_amount_usd, 0),
        discount_amount_lbp: toNum(src?.discount_amount_lbp, 0),
        applied_promotion_id: src?.applied_promotion_id || null,
        applied_promotion_item_id: src?.applied_promotion_item_id || null,
      };
      merged.set(key, applyPromotionToLine(line));
    }
    return Array.from(merged.values());
  };

  const _normalizeCartDraftRecord = (value) => {
    if (!value || typeof value !== "object") return null;
    const lines = _sanitizeDraftLines(value?.cart || value?.lines || []);
    if (!lines.length) return null;

    const createdRaw = String(value?.created_at || value?.createdAt || "").trim();
    const updatedRaw = String(value?.updated_at || value?.updatedAt || "").trim();
    const createdAt = Number.isFinite(Date.parse(createdRaw)) ? new Date(createdRaw).toISOString() : new Date().toISOString();
    const updatedAt = Number.isFinite(Date.parse(updatedRaw))
      ? new Date(updatedRaw).toISOString()
      : createdAt;

    return {
      id: String(value?.id || "").trim() || makeUuid(),
      name: _draftNameOrDefault(value?.name, _defaultDraftName()),
      created_at: createdAt,
      updated_at: updatedAt,
      cart: lines,
      customer: _snapshotDraftCustomer(value?.customer),
      sale_mode: _normalizeSaleMode(value?.sale_mode),
      invoice_company_mode: _normalizeInvoiceMode(value?.invoice_company_mode),
      flag_official: !!value?.flag_official,
    };
  };

  const _sortCartDrafts = (rows = []) => {
    const copy = [...(rows || [])];
    copy.sort((a, b) => (Date.parse(String(b?.updated_at || "")) || 0) - (Date.parse(String(a?.updated_at || "")) || 0));
    return copy;
  };

  const _persistCartDrafts = (rows = cartDrafts) => {
    try {
      const drafts = _trimArray(_sortCartDrafts(rows || []), CART_DRAFTS_MAX);
      localStorage.setItem(CART_DRAFTS_STORAGE_KEY, JSON.stringify({ version: 1, drafts }));
    } catch (_) {}
  };

  const _loadCartDrafts = () => {
    const raw = _readJsonStorage(CART_DRAFTS_STORAGE_KEY, { version: 1, drafts: [] });
    const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.drafts) ? raw.drafts : []);
    return _trimArray(
      _sortCartDrafts(rows.map((row) => _normalizeCartDraftRecord(row)).filter(Boolean)),
      CART_DRAFTS_MAX,
    );
  };

  const _draftTotalUsd = (draft) => {
    let total = 0;
    for (const line of draft?.cart || []) {
      const qty = Math.max(0, toNum(line?.qty, 0));
      const baseUsd = toNum(line?.price_usd, 0) * qty;
      const taxUsd = baseUsd * Math.max(0, toNum(vatRateForLine(line), 0));
      total += (baseUsd + taxUsd);
    }
    return total;
  };

  const openCartDrafts = () => {
    showTopMoreActions = false;
    showCartDraftsDrawer = true;
  };
  const saveCurrentCartToDraft = () => {
    if (saveCurrentCartAsDraft({ name: "", clearCurrent: true })) cartDraftName = "";
  };
  const openShortcutsGuide = () => {
    showTopMoreActions = false;
    showShortcutsGuide = true;
  };

  const setKeepDraftCopyMode = (value) => {
    keepDraftCopyOnResume = !!value;
    try { localStorage.setItem(CART_DRAFT_KEEP_COPY_STORAGE_KEY, keepDraftCopyOnResume ? "1" : "0"); } catch (_) {}
  };

  const saveCurrentCartAsDraft = ({ name = "", clearCurrent = true } = {}) => {
    const lines = _sanitizeDraftLines(cart);
    if (!lines.length) {
      reportError("Add items before saving a draft.");
      return false;
    }
    const nowIso = new Date().toISOString();
    const draft = {
      id: makeUuid(),
      name: _draftNameOrDefault(name, _defaultDraftName()),
      created_at: nowIso,
      updated_at: nowIso,
      cart: lines,
      customer: _snapshotDraftCustomer(activeCustomer),
      sale_mode: _normalizeSaleMode(saleMode),
      invoice_company_mode: _normalizeInvoiceMode(invoiceCompanyMode),
      flag_official: !!flagOfficial,
    };
    cartDrafts = _trimArray(_sortCartDrafts([draft, ...(cartDrafts || [])]), CART_DRAFTS_MAX);
    _persistCartDrafts();
    if (clearCurrent) {
      cart = [];
      activeCustomer = null;
      checkoutIntentId = "";
      saleMode = "sale";
    }
    reportNotice(`Saved draft: ${draft.name}`);
    return true;
  };

  const restoreCartDraft = (draftId) => {
    const target = (cartDrafts || []).find((row) => String(row?.id || "") === String(draftId || ""));
    if (!target) {
      reportError("Draft not found.");
      return;
    }
    if (loading || checkoutInFlight) {
      reportError("Please wait until current actions finish.");
      return;
    }
    if ((cart || []).length > 0) {
      const ok = typeof window === "undefined"
        ? true
        : window.confirm("Replace the current cart with this draft? Current unsaved cart will be lost.");
      if (!ok) return;
    }
    const lines = _sanitizeDraftLines(target?.cart || []);
    if (!lines.length) {
      reportError("This draft is empty.");
      return;
    }

    cart = lines;
    activeCustomer = _snapshotDraftCustomer(target?.customer);
    saleMode = _normalizeSaleMode(target?.sale_mode);
    onInvoiceCompanyModeChange(_normalizeInvoiceMode(target?.invoice_company_mode));
    onFlagOfficialChange(!!target?.flag_official);
    checkoutIntentId = "";
    setActiveScreen("pos");

    if (keepDraftCopyOnResume) {
      // Keep a reusable copy and bump recency.
      const nowIso = new Date().toISOString();
      cartDrafts = _sortCartDrafts((cartDrafts || []).map((row) => (
        String(row?.id || "") === String(target.id) ? { ...(row || {}), updated_at: nowIso } : row
      )));
    } else {
      // Move draft out of the list once resumed to prevent duplicate checkouts by accident.
      cartDrafts = _sortCartDrafts((cartDrafts || []).filter((row) => String(row?.id || "") !== String(target.id)));
    }
    _persistCartDrafts();

    showCartDraftsDrawer = false;
    reportNotice(`Resumed draft: ${target.name}`);
  };

  const deleteCartDraft = (draftId) => {
    const target = (cartDrafts || []).find((row) => String(row?.id || "") === String(draftId || ""));
    if (!target) return;
    const ok = typeof window === "undefined"
      ? true
      : window.confirm(`Delete draft "${target.name}"?`);
    if (!ok) return;
    cartDrafts = _sortCartDrafts((cartDrafts || []).filter((row) => String(row?.id || "") !== String(target.id)));
    _persistCartDrafts();
    reportNotice(`Deleted draft: ${target.name}`);
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
    const name = String(customerDraft?.name || "").trim();
    if (!name) {
      reportError("Customer name is required.");
      return;
    }
    const email = String(customerDraft?.email || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      reportError("Please enter a valid email address.");
      return;
    }
    const termsRaw = String(customerDraft?.payment_terms_days ?? "").trim();
    const parsedTerms = Number.parseInt(termsRaw || "0", 10);
    if (!Number.isFinite(parsedTerms) || parsedTerms < 0 || parsedTerms > 3650) {
      reportError("Payment terms must be between 0 and 3650 days.");
      return;
    }
    const rawPartyType = String(customerDraft?.party_type || "individual").trim().toLowerCase();
    const rawCustomerType = String(customerDraft?.customer_type || "retail").trim().toLowerCase();
    const partyType = rawPartyType === "business" ? "business" : "individual";
    const customerType = ["retail", "wholesale", "b2b"].includes(rawCustomerType) ? rawCustomerType : "retail";
    const membershipNo = String(customerDraft?.membership_no || "").trim();
    const payload = {
      name,
      phone: String(customerDraft?.phone || "").trim() || null,
      email: email || null,
      party_type: partyType,
      customer_type: customerType,
      legal_name: String(customerDraft?.legal_name || "").trim() || null,
      membership_no: membershipNo || null,
      tax_id: String(customerDraft?.tax_id || "").trim() || null,
      vat_no: String(customerDraft?.vat_no || "").trim() || null,
      notes: String(customerDraft?.notes || "").trim() || null,
      marketing_opt_in: !!customerDraft?.marketing_opt_in,
      is_member: !!membershipNo,
      payment_terms_days: parsedTerms,
      is_active: customerDraft?.is_active !== false,
    };
    try {
      const companyKey = effectiveInvoiceCompany();
      const res = await apiCallFor(companyKey, "/customers/create", { method: "POST", body: payload });
      if (res.customer) {
        selectCustomer(res.customer);
        addCustomerMode = false;
        customerDraft = makeEmptyCustomerDraft();
        fetchData();
      }
    } catch(e) { reportError(e.message); }
  };

  // Checkout
  const handleCheckoutRequest = () => {
    if (cart.length === 0 || loading || checkoutInFlight) return;
    if (checkoutMissingCashiers.length) {
      cashierCompanyKey = checkoutMissingCashiers[0] || originCompanyKey;
      showCashierModal = true;
      reportError(`Cashier sign-in required: ${_companyListText(checkoutMissingCashiers)}.`);
      return;
    }
    if (checkoutMissingShifts.length) {
      shiftCompanyKey = checkoutMissingShifts[0] || originCompanyKey;
      showShiftModal = true;
      reportError(`Open shift required: ${_companyListText(checkoutMissingShifts)}.`);
      return;
    }
    if (!checkoutIntentId) checkoutIntentId = makeIntentId();
    showPaymentModal = true;
  };

  const handleProcessSale = async (method) => {
    if (checkoutInFlight) return;
    checkoutInFlight = true;
    showPaymentModal = false;
    loading = true;
    let payment_method = String(method || "cash").trim().toLowerCase();
    pendingCheckoutMethod = "";
    managerApprovalPendingCompanies = [];
    const checkoutIntent = checkoutIntentId || makeIntentId();
    checkoutIntentId = checkoutIntent;
    const preopenedPrintWindows = {};
    const consumedPrintWindows = new Set();

    const primePrintWindowFor = (companyKey) => {
      const key = normalizeCompanyKey(companyKey);
      let win = preopenedPrintWindows[key] || null;
      try {
        if (win && win.closed) win = null;
      } catch (_) {
        win = null;
      }
      if (!win) {
        try { win = _openManagedPrintWindow(); } catch (_) { win = null; }
        if (win) {
          try {
            win.document.open();
            win.document.write(
              "<!doctype html><html><head><meta charset=\"utf-8\" /><title>Preparing print...</title></head><body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:16px;color:#111\">Preparing print preview...</body></html>",
            );
            win.document.close();
          } catch (_) {}
        }
        preopenedPrintWindows[key] = win;
      }
      return win;
    };
    const markPrintWindowConsumed = (companyKey) => {
      consumedPrintWindows.add(normalizeCompanyKey(companyKey));
    };
    
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
              cashier_id: cashierIdForCompany(companyKey),
            },
          });
        };

        const cartCompanies = cartCompaniesSet();
        const mixedCompanies = cartCompanies.size > 1;
        const returnCompanies = mixedCompanies
          ? ["official", "unofficial"].filter((k) => cart.some((c) => c.companyKey === k))
          : [primaryCompanyFromCart() || originCompanyKey];
        if (!ensureCashierForCompanies(returnCompanies, "return")) return;
        if (!ensureShiftForCompanies(returnCompanies, "return")) return;
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
              try {
                if (_companyUsesCloudTransport(companyKey)) {
                  await _printReturnByEventWeb(companyKey, res?.event_id || "", null, { thermal: companyKey !== "official" });
                } else {
                  window.open(_agentReceiptUrl(companyKey), "_blank", "noopener,noreferrer");
                }
              } catch (_) {}
            } catch (e) {
              const pe = e?.payload;
              if (pe?.error === "manager_approval_required" || pe?.error === "pos_auth_required") throw e;
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
        try {
          if (_companyUsesCloudTransport(returnCompany)) {
            await _printReturnByEventWeb(returnCompany, res?.event_id || "", null, { thermal: returnCompany !== "official" });
          } else {
            window.open(_agentReceiptUrl(returnCompany), "_blank", "noopener,noreferrer");
          }
        } catch (_) {}
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
        if (!ensureCashierForCompanies([invoiceCompany], "sale")) return;
        if (!ensureShiftForCompanies([invoiceCompany], "sale")) return;
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
        const receiptWin = primePrintWindowFor(invoiceCompany);
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

        const cfg = cfgFor(invoiceCompany);
        const res = await apiCallFor(invoiceCompany, "/sale", {
          method: "POST",
          body: {
            idempotency_key: saleIdempotencyKeyForCompany(checkoutIntent, invoiceCompany),
            cart: mapCartLines(cart),
            customer_id,
            payment_method,
            receipt_meta,
            pricing_currency: cfg.pricing_currency,
            exchange_rate: cfg.exchange_rate,
            shift_id: cfg.shift_id || null,
            cashier_id: cashierIdForCompany(invoiceCompany),
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
        markPrintWindowConsumed(invoiceCompany);
        return;
      }

      // Mixed cart: automatically split into two invoices (one per company) with a single Pay.
      if (mixedCompanies) {
        const groupId = `split-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const companiesInOrder = ["official", "unofficial"].filter((k) => cart.some((c) => c.companyKey === k));
        if (payment_method === "credit") {
          const needsApproval = companiesInOrder.filter((companyKey) => {
            const cfg = cfgFor(companyKey);
            return !!cfg?.require_manager_approval_credit && !_managerApprovalValidFor(companyKey);
          });
          if (needsApproval.length) {
            pendingCheckoutMethod = payment_method;
            managerApprovalPendingCompanies = needsApproval;
            adminPinMode = "unlock";
            openAdminPinModal();
            reportNotice(`Manager approval required: ${_companyListText(needsApproval)}. Enter admin PIN to continue.`);
            return;
          }
        }

        if (!ensureCashierForCompanies(companiesInOrder, "split sale")) return;
        if (!ensureShiftForCompanies(companiesInOrder, "split sale")) return;
        for (const companyKey of companiesInOrder) primePrintWindowFor(companyKey);
        _assertSplitTotalsConsistent(
          companiesInOrder.map((companyKey) => ({ companyKey, lines: cart.filter((c) => c.companyKey === companyKey) })),
        );

        const customerByCompany = {};
        if (requested_customer_id) {
          for (const k of companiesInOrder) customerByCompany[k] = await resolveCustomerId(k);
          const missing = companiesInOrder.filter((k) => !customerByCompany[k]);
          if (missing.length) reportNotice(`Customer not found on: ${missing.join(", ")}. Those invoices will be walk-in.`);
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
                idempotency_key: saleIdempotencyKeyForCompany(checkoutIntent, companyKey),
                cart: mapCartLines(lines),
                customer_id,
                payment_method,
                receipt_meta,
                pricing_currency: cfg.pricing_currency,
                exchange_rate: cfg.exchange_rate,
                shift_id: cfg.shift_id || null,
                cashier_id: cashierIdForCompany(companyKey),
                skip_stock_moves: false,
              }
            });

            done.push({ companyKey, event_id: res.event_id || "ok" });
            queueSyncPush(companyKey);

            // Remove only the successfully invoiced lines.
            cart = cart.filter((c) => c.companyKey !== companyKey);
            const receiptWin = primePrintWindowFor(companyKey);
            await printAfterSale(companyKey, res?.event_id || "", receiptWin);
            markPrintWindowConsumed(companyKey);
          } catch (e) {
            const pe = e?.payload;
            if (pe?.error === "manager_approval_required" || pe?.error === "pos_auth_required") throw e;
            failed.push({ companyKey, error: e?.message || String(e) });
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
      if (!ensureCashierForCompanies([invoiceCompany], "sale")) return;
      if (!ensureShiftForCompanies([invoiceCompany], "sale")) return;
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
      const receiptWin = primePrintWindowFor(invoiceCompany);
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

      const cfg = cfgFor(invoiceCompany);
      const res = await apiCallFor(invoiceCompany, "/sale", {
        method: "POST",
        body: {
          idempotency_key: saleIdempotencyKeyForCompany(checkoutIntent, invoiceCompany),
          cart: mapCartLines(cart),
          customer_id,
          payment_method,
          receipt_meta,
          pricing_currency: cfg.pricing_currency,
          exchange_rate: cfg.exchange_rate,
          shift_id: cfg.shift_id || null,
          cashier_id: cashierIdForCompany(invoiceCompany),
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
      markPrintWindowConsumed(invoiceCompany);
    } catch(e) {
      const p = e?.payload;
      if (p?.error === "pos_auth_required") {
        status = "Locked";
        adminPinMode = "unlock";
        openAdminPinModal();
      } else if (p?.error === "manager_approval_required") {
        pendingCheckoutMethod = payment_method;
        const fromPayload = String(p?.company_key || "").trim();
        const fromError = String(e?.companyKey || "").trim();
        managerApprovalPendingCompanies = fromPayload
          ? [normalizeCompanyKey(fromPayload)]
          : (fromError
              ? [normalizeCompanyKey(fromError)]
              : (checkoutRequiredCompanies.length ? [...checkoutRequiredCompanies] : [effectiveInvoiceCompany()]));
        adminPinMode = "unlock";
        openAdminPinModal();
        reportNotice("Manager approval required. Enter admin PIN to continue.");
      } else {
        reportError(e.message);
      }
    } finally {
      for (const [companyKey, win] of Object.entries(preopenedPrintWindows)) {
        if (consumedPrintWindows.has(normalizeCompanyKey(companyKey))) continue;
        try { if (win && !win.closed) win.close(); } catch (_) {}
      }
      loading = false;
      checkoutInFlight = false;
    }
  };

  const syncPull = async () => {
    try {
      loading = true;
      const results = await Promise.allSettled([
        apiCallFor("official", "/sync/pull", { method: "POST", body: {} }),
        apiCallFor("unofficial", "/sync/pull", { method: "POST", body: {} }),
      ]);
      const failures = [];
      if (results[0].status === "rejected") failures.push(`official: ${results[0].reason?.message || "failed"}`);
      if (results[1].status === "rejected") failures.push(`unofficial: ${results[1].reason?.message || "failed"}`);
      if (failures.length) {
        reportError(`Refresh failed. ${failures.join(" | ")}`);
        await fetchData();
        return;
      }
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
      const failures = [];
      if (results[0].status === "rejected") failures.push(`official: ${results[0].reason?.message || "failed"}`);
      if (results[1].status === "rejected") failures.push(`unofficial: ${results[1].reason?.message || "failed"}`);
      if (failures.length) {
        reportError(`Queue push failed. ${failures.join(" | ")}`);
        await fetchData();
        return;
      }
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
    const cashier_id = String(cashierLoginCashierId || "").trim();
    if (!pin) return;
    if (!cashier_id) {
      reportError("Select cashier name first.");
      return;
    }
    const companyKey = normalizeCompanyKey(cashierCompanyKey || originCompanyKey);
    try {
      loading = true;
      const res = await apiCallFor(companyKey, "/cashiers/login", { method: "POST", body: { pin, cashier_id } });
      if (companyKey === otherCompanyKey) unofficialConfig = { ...unofficialConfig, ...(res?.config || {}) };
      else config = { ...config, ...(res?.config || {}) };
      _setCashierManagerMetaFor(companyKey, res?.cashier || null);
      showCashierModal = false;
      cashierPin = "";
      await fetchData();
      reportNotice(`Signed in (${companyKey}): ${res?.cashier?.name || "Cashier"}`);
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const cashierLogout = async (companyKey = "") => {
    const target = String(companyKey || "").trim();
    const companies = target ? [normalizeCompanyKey(target)] : ["official", "unofficial"];
    const activeCompanies = companies.filter((k) => !!cashierIdForCompany(k));
    if (!activeCompanies.length) {
      reportNotice(target ? `No cashier signed in (${normalizeCompanyKey(target)}).` : "No cashier is currently signed in.");
      return;
    }
    try {
      loading = true;
      const results = await Promise.allSettled(
        activeCompanies.map((k) => apiCallFor(k, "/cashiers/logout", { method: "POST", body: {} })),
      );
      for (let i = 0; i < activeCompanies.length; i += 1) {
        const k = activeCompanies[i];
        const r = results[i];
        if (r.status !== "fulfilled") continue;
        _clearCashierManagerMetaFor(k);
        if (k === otherCompanyKey) unofficialConfig = { ...unofficialConfig, ...(r.value?.config || {}) };
        else config = { ...config, ...(r.value?.config || {}) };
      }
      await fetchData();
      reportNotice(target ? `Signed out (${normalizeCompanyKey(target)})` : "Signed out (all companies)");
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const adminPinSubmit = async () => {
    const pin = (adminPin || "").trim();
    if (!pin) return;
    const pendingManagerCompanies = Array.from(new Set((managerApprovalPendingCompanies || []).map((k) => normalizeCompanyKey(k))));
    try {
      loading = true;
      let unlockMsg = "Unlocked";

      if (pendingManagerCompanies.length) {
        for (const companyKey of pendingManagerCompanies) {
          if (_companyUsesCloudTransport(companyKey)) {
            const verified = await _webPosCall(companyKey, "/pos/cashiers/verify", {
              method: "POST",
              body: { pin },
            });
            const cashier = verified?.cashier || null;
            const approverId = String(cashier?.id || "").trim();
            const currentCashierId = String(cashierIdForCompany(companyKey) || "").trim();
            if (!cashier || !approverId) {
              throw new Error(`Approval PIN is invalid for ${companyKey}.`);
            }
            if (_hasManagerMeta(cashier)) {
              if (!_isManagerCashier(cashier)) {
                throw new Error(`Manager PIN required for ${companyKey}.`);
              }
            } else if (!currentCashierId || approverId === currentCashierId) {
              throw new Error(`Use a second cashier PIN to approve ${companyKey}.`);
            }
            _markManagerApprovedFor(companyKey);
            _appendWebAudit(companyKey, {
              action: "manager.approval",
              cashier_id: approverId,
              shift_id: shiftIdForCompany(companyKey) || null,
              event_id: null,
              status: "approved",
              details: {
                mode: _hasManagerMeta(cashier) ? "cloud-manager-role" : "cloud-second-cashier",
                cashier_name: cashier?.name || null,
                current_cashier_id: currentCashierId || null,
              },
            });
          } else {
            if (adminPinMode === "set") {
              await apiCallFor(companyKey, "/admin/pin/set", { method: "POST", body: { pin } });
              adminPinMode = "unlock";
            }
            const authRes = await apiCallFor(companyKey, "/auth/pin", { method: "POST", body: { pin } });
            setSessionToken(companyKey, authRes?.token || "");
            _markManagerApprovedFor(companyKey);
          }
        }
        unlockMsg = `Manager approval granted: ${_companyListText(pendingManagerCompanies)}`;
        managerApprovalPendingCompanies = [];
      } else {
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

  const shiftRefresh = async (companyKey = shiftCompanyKey, { quiet = false } = {}) => {
    const targetCompany = normalizeCompanyKey(companyKey || shiftCompanyKey || originCompanyKey);
    shiftCompanyKey = targetCompany;
    try {
      loading = true;
      const res = await apiCallFor(targetCompany, "/shift/status", { method: "POST", body: {} });
      const nextShift = res?.shift || null;
      _setShiftCashSetup(targetCompany, res?.cash_methods || [], res?.has_cash_method_mapping);
      _setShiftIdForCompany(targetCompany, nextShift?.id || "");
      if (targetCompany === otherCompanyKey) unofficialShift = nextShift;
      shift = nextShift;
      if (nextShift) {
        _applyShiftExpectedToClosing(targetCompany, nextShift, { preserveTouched: true });
      } else {
        _setShiftClosingTouched(targetCompany, false);
      }
      if (!quiet) reportNotice(nextShift ? `${targetCompany} shift is open` : `${targetCompany} has no open shift`);
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const shiftOpen = async (companyKey = shiftCompanyKey) => {
    const targetCompany = normalizeCompanyKey(companyKey || shiftCompanyKey || originCompanyKey);
    shiftCompanyKey = targetCompany;
    const cashierId = cashierIdForCompany(targetCompany);
    if (!cashierId) {
      cashierCompanyKey = targetCompany;
      showCashierModal = true;
      reportError(`Cashier sign-in required before opening shift (${targetCompany}).`);
      return;
    }
    try {
      loading = true;
      const res = await apiCallFor(targetCompany, "/shift/open", {
        method: "POST",
        body: {
          opening_cash_usd: toNum(openingCashUsd, 0),
          opening_cash_lbp: toNum(openingCashLbp, 0),
          cashier_id: cashierId,
        },
      });
      const nextShift = res?.shift || null;
      _setShiftCashSetup(targetCompany, res?.cash_methods || [], res?.has_cash_method_mapping);
      _setShiftIdForCompany(targetCompany, nextShift?.id || "");
      if (targetCompany === otherCompanyKey) unofficialShift = nextShift;
      shift = nextShift;
      _setShiftClosingTouched(targetCompany, false);
      closingCashUsd = toNum(_shiftPickMoney(nextShift, ["opening_cash_usd", "opening_usd"], openingCashUsd), 0);
      closingCashLbp = toNum(_shiftPickMoney(nextShift, ["opening_cash_lbp", "opening_lbp"], openingCashLbp), 0);
      Promise.resolve().then(() => fetchData({ background: true })).catch(() => {});
      reportNotice(`Shift opened (${targetCompany})`);
      showShiftModal = false;
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const shiftClose = async (companyKey = shiftCompanyKey) => {
    const targetCompany = normalizeCompanyKey(companyKey || shiftCompanyKey || originCompanyKey);
    shiftCompanyKey = targetCompany;
    const cashierId = cashierIdForCompany(targetCompany);
    if (!cashierId) {
      cashierCompanyKey = targetCompany;
      showCashierModal = true;
      reportError(`Cashier sign-in required before closing shift (${targetCompany}).`);
      return;
    }
    try {
      loading = true;
      const res = await apiCallFor(targetCompany, "/shift/close", {
        method: "POST",
        body: {
          closing_cash_usd: toNum(closingCashUsd, 0),
          closing_cash_lbp: toNum(closingCashLbp, 0),
          cashier_id: cashierId,
        },
      });
      const nextShift = res?.shift || null;
      _setShiftCashSetup(targetCompany, res?.cash_methods || [], res?.has_cash_method_mapping);
      _setShiftIdForCompany(targetCompany, nextShift?.id || "");
      if (targetCompany === otherCompanyKey) unofficialShift = nextShift;
      shift = nextShift;
      _setShiftClosingTouched(targetCompany, false);
      Promise.resolve().then(() => fetchData({ background: true })).catch(() => {});
      reportNotice(`Shift closed (${targetCompany})`);
      showShiftModal = false;
    } catch (e) {
      reportError(e.message);
    } finally {
      loading = false;
    }
  };

  const refreshRuntimeVersionText = () => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search || "");
    const desktopFlag = String(q.get("desktop") || "").trim() === "1";
    const desktopVersion = String(q.get("desktopVersion") || "").trim();
    if (!desktopFlag) {
      runtimeVersionText = `pos-web v${POS_UI_VERSION}`;
      return;
    }
    runtimeVersionText = desktopVersion
      ? `pos-desktop v${desktopVersion} · ui v${POS_UI_VERSION}`
      : `pos-desktop · ui v${POS_UI_VERSION}`;
  };

  // Lifecycle
  onMount(() => {
    refreshRuntimeVersionText();
    let fetchTimer = null;
    let pushTimer = null;
    let pullTimer = null;

    const hasOutboxPressure = () => {
      const off = Array.isArray(outbox) ? outbox.length : 0;
      const un = Array.isArray(unofficialOutbox) ? unofficialOutbox.length : 0;
      return (off + un) > 0;
    };

    const scheduleFetch = (delayMs = 0) => {
      if (fetchTimer) clearTimeout(fetchTimer);
      fetchTimer = setTimeout(async () => {
        if (!document.hidden) await fetchData({ background: true });
        scheduleFetch(hasOutboxPressure() ? 15000 : 45000);
      }, Math.max(1000, toNum(delayMs, 0)));
    };

    const schedulePush = (delayMs = 0) => {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        if (!document.hidden) {
          if (config?.device_id) queueSyncPush(originCompanyKey);
          if (unofficialConfig?.device_id) queueSyncPush(otherCompanyKey);
        }
        schedulePush(hasOutboxPressure() ? 7000 : 18000);
      }, Math.max(1000, toNum(delayMs, 0)));
    };

    const schedulePull = (delayMs = 0) => {
      if (pullTimer) clearTimeout(pullTimer);
      pullTimer = setTimeout(() => {
        if (!document.hidden) {
          if (config?.device_id) queueSyncPull(originCompanyKey);
          if (unofficialConfig?.device_id) queueSyncPull(otherCompanyKey);
        }
        schedulePull(150000);
      }, Math.max(1000, toNum(delayMs, 0)));
    };

    const stored = _readStorage(API_BASE_STORAGE_KEY, "");
    if (stored) apiBase = stored;
    sessionToken = _readStorage(SESSION_STORAGE_KEY, "");
    unofficialSessionToken = _readStorage(UNOFFICIAL_SESSION_STORAGE_KEY, "");
    const storedOtherAgentUrlRaw = _readStorage(OTHER_AGENT_URL_STORAGE_KEY, "");
    const storedOtherAgentUrl = _normalizeOriginUrl(storedOtherAgentUrlRaw);
    const fallbackOtherAgentUrl = _defaultOtherAgentUrlForCurrentHost();
    const nextOtherAgentUrl = _sanitizeOtherAgentUrl(storedOtherAgentUrl || fallbackOtherAgentUrl);
    otherAgentUrl = nextOtherAgentUrl;
    otherAgentDraftUrl = nextOtherAgentUrl;
    if (nextOtherAgentUrl !== storedOtherAgentUrl) {
      _writeStorage(OTHER_AGENT_URL_STORAGE_KEY, nextOtherAgentUrl);
    }
    invoiceCompanyMode = _readStorage(INVOICE_MODE_STORAGE_KEY, "auto");
    invoiceCompanyMode = (invoiceCompanyMode === "official" || invoiceCompanyMode === "unofficial") ? invoiceCompanyMode : "auto";
    flagOfficial = _readStorage(FLAG_OFFICIAL_STORAGE_KEY, "") === "1";
    vatDisplayMode = normalizeVatDisplayMode(_readStorage(VAT_DISPLAY_MODE_STORAGE_KEY, "both"));
    showPriceDisplayControls = _readStorage(PRICE_DISPLAY_CONTROLS_STORAGE_KEY, "") === "1";

    theme = _readStorage(THEME_STORAGE_KEY, "dark") || "dark";
    if (theme !== "light" && theme !== "dark") theme = "dark";
    try { document.documentElement.dataset.theme = theme; } catch (_) {}

    const storedScreen = _readStorage(SCREEN_STORAGE_KEY, "pos");
    activeScreen = (storedScreen === "items") ? "items" : "pos";
    keepDraftCopyOnResume = _readStorage(CART_DRAFT_KEEP_COPY_STORAGE_KEY, "") === "1";

    try {
      const offRaw = _readStorage(WEB_CONFIG_OFFICIAL_STORAGE_KEY, "");
      if (offRaw) config = { ...config, ...(JSON.parse(offRaw) || {}) };
    } catch (_) {}
    try {
      const unRaw = _readStorage(WEB_CONFIG_UNOFFICIAL_STORAGE_KEY, "");
      if (unRaw) unofficialConfig = { ...unofficialConfig, ...(JSON.parse(unRaw) || {}) };
    } catch (_) {}
    webLocalOutboxByCompany = _readJsonStorage(WEB_LOCAL_OUTBOX_STORAGE_KEY, { official: [], unofficial: [] });
    webAuditByCompany = _readJsonStorage(WEB_LOCAL_AUDIT_STORAGE_KEY, { official: [], unofficial: [] });
    {
      const raw = _readJsonStorage(CASHIER_MANAGER_META_STORAGE_KEY, { official: null, unofficial: null });
      cashierManagerMetaByCompany = {
        official: _normalizeCashierManagerMeta(raw?.official),
        unofficial: _normalizeCashierManagerMeta(raw?.unofficial),
      };
    }
    cartDrafts = _loadCartDrafts();
    cashierCompanyKey = originCompanyKey;
    shiftCompanyKey = originCompanyKey;

    (async () => {
      // On remote web hosts, force cloud/web setup transport to avoid local /api/* calls.
      const host = String(window?.location?.hostname || "").trim();
      const remoteHost = !_isLoopbackHost(host);
      if (remoteHost) {
        otherAgentUrl = "";
        otherAgentDraftUrl = "";
        _writeStorage(OTHER_AGENT_URL_STORAGE_KEY, "");
        const probe = await _probeAgentHealth(apiBase);
        if (!probe.localAgentLike) activateWebHostUnsupported("This host responds with backend health, not local POS agent health.");
        else activateWebHostUnsupported("Remote web host detected. Using cloud setup mode.");
      }

      fetchData();
      scheduleFetch(22000);
      schedulePush(7000);
      schedulePull(45000);
    })();

    const onVisibilityChange = () => {
      if (!document.hidden) {
        fetchData({ background: true });
        scheduleFetch(12000);
        schedulePush(3000);
        schedulePull(12000);
      }
    };
    const onWindowResize = () => {
      if (showTopMoreActions) _positionTopMoreActionsMenu();
    };
    const onWindowScroll = () => {
      if (showTopMoreActions) _positionTopMoreActionsMenu();
    };
    const onPointerDownCapture = (e) => {
      if (!showTopMoreActions) return;
      const target = e?.target;
      if (_elContainsTarget(topMoreActionsButtonEl, target)) return;
      if (_elContainsTarget(topMoreMenuEl, target)) return;
      closeTopMoreActions();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("scroll", onWindowScroll, true);
    document.addEventListener("pointerdown", onPointerDownCapture, true);

    // Global barcode scan capture (keyboard-wedge scanners often type fast chars + Enter).
    // This intentionally works without requiring focus on the dedicated scan field.
    let buf = "";
    let lastAt = 0;
    let startedAt = 0;
    let maxGap = 0;
    let charCount = 0;
    let clearTimer = null;
    const SCAN_INTER_KEY_RESET_MS = 180;
    const SCAN_BUFFER_TTL_MS = 450;
    const SCAN_MAX_GAP_MS = 95;
    const SCAN_MAX_DURATION_MS = 1200;

    const reset = () => {
      buf = "";
      lastAt = 0;
      startedAt = 0;
      maxGap = 0;
      charCount = 0;
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
    };

    const shouldAutoSelectInput = (el) => {
      const tag = (el?.tagName || "").toUpperCase();
      if (tag !== "INPUT") return false;
      if (!!el?.disabled || !!el?.readOnly) return false;
      if (el?.getAttribute?.("data-no-autoselect") === "1") return false;
      const t = String(el?.type || "text").toLowerCase();
      return t === "text" || t === "search" || t === "tel" || t === "url" || t === "email" || t === "number" || t === "password";
    };

    const selectAll = (el) => {
      if (!el || typeof el.select !== "function") return;
      try { el.select(); } catch (_) {}
    };

    const onFocusIn = (e) => {
      if (activeScreen !== "pos" && activeScreen !== "items") return;
      const target = e?.target;
      if (!shouldAutoSelectInput(target)) return;
      requestAnimationFrame(() => selectAll(target));
    };

    const onClickCapture = (e) => {
      if (activeScreen !== "pos" && activeScreen !== "items") return;
      const target = e?.target;
      if (!shouldAutoSelectInput(target)) return;
      if (document.activeElement !== target) return;
      requestAnimationFrame(() => selectAll(target));
    };

    const onKeyDown = (e) => {
      if (!e) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && showTopMoreActions) {
        e.preventDefault();
        closeTopMoreActions();
        return;
      }
      if (e.key === "Escape" && showCartDraftsDrawer) {
        e.preventDefault();
        showCartDraftsDrawer = false;
        return;
      }
      if (e.key === "Escape" && showShortcutsGuide) {
        e.preventDefault();
        showShortcutsGuide = false;
        return;
      }

      const active = document.activeElement;
      const isScanField = !!active?.getAttribute?.("data-scan-input");

      if (e.key === "Enter" || e.key === "NumpadEnter" || e.key === "Tab") {
        // If the dedicated scan input is focused, let ProductGrid handle Enter.
        if (isScanField) {
          reset();
          return;
        }
        const term = _normalizeScanCode(buf);
        const duration = startedAt ? (Date.now() - startedAt) : 0;
        const looksLikeScan = !!term && term.length >= 3 && charCount >= 3 && duration <= SCAN_MAX_DURATION_MS && maxGap <= SCAN_MAX_GAP_MS;
        if (looksLikeScan) {
          e.preventDefault();
          if (activeScreen === "items") {
            itemLookupQuery = term;
            itemLookupAutoPick++;
          } else if (activeScreen === "pos") {
            // Attempt immediate add by barcode/SKU. Keep scanTerm for visibility.
            scanTerm = term;
            const ok = addByBarcode(term) || addBySkuExact(term) || addByExactSearchMatch(term);
            if (ok) scanTerm = "";
          }
        }
        reset();
        return;
      }

      if (typeof e.key === "string" && e.key.length === 1) {
        const now = Date.now();
        const dt = lastAt ? (now - lastAt) : 0;
        // Allow occasional UI/render jitter without discarding a valid scan.
        if (dt && dt > SCAN_INTER_KEY_RESET_MS) buf = "";
        if (!buf) {
          startedAt = now;
          maxGap = 0;
          charCount = 0;
        } else if (dt > 0) {
          maxGap = Math.max(maxGap, dt);
        }
        buf += e.key;
        charCount += 1;
        lastAt = now;
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(reset, SCAN_BUFFER_TTL_MS);
      }
    };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      if (fetchTimer) clearTimeout(fetchTimer);
      if (pushTimer) clearTimeout(pushTimer);
      if (pullTimer) clearTimeout(pullTimer);
      if (_customerRemoteTimer) {
        clearTimeout(_customerRemoteTimer);
        _customerRemoteTimer = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("scroll", onWindowScroll, true);
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("click", onClickCapture, true);
      document.removeEventListener("keydown", onKeyDown, true);
      reset();
    };
  });

</script>

<Shell 
  syncBadge={syncBadge}
  officialStatus={status}
  unofficialStatus={unofficialStatus}
  cashierName={cashierName}
  cashierOfficialName={cashierOfficialName}
  cashierUnofficialName={cashierUnofficialName}
  cashierOfficialManager={cashierOfficialManager}
  cashierUnofficialManager={cashierUnofficialManager}
  shiftText={shiftText}
  showTabs={!webSetupFirstTime}
  plainBackground={activeScreen === "pos"}
>
  <svelte:fragment slot="tabs">
    {@const tabBase = "h-10 px-3.5 rounded-xl text-xs font-bold border transition-all whitespace-nowrap shadow-sm"}
    {@const tabOn = "bg-accent text-[rgb(var(--color-accent-content))] border-accent/40 hover:bg-accent-hover shadow-lg shadow-accent/20"}
    {@const tabOff = "bg-surface/55 text-ink/85 border-ink/10 hover:bg-surface/75 hover:text-ink"}
    {@const draftCount = (cartDrafts || []).length}
    {@const draftsTabOn = "bg-accent/20 text-accent border-accent/30 hover:bg-accent/30"}

    <div class="flex items-center gap-1.5 min-w-max">
      <button
        class={`${tabBase} ${activeScreen === "pos" ? tabOn : tabOff}`}
        on:click={() => setActiveScreen("pos")}
        type="button"
        title="Cashier POS screen"
      >
        POS
      </button>
      <button
        class={`${tabBase} w-10 px-0 inline-flex items-center justify-center relative ${showCartDraftsDrawer || draftCount > 0 ? draftsTabOn : tabOff}`}
        on:click={openCartDrafts}
        title="Save and resume draft carts"
        aria-label={`Draft carts${draftCount > 0 ? ` (${draftCount})` : ""}`}
        type="button"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M3 7h6l2 2h10v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M3 7V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {#if draftCount > 0}
          <span class="absolute top-0.5 right-0.5 inline-flex min-w-[16px] h-4 px-1 items-center justify-center rounded-full bg-accent text-[10px] leading-none text-[rgb(var(--color-accent-content))] font-bold text-center">
            {draftCount > 99 ? "99+" : draftCount}
          </span>
        {/if}
      </button>
      <button
        class={`${tabBase} ${activeScreen === "items" ? tabOn : tabOff}`}
        on:click={() => setActiveScreen("items")}
        type="button"
        title="Item lookup & details"
      >
        Items
      </button>
    </div>
    <button
      class={`${tabBase} ml-auto ${activeScreen === "settings" ? tabOn : tabOff}`}
      on:click={() => setActiveScreen("settings")}
      type="button"
      title="Connectivity & setup"
    >
      Settings
    </button>
  </svelte:fragment>

  <svelte:fragment slot="top-actions">
    {@const topBtnBase = "h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/50 hover:bg-surface/75 transition-all whitespace-nowrap shadow-sm disabled:opacity-60"}
    {@const topBtnActive = "bg-accent/20 text-accent border-accent/30 hover:bg-accent/30"}
    {@const topBtnWarn = "border-amber-500/40 bg-amber-500/15 text-ink hover:bg-amber-500/25"}
    {#if !webSetupFirstTime}
    <button
      class={topBtnBase}
      on:click={syncPull}
      disabled={loading}
      title={syncPullHint}
      type="button"
    >
      Refresh
    </button>
    <button
      class={`${topBtnBase} ${queuedEventsTotal > 0 ? topBtnWarn : ""}`}
      on:click={() => showQueueDrawer = true}
      disabled={loading}
      title="Inspect pending queue events"
      type="button"
    >
      Queue{queuedEventsTotal > 0 ? ` (${queuedEventsTotal})` : ""}
    </button>
    <button
      class={topBtnBase}
      on:click={() => openCashierModal(cashierCompanyKey || originCompanyKey)}
      disabled={loading}
      title="Cashier login"
      type="button"
    >
      Cashier
    </button>
    <button
      class={topBtnBase}
      on:click={() => {
        shiftCompanyKey = checkoutMissingShifts[0] || originCompanyKey;
        showShiftModal = true;
        shiftRefresh(shiftCompanyKey, { quiet: true });
      }}
      disabled={loading}
      title="Shift open/close"
      type="button"
    >
      Shift
    </button>
    {#if activeScreen === "pos"}
      <button
        class={`${topBtnBase} ${saleMode === "return" ? topBtnActive : "text-muted"}`}
        on:click={() => { saleMode = (saleMode === "sale" ? "return" : "sale"); }}
        title="Toggle return mode"
        type="button"
      >
        {saleMode === "sale" ? "Sale" : "Return"}
      </button>
    {/if}

    <div class="relative">
      <button
        bind:this={topMoreActionsButtonEl}
        class={`${topBtnBase} ${showTopMoreActions ? topBtnActive : ""}`}
        on:click={toggleTopMoreActions}
        title="More actions"
        type="button"
      >
        More
      </button>
      {#if showTopMoreActions}
        <div bind:this={topMoreMenuEl} class="fixed z-[81] rounded-2xl border border-ink/10 bg-surface shadow-2xl p-2 space-y-1" style={topMoreMenuStyle}>
          <button
            class={`w-full text-left h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/55 hover:bg-surface/75 transition-colors ${queuedEventsTotal > 0 ? "border-amber-500/40 bg-amber-500/10" : ""}`}
            on:click={() => { showTopMoreActions = false; syncPush(); }}
            disabled={loading}
            title={syncPushHint}
            type="button"
          >
            Send Queue{queuedEventsTotal > 0 ? ` (${queuedEventsTotal})` : ""}
          </button>
          <button
            class="w-full text-left h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/55 hover:bg-surface/75 transition-colors"
            on:click={() => { showTopMoreActions = false; openAuditDrawer(); }}
            disabled={loading}
            title="Recent sale/return/retry audit entries"
            type="button"
          >
            Audit
          </button>
          <button
            class="w-full text-left h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/55 hover:bg-surface/75 transition-colors"
            on:click={() => { showTopMoreActions = false; openReceiptPreview(); }}
            title="Open printable last receipt"
            type="button"
          >
            Receipt
          </button>
          <button
            class="w-full text-left h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/55 hover:bg-surface/75 transition-colors"
            on:click={openShortcutsGuide}
            title="Show keyboard shortcuts"
            type="button"
          >
            Shortcuts
          </button>
          {#if activeScreen === "pos"}
            <button
              class="w-full text-left h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/55 hover:bg-surface/75 transition-colors"
              on:click={() => { showTopMoreActions = false; openCartDrafts(); }}
              title="Open cart drafts"
              type="button"
            >
              Drafts{cartDrafts.length > 0 ? ` (${cartDrafts.length})` : ""}
            </button>
            <button
              class="w-full text-left h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/55 hover:bg-surface/75 transition-colors disabled:opacity-60"
              on:click={() => {
                showTopMoreActions = false;
                saveCurrentCartToDraft();
              }}
              disabled={(cart || []).length === 0}
              title={(cart || []).length === 0 ? "Add items before saving draft" : "Save current cart to drafts"}
              type="button"
            >
              Save Current As Draft
            </button>
          {/if}
          <button
            class="w-full text-left h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/55 hover:bg-surface/75 transition-colors"
            on:click={() => { showTopMoreActions = false; toggleTheme(); }}
            title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            type="button"
          >
            Theme: {theme === "light" ? "Light" : "Dark"}
          </button>
          <button
            class="w-full text-left h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/55 hover:bg-surface/75 transition-colors"
            on:click={() => { showTopMoreActions = false; cashierLogout(); }}
            disabled={loading}
            title="Cashier logout"
            type="button"
          >
            Cashier Logout
          </button>
          {#if webHostUnsupported}
            <a
              class="w-full h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/55 hover:bg-surface/75 transition-colors inline-flex items-center"
              href="https://download.melqard.com"
              target="_blank"
              rel="noopener noreferrer"
              on:click={() => { showTopMoreActions = false; }}
            >
              Download POS Desktop
            </a>
          {/if}
          <div class="px-1 pt-1 text-[10px] text-muted">{syncActionHelp}</div>
          <div class="px-1 pb-1 text-[10px] text-muted/80">Version: {runtimeVersionText}</div>
        </div>
      {/if}
    </div>
    {:else}
      <a
        class="h-8 px-3 rounded-xl text-[11px] font-semibold border border-ink/10 bg-surface/50 hover:bg-surface/75 transition-all whitespace-nowrap shadow-sm inline-flex items-center"
        href="https://download.melqard.com"
        target="_blank"
        rel="noopener noreferrer"
      >
        Download POS Desktop
      </a>
      <button
        class={topBtnBase}
        on:click={() => { try { window.open("http://127.0.0.1:7070", "_blank", "noopener,noreferrer"); } catch (_) {} }}
        type="button"
      >
        Open Local POS
      </button>
    {/if}
  </svelte:fragment>

  {#if activeScreen === "pos"}
    <div
      class={`pos-screen grid h-full gap-6 ${
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
          vatRate={toRate(config.vat_rate)}
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
          vatDisplayMode={vatDisplayMode}
          vatRateForLine={vatRateForLine}
          updateQty={updateLineQty}
          uomOptionsForLine={uomOptionsForLine}
          updateUom={updateLineUom}
          removeLine={removeLine}
          clearCart={clearCartAll}
          saveDraft={saveCurrentCartToDraft}
          companyLabelForLine={companyLabel}
          companyToneForLine={companyTone}
        />
      </div>

      <!-- Right Column: Customer + Current Sale -->
      <div class="h-full min-h-0 flex flex-col gap-2 overflow-visible relative z-0">
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
            vatDisplayMode={vatDisplayMode}
            showPriceDisplayControls={showPriceDisplayControls}
            onVatDisplayModeChange={onVatDisplayModeChange}
            vatRateForLine={vatRateForLine}
            originCompanyKey={originCompanyKey}
            invoiceCompanyMode={invoiceCompanyMode}
            flagOfficial={flagOfficial}
            onInvoiceCompanyModeChange={onInvoiceCompanyModeChange}
            onFlagOfficialChange={onFlagOfficialChange}
            checkoutBlocked={checkoutBlocked}
            checkoutBlockedReason={checkoutBlockReason}
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
      currencyPrimary={currencyPrimary}
      vatRate={toRate(config.vat_rate)}
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
    {#if webSetupFirstTime}
      <section class="glass-panel rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 mb-4">
        <h2 class="text-lg font-extrabold text-ink">First-Time Setup</h2>
        <p class="mt-1 text-sm text-muted">
          Complete cloud onboarding once, then POS and Items will remain available without Web Setup mode.
        </p>
        {#if _hasCloudDeviceConfig(originCompanyKey)}
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              class="px-4 py-2 rounded-xl bg-accent text-[rgb(var(--color-accent-content))] font-extrabold hover:bg-accent-hover transition-colors"
              on:click={async () => { setActiveScreen("pos"); await fetchData(); }}
              type="button"
            >
              Continue To POS
            </button>
            <button
              class="px-4 py-2 rounded-xl border border-ink/10 bg-ink/5 text-ink hover:bg-ink/10 font-semibold transition-colors"
              on:click={async () => { setActiveScreen("items"); await fetchData(); }}
              type="button"
            >
              Open Items
            </button>
          </div>
        {/if}
        {#if webHostHint}
          <p class="mt-1 text-xs text-amber-300">{webHostHint}</p>
        {/if}
      </section>
    {/if}
    <SettingsScreen
      officialConfig={config}
      unofficialConfig={unofficialConfig}
      isWebSetupMode={webSetupFirstTime}
      isCloudOnlyMode={webHostUnsupported}
      unofficialEnabled={true}
      unofficialStatus={unofficialStatus}
      otherAgentUrl={otherAgentUrl}
      bind:otherAgentDraftUrl={otherAgentDraftUrl}
      saveOtherAgent={saveOtherAgent}
      saveConfigFor={saveConfigFor}
      testSyncFor={testSyncFor}
      syncPullFor={syncPullFor}
      syncPushFor={syncPushFor}
      openPrintingSettings={configurePrinting}
      runStressBenchmark={runStressBenchmark}
      vatDisplayMode={vatDisplayMode}
      onVatDisplayModeChange={onVatDisplayModeChange}
      showPriceDisplayControls={showPriceDisplayControls}
      onShowPriceDisplayControlsChange={onShowPriceDisplayControlsChange}
      setupLogin={setupLogin}
      setupBranches={setupBranches}
      setupDevices={setupDevices}
      setupRegisterDevice={setupRegisterDevice}
      versionText={runtimeVersionText}
    />
  {/if}
</Shell>

<style>
  :global(.pos-screen .glass-panel) {
    box-shadow: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    background-color: rgb(var(--color-surface) / 0.96) !important;
  }

  :global(.queue-status-bad) {
    border-color: rgb(248 113 113 / 0.35) !important;
    background-color: rgb(239 68 68 / 0.12) !important;
    color: rgb(252 165 165) !important;
  }

  :global(.queue-error-msg) {
    border: 1px solid rgb(248 113 113 / 0.25) !important;
    background-color: rgb(239 68 68 / 0.10) !important;
    color: rgb(254 202 202) !important;
    font-weight: 500;
  }

  :global(:root[data-theme="light"] .queue-status-bad) {
    border-color: rgb(239 68 68 / 0.45) !important;
    background-color: rgb(254 226 226 / 0.92) !important;
    color: rgb(153 27 27) !important;
  }

  :global(:root[data-theme="light"] .queue-error-msg) {
    border-color: rgb(239 68 68 / 0.45) !important;
    background-color: rgb(254 226 226 / 0.92) !important;
    color: rgb(127 29 29) !important;
    font-weight: 600;
  }
</style>

<PaymentModal
  isOpen={showPaymentModal}
  total={checkoutTotal}
  currency={currencyPrimary}
  mode={saleMode}
  busy={loading || checkoutInFlight}
  onConfirm={handleProcessSale}
  onCancel={() => showPaymentModal = false}
/>

{#if showShortcutsGuide}
  <div class="fixed inset-0 z-[75] flex items-center justify-center p-4">
    <button
      class="absolute inset-0 bg-black/70 backdrop-blur-sm"
      type="button"
      aria-label="Close shortcuts guide"
      on:click={() => showShortcutsGuide = false}
    ></button>
    <div class="relative z-10 w-full max-w-4xl max-h-[88vh] bg-surface border border-ink/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      <header class="px-5 py-4 border-b border-ink/10 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-base font-bold text-ink">POS Shortcuts Guide</h3>
          <p class="text-xs text-muted mt-1">All available keyboard shortcuts in this POS UI.</p>
        </div>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
          type="button"
          on:click={() => showShortcutsGuide = false}
        >
          Close
        </button>
      </header>
      <div class="p-5 overflow-auto flex-1 space-y-4">
        {#each SHORTCUT_GUIDE_SECTIONS as section}
          <section class="rounded-xl border border-ink/10 bg-ink/5 overflow-hidden">
            <div class="px-4 py-2.5 border-b border-ink/10 text-xs font-bold uppercase tracking-wide text-muted">
              {section.title}
            </div>
            <div class="divide-y divide-ink/10">
              {#each section.items as row}
                <div class="px-4 py-2.5 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-2 items-start">
                  <div class="text-[11px] font-mono font-semibold text-accent">{row.keys}</div>
                  <div class="text-[12px] text-ink/90">{row.action}</div>
                </div>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if showCartDraftsDrawer}
  <div class="fixed inset-0 z-[71]">
    <button
      class="absolute inset-0 bg-black/70 backdrop-blur-sm"
      type="button"
      aria-label="Close cart drafts drawer"
      on:click={() => showCartDraftsDrawer = false}
    ></button>
    <aside class="absolute right-0 top-0 h-full w-full max-w-2xl bg-surface border-l border-ink/10 shadow-2xl overflow-hidden flex flex-col">
      <header class="p-5 border-b border-ink/10 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-xl font-bold text-ink">Cart Drafts</h2>
          <p class="text-sm text-muted mt-1">Save current cart and resume later.</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors disabled:opacity-60"
            on:click={() => {
              if (saveCurrentCartAsDraft({ name: cartDraftName, clearCurrent: true })) cartDraftName = "";
            }}
            disabled={(cart || []).length === 0 || loading || checkoutInFlight}
            title={(cart || []).length === 0 ? "Add items before saving a draft" : "Save current cart and start a new one"}
            type="button"
          >
            Save Current Cart
          </button>
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
            on:click={() => showCartDraftsDrawer = false}
            type="button"
          >
            Close
          </button>
        </div>
      </header>

      <div class="px-5 py-4 border-b border-ink/10 space-y-2">
        <label class="text-xs text-muted uppercase tracking-wide font-semibold" for="cart-draft-name">Draft Name (Optional)</label>
        <input
          id="cart-draft-name"
          class="w-full bg-bg/50 border border-ink/10 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none"
          placeholder="Draft for customer / order note"
          bind:value={cartDraftName}
          on:keydown={(e) => {
            if (e.key !== "Enter") return;
            if (saveCurrentCartAsDraft({ name: cartDraftName, clearCurrent: true })) cartDraftName = "";
          }}
        />
        <div class="text-[11px] text-muted">
          Current cart: {(cart || []).length} line{(cart || []).length === 1 ? "" : "s"}.
        </div>
        <label class="inline-flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            class="accent-accent w-3.5 h-3.5 rounded border-white/10 bg-surface/50"
            checked={keepDraftCopyOnResume}
            on:change={(e) => setKeepDraftCopyMode(!!e?.target?.checked)}
          />
          Keep a copy after resume
        </label>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-3">
        {#if (cartDrafts || []).length === 0}
          <div class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-5 text-sm text-muted">
            No saved drafts yet. Build a cart, then click <span class="font-semibold text-ink">Save Current Cart</span>.
          </div>
        {:else}
          {#each cartDrafts as draft, i}
            {@const lineCount = (draft?.cart || []).length}
            {@const customerName = String(draft?.customer?.name || "").trim()}
            {@const totalUsd = _draftTotalUsd(draft)}
            {@const draftLabel = `Draft #${i + 1}`}
            {@const draftTitle = customerName ? `${customerName} - ${draftLabel}` : draftLabel}
            {@const customDraftName = String(draft?.name || "").trim()}
            <article class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-3 space-y-2">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm font-bold text-ink truncate">{draftTitle}</div>
                  <div class="text-[11px] text-muted mt-1">
                    Updated {_queueAgeText(draft?.updated_at)} · {lineCount} line{lineCount === 1 ? "" : "s"}
                    {#if customDraftName}
                      {" · "}Name: <span class="text-ink">{customDraftName}</span>
                    {/if}
                  </div>
                </div>
                <div class="text-xs font-mono text-ink whitespace-nowrap">{totalUsd.toFixed(2)} USD</div>
              </div>
              <div class="flex flex-wrap items-center gap-2 pt-1">
                <button
                  class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-60"
                  type="button"
                  on:click={() => restoreCartDraft(draft?.id)}
                  disabled={loading || checkoutInFlight}
                >
                  Resume
                </button>
                <button
                  class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors"
                  type="button"
                  on:click={() => deleteCartDraft(draft?.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          {/each}
        {/if}
      </div>
    </aside>
  </div>
{/if}

{#if showQueueDrawer}
  <div class="fixed inset-0 z-[70]">
    <button
      class="absolute inset-0 bg-black/70 backdrop-blur-sm"
      type="button"
      aria-label="Close queue drawer"
      on:click={() => showQueueDrawer = false}
    ></button>
    <aside class="absolute right-0 top-0 h-full w-full max-w-2xl bg-surface border-l border-ink/10 shadow-2xl overflow-hidden flex flex-col">
      <header class="p-5 border-b border-ink/10 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-xl font-bold text-ink">Queue Inspector</h2>
          <p class="text-sm text-muted mt-1">Pending/failed events waiting to sync. Dead cloud events need Admin requeue first.</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
            on:click={syncPull}
            disabled={loading}
            type="button"
          >
            Refresh
          </button>
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
            on:click={openAdminOutbox}
            type="button"
            title="Open Admin > System > Outbox"
          >
            Open Admin Outbox
          </button>
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-amber-500/35 bg-amber-500/15 text-ink hover:bg-amber-500/25 transition-colors disabled:opacity-60"
            on:click={syncPush}
            disabled={loading}
            type="button"
          >
            Send Queue{queuedEventsTotal > 0 ? ` (${queuedEventsTotal})` : ""}
          </button>
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
            on:click={() => showQueueDrawer = false}
            type="button"
          >
            Close
          </button>
        </div>
      </header>

      <div class="px-5 py-4 border-b border-ink/10 grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
        <div class="rounded-xl border border-ink/10 bg-ink/5 px-3 py-2">
          <div class="text-muted uppercase tracking-wide">Total</div>
          <div class="text-ink font-bold mt-0.5">{queuedEventsTotal}</div>
        </div>
        <div class="rounded-xl border border-ink/10 bg-ink/5 px-3 py-2">
          <div class="text-muted uppercase tracking-wide">Official</div>
          <div class="text-ink font-bold mt-0.5">{queueOfficialCount}</div>
        </div>
        <div class="rounded-xl border border-ink/10 bg-ink/5 px-3 py-2">
          <div class="text-muted uppercase tracking-wide">Unofficial</div>
          <div class="text-ink font-bold mt-0.5">{queueUnofficialCount}</div>
        </div>
        <div class="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2">
          <div class="text-muted uppercase tracking-wide">Failed</div>
          <div class="text-ink font-bold mt-0.5">{queueFailedCount}</div>
        </div>
        <div class="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
          <div class="text-muted uppercase tracking-wide">Dead</div>
          <div class="text-ink font-bold mt-0.5">{queueDeadCount}</div>
        </div>
      </div>

      {#if queueManualRequeueCount > 0}
        <div class="px-5 py-4 border-b border-ink/10">
          <div class="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3">
            <div class="text-xs font-bold text-ink">Dead means manual requeue required.</div>
            <div class="text-[11px] text-muted mt-1">
              {queueManualRequeueCount} cloud event{queueManualRequeueCount === 1 ? "" : "s"} in dead state. Requeue in Admin, then return here and click Send Queue.
            </div>
            <div class="mt-2 rounded-lg border border-ink/10 bg-ink/5 px-3 py-2">
              <div class="text-[10px] font-bold uppercase tracking-wide text-muted">How to recover dead events</div>
              <ol class="mt-1.5 space-y-1 text-[11px] text-ink list-decimal list-inside">
                <li>Open Admin Outbox and filter status to dead or failed.</li>
                <li>Requeue the affected events in Admin.</li>
                <li>Return to POS Queue and click Send Queue.</li>
                <li>Confirm queue count drops and invoices/returns appear.</li>
              </ol>
            </div>
            <div class="flex items-center gap-2 pt-2">
              <button
                class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-ink/15 bg-ink/5 text-ink hover:bg-ink/10 transition-colors"
                type="button"
                on:click={openAdminOutbox}
              >
                Open Admin Outbox
              </button>
              <button
                class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-ink/15 bg-ink/5 text-ink hover:bg-ink/10 transition-colors"
                type="button"
                on:click={copyAdminOutboxLink}
              >
                Copy Link
              </button>
            </div>
          </div>
        </div>
      {/if}

      <div class="flex-1 overflow-y-auto p-5 space-y-3">
        {#if queueEvents.length === 0}
          <div class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-5 text-sm text-muted">
            Queue is empty. New events will appear here if sync is delayed.
          </div>
        {:else}
          {#each queueEvents as ev}
            {@const statusText = String(ev?.status || "pending").trim().toLowerCase()}
            {@const eventType = String(ev?.event_type || "event").trim() || "event"}
            {@const eventId = String(ev?.event_id || ev?.id || "").trim()}
            {@const errorText = String(ev?.error_message || ev?.last_error || "").trim()}
            <article class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-3 space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <span class={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${ev?.companyKey === "unofficial" ? "border-amber-500/35 bg-amber-500/12 text-amber-300" : "border-emerald-500/35 bg-emerald-500/12 text-emerald-300"}`}>
                    {ev?.companyKey === "unofficial" ? "Unofficial" : "Official"}
                  </span>
                  <span class={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${statusText === "failed" || statusText === "dead" ? "queue-status-bad" : "border-amber-500/35 bg-amber-500/12 text-amber-300"}`}>
                    {statusText || "pending"}
                  </span>
                </div>
                <div class="text-[11px] text-muted whitespace-nowrap">{_queueAgeText(ev?.created_at)}</div>
              </div>
              <div class="text-xs font-mono text-ink/90">{_shortQueueEventId(eventId)}</div>
              <div class="text-xs text-muted">{eventType}</div>
              {#if _queueNeedsAdminRequeue(ev)}
                <div class="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-ink">
                  Dead cloud event. Requeue it in Admin Outbox before retrying from POS.
                </div>
              {/if}
              {#if errorText}
                <div class="queue-error-msg rounded-lg px-3 py-2 text-[11px] break-words">
                  {errorText}
                </div>
              {/if}
              <div class="flex flex-wrap items-center gap-2 pt-1">
                {#if _queueNeedsAdminRequeue(ev)}
                  <button
                    class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-ink/15 bg-ink/5 text-ink hover:bg-ink/10 transition-colors"
                    type="button"
                    on:click={openAdminOutbox}
                  >
                    Open Admin Outbox
                  </button>
                {:else}
                  <button
                    class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-60"
                    type="button"
                    on:click={() => retryQueueEvent(ev)}
                    disabled={loading || _isQueueRetrying(ev)}
                  >
                    {_isQueueRetrying(ev) ? "Retrying..." : "Retry"}
                  </button>
                {/if}
                <button
                  class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-ink/15 bg-ink/5 text-ink hover:bg-ink/10 transition-colors"
                  type="button"
                  on:click={() => copyQueueEventId(ev)}
                >
                  Copy ID
                </button>
                <button
                  class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-ink/15 bg-ink/5 text-ink hover:bg-ink/10 transition-colors"
                  type="button"
                  on:click={() => openQueuePayload(ev)}
                >
                  View Payload
                </button>
              </div>
            </article>
          {/each}
        {/if}
      </div>
    </aside>
  </div>
{/if}

{#if showAuditDrawer}
  <div class="fixed inset-0 z-[72]">
    <button
      class="absolute inset-0 bg-black/70 backdrop-blur-sm"
      type="button"
      aria-label="Close audit drawer"
      on:click={() => showAuditDrawer = false}
    ></button>
    <aside class="absolute right-0 top-0 h-full w-full max-w-2xl bg-surface border-l border-ink/10 shadow-2xl overflow-hidden flex flex-col">
      <header class="p-5 border-b border-ink/10 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-xl font-bold text-ink">Audit Trail</h2>
          <p class="text-sm text-muted mt-1">Sales, returns, and retry actions with cashier + timestamp.</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
            on:click={loadAuditEvents}
            disabled={auditLoading || loading}
            type="button"
          >
            {auditLoading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
            on:click={() => showAuditDrawer = false}
            type="button"
          >
            Close
          </button>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto p-5 space-y-3">
        {#if auditLoading && auditEvents.length === 0}
          <div class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-5 text-sm text-muted">
            Loading audit events...
          </div>
        {:else if auditEvents.length === 0}
          <div class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-5 text-sm text-muted">
            No audit entries yet.
          </div>
        {:else}
          {#each auditEvents as row}
            {@const action = String(row?.action || "event").trim() || "event"}
            {@const statusText = String(row?.status || "ok").trim() || "ok"}
            {@const eventId = String(row?.event_id || "").trim()}
            {@const cashierId = String(row?.cashier_id || "").trim()}
            <article class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-3 space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${row?.companyKey === "unofficial" ? "border-amber-500/35 bg-amber-500/12 text-amber-300" : "border-emerald-500/35 bg-emerald-500/12 text-emerald-300"}`}>
                    {row?.companyKey === "unofficial" ? "Unofficial" : "Official"}
                  </span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-ink/20 bg-ink/10 text-ink">
                    {action}
                  </span>
                  <span class={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${statusText.includes("fail") || statusText.includes("reject") ? "border-red-500/35 bg-red-500/12 text-red-300" : "border-accent/35 bg-accent/12 text-accent"}`}>
                    {statusText}
                  </span>
                </div>
                <div class="text-[11px] text-muted whitespace-nowrap">{_queueAgeText(row?.created_at)}</div>
              </div>
              <div class="text-xs text-muted">Cashier: <span class="font-mono text-ink/90">{cashierId || "—"}</span></div>
              {#if eventId}
                <div class="text-xs text-muted">Event: <span class="font-mono text-ink/90">{_shortQueueEventId(eventId)}</span></div>
              {/if}
            </article>
          {/each}
        {/if}
      </div>
    </aside>
  </div>
{/if}

{#if showQueuePayloadModal}
  <div class="fixed inset-0 z-[80] flex items-center justify-center p-4">
    <button
      class="absolute inset-0 bg-black/70 backdrop-blur-sm"
      type="button"
      aria-label="Close queue payload"
      on:click={closeQueuePayloadModal}
    ></button>
    <div class="relative z-10 w-full max-w-3xl max-h-[85vh] bg-surface border border-ink/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      <header class="px-5 py-4 border-b border-ink/10 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-base font-bold text-ink">Queue Event Payload</h3>
          <p class="text-xs text-muted font-mono mt-1 truncate">{_shortQueueEventId(queuePayloadEvent?.event_id || queuePayloadEvent?.id || "")}</p>
        </div>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
          type="button"
          on:click={closeQueuePayloadModal}
        >
          Close
        </button>
      </header>
      <div class="p-5 overflow-auto flex-1">
        {#if queuePayloadLoading}
          <div class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-5 text-sm text-muted">
            Loading payload...
          </div>
        {:else if queuePayloadError}
          <div class="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-5 text-sm text-red-200 break-words">
            {queuePayloadError}
          </div>
        {:else}
          <pre class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-4 text-[12px] text-ink whitespace-pre-wrap break-words font-mono leading-5">{queuePayloadText}</pre>
        {/if}
      </div>
    </div>
  </div>
{/if}

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
        <h2 class="text-xl font-bold text-ink">Cashier Session</h2>
        <p class="text-sm text-muted mt-1">{cashierModalSubtitle}</p>
      </div>
      <div class="p-6 space-y-4">
        <label class="text-xs text-muted uppercase tracking-wider font-bold" for="cashier-company">Company</label>
        <select
          id="cashier-company"
          class="w-full bg-bg/50 border border-ink/10 rounded-xl px-4 py-2.5 text-sm font-semibold focus:ring-2 focus:ring-accent/50 focus:outline-none"
          bind:value={cashierCompanyKey}
          on:change={() => { void fetchData({ background: true }); }}
          disabled={loading}
        >
          <option value="official">Official ({cashierOfficialName}{cashierOfficialManager ? " · Manager" : ""})</option>
          <option value="unofficial">Unofficial ({cashierUnofficialName}{cashierUnofficialManager ? " · Manager" : ""})</option>
        </select>
        <div class="text-xs text-muted">
          Current cashier:
          <span class="font-semibold text-ink/80">{selectedCashierName}</span>
        </div>
        <label class="text-xs text-muted uppercase tracking-wider font-bold" for="cashier-select">Cashier</label>
        <select
          id="cashier-select"
          class="w-full bg-bg/50 border border-ink/10 rounded-xl px-4 py-2.5 text-sm font-semibold focus:ring-2 focus:ring-accent/50 focus:outline-none"
          bind:value={cashierLoginCashierId}
          disabled={loading || !cashierChoices.length}
        >
          {#if !cashierChoices.length}
            <option value="">No active cashiers available</option>
          {:else}
            {#each cashierChoices as c}
              <option value={c.id}>{c.name}</option>
            {/each}
          {/if}
        </select>
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
            class="flex-[1.4] py-3 px-4 rounded-xl border border-ink/10 text-muted hover:text-ink hover:bg-ink/5 font-medium transition-colors"
            on:click={() => cashierLogout(cashierCompanyKey || originCompanyKey)}
            disabled={loading || !selectedCashierSignedIn}
            type="button"
            title="Sign out current cashier for selected company"
          >
            Sign Out Current
          </button>
          <button
            class="flex-[2] py-3 px-4 rounded-xl bg-accent text-[rgb(var(--color-accent-content))] font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98]"
            on:click={cashierLogin}
            disabled={loading || !cashierLoginCashierId}
            title={selectedCashierSignedIn ? "Switch cashier with PIN" : "Sign in cashier with PIN"}
            type="button"
          >
            {selectedCashierSignedIn ? "Switch Cashier" : "Sign In"}
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
            class="flex-[2] py-3 px-4 rounded-xl bg-accent text-[rgb(var(--color-accent-content))] font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98]"
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
          <p class="text-sm text-muted mt-1">
            {normalizeCompanyKey(shiftCompanyKey) === "unofficial" ? "Unofficial" : "Official"}:
            {selectedShiftOpen ? " Open shift detected" : " No open shift"}
          </p>
        </div>
        <button
          class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
          on:click={() => shiftRefresh(shiftCompanyKey)}
          disabled={loading}
          title="Refresh"
        >
          Refresh
        </button>
      </div>

      <div class="p-6 space-y-5">
        <div>
          <label class="text-xs text-muted uppercase tracking-wider font-bold" for="shift-company">Company</label>
          <select
            id="shift-company"
            class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-2.5 text-sm font-semibold focus:ring-2 focus:ring-accent/50 focus:outline-none"
            bind:value={shiftCompanyKey}
            on:change={() => shiftRefresh(shiftCompanyKey, { quiet: true })}
            disabled={loading}
          >
            <option value="official">Official ({config.shift_id ? "Open" : "Closed"})</option>
            <option value="unofficial">Unofficial ({unofficialConfig.shift_id ? "Open" : "Closed"})</option>
          </select>
          <div class="mt-1 text-[11px] text-muted">Cashier: {selectedShiftCashierName}</div>
          {#if selectedShiftHasCashMapping === false}
            <div class="mt-2 rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2">
              <div class="text-xs font-semibold text-ink">No CASH payment mapping found.</div>
              <div class="mt-1 text-[11px] text-muted">
                Expected cash currently excludes sale/refund tenders. Add at least one CASH mapping in Admin.
              </div>
            </div>
          {:else if selectedShiftHasCashMapping === true && selectedShiftCashMethodsLabel}
            <div class="mt-1 text-[11px] text-muted">Cash methods: {selectedShiftCashMethodsLabel}</div>
          {/if}
        </div>
        {#if !selectedShiftOpen}
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
            class="w-full py-3 px-4 rounded-xl bg-accent text-[rgb(var(--color-accent-content))] font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98] disabled:opacity-60"
            on:click={() => shiftOpen(shiftCompanyKey)}
            disabled={loading}
          >
            Open Shift
          </button>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-3">
              <div class="text-[11px] uppercase tracking-wide text-muted">Expected Cash (Cash Tenders)</div>
              <div class="mt-1 text-sm font-mono text-ink">USD {toNum(shiftExpectedCloseUsd, 0).toFixed(2)}</div>
              <div class="text-sm font-mono text-ink">{Math.round(toNum(shiftExpectedCloseLbp, 0)).toLocaleString()} LBP</div>
            </div>
            <div class="rounded-xl border border-ink/10 bg-ink/5 px-4 py-3">
              <div class="text-[11px] uppercase tracking-wide text-muted">Variance (Actual - Expected)</div>
              <div class={`mt-1 text-sm font-mono ${Math.abs(toNum(shiftVarianceUsd, 0)) < 0.01 ? "text-emerald-300" : (shiftVarianceUsd > 0 ? "text-amber-300" : "text-red-300")}`}>
                USD {shiftVarianceUsd >= 0 ? "+" : ""}{toNum(shiftVarianceUsd, 0).toFixed(2)}
              </div>
              <div class={`text-sm font-mono ${Math.abs(toNum(shiftVarianceLbp, 0)) < 1 ? "text-emerald-300" : (shiftVarianceLbp > 0 ? "text-amber-300" : "text-red-300")}`}>
                {shiftVarianceLbp >= 0 ? "+" : ""}{Math.round(toNum(shiftVarianceLbp, 0)).toLocaleString()} LBP
              </div>
            </div>
          </div>
          <div class="flex justify-end">
            <button
              class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
              type="button"
              on:click={() => shiftResetClosingToExpected(shiftCompanyKey)}
              disabled={loading}
              title="Reset closing cash inputs to expected values"
            >
              Reset to Expected
            </button>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-muted" for="shift-closing-usd">Closing Cash (USD)</label>
              <input
                id="shift-closing-usd"
                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                type="number"
                step="0.01"
                bind:value={closingCashUsd}
                on:input={() => markShiftClosingEdited(shiftCompanyKey)}
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
                on:input={() => markShiftClosingEdited(shiftCompanyKey)}
              />
            </div>
          </div>
          <button
            class="w-full py-3 px-4 rounded-xl bg-red-500 text-white font-bold hover:bg-red-400 transition-all active:scale-[0.98] disabled:opacity-60"
            on:click={() => shiftClose(shiftCompanyKey)}
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
            class="py-3 px-4 rounded-xl bg-accent text-[rgb(var(--color-accent-content))] font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98]"
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
            <div>
              <label class="text-xs text-muted" for="print-official-template">Invoice template</label>
              <select id="print-official-template" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-3 py-2 text-sm" bind:value={printOfficial.template}>
                {#each INVOICE_TEMPLATE_OPTIONS as opt}
                  <option value={opt.id}>{opt.label}</option>
                {/each}
              </select>
              <div class="mt-1 text-[11px] text-muted">
                {INVOICE_TEMPLATE_OPTIONS.find((t) => t.id === printOfficial.template)?.desc || "A4 invoice PDF format"}
              </div>
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
            <div>
              <label class="text-xs text-muted" for="print-unofficial-template">Receipt template</label>
              <select id="print-unofficial-template" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-3 py-2 text-sm" bind:value={printUnofficial.template}>
                {#each RECEIPT_TEMPLATE_OPTIONS as opt}
                  <option value={opt.id}>{opt.label}</option>
                {/each}
              </select>
              <div class="mt-1 text-[11px] text-muted">
                {RECEIPT_TEMPLATE_OPTIONS.find((t) => t.id === printUnofficial.template)?.desc || "Thermal print format"}
              </div>
            </div>
            <div>
              <label class="text-xs text-muted" for="print-unofficial-company">Receipt header</label>
              <input
                id="print-unofficial-company"
                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-3 py-2 text-sm"
                placeholder="AH Trading"
                bind:value={printUnofficial.companyName}
                maxlength="64"
              />
            </div>
            <div>
              <label class="text-xs text-muted" for="print-unofficial-footer">Receipt footer (optional)</label>
              <input
                id="print-unofficial-footer"
                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-3 py-2 text-sm"
                placeholder="Thank you for your purchase"
                bind:value={printUnofficial.footerText}
                maxlength="160"
              />
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
              class="py-3 px-4 rounded-xl bg-accent text-[rgb(var(--color-accent-content))] font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98]"
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
