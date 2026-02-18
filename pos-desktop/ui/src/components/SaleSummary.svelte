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

<section class="glass-panel rounded-2xl p-5 flex flex-col gap-4 overflow-hidden">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h3 class="text-sm font-extrabold text-muted uppercase tracking-[0.15em]">Current Sale</h3>
      <p class="text-xs text-muted mt-1">{cart.length} line(s)</p>
    </div>
    <select
      class="bg-surface/50 border border-ink/10 rounded-xl px-3 py-2.5 text-xs font-bold text-ink shadow-sm focus:ring-2 focus:ring-accent/40 focus:outline-none"
      value={invoiceCompanyMode}
      on:change={(e) => onInvoiceCompanyModeChange(e.target.value)}
      title="Invoice mode"
    >
      <option value="auto">Auto (Split)</option>
      <option value="official">Force Official</option>
      <option value="unofficial">Force Unofficial</option>
    </select>
  </div>

  <label class="flex items-center justify-between gap-3 text-xs">
    <span class="text-muted">Flag to Official (manual review)</span>
    <input
      type="checkbox"
      checked={flagOfficial}
      on:change={(e) => onFlagOfficialChange(!!e.target.checked)}
      aria-label="Flag to Official"
    />
  </label>

  <div class={`rounded-xl border p-3 text-xs ${routeHint ? "border-amber-500/30 bg-amber-500/10" : "border-ink/10 bg-surface/45"}`}>
    <div class="text-muted font-semibold">Invoice Route</div>
    <div class="mt-1 font-bold text-ink">{routePreview}</div>
    {#if routeHint}
      <div class="mt-1 text-amber-200">{routeHint}</div>
    {/if}
  </div>

  {#if totalsByCompany}
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div class="rounded-xl border border-ink/10 bg-surface/45 p-2.5">
        <div class="text-[10px] font-bold text-ink/70">Official</div>
        <div class="num-readable font-bold text-ink">{fmtMoney(totalsByCompany.official?.totalUsd || 0, "USD")}</div>
      </div>
      <div class="rounded-xl border border-ink/10 bg-surface/45 p-2.5">
        <div class="text-[10px] font-bold text-ink/70">Unofficial</div>
        <div class="num-readable font-bold text-ink">{fmtMoney(totalsByCompany.unofficial?.totalUsd || 0, "USD")}</div>
      </div>
    </div>
  {/if}

  <div class="space-y-1 text-sm">
    <div class="flex justify-between text-muted">
      <span>Subtotal</span>
      <span class="num-readable">{fmtMoney(totals.subtotalUsd || 0, "USD")}</span>
    </div>
    {#if totals.taxUsd > 0}
      <div class="flex justify-between text-muted">
        <span>VAT</span>
        <span class="num-readable">{fmtMoney(totals.taxUsd || 0, "USD")}</span>
      </div>
    {/if}
    <div class="flex justify-between items-end pt-2 text-xl font-bold text-ink border-t border-ink/10 mt-2">
      <span>Total</span>
      <span class="num-readable text-emerald-400">{fmtMoney(totals.totalUsd || 0, "USD")}</span>
    </div>
  </div>

  <button
    class="w-full py-4 rounded-xl bg-gradient-to-r from-accent to-emerald-500 text-white font-bold text-lg shadow-lg shadow-accent/20 hover:shadow-accent/40 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    disabled={cart.length === 0}
    on:click={onCheckout}
  >
    Checkout
  </button>
</section>
