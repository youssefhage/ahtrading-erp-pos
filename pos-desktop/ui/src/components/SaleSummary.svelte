<script>
  export let cart = [];
  export let totals = {};
  export let totalsByCompany = null;
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
</script>

<section class="glass-panel rounded-2xl p-4 flex flex-col gap-4 overflow-hidden">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h3 class="text-sm font-bold text-muted uppercase tracking-wider">Current Sale</h3>
      <p class="text-xs text-muted mt-1">{cart.length} line(s)</p>
    </div>
    <select
      class="bg-surface/40 border border-ink/10 rounded-lg px-3 py-2 text-xs font-semibold text-ink focus:ring-2 focus:ring-accent/40 focus:outline-none"
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

  {#if totalsByCompany}
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div class="rounded-lg border border-ink/10 bg-ink/5 p-2">
        <div class="text-[10px] font-bold text-ink/70">Official</div>
        <div class="font-mono font-bold text-ink">{fmtMoney(totalsByCompany.official?.totalUsd || 0, "USD")}</div>
      </div>
      <div class="rounded-lg border border-ink/10 bg-ink/5 p-2">
        <div class="text-[10px] font-bold text-ink/70">Unofficial</div>
        <div class="font-mono font-bold text-ink">{fmtMoney(totalsByCompany.unofficial?.totalUsd || 0, "USD")}</div>
      </div>
    </div>
  {/if}

  <div class="space-y-1 text-sm">
    <div class="flex justify-between text-muted">
      <span>Subtotal</span>
      <span class="font-mono">{fmtMoney(totals.subtotalUsd || 0, "USD")}</span>
    </div>
    {#if totals.taxUsd > 0}
      <div class="flex justify-between text-muted">
        <span>VAT</span>
        <span class="font-mono">{fmtMoney(totals.taxUsd || 0, "USD")}</span>
      </div>
    {/if}
    <div class="flex justify-between items-end pt-2 text-xl font-bold text-ink border-t border-ink/10 mt-2">
      <span>Total</span>
      <span class="font-mono text-emerald-400">{fmtMoney(totals.totalUsd || 0, "USD")}</span>
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
