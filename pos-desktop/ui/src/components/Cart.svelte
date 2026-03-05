<script>
  export let cart = [];
  export let config = {};
  export let vatDisplayMode = "both";
  export let vatRateForLine = (line) => 0;
  export let updateQty = (index, qty) => {};
  export let uomOptionsForLine = (line) => [];
  export let updateUom = (index, opt) => {};
  export let removeLine = (index) => {};
  export let requestManagerDiscount = (index) => {};
  export let canManagerDiscountLine = (line) => false;
  export let requestPriceOverride = (index) => {};
  export let canPriceOverrideLine = (line) => false;
  export let clearCart = () => {};
  export let saveDraft = () => {};
  export let printVerification = () => {};
  export let companyLabelForLine = (line) => "";
  export let companyToneForLine = (line) => "";
  export let priceListUpdating = false;

  const toNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const fmtMoney = (value, currency = "USD") => {
    const v = Number(value) || 0;
    if (currency === "LBP") {
      return `${Math.round(v).toLocaleString()} LBP`;
    }
    return `${v.toFixed(2)} USD`;
  };

  const fmtPct = (p) => {
    const n = Math.max(0, Math.min(1, toNum(p, 0)));
    return `${Math.round(n * 100)}%`;
  };

  const fmtVatPct = (r) => {
    const pct = Math.max(0, toNum(r, 0) * 100);
    return Number.isInteger(pct) ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
  };

  $: currencyPrimary = (config.pricing_currency || "USD").toUpperCase();
  $: vatMode = (() => {
    const m = String(vatDisplayMode || "").trim().toLowerCase();
    return (m === "ex" || m === "inc" || m === "both") ? m : "both";
  })();
  const lineUom = (line) => (line.uom || line.uom_code || line.unit_of_measure || "pcs");
  const lineName = (line) => {
    const candidates = [
      line?.name,
      line?.item_name,
      line?.product_name,
      line?.item_description,
      line?.description,
      line?.display_name,
      line?.title,
      line?.item?.name,
      line?.item?.item_name,
      line?.sku,
      line?.item_sku,
      line?.item_id,
      line?.id,
    ];
    for (const raw of candidates) {
      const v = String(raw || "").trim();
      if (v) return v;
    }
    return "Unknown Item";
  };
  const lineSku = (line) => (
    String(line?.sku || line?.item_sku || line?.item_code || line?.code || "").trim() || "NO SKU"
  );
  const lineManagerDiscountMode = (line) => {
    const mode = String(line?.manual_discount_mode || "").trim().toLowerCase();
    if (mode === "pct" || mode === "amount") return mode;
    return toNum(line?.manual_discount_pct, 0) > 0 ? "pct" : "";
  };
  const lineHasManagerDiscount = (line) => {
    const mode = lineManagerDiscountMode(line);
    if (mode === "amount") {
      const amtUsd = Math.max(0, toNum(line?.manual_discount_amount_usd, 0));
      const amtLbp = Math.max(0, toNum(line?.manual_discount_amount_lbp, 0));
      return amtUsd > 0 || amtLbp > 0;
    }
    if (mode === "pct") return toNum(line?.manual_discount_pct, 0) > 0;
    return false;
  };
  const lineManagerDiscountText = (line) => {
    const mode = lineManagerDiscountMode(line);
    if (mode === "amount") {
      const amount = currencyPrimary === "LBP"
        ? Math.max(0, toNum(line?.manual_discount_amount_lbp, 0))
        : Math.max(0, toNum(line?.manual_discount_amount_usd, 0));
      if (amount <= 0) return "";
      return `Mgr -${fmtMoney(amount, currencyPrimary)}`;
    }
    const pct = Math.max(0, toNum(line?.manual_discount_pct, 0));
    if (pct <= 0) return "";
    return `Mgr -${fmtPct(pct)}`;
  };

  const nameSizeClass = (name) => {
    const n = String(name || "").trim().length;
    if (n <= 24) return "text-sm font-semibold";
    if (n <= 44) return "text-[13px] font-semibold";
    return "text-[12px] font-medium";
  };

  const findUomOpt = (opts, line) => {
    const u = String(lineUom(line) || "").trim();
    const f = toNum(line?.qty_factor, 1) || 1;
    const arr = Array.isArray(opts) ? opts : [];
    const idx = arr.findIndex((o) => String(o?.uom || "").trim() === u && (toNum(o?.qty_factor, 1) || 1) === f);
    return { idx: idx >= 0 ? idx : 0, opt: arr[idx >= 0 ? idx : 0] || null, arr };
  };

  const cycleLineUom = (index, delta = 1) => {
    const line = cart[index];
    if (!line) return;
    const { idx, arr } = findUomOpt(uomOptionsForLine(line), line);
    if (!arr.length) return;
    const next = (idx + delta + arr.length) % arr.length;
    updateUom(index, arr[next]);
  };

  const optValue = (o) => {
    const u = String(o?.uom || "").trim();
    const f = toNum(o?.qty_factor, 1) || 1;
    return `${u}|${f}`;
  };

  const optLabel = (o, fallbackUom = "pcs") => {
    const u = String(o?.uom || "").trim() || String(fallbackUom || "pcs");
    const f = toNum(o?.qty_factor, 1) || 1;
    const lbl = String(o?.label || "").trim();
    if (lbl) return lbl;
    const factorText = Number(f.toFixed(f >= 1 ? 3 : 5)).toString();
    return f !== 1 ? `${u} x${factorText}` : u;
  };

  const uomMetaText = (opts) => {
    const n = Array.isArray(opts) ? opts.length : 0;
    if (n <= 1) return "Single UOM";
    return `${n} options`;
  };

  const selectField = (e) => {
    const el = e?.currentTarget;
    if (!el || typeof el.select !== "function") return;
    try { el.select(); } catch (_) {}
  };

  const lineVatRate = (line) => Math.max(0, toNum(vatRateForLine ? vatRateForLine(line) : 0, 0));

  const lineBaseUnitPrice = (line) => (
    currencyPrimary === "USD"
      ? toNum(line?.price_usd, 0)
      : toNum(line?.price_lbp, 0)
  );

  const lineBaseAmount = (line) => lineBaseUnitPrice(line) * Math.max(0, toNum(line?.qty, 0));
  const lineTotalAmount = (line, includeVat = false) => {
    const base = lineBaseAmount(line);
    if (!includeVat) return base;
    return base * (1 + lineVatRate(line));
  };
  const unitTotalPrice = (line, includeVat = false) => {
    const base = lineBaseUnitPrice(line);
    if (!includeVat) return base;
    return base * (1 + lineVatRate(line));
  };
  const selectedUomUnitPrice = (line, includeVat = false) => {
    const factor = Math.max(1e-9, toNum(line?.qty_factor, 1) || 1);
    return unitTotalPrice(line, includeVat) * factor;
  };

  let confirmingClear = false;
  let confirmClearTimer = null;

  const confirmClearCart = () => {
    if (!Array.isArray(cart) || cart.length === 0) return;
    if (confirmingClear) {
      clearCart();
      confirmingClear = false;
      if (confirmClearTimer) clearTimeout(confirmClearTimer);
      return;
    }
    confirmingClear = true;
    confirmClearTimer = setTimeout(() => { confirmingClear = false; }, 3000);
  };
</script>

<section class="glass-panel rounded-2xl flex flex-col h-full w-full overflow-hidden relative group/panel">
  <div class="absolute inset-0 bg-surface/40 pointer-events-none"></div>

  {#if priceListUpdating}
    <div class="absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden rounded-t-2xl">
      <div class="h-full bg-accent/80 animate-progress-bar"></div>
    </div>
  {/if}

  <header class="relative px-2.5 py-1.5 border-b border-white/5 flex items-center justify-between shrink-0 z-10">
    <div class="flex items-center gap-2">
      <div class="h-5 w-0.5 rounded-full bg-accent"></div>
      <h2 class="text-sm font-bold tracking-tight">Sale</h2>
      <span class="px-1.5 py-0.5 rounded-md bg-surface-highlight border border-white/5 text-[10px] font-mono text-muted">{cart.length}</span>
    </div>
    <div class="flex items-center gap-1.5">
      {#if cart.length > 0}
        <button
          on:click={confirmClearCart}
          class="text-[10px] font-bold transition-colors px-2 py-1 rounded-md active:scale-95
            {confirmingClear
              ? 'text-white bg-red-500 border border-red-400 animate-pulse'
              : 'text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/10'}"
        >
          {confirmingClear ? 'Confirm?' : 'Clear'}
        </button>
        <button
          type="button"
          on:click={printVerification}
          class="h-6 w-6 inline-flex items-center justify-center rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent transition-colors active:scale-95"
          title="Print verification"
          aria-label="Print order verification receipt"
        >
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <rect x="6" y="14" width="12" height="8" rx="1" stroke-width="2" />
          </svg>
        </button>
        <button
          type="button"
          on:click={saveDraft}
          class="h-6 w-6 inline-flex items-center justify-center rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent transition-colors active:scale-95"
          title="Save draft"
          aria-label="Save cart as draft"
        >
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M5 4h11l3 3v13H5z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      {/if}
    </div>
  </header>

  <div class="relative flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-1.5 z-10">
    {#if cart.length === 0}
      <div class="h-full flex flex-col items-center justify-center text-muted/40 pb-10">
        <div class="p-6 rounded-full bg-surface-highlight/30 mb-4 border border-white/5">
          <svg class="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
        </div>
        <p class="text-sm font-medium tracking-wide">Cart is empty</p>
        <p class="text-xs opacity-60 mt-1">Scan items to start sale</p>
      </div>
    {:else}
      <div class="cart-grid cart-head px-3 py-1 text-[10px] uppercase tracking-wider text-muted/80 font-bold">
        <div>Name</div>
        <div class="text-center">Quantity</div>
        <div class="text-center">UOM</div>
        <div class="text-right">Price</div>
      </div>

      {#each cart as line, i (line.key || `${line.companyKey || "official"}|${line.id || ""}|${line.qty_factor || 1}|${line.uom || line.unit_of_measure || "pcs"}`)}
        {@const uomOpts = uomOptionsForLine(line) || []}
        {@const uomSel = findUomOpt(uomOpts, line)}
        {@const vatRate = lineVatRate(line)}
        {@const lineAmountEx = lineTotalAmount(line, false)}
        {@const lineAmountInc = lineTotalAmount(line, true)}
        {@const lineAmountPrimary = vatMode === "ex" ? lineAmountEx : lineAmountInc}
        {@const unitPricePrimary = vatMode === "ex" ? selectedUomUnitPrice(line, false) : selectedUomUnitPrice(line, true)}
        {@const preDiscBaseRaw = currencyPrimary === "USD" ? toNum(line.pre_discount_unit_price_usd, 0) : toNum(line.pre_discount_unit_price_lbp, 0)}
        {@const preDiscBase = preDiscBaseRaw * (Math.max(1e-9, toNum(line?.qty_factor, 1) || 1))}
        <div class="group relative cart-grid cart-line p-2.5 rounded-xl bg-surface/40 hover:bg-surface/60 border border-white/5 hover:border-white/10 transition-all duration-200 shadow-sm hover:shadow-md">
          <div class="cart-name min-w-0 pr-1">
            <h4
              class={`leading-snug text-ink/95 clamp-2 group-hover:text-accent transition-colors duration-200 ${nameSizeClass(lineName(line))}`}
              title={lineName(line)}
            >{lineName(line)}</h4>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
              <span class="font-mono text-xs text-muted tracking-wider">{lineSku(line)}</span>
              {#if companyLabelForLine(line)}
                <span class="w-1 h-1 rounded-full bg-white/10"></span>
                <span
                  class={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                    companyToneForLine(line) === "official"
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : companyToneForLine(line) === "unofficial"
                        ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                        : "bg-surface-highlight border-white/5 text-muted"
                  }`}
                >
                  {companyLabelForLine(line)}
                </span>
              {/if}
              {#if vatRate > 0}
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded border text-blue-300 border-blue-400/20 bg-blue-500/10">
                  VAT {fmtVatPct(vatRate)}
                </span>
              {/if}
              {#if lineHasManagerDiscount(line)}
                <span class="text-[10px] font-bold text-amber-300 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                  {lineManagerDiscountText(line)}
                </span>
              {/if}
              {#if toNum(line.discount_pct, 0) > 0}
                <span class="text-[10px] font-bold text-accent px-1.5 py-0.5 rounded bg-accent/10 border border-accent/10">
                  -{fmtPct(line.discount_pct)}
                </span>
              {/if}
              {#if line.price_override}
                <span class="text-[10px] font-bold text-purple-300 px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
                  Price Override
                </span>
              {/if}
            </div>
            <div class="mt-1.5 flex gap-1.5">
              <button
                type="button"
                class={`inline-flex items-center gap-1.5 rounded-lg border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  canManagerDiscountLine(line)
                    ? "border-amber-500/25 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                    : "border-white/10 bg-surface-highlight/40 text-muted hover:text-ink"
                }`}
                on:click={() => requestManagerDiscount(i)}
                title={canManagerDiscountLine(line) ? "Apply manager item discount" : "Manager approval required"}
              >
                <span>{lineHasManagerDiscount(line) ? "Edit Discount" : "Discount"}</span>
              </button>
              <button
                type="button"
                class={`inline-flex items-center gap-1.5 rounded-lg border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  canPriceOverrideLine(line)
                    ? "border-purple-500/25 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20"
                    : "border-white/10 bg-surface-highlight/40 text-muted hover:text-ink"
                }`}
                on:click={() => requestPriceOverride(i)}
                title={canPriceOverrideLine(line) ? "Edit unit price (manager)" : "Manager approval required to edit price"}
              >
                <span>{line.price_override ? "Edit Price" : "Price"}</span>
              </button>
            </div>
          </div>

          <div class="cart-qty flex items-center">
            <div class="flex items-center bg-surface-highlight/40 rounded-xl border border-white/5 p-0.5 w-full shadow-inner shadow-black/20">
              <button
                type="button"
                class="w-9 h-9 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-white/5 transition-colors active:scale-90"
                on:click={() => updateQty(i, Math.max(1, toNum(line.qty_entered, 0) - 1))}
                aria-label="Decrease quantity"
                title="Decrease quantity"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M20 12H4" /></svg>
              </button>
              <input
                type="number"
                min="1"
                step="any"
                class="qty-input flex-1 w-0 bg-transparent text-center font-bold num-readable text-sm text-ink focus:outline-none focus:text-accent selection:bg-accent/20"
                value={line.qty_entered}
                on:change={(e) => {
                  const val = Number(e.target.value);
                  const clamped = Number.isFinite(val) && val >= 1 ? Math.round(val) : 1;
                  updateQty(i, clamped);
                }}
                on:keydown={(e) => e.key === "Enter" && e.currentTarget?.blur?.()}
                on:focus={selectField}
                on:click={selectField}
              />
              <button
                type="button"
                class="w-9 h-9 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-white/5 transition-colors active:scale-90"
                on:click={() => updateQty(i, toNum(line.qty_entered, 0) + 1)}
                aria-label="Increase quantity"
                title="Increase quantity"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" /></svg>
              </button>
            </div>
          </div>

          <div class="cart-uom flex items-center justify-center">
            {#if uomOpts.length > 1}
              <div class="relative group/uom w-full">
                <select
                  class="w-full appearance-none pl-2.5 pr-7 py-2 rounded-xl text-xs font-bold uppercase tracking-wider truncate bg-surface-highlight/50 border border-white/5 hover:border-accent/30 text-ink/80 hover:text-accent cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-accent/50"
                  value={optValue(uomSel.opt || uomOpts[0])}
                  title={`Change UOM (${uomMetaText(uomOpts)})`}
                  on:change={(e) => {
                    const v = String(e?.target?.value || "");
                    const pick = (uomOpts || []).find((o) => optValue(o) === v) || (uomOpts || [])[0];
                    if (pick) updateUom(i, pick);
                  }}
                >
                  {#each uomOpts as o}
                    <option value={optValue(o)}>{optLabel(o, lineUom(line))}</option>
                  {/each}
                </select>
                <svg class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted group-hover/uom:text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            {:else}
              <span class="w-full text-center text-[11px] font-bold uppercase tracking-wider text-muted/70 px-2.5 py-1.5 rounded-xl bg-surface-highlight/30 border border-white/5">
                {lineUom(line)}
              </span>
            {/if}
          </div>

          <div class="cart-price flex flex-col items-end justify-center min-w-[90px]">
            <div class="cart-line-amount font-bold text-lg text-ink num-readable leading-none tracking-tight">
              {fmtMoney(lineAmountPrimary, currencyPrimary)}
            </div>
            <div class="flex flex-col items-end mt-1 text-[10px] text-muted space-y-0.5">
              {#if toNum(line.pre_discount_unit_price_usd, 0) > 0 || toNum(line.pre_discount_unit_price_lbp, 0) > 0}
                <span class="line-through opacity-50 num-readable">
                  {fmtMoney(vatMode === "ex" ? preDiscBase : (preDiscBase * (1 + vatRate)), currencyPrimary)}
                </span>
              {/if}
              <span class="opacity-80 num-readable">
                {fmtMoney(unitPricePrimary, currencyPrimary)} / {lineUom(line)}
              </span>
              {#if vatMode === "both"}
                <span class="opacity-70 num-readable">
                  ex {fmtMoney(lineAmountEx, currencyPrimary)}
                </span>
              {/if}
            </div>
          </div>

          <button
            class="absolute top-2 right-2 p-2 rounded-lg text-muted/50 hover:text-red-400 hover:bg-red-500/10 transition-all touch-visible opacity-0 group-hover:opacity-100"
            on:click={() => removeLine(i)}
            title="Remove Item"
            aria-label="Remove {lineName(line)}"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
  /* Make remove button always visible on touch devices */
  @media (hover: none), (pointer: coarse) {
    .touch-visible {
      opacity: 1 !important;
    }
  }

  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 99px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* Keep custom +/- controls and hide native number steppers in qty input. */
  .qty-input::-webkit-outer-spin-button,
  .qty-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .qty-input[type="number"] {
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .cart-grid {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(90px, 0.85fr) minmax(112px, 0.95fr) minmax(120px, 1fr);
    gap: 0.5rem;
  }

  .cart-line-amount {
    font-size: 1.18rem;
  }

  @media (max-width: 1360px) {
    .cart-grid {
      grid-template-columns: minmax(0, 1.75fr) minmax(84px, 0.8fr) minmax(98px, 0.9fr) minmax(108px, 0.95fr);
    }
    .cart-line-amount {
      font-size: 1.06rem;
    }
  }

  @keyframes progress-bar {
    0% { width: 0%; margin-left: 0; }
    50% { width: 60%; margin-left: 20%; }
    100% { width: 0%; margin-left: 100%; }
  }
  .animate-progress-bar {
    animation: progress-bar 1.2s ease-in-out infinite;
  }

  @media (max-width: 1200px) {
    .cart-grid {
      grid-template-columns: minmax(0, 1fr) minmax(110px, 0.9fr);
      gap: 0.5rem;
    }
    .cart-head {
      display: none;
    }
    .cart-line .cart-name {
      grid-column: 1 / -1;
      padding-right: 0;
    }
    .cart-line .cart-qty {
      grid-column: 1;
      width: 100%;
    }
    .cart-line .cart-uom {
      grid-column: 2;
      width: 100%;
    }
    .cart-line .cart-price {
      grid-column: 1 / -1;
      width: 100%;
      align-items: flex-start;
    }
  }
</style>
