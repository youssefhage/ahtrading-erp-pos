<script>
  export let cart = [];
  export let totals = {};
  export let totalsByCompany = null;
  export let vatDisplayMode = "both"; // "ex" | "inc" | "both"
  export let showPriceDisplayControls = false;
  export let onVatDisplayModeChange = (v) => {};
  export let vatRateForLine = (line) => 0;
  export let originCompanyKey = "official";
  export let invoiceCompanyMode = "auto"; // "auto" | "official" | "unofficial"
  export let flagOfficial = false;
  export let onInvoiceCompanyModeChange = (v) => {};
  export let onFlagOfficialChange = (v) => {};
  export let priceLists = [];
  export let selectedPriceListId = "";
  export let onPriceListChange = (id) => {};
  export let priceListUpdating = false;
  export let saleMode = "sale";
  export let checkoutBlocked = false;
  export let checkoutBlockedReason = "";
  export let onCheckout = () => {};

  let settingsOpen = false;

  const fmtMoney = (value, currency = "USD") => {
    const v = Number(value) || 0;
    if (currency === "LBP") return `${Math.round(v).toLocaleString()} LBP`;
    return `${v.toFixed(2)} USD`;
  };

  const toNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const roundUsd = (v) => Math.round((Number(v) || 0) * 10000) / 10000;

  const companyLabel = (k) => (k === "unofficial" ? "UN" : "OF");
  const cartCompaniesSet = (lines) => new Set((lines || []).map((ln) => ln?.companyKey).filter(Boolean));

  $: companies = cartCompaniesSet(cart);
  $: mixedCart = companies.size > 1;
  $: cartPrimaryCompany = companies.size === 1 ? Array.from(companies.values())[0] : null;
  $: resolvedInvoiceCompany = (() => {
    const m = String(invoiceCompanyMode || "auto").trim().toLowerCase();
    if (m === "official" || m === "unofficial") return m;
    return cartPrimaryCompany || originCompanyKey || "official";
  })();
  $: routeLabel = (() => {
    if (flagOfficial) return "Flag Official";
    if (invoiceCompanyMode === "auto") return mixedCart ? "Auto Split" : companyLabel(resolvedInvoiceCompany);
    return `Force ${companyLabel(resolvedInvoiceCompany)}`;
  })();
  $: routeHint = (() => {
    if (flagOfficial && mixedCart) return "Mixed lines -> Official only if all items exist in catalog.";
    if (!flagOfficial && mixedCart && invoiceCompanyMode !== "auto") return "Cross-company stock moves skipped.";
    return "";
  })();
  $: mode = (() => {
    const m = String(vatDisplayMode || "").trim().toLowerCase();
    return (m === "ex" || m === "inc" || m === "both") ? m : "both";
  })();
  $: modeLabel = mode === "ex" ? "Ex" : (mode === "inc" ? "Inc" : "Both");
  $: lineTotals = (() => {
    let subtotalUsd = 0;
    let taxUsd = 0;
    for (const ln of cart || []) {
      const qty = Math.max(0, toNum(ln?.qty, 0));
      const baseUsd = roundUsd(toNum(ln?.price_usd, 0) * qty);
      const vatRate = Math.max(0, toNum(vatRateForLine ? vatRateForLine(ln) : 0, 0));
      subtotalUsd += baseUsd;
      taxUsd += roundUsd(baseUsd * vatRate);
    }
    return { subtotalUsd, taxUsd, totalUsd: subtotalUsd + taxUsd };
  })();
  $: subtotalUsd = lineTotals?.subtotalUsd || toNum(totals?.subtotalUsd, 0);
  $: taxUsd = lineTotals?.taxUsd || toNum(totals?.taxUsd, 0);
  $: totalIncUsd = lineTotals?.totalUsd || toNum(totals?.totalUsd, 0);
  $: primaryTotalUsd = mode === "ex" ? subtotalUsd : totalIncUsd;
  $: officialSubtotalUsd = toNum(totalsByCompany?.official?.subtotalUsd, 0);
  $: officialTotalUsd = toNum(totalsByCompany?.official?.totalUsd, 0);
  $: unofficialSubtotalUsd = toNum(totalsByCompany?.unofficial?.subtotalUsd, 0);
  $: unofficialTotalUsd = toNum(totalsByCompany?.unofficial?.totalUsd, 0);
  $: lineCount = Array.isArray(cart) ? cart.length : 0;
  $: emptyCart = lineCount === 0;
  $: splitAlignAdjustmentCents = Math.max(0, Math.trunc(toNum(totalsByCompany?._align_adjustment_cents, 0)));
  $: showSplitAlignBadge = !emptyCart && mixedCart && invoiceCompanyMode === "auto" && splitAlignAdjustmentCents > 0;
  $: hasSaleToCheckout = lineCount > 0 || totalIncUsd > 0;
  $: canCheckout = hasSaleToCheckout && !checkoutBlocked;
  $: selectedPriceListName = (() => {
    const pl = (priceLists || []).find((p) => p.id === selectedPriceListId);
    return pl ? pl.name : "";
  })();
</script>

<section class="glass-panel rounded-2xl p-2.5 h-full min-h-0 flex flex-col relative">
  <div class="absolute inset-0 bg-surface/40 pointer-events-none rounded-2xl"></div>

  {#if priceListUpdating}
    <div class="absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden rounded-t-2xl">
      <div class="h-full bg-accent/80 price-list-progress"></div>
    </div>
  {/if}

  <!-- Collapsible settings row -->
  <div class="relative z-10 shrink-0">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-2 py-1 px-1 rounded-lg hover:bg-white/5 transition-colors"
      on:click={() => settingsOpen = !settingsOpen}
    >
      <div class="flex items-center gap-2 min-w-0">
        <div class={`w-1.5 h-1.5 rounded-full shrink-0 ${routeHint ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`}></div>
        <span class="text-[10px] font-bold text-ink uppercase tracking-wider truncate">{routeLabel}</span>
        {#if selectedPriceListName}
          <span class="text-[9px] text-accent font-bold uppercase flex items-center gap-1">
            {selectedPriceListName}
            {#if priceListUpdating}
              <svg class="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.3"/>
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              </svg>
            {/if}
          </span>
        {/if}
        <span class="text-[9px] text-muted font-medium">VAT: {modeLabel}</span>
      </div>
      <svg class={`w-3 h-3 text-muted shrink-0 transition-transform ${settingsOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
      </svg>
    </button>

    {#if settingsOpen}
      <div class="mt-1.5 space-y-1.5 pb-1.5 border-b border-white/5">
        <!-- Invoice mode -->
        <div class="flex items-center gap-2 px-1">
          <span class="text-[9px] font-bold text-muted uppercase tracking-wider shrink-0 w-12">Route</span>
          <select
            class="flex-1 bg-surface-highlight/50 border border-white/5 hover:border-accent/30 rounded-lg px-2 py-1 text-[10px] font-bold text-ink focus:ring-1 focus:ring-accent/50 focus:outline-none transition-colors cursor-pointer appearance-none"
            value={invoiceCompanyMode}
            on:change={(e) => onInvoiceCompanyModeChange(e.target.value)}
          >
            <option value="auto">Auto Split</option>
            <option value="official">Force Official</option>
            <option value="unofficial">Force Unofficial</option>
          </select>
          <label class="flex items-center gap-1 shrink-0 cursor-pointer" title="Flag for manual review">
            <input
              type="checkbox"
              class="accent-accent w-3 h-3 rounded border-white/10"
              checked={flagOfficial}
              on:change={(e) => onFlagOfficialChange(!!e.target.checked)}
            />
            <span class="text-[9px] text-muted font-bold uppercase">Flag</span>
          </label>
        </div>

        {#if routeHint}
          <div class="mx-1 text-[9px] text-amber-300/90 leading-snug font-medium bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/10">
            {routeHint}
          </div>
        {/if}

        <!-- Price list selector -->
        {#if priceLists.length > 1}
          <div class="flex items-center gap-2 px-1">
            <span class="text-[9px] font-bold text-muted uppercase tracking-wider shrink-0 w-12">Prices</span>
            <select
              class="flex-1 bg-surface-highlight/50 border border-white/5 hover:border-accent/30 rounded-lg px-2 py-1 text-[10px] font-bold text-ink focus:ring-1 focus:ring-accent/50 focus:outline-none transition-colors cursor-pointer appearance-none disabled:opacity-40 disabled:cursor-not-allowed"
              value={selectedPriceListId}
              on:change={(e) => onPriceListChange(e.target.value)}
              disabled={saleMode === "return"}
            >
              {#each priceLists as pl}
                <option value={pl.id}>{pl.name}{pl.is_default ? " (Default)" : ""}</option>
              {/each}
            </select>
          </div>
        {/if}

        <!-- VAT display mode -->
        {#if showPriceDisplayControls}
          <div class="flex items-center gap-2 px-1">
            <span class="text-[9px] font-bold text-muted uppercase tracking-wider shrink-0 w-12">VAT</span>
            <div class="flex gap-1 flex-1">
              {#each [["ex","Ex"],["inc","Inc"],["both","Both"]] as [val, label]}
                <button
                  type="button"
                  class={`flex-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase border transition-colors ${
                    mode === val
                      ? "bg-accent/20 border-accent/40 text-accent"
                      : "bg-surface/40 border-white/5 text-muted hover:text-ink"
                  }`}
                  on:click={() => onVatDisplayModeChange(val)}
                >{label}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Company split (compact inline) -->
  {#if totalsByCompany && !emptyCart && mixedCart}
    <div class="relative z-10 shrink-0 flex gap-1.5 mt-1.5 px-0.5">
      <div class="flex-1 rounded-lg border border-white/5 bg-surface-highlight/30 px-2 py-1.5">
        <div class="text-[9px] font-bold uppercase tracking-wider text-muted">OF</div>
        <div class="num-readable font-bold text-ink text-sm leading-tight">{fmtMoney(mode === "ex" ? officialSubtotalUsd : officialTotalUsd, "USD")}</div>
      </div>
      <div class="flex-1 rounded-lg border border-white/5 bg-surface-highlight/30 px-2 py-1.5">
        <div class="text-[9px] font-bold uppercase tracking-wider text-muted">UN</div>
        <div class="num-readable font-bold text-ink text-sm leading-tight">{fmtMoney(mode === "ex" ? unofficialSubtotalUsd : unofficialTotalUsd, "USD")}</div>
      </div>
    </div>
    {#if showSplitAlignBadge}
      <div class="relative z-10 shrink-0 mx-0.5 mt-1 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1 text-[9px] text-ink/70">
        <span class="font-semibold text-accent">Audit:</span> rounded {fmtMoney(splitAlignAdjustmentCents / 100, "USD")}
      </div>
    {/if}
  {/if}

  <!-- Spacer pushes totals+checkout to bottom -->
  <div class="flex-1 min-h-0"></div>

  <!-- Totals + Checkout pinned at bottom -->
  <div class="relative z-10 shrink-0 mt-1.5">
    {#if !emptyCart}
      <div class="space-y-0.5 px-1 mb-1">
        <div class="flex justify-between text-muted text-[11px]">
          <span>Subtotal</span>
          <span class="num-readable font-medium">{fmtMoney(subtotalUsd, "USD")}</span>
        </div>
        {#if taxUsd > 0}
          <div class="flex justify-between text-muted text-[11px]">
            <span>VAT</span>
            <span class="num-readable font-medium">{fmtMoney(taxUsd, "USD")}</span>
          </div>
        {/if}
      </div>
    {/if}

    <div class="border-t border-white/10 pt-1.5 pb-1 px-1">
      <div class="flex justify-between items-baseline">
        <span class="text-sm font-bold text-ink">{mode === "ex" ? "Total ex" : "Total"}</span>
        <span class="num-readable text-xl font-extrabold text-accent tracking-tight">{fmtMoney(primaryTotalUsd, "USD")}</span>
      </div>
      {#if mode === "both" && !emptyCart}
        <div class="text-right text-[9px] text-muted num-readable">
          ex {fmtMoney(subtotalUsd, "USD")}
        </div>
      {/if}
    </div>

    <button
      class={`w-full mt-1.5 py-2.5 rounded-xl font-bold text-sm tracking-wide transition-all relative overflow-hidden border ${
        canCheckout
          ? "border-accent/40 bg-accent text-[rgb(var(--color-accent-content))] shadow-lg shadow-accent/25 hover:shadow-accent/40 active:scale-[0.98] group/btn"
          : "border-border/60 bg-surface-highlight/90 text-ink/70 shadow-sm cursor-not-allowed"
      }`}
      disabled={!canCheckout}
      title={!canCheckout && checkoutBlockedReason ? checkoutBlockedReason : "Checkout"}
      on:click={onCheckout}
    >
      {#if canCheckout}
        <div class="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300 rounded-xl"></div>
      {/if}
      <span class="relative z-10 flex items-center justify-center gap-2">
        Checkout
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
      </span>
    </button>
    {#if hasSaleToCheckout && checkoutBlockedReason}
      <div class="text-[9px] text-amber-300 font-semibold px-1 mt-1">{checkoutBlockedReason}</div>
    {/if}
  </div>
</section>

<style>
  @keyframes progress-bar {
    0% { width: 0%; margin-left: 0; }
    50% { width: 60%; margin-left: 20%; }
    100% { width: 0%; margin-left: 100%; }
  }
  .price-list-progress {
    animation: progress-bar 1.2s ease-in-out infinite;
  }
</style>
