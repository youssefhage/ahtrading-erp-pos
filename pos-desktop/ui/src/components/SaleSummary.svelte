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
  export let checkoutBlocked = false;
  export let checkoutBlockedReason = "";
  export let onCheckout = () => {};

  const fmtMoney = (value, currency = "USD") => {
    const v = Math.max(0, Number(value) || 0);
    if (currency === "LBP") return `${Math.round(v).toLocaleString()} LBP`;
    return `${v.toFixed(2)} USD`;
  };

  const toNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const companyLabel = (k) => (k === "unofficial" ? "Unofficial" : "Official");
  const cartCompaniesSet = (lines) => new Set((lines || []).map((ln) => ln?.companyKey).filter(Boolean));

  $: companies = cartCompaniesSet(cart);
  $: mixedCart = companies.size > 1;
  $: cartPrimaryCompany = companies.size === 1 ? Array.from(companies.values())[0] : null;
  $: resolvedInvoiceCompany = (() => {
    const m = String(invoiceCompanyMode || "auto").trim().toLowerCase();
    if (m === "official" || m === "unofficial") return m;
    return cartPrimaryCompany || originCompanyKey || "official";
  })();
  $: routePreview = (() => {
    if (flagOfficial) return "Flagged -> Official (single invoice)";
    if (mixedCart && invoiceCompanyMode === "auto") return "Auto Split -> Official + Unofficial";
    if (invoiceCompanyMode === "auto") return `Auto Split -> ${companyLabel(resolvedInvoiceCompany)} (single company)`;
    if (mixedCart) return `Forced -> ${companyLabel(resolvedInvoiceCompany)} (cross-company)`;
    return `${companyLabel(resolvedInvoiceCompany)} invoice`;
  })();
  $: routeHint = (() => {
    if (flagOfficial && mixedCart) return "Mixed lines will be invoiced on Official only if all items exist in Official catalog.";
    if (!flagOfficial && mixedCart && invoiceCompanyMode !== "auto") return "Cross-company stock moves are skipped and require later review.";
    return "";
  })();
  $: mode = (() => {
    const m = String(vatDisplayMode || "").trim().toLowerCase();
    return (m === "ex" || m === "inc" || m === "both") ? m : "both";
  })();
  $: modeLabel = mode === "ex" ? "Ex VAT" : (mode === "inc" ? "Incl VAT" : "Both");
  $: lineTotals = (() => {
    let subtotalUsd = 0;
    let taxUsd = 0;
    for (const ln of cart || []) {
      const qty = Math.max(0, toNum(ln?.qty, 0));
      const baseUsd = toNum(ln?.price_usd, 0) * qty;
      const vatRate = Math.max(0, toNum(vatRateForLine ? vatRateForLine(ln) : 0, 0));
      subtotalUsd += baseUsd;
      taxUsd += baseUsd * vatRate;
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
  // Keep checkout enabled when we have either cart lines or a computed total,
  // and strict guardrails are satisfied (cashier + shift).
  $: hasSaleToCheckout = lineCount > 0 || totalIncUsd > 0;
  $: canCheckout = hasSaleToCheckout && !checkoutBlocked;
</script>

<section class="glass-panel rounded-3xl p-4 h-full min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-3 relative group/summary">
  <div class="absolute inset-0 bg-surface/40 pointer-events-none rounded-3xl"></div>
  
  <div class="relative z-10 flex flex-col gap-3">
    <!-- Header Controls -->
    <div class="flex items-start justify-between gap-2">
      <div>
        <h3 class="text-[11px] font-bold text-muted uppercase tracking-widest mb-0.5">Invoice Settings</h3>
        <p class="text-[10px] text-ink/50 leading-tight">Route & display.</p>
      </div>
      
      <div class="flex flex-col items-end gap-1.5">
         <select
          class="bg-surface-highlight/50 border border-white/5 hover:border-accent/30 rounded-lg px-2.5 py-1 text-[11px] font-bold text-ink shadow-sm focus:ring-1 focus:ring-accent/50 focus:outline-none transition-colors cursor-pointer appearance-none text-right"
          value={invoiceCompanyMode}
          on:change={(e) => onInvoiceCompanyModeChange(e.target.value)}
          title="Invoice mode"
        >
          <option value="auto">Auto Split</option>
          <option value="official">Force Official</option>
          <option value="unofficial">Force Unofficial</option>
        </select>
        
        <label class="flex items-center gap-2 text-[11px] cursor-pointer group/check">
          <span class="text-muted group-hover/check:text-ink transition-colors text-[10px] uppercase font-bold tracking-wider">Flag Manual Review</span>
          <input
            type="checkbox"
            class="accent-accent w-3 h-3 rounded border-white/10 bg-surface/50"
            checked={flagOfficial}
            on:change={(e) => onFlagOfficialChange(!!e.target.checked)}
          />
        </label>
      </div>
    </div>

    <!-- Route Info -->
    <div class={`rounded-xl border px-3 py-2 text-xs transition-colors ${routeHint ? "border-amber-500/20 bg-amber-500/5" : "border-white/5 bg-surface-highlight/30"}`}>
      <div class="flex items-center gap-2">
        <div class={`w-1.5 h-1.5 rounded-full ${routeHint ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`}></div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-muted/80">Routing Strategy</div>
      </div>
      <div class="mt-1 font-bold text-ink text-[13px]">{routePreview}</div>
      {#if routeHint}
        <div class="mt-1.5 text-[10px] text-amber-300/90 leading-snug font-medium bg-amber-500/10 p-1.5 rounded-lg border border-amber-500/10">
          {routeHint}
        </div>
      {/if}
    </div>

    {#if showPriceDisplayControls}
      <div class="rounded-xl border border-white/5 bg-surface-highlight/30 p-2.5">
        <div class="text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">Price Display</div>
        <div class="grid grid-cols-3 gap-1">
          <button
            type="button"
            class={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-colors ${
              mode === "ex"
                ? "bg-accent/20 border-accent/40 text-accent"
                : "bg-surface/40 border-white/5 text-muted hover:text-ink"
            }`}
            on:click={() => onVatDisplayModeChange("ex")}
          >
            Ex VAT
          </button>
          <button
            type="button"
            class={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-colors ${
              mode === "inc"
                ? "bg-accent/20 border-accent/40 text-accent"
                : "bg-surface/40 border-white/5 text-muted hover:text-ink"
            }`}
            on:click={() => onVatDisplayModeChange("inc")}
          >
            Incl VAT
          </button>
          <button
            type="button"
            class={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-colors ${
              mode === "both"
                ? "bg-accent/20 border-accent/40 text-accent"
                : "bg-surface/40 border-white/5 text-muted hover:text-ink"
            }`}
            on:click={() => onVatDisplayModeChange("both")}
          >
            Both
          </button>
        </div>
        <div class="mt-1 text-[10px] text-muted">Mode: <span class="font-bold text-ink">{modeLabel}</span></div>
      </div>
    {:else}
      <div class="rounded-xl border border-white/5 bg-surface-highlight/25 px-3 py-2 flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-wider font-bold text-muted">Price Display</span>
        <span class="text-[11px] font-bold text-ink">{modeLabel}</span>
      </div>
    {/if}

    <!-- Company Split Totals -->
    {#if totalsByCompany && !emptyCart}
      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-xl border border-white/5 bg-surface-highlight/30 p-2.5 flex flex-col gap-1">
          <div class="text-[10px] font-bold uppercase tracking-wider text-muted">Official</div>
          <div class="num-readable font-bold text-ink text-lg leading-tight">{fmtMoney(mode === "ex" ? officialSubtotalUsd : officialTotalUsd, "USD")}</div>
          {#if mode === "both"}
            <div class="text-[10px] text-muted num-readable">ex {fmtMoney(officialSubtotalUsd, "USD")}</div>
          {/if}
        </div>
        <div class="rounded-xl border border-white/5 bg-surface-highlight/30 p-2.5 flex flex-col gap-1">
          <div class="text-[10px] font-bold uppercase tracking-wider text-muted">Unofficial</div>
          <div class="num-readable font-bold text-ink text-lg leading-tight">{fmtMoney(mode === "ex" ? unofficialSubtotalUsd : unofficialTotalUsd, "USD")}</div>
          {#if mode === "both"}
            <div class="text-[10px] text-muted num-readable">ex {fmtMoney(unofficialSubtotalUsd, "USD")}</div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Final Totals -->
    <div class="space-y-1.5 pt-1">
      {#if !emptyCart}
        <div class="flex justify-between text-muted text-xs px-1">
          <span>Subtotal (ex VAT)</span>
          <span class="num-readable font-medium">{fmtMoney(subtotalUsd, "USD")}</span>
        </div>
        {#if taxUsd > 0}
          <div class="flex justify-between text-muted text-xs px-1">
            <span>VAT</span>
            <span class="num-readable font-medium">{fmtMoney(taxUsd, "USD")}</span>
          </div>
        {/if}
        <div class="flex justify-between text-muted text-xs px-1">
          <span>Total (inc VAT)</span>
          <span class="num-readable font-medium">{fmtMoney(totalIncUsd, "USD")}</span>
        </div>
      {/if}

      <div class="relative py-3 mt-1">
         <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
         <div class="flex justify-between items-end">
           <span class="text-lg font-bold text-ink">{mode === "ex" ? "Total (ex VAT)" : "Total (inc VAT)"}</span>
           <span class="num-readable text-2xl font-extrabold text-accent tracking-tight">{fmtMoney(primaryTotalUsd, "USD")}</span>
         </div>
         {#if mode === "both" && !emptyCart}
           <div class="mt-1 text-right text-[10px] text-muted num-readable">
             ex {fmtMoney(subtotalUsd, "USD")}
           </div>
         {/if}
      </div>
    </div>

    <!-- Checkout Action -->
    <button
      class={`w-full py-3 rounded-2xl font-bold text-base tracking-wide transition-all relative overflow-hidden border ${
        canCheckout
          ? "border-accent/40 bg-accent bg-gradient-to-br from-accent to-accent-hover text-[rgb(var(--color-accent-content))] shadow-lg shadow-accent/25 hover:shadow-accent/40 hover:scale-[1.02] active:scale-[0.98] group/btn"
          : "border-border/60 bg-surface-highlight/90 text-ink/70 shadow-sm cursor-not-allowed"
      }`}
      disabled={!canCheckout}
      title={!canCheckout && checkoutBlockedReason ? checkoutBlockedReason : "Checkout"}
      on:click={onCheckout}
    >
      {#if canCheckout}
        <div class="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300 rounded-2xl"></div>
      {/if}
      <span class="relative z-10 flex items-center justify-center gap-2">
        Checkout
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
      </span>
    </button>
    {#if hasSaleToCheckout && checkoutBlockedReason}
      <div class="text-[10px] text-amber-300 font-semibold px-1">{checkoutBlockedReason}</div>
    {/if}
  </div>
</section>
