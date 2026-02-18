<script>
  export let cart = [];
  export let totals = {};
  export let totalsByCompany = null;
  export let originCompanyKey = "official";
  export let invoiceCompanyMode = "auto"; // "auto" | "official" | "unofficial"
  export let flagOfficial = false;
  export let onInvoiceCompanyModeChange = (v) => {};
  export let onFlagOfficialChange = (v) => {};
  export let onCheckout = () => {};

  const fmtMoney = (value, currency = "USD") => {
    const v = Math.max(0, Number(value) || 0);
    if (currency === "LBP") return `${Math.round(v).toLocaleString()} LBP`;
    return `${v.toFixed(2)} USD`;
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
    if (mixedCart) return `Forced -> ${companyLabel(resolvedInvoiceCompany)} (cross-company)`;
    return `${companyLabel(resolvedInvoiceCompany)} invoice`;
  })();
  $: routeHint = (() => {
    if (flagOfficial && mixedCart) return "Mixed lines will be invoiced on Official only if all items exist in Official catalog.";
    if (!flagOfficial && mixedCart && invoiceCompanyMode !== "auto") return "Cross-company stock moves are skipped and require later review.";
    return "";
  })();
</script>

<section class="glass-panel rounded-3xl p-6 flex flex-col gap-6 relative group/summary">
  <div class="absolute inset-0 bg-surface/40 pointer-events-none rounded-3xl"></div>
  
  <div class="relative z-10 flex flex-col gap-6">
    <!-- Header Controls -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-xs font-bold text-muted uppercase tracking-widest mb-1">Invoice Settings</h3>
        <p class="text-[10px] text-ink/50 max-w-[120px] leading-tight">Configure how this sale is routed.</p>
      </div>
      
      <div class="flex flex-col items-end gap-2">
         <select
          class="bg-surface-highlight/50 border border-white/5 hover:border-accent/30 rounded-lg px-3 py-1.5 text-xs font-bold text-ink shadow-sm focus:ring-1 focus:ring-accent/50 focus:outline-none transition-colors cursor-pointer appearance-none text-right"
          value={invoiceCompanyMode}
          on:change={(e) => onInvoiceCompanyModeChange(e.target.value)}
          title="Invoice mode"
        >
          <option value="auto">Auto Split</option>
          <option value="official">Force Official</option>
          <option value="unofficial">Force Unofficial</option>
        </select>
        
        <label class="flex items-center gap-2 text-xs cursor-pointer group/check">
          <span class="text-muted group-hover/check:text-ink transition-colors text-[10px] uppercase font-bold tracking-wider">Flag Manual Review</span>
          <input
            type="checkbox"
            class="accent-accent w-3.5 h-3.5 rounded border-white/10 bg-surface/50"
            checked={flagOfficial}
            on:change={(e) => onFlagOfficialChange(!!e.target.checked)}
          />
        </label>
      </div>
    </div>

    <!-- Route Info -->
    <div class={`rounded-xl border px-4 py-3 text-xs transition-colors ${routeHint ? "border-amber-500/20 bg-amber-500/5" : "border-white/5 bg-surface-highlight/30"}`}>
      <div class="flex items-center gap-2">
        <div class={`w-1.5 h-1.5 rounded-full ${routeHint ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`}></div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-muted/80">Routing Strategy</div>
      </div>
      <div class="mt-1 font-bold text-ink text-sm">{routePreview}</div>
      {#if routeHint}
        <div class="mt-2 text-amber-300/90 leading-relaxed font-medium bg-amber-500/10 p-2 rounded-lg border border-amber-500/10">
          {routeHint}
        </div>
      {/if}
    </div>

    <!-- Company Split Totals -->
    {#if totalsByCompany}
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-xl border border-white/5 bg-surface-highlight/30 p-3 flex flex-col gap-1">
          <div class="text-[10px] font-bold uppercase tracking-wider text-muted">Official</div>
          <div class="num-readable font-bold text-ink text-lg">{fmtMoney(totalsByCompany.official?.totalUsd || 0, "USD")}</div>
        </div>
        <div class="rounded-xl border border-white/5 bg-surface-highlight/30 p-3 flex flex-col gap-1">
          <div class="text-[10px] font-bold uppercase tracking-wider text-muted">Unofficial</div>
          <div class="num-readable font-bold text-ink text-lg">{fmtMoney(totalsByCompany.unofficial?.totalUsd || 0, "USD")}</div>
        </div>
      </div>
    {/if}

    <!-- Final Totals -->
    <div class="space-y-3 pt-2">
      <div class="flex justify-between text-muted text-sm px-1">
        <span>Subtotal</span>
        <span class="num-readable font-medium">{fmtMoney(totals.subtotalUsd || 0, "USD")}</span>
      </div>
      {#if totals.taxUsd > 0}
        <div class="flex justify-between text-muted text-sm px-1">
          <span>VAT</span>
          <span class="num-readable font-medium">{fmtMoney(totals.taxUsd || 0, "USD")}</span>
        </div>
      {/if}
      
      <div class="relative py-6 mt-2">
         <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
         <div class="flex justify-between items-end">
           <span class="text-xl font-bold text-ink">Total</span>
           <span class="num-readable text-3xl font-extrabold text-accent tracking-tight">{fmtMoney(totals.totalUsd || 0, "USD")}</span>
         </div>
      </div>
    </div>

    <!-- Checkout Action -->
    <button
      class="w-full py-4 rounded-2xl bg-gradient-to-br from-accent to-accent-hover text-white font-bold text-lg tracking-wide shadow-lg shadow-accent/25 hover:shadow-accent/40 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale disabled:pointer-events-none relative overflow-hidden group/btn"
      disabled={cart.length === 0}
      on:click={onCheckout}
    >
      <div class="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300 rounded-2xl"></div>
      <span class="relative z-10 flex items-center justify-center gap-2">
        Checkout
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
      </span>
    </button>
  </div>
</section>
