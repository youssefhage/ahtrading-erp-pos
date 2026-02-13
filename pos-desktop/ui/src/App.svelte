<script>
  import { onMount } from "svelte";

  const API_BASE_STORAGE_KEY = "pos_ui_api_base";
  const SESSION_STORAGE_KEY = "pos_ui_session_token";
  const DEFAULT_API_BASE = "/api";

  const money = (value) => Math.max(0, Number(value) || 0);

  const normalizeApiBase = (value) => {
    let v = (value || "").trim();
    if (!v) {
      return DEFAULT_API_BASE;
    }
    if (v.startsWith("http://") || v.startsWith("https://")) {
      return v.endsWith("/") ? v.slice(0, -1) : v;
    }
    if (!v.startsWith("/")) {
      v = `/${v}`;
    }
    return v.endsWith("/") ? v.slice(0, -1) : v;
  };

  const toNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const toRate = (value) => {
    const parsed = toNum(value, 0);
    if (parsed === 0) return 0;
    return parsed;
  };

  const fmtQty = (value) => {
    const v = toNum(value, 0);
    return Number.isInteger(v) ? `${v}` : v.toFixed(2).replace(/\.00$/, "");
  };

  const fmtMoney = (value, currency = "USD") => {
    const v = money(value);
    if (currency === "LBP") {
      return `${Math.round(v).toLocaleString()} LBP`;
    }
    return `${v.toFixed(2)} USD`;
  };

  let apiBase = normalizeApiBase(DEFAULT_API_BASE);
  let apiBaseInput = apiBase;
  let sessionToken = "";
  let sessionInput = "";

  let status = "Booting...";
  let loading = false;
  let notice = "";
  let error = "";

  let config = {
    company_id: "",
    device_id: "",
    device_token: "",
    shift_id: "",
    warehouse_id: "",
    cashier_id: "",
    api_base_url: "",
    pricing_currency: "USD",
    exchange_rate: 0,
    vat_rate: 0,
    tax_code_id: null,
    edge_ok: false,
    outbox_pending: 0,
  };
  let edge = null;

  let items = [];
  let barcodes = [];
  let customers = [];
  let customerResults = [];
  let cashiers = [];
  let outbox = [];
  let lastReceipt = null;

  let scanTerm = "";
  let scanSuggestions = [];
  let cart = [];
  let activeCustomer = null;
  let customerSearch = "";
  let paymentMethod = "cash";
  let cashierPin = "";
  let addCustomerMode = false;
  let customerDraft = {
    name: "",
    phone: "",
    email: "",
  };

  const requestHeaders = () => {
    const headers = {
      "Content-Type": "application/json",
    };
    if (sessionToken) {
      headers["X-POS-Session"] = sessionToken;
    }
    return headers;
  };

  const buildApiUrl = (path) => {
    const base = normalizeApiUrl(apiBase);
    const route = path.startsWith("/") ? path : `/${path}`;
    if (/^https?:\/\//.test(base)) {
      return `${base}${route}`;
    }
    return `${base}${route}`;
  };

  const normalizeApiUrl = (value) => normalizeApiBase(value);

  const reportNotice = (message) => {
    notice = message || "";
    error = "";
  };

  const reportError = (message) => {
    error = message || "Something failed.";
    notice = "";
  };

  const clearMessage = () => {
    error = "";
    notice = "";
  };

  const apiCall = async (path, options = {}) => {
    const url = buildApiUrl(path);
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: requestHeaders(),
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = raw || null;
    }

    if (!response.ok) {
      const message =
        (payload && typeof payload === "object" && (payload.error || payload.detail)) ||
        payload ||
        response.statusText ||
        "Request failed";
      const err = new Error(typeof message === "string" ? message : "Request failed");
      err.status = response.status;
      err.payload = payload;
      throw err;
    }

    return payload;
  };

  const fetchConfig = async () => {
    const data = await apiCall("/config");
    config = { ...config, ...data };
  };

  const fetchItems = async () => {
    const data = await apiCall("/items");
    items = Array.isArray(data?.items) ? data.items : [];
  };

  const fetchBarcodes = async () => {
    const data = await apiCall("/barcodes");
    barcodes = Array.isArray(data?.barcodes) ? data.barcodes : [];
  };

  const fetchCustomers = async (query = "") => {
    const route =
      "/customers" + (query ? `?query=${encodeURIComponent(query)}&limit=20` : "");
    const data = await apiCall(route);
    const list = Array.isArray(data?.customers) ? data.customers : [];
    if (query) {
      customerResults = list;
    } else {
      customers = list;
    }
  };

  const fetchCashiers = async () => {
    const data = await apiCall("/cashiers");
    cashiers = Array.isArray(data?.cashiers) ? data.cashiers : [];
  };

  const fetchOutbox = async () => {
    const data = await apiCall("/outbox");
    outbox = Array.isArray(data?.outbox) ? data.outbox : [];
  };

  const fetchEdgeStatus = async () => {
    const data = await apiCall("/edge/status");
    edge = data || null;
  };

  const fetchLastReceipt = async () => {
    const data = await apiCall("/receipts/last");
    lastReceipt = data?.receipt || null;
  };

  const syncPull = async () => {
    await apiCall("/sync/pull", { method: "POST" });
    await Promise.all([fetchItems(), fetchBarcodes(), fetchCustomers(), fetchCashiers(), fetchOutbox()]);
    reportNotice("Catalog sync complete.");
  };

  const syncPush = async () => {
    const data = await apiCall("/sync/push", { method: "POST" });
    reportNotice(`Synced ${data?.sent || 0} pending sale event(s).`);
    await fetchOutbox();
  };

  const refreshAll = async () => {
    clearMessage();
    loading = true;
    status = "Loading data...";
    try {
      await fetchConfig();
      await Promise.all([
        fetchItems(),
        fetchBarcodes(),
        fetchCustomers(),
        fetchCashiers(),
        fetchOutbox(),
        fetchEdgeStatus(),
        fetchLastReceipt(),
      ]);
      status = "Ready";
    } catch (err) {
      reportError(err?.message || "Unable to load workspace.");
      status = "Offline";
      if (err?.status === 503) {
        const hint = err?.payload?.hint || "This endpoint may require an admin session.";
        reportError(hint);
      } else if (err?.status === 401) {
        reportError("Unauthorized (check admin unlock and session token).");
      }
    } finally {
      loading = false;
      await tickUi();
    }
  };

  const applySettings = () => {
    apiBase = normalizeApiBase(apiBaseInput);
    sessionToken = (sessionInput || "").trim();
    localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);
    if (sessionToken) {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    reportNotice(`API base set to ${apiBase}`);
    void refreshAll();
  };

  const clearSessionToken = () => {
    sessionInput = "";
    sessionToken = "";
    localStorage.removeItem(SESSION_STORAGE_KEY);
    reportNotice("Session token removed.");
  };

  const findBarcode = (term) => {
    const normalized = (term || "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return (
      barcodes.find((entry) =>
        (entry?.barcode || "").toLowerCase() === normalized,
      ) || null
    );
  };

  const mapBarcodeToItem = (barcode) => {
    if (!barcode || !barcode.item_id) {
      return null;
    }
    const item = items.find((entry) => entry.id === barcode.item_id);
    return item || null;
  };

  const buildLine = (item, barcode = null, enteredQty = 1) => {
    const factor = toNum(barcode?.qty_factor || 1, 1);
    const qtyEntered = Math.max(toNum(enteredQty, 1), 0.01);
    const baseQty = qtyEntered * factor;
    return {
      id: item.id,
      sku: item.sku || "",
      name: item.name || "",
      unit_of_measure: barcode?.uom_code || item.unit_of_measure || "pcs",
      price_usd: toNum(item.price_usd, 0),
      price_lbp: toNum(item.price_lbp, 0),
      tax_code_id: item.tax_code_id || config.tax_code_id || null,
      qty_factor: factor,
      qty_entered: qtyEntered,
      qty: baseQty,
    };
  };

  const addToCart = (item, enteredQty = 1, barcode = null) => {
    if (!item?.id) {
      return;
    }
    const line = buildLine(item, barcode, enteredQty);
    const idx = cart.findIndex(
      (entry) =>
        entry.id === line.id &&
        entry.qty_factor === line.qty_factor &&
        entry.price_usd === line.price_usd &&
        entry.price_lbp === line.price_lbp,
    );
    if (idx >= 0) {
      const next = [...cart];
      next[idx] = {
        ...next[idx],
        qty_entered: next[idx].qty_entered + line.qty_entered,
        qty: next[idx].qty + line.qty,
      };
      cart = next;
      reportNotice(`Added ${item.name || item.sku || "item"} to cart.`);
      scanTerm = "";
      return;
    }
    cart = [line, ...cart];
    reportNotice(`Added ${item.name || item.sku || "item"} to cart.`);
    scanTerm = "";
  };

  const addFromScan = () => {
    clearMessage();
    const term = scanTerm.trim();
    if (!term) {
      return;
    }
    const barcode = findBarcode(term);
    if (barcode) {
      const linked = mapBarcodeToItem(barcode);
      if (linked) {
        addToCart(linked, 1, barcode);
        return;
      }
    }

    const matchBySku = items.find(
      (entry) => (entry.sku || "").toLowerCase() === term.toLowerCase(),
    );
    if (matchBySku) {
      addToCart(matchBySku);
      return;
    }

    const exactName = items.find(
      (entry) => (entry.name || "").toLowerCase() === term.toLowerCase(),
    );
    if (exactName) {
      addToCart(exactName);
      return;
    }

    const fuzzy = scanSuggestions[0];
    if (fuzzy) {
      addToCart(fuzzy);
      return;
    }
    reportError("Item not found. Scan exact barcode, SKU, or choose from suggestions.");
  };

  const onScanKeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addFromScan();
    }
  };

  const setLineEnteredQty = (index, value) => {
    const entered = Math.max(toNum(value, 0), 0);
    if (entered <= 0) {
      removeLine(index);
      return;
    }
    const next = [...cart];
    if (!next[index]) {
      return;
    }
    const factor = Math.max(toNum(next[index].qty_factor, 1), 1);
    next[index] = {
      ...next[index],
      qty_entered: entered,
      qty: entered * factor,
    };
    cart = next;
  };

  const removeLine = (index) => {
    const next = [...cart];
    next.splice(index, 1);
    cart = next;
  };

  const clearCart = () => {
    cart = [];
    reportNotice("Cart cleared.");
  };

  const selectCustomer = (customer) => {
    activeCustomer = customer || null;
    customerSearch = activeCustomer?.name || "";
    customerResults = [];
  };

  const searchCustomers = async () => {
    const query = customerSearch.trim();
    if (!query) {
      customerResults = [];
      return;
    }
    try {
      await fetchCustomers(query);
    } catch (err) {
      reportError(err?.message || "Customer search failed.");
      customerResults = [];
    }
  };

  const createCustomer = async () => {
    if (!customerDraft.name.trim()) {
      reportError("Customer name is required.");
      return;
    }
    try {
      const data = await apiCall("/customers/create", {
        method: "POST",
        body: {
          name: customerDraft.name.trim(),
          phone: customerDraft.phone.trim(),
          email: customerDraft.email.trim(),
        },
      });
      if (data?.customer) {
        activeCustomer = data.customer;
        customerSearch = activeCustomer.name || "";
        customerDraft = { name: "", phone: "", email: "" };
        addCustomerMode = false;
        await fetchCustomers();
        reportNotice(`Customer ${activeCustomer.name} added.`);
      } else {
        reportError("Customer not returned by server.");
      }
    } catch (err) {
      reportError(err?.message || "Create customer failed.");
    }
  };

  let activeCashier = null;
  let cashierName = "";
  let syncBadge = "";
  let hasConnection = false;
  let currencyPrimary = "USD";
  let currencySecondary = "LBP";
  let totals = {
    subtotalUsd: 0,
    subtotalLbp: 0,
    subtotalUsdFallback: 0,
    taxUsd: 0,
    taxLbp: 0,
    totalUsd: 0,
    totalLbp: 0,
    vatRate: 0,
  };

  $: activeCashier = cashiers.find((entry) => entry.id === config.cashier_id) || null;
  $: cashierName = activeCashier
    ? activeCashier.name
    : config.cashier_id
      ? "Signed in (unknown)"
      : "Not signed in";
  $: syncBadge = outbox.length ? `${outbox.length} pending` : "No pending";
  $: hasConnection = status === "Ready";
  $: currencyPrimary = (config.pricing_currency || "USD").toUpperCase();
  $: currencySecondary = currencyPrimary === "USD" ? "LBP" : "USD";

  const loginCashier = async () => {
    if (!cashierPin.trim()) {
      reportError("Enter cashier PIN.");
      return;
    }
    try {
      const data = await apiCall("/cashiers/login", {
        method: "POST",
        body: { pin: cashierPin.trim() },
      });
      if (data?.config) {
        config = { ...config, ...data.config };
      }
      reportNotice(`Cashier ${data?.cashier?.name || ""} signed in.`);
      cashierPin = "";
      await refreshAll();
    } catch (err) {
      reportError(err?.message || "Cashier login failed.");
    }
  };

  const logoutCashier = async () => {
    try {
      await apiCall("/cashiers/logout", { method: "POST" });
      config.cashier_id = "";
      reportNotice("Cashier logged out.");
      await refreshAll();
    } catch (err) {
      reportError(err?.message || "Cashier logout failed.");
    }
  };

  const checkout = async () => {
    if (!cart.length) {
      reportError("Add at least one item to checkout.");
      return;
    }
    if (paymentMethod === "credit" && !activeCustomer?.id) {
      reportError("Credit sales require a customer.");
      return;
    }
    const payload = {
      cart: cart.map((line) => ({
        id: line.id,
        qty: toNum(line.qty, 0),
        qty_factor: toNum(line.qty_factor, 1),
        qty_entered: toNum(line.qty_entered, 0),
        unit_of_measure: line.unit_of_measure,
        price_usd: toNum(line.price_usd, 0),
        price_lbp: toNum(line.price_lbp, 0),
        tax_code_id: line.tax_code_id || null,
      })),
      customer_id: activeCustomer?.id || null,
      payment_method: paymentMethod,
      pricing_currency: config.pricing_currency || "USD",
      exchange_rate: toNum(config.exchange_rate, 0),
    };
    try {
      loading = true;
      const data = await apiCall("/sale", {
        method: "POST",
        body: payload,
      });
      cart = [];
      reportNotice(`Sale posted. Event: ${data?.event_id || "N/A"}`);
      await Promise.all([fetchOutbox(), fetchLastReceipt(), fetchConfig()]);
    } catch (err) {
      const hint = err?.payload?.hint || "";
      reportError(
        hint
          ? `${err.message}${hint ? ` — ${hint}` : ""}`
          : err?.message || "Sale failed.",
      );
    } finally {
      loading = false;
    }
  };

  const viewReceiptSummary = () => {
    if (!lastReceipt) {
      return "No last receipt yet.";
    }
    const created = lastReceipt.created_at
      ? new Date(lastReceipt.created_at).toLocaleString()
      : "Unknown time";
    return `${lastReceipt.receipt_type || "receipt"} (${created})`;
  };

  const getLinePrice = (line, currency = currencyPrimary) => {
    const price = currency === "USD" ? toNum(line.price_usd, 0) : toNum(line.price_lbp, 0);
    return price;
  };

  const lineSubtotal = (line, currency = currencyPrimary) => {
    const unit = getLinePrice(line, currency);
    return unit * toNum(line.qty, 0);
  };

  const baseCurrencyRates = () => {
    const usd = cart.reduce((sum, line) => sum + toNum(line.price_usd, 0) * toNum(line.qty, 0), 0);
    const lbp = cart.reduce((sum, line) => sum + toNum(line.price_lbp, 0) * toNum(line.qty, 0), 0);
    const rate = toRate(config.exchange_rate);
    return {
      subtotalUsd: usd,
      subtotalLbp: lbp === 0 && rate > 0 ? usd * rate : lbp,
      subtotalUsdFallback: lbp > 0 && rate > 0 ? lbp / rate : usd,
    };
  };

  $: totals = (() => {
    const { subtotalUsd, subtotalLbp } = baseCurrencyRates();
    const vatRate = toRate(config.vat_rate);
    const taxUsd = subtotalUsd * vatRate;
    const taxLbp = subtotalLbp * vatRate;
    const totalUsd = subtotalUsd + taxUsd;
    const totalLbp = subtotalLbp + taxLbp;
    return {
      subtotalUsd,
      subtotalLbp,
      taxUsd,
      taxLbp,
      totalUsd,
      totalLbp,
      vatRate,
    };
  })();

  const edgeStateText = () => {
    if (!edge) {
      return "Edge check pending...";
    }
    if (!edge.ok) {
      return `Edge: offline (${edge.edge_error || "unreachable"})`;
    }
    if (!edge.edge_auth_ok) {
      return `Edge auth failed (${edge.edge_auth_status || 401})`;
    }
    return "Edge connected";
  };

  const cartLineLabel = (line) => `${line.name || line.sku || "Item"} (${line.unit_of_measure || "pc"})`;

  const tickUi = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  $: scanSuggestions = (scanTerm.trim()
    ? items
        .filter((entry) => {
          const hay = `${entry.sku || ""} ${entry.name || ""} ${entry.barcode || ""}`
            .toLowerCase();
          return hay.includes(scanTerm.trim().toLowerCase());
        })
        .slice(0, 10)
    : []);

  onMount(async () => {
    apiBase = normalizeApiBase(localStorage.getItem(API_BASE_STORAGE_KEY) || DEFAULT_API_BASE);
    apiBaseInput = apiBase;
    sessionToken = localStorage.getItem(SESSION_STORAGE_KEY) || "";
    sessionInput = sessionToken;
    await refreshAll();
    setInterval(() => {
      void fetchOutbox();
      void fetchEdgeStatus();
    }, 15000);
  });
</script>

<div class="app-shell">
  <header class="topbar">
    <div class="brand">
      <div class="brand-badge">WP</div>
      <div>
        <h1>Wholesale POS</h1>
        <p>Compact, checkout-first FMCG workflow</p>
      </div>
    </div>
    <div class="top-states">
      <span class={"status-pill " + (hasConnection ? "ok" : "warn")}>{status}</span>
      <span class="status-pill">{edgeStateText()}</span>
      <span class="status-pill">{syncBadge}</span>
    </div>
  </header>

  <section class="settings-strip">
    <label class="field">
      <span>POS API Base</span>
      <input bind:value={apiBaseInput} type="text" />
      <button on:click={applySettings} type="button">Apply</button>
    </label>
    <label class="field">
      <span>Session Token</span>
      <input bind:value={sessionInput} type="text" />
      <button on:click={applySettings} type="button">Save</button>
      <button on:click={clearSessionToken} type="button" class="ghost">Clear</button>
    </label>
    <div class="actions">
      <button on:click={refreshAll} type="button">Reload</button>
      <button on:click={syncPull} type="button">Sync Pull</button>
      <button on:click={syncPush} type="button">Sync Push</button>
    </div>
  </section>

  {#if notice}
    <div class="message ok">{notice}</div>
  {/if}
  {#if error}
    <div class="message bad">{error}</div>
  {/if}

  <section class="workspace">
    <section class="panel">
      <header class="panel-head">
        <h2>Scan & Add</h2>
        <span class="muted">{items.length} items in local catalog</span>
      </header>
      <div class="scan-row">
        <input
          bind:value={scanTerm}
          type="text"
          placeholder="Scan barcode or search item name / SKU"
          on:keydown={onScanKeydown}
        />
        <button on:click={addFromScan} type="button">Add</button>
      </div>

      <div class="result-list">
        {#if !scanTerm.trim()}
          <p class="muted small">Start typing to search items or scan barcode.</p>
        {:else if scanSuggestions.length === 0}
          <p class="muted small">No matches found.</p>
        {:else}
          {#each scanSuggestions as entry}
            <button
              type="button"
              class="result-item"
              on:click={() => addToCart(entry)}
            >
              <span class="result-name">{entry.name || entry.sku}</span>
              <span class="result-meta">
                {entry.sku || "no sku"} · {fmtMoney(
                  currencyPrimary === "USD" ? toNum(entry.price_usd, 0) : toNum(entry.price_lbp, 0),
                  currencyPrimary,
                )}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </section>

    <section class="panel checkout">
      <header class="panel-head">
        <h2>Checkout</h2>
        <span class="muted">{cart.length} lines</span>
      </header>

      <section class="section">
        <div class="split">
          <label class="field">
            <span>Cashier</span>
            <div class="compact-row">
              <input type="text" value={cashierName} readonly />
              {#if config.cashier_id}
                <button on:click={logoutCashier} type="button" class="ghost">Logout</button>
              {:else}
                <button on:click={loginCashier} type="button" class="ghost">Sign in</button>
              {/if}
            </div>
          </label>
          {#if !config.cashier_id}
            <label class="field">
              <span>Cashier PIN</span>
              <div class="compact-row">
                <input bind:value={cashierPin} type="password" />
                <button on:click={loginCashier} type="button">Login</button>
              </div>
            </label>
          {/if}
        </div>
      </section>

      <section class="section">
        <div class="split">
          <label class="field">
            <span>Customer (optional)</span>
            <div class="compact-row">
              <input
                bind:value={customerSearch}
                type="text"
                placeholder="Search by name, phone, id"
              />
              <button on:click={searchCustomers} type="button">Find</button>
            </div>
          </label>
          <button class="ghost" on:click={() => (addCustomerMode = !addCustomerMode)} type="button">
            {addCustomerMode ? "Hide new customer" : "New customer"}
          </button>
        </div>
        {#if customerSearch && customerResults.length > 0}
          <div class="customer-list">
            {#each customerResults as customer}
              <button
                type="button"
                class="result-item"
                on:click={() => selectCustomer(customer)}
              >
                <span>{customer.name}</span>
                <span>{customer.phone || "no phone"} {customer.membership_no ? `· #${customer.membership_no}` : ""}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if addCustomerMode}
          <div class="customer-form">
            <input bind:value={customerDraft.name} type="text" placeholder="Customer name *" />
            <input bind:value={customerDraft.phone} type="text" placeholder="Phone" />
            <input bind:value={customerDraft.email} type="email" placeholder="Email" />
            <button on:click={createCustomer} type="button">Create customer</button>
          </div>
        {/if}
        {#if activeCustomer}
          <p class="muted small">Active: {activeCustomer.name} {activeCustomer.phone ? `(${activeCustomer.phone})` : ""}</p>
        {/if}
      </section>

      <section class="section">
        <div class="cart-head">
          <h3>Cart</h3>
          <button on:click={clearCart} class="ghost" type="button">Clear cart</button>
        </div>
        <div class="cart-list">
          {#if cart.length === 0}
            <p class="muted small">No items yet. Scan or add from search above.</p>
          {:else}
            {#each cart as line, index}
              <div class="cart-row">
                <div>
                  <p>{cartLineLabel(line)}</p>
                  <p class="muted">
                    {line.qty_factor > 1
                      ? `Pack factor ${fmtQty(line.qty_factor)}`
                      : "Single unit"} · {fmtMoney(getLinePrice(line, "USD"), "USD")} / {line.unit_of_measure}
                  </p>
                </div>
                <label class="qty">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={line.qty_entered}
                    on:change={(event) => setLineEnteredQty(index, event.currentTarget.value)}
                  />
                  <span>{line.unit_of_measure}</span>
                </label>
                <p>{fmtMoney(lineSubtotal(line, currencyPrimary), currencyPrimary)}</p>
                <button on:click={() => removeLine(index)} class="ghost small" type="button">×</button>
              </div>
            {/each}
          {/if}
        </div>
      </section>

      <section class="section">
        <label class="field">
          <span>Payment method</span>
          <select bind:value={paymentMethod}>
            <option>cash</option>
            <option>card</option>
            <option>transfer</option>
            <option>credit</option>
          </select>
        </label>

        <div class="totals">
          <div><span>Subtotal ({currencyPrimary})</span><strong>{fmtMoney(totals.subtotalUsd, currencyPrimary)}</strong></div>
          <div><span>VAT ({(totals.vatRate * 100).toFixed(0)}%)</span><strong>{fmtMoney(totals.taxUsd, currencyPrimary)}</strong></div>
          <div class="grand"><span>Total ({currencyPrimary})</span><strong>{fmtMoney(totals.totalUsd, currencyPrimary)}</strong></div>
          <div class="muted small">
            Total ({currencySecondary}): {fmtMoney(totals.totalLbp, currencySecondary)}
          </div>
        </div>
      </section>

      <div class="checkout-actions">
        <button
          on:click={checkout}
          type="button"
          class="primary"
          disabled={loading || cart.length === 0}
        >
          {loading ? "Posting..." : "Post Sale"}
        </button>
        <button on:click={fetchLastReceipt} type="button" class="ghost">Last Receipt</button>
      </div>
      <p class="muted small">Last receipt: {viewReceiptSummary()}</p>
    </section>
  </section>
</div>
