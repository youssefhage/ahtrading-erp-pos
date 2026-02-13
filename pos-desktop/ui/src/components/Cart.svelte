<script>
  export let cart = [];
  export let config = {};
  export let updateQty = (index, qty) => {};
  export let removeLine = (index) => {};
  export let clearCart = () => {};
  export let companyLabelForLine = (line) => "";
  export let companyToneForLine = (line) => "";

  const toNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const fmtMoney = (value, currency = "USD") => {
    const v = Math.max(0, Number(value) || 0);
    if (currency === "LBP") {
      return `${Math.round(v).toLocaleString()} LBP`;
    }
    return `${v.toFixed(2)} USD`;
  };

  $: currencyPrimary = (config.pricing_currency || "USD").toUpperCase();
  const lineUom = (line) => (line.uom || line.uom_code || line.unit_of_measure || "pcs");
</script>

<section class="glass-panel rounded-2xl p-0 flex flex-col h-full w-full overflow-hidden">
  <header class="p-4 border-b border-ink/10 flex items-center justify-between">
    <h2 class="text-lg font-bold">Current Sale</h2>
    <div class="flex items-center gap-2">
      <span class="text-xs font-mono text-muted">{cart.length} lines</span>
      {#if cart.length > 0}
        <button 
          on:click={clearCart} 
          class="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20"
        >
          Clear
        </button>
      {/if}
    </div>
  </header>

  <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
    {#if cart.length === 0}
      <div class="h-full flex flex-col items-center justify-center text-muted opacity-50">
        <svg class="w-12 h-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
        <p class="text-sm">Cart is empty</p>
      </div>
    {:else}
      {#each cart as line, i}
        <div class="group relative flex items-center gap-3 p-3 rounded-xl bg-surface/40 border border-ink/10 hover:bg-surface/60 transition-colors">
          <!-- Qty Controls -->
          <div class="flex flex-col items-center gap-1">
            <button 
              class="w-6 h-6 rounded flex items-center justify-center bg-ink/5 hover:bg-accent hover:text-white text-muted transition-colors"
              on:click={() => updateQty(i, line.qty_entered + 1)}
              aria-label="Increase quantity"
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
            </button>
            <input 
              type="number" 
              class="w-10 text-center bg-transparent font-mono text-sm font-bold focus:outline-none focus:text-accent"
              value={line.qty_entered} 
              on:change={(e) => updateQty(i, e.target.value)}
              aria-label="Quantity"
            />
            <button 
              class="w-6 h-6 rounded flex items-center justify-center bg-ink/5 hover:bg-accent hover:text-white text-muted transition-colors"
              on:click={() => updateQty(i, line.qty_entered - 1)}
              aria-label="Decrease quantity"
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>

          <!-- Item Details -->
          <div class="flex-1 min-w-0">
            <h4 class="font-medium text-sm leading-tight truncate">{line.name || "Unknown Item"}</h4>
            <div class="flex items-center gap-2 mt-1 text-xs text-muted">
              <span>{line.sku || "NO SKU"}</span>
              <span class="w-1 h-1 rounded-full bg-ink/15"></span>
              <span>{lineUom(line)}</span>
              {#if toNum(line.qty_factor, 1) !== 1}
                <span class="w-1 h-1 rounded-full bg-ink/15"></span>
                <span class="font-mono">x{toNum(line.qty_factor, 1)}</span>
              {/if}
              {#if companyLabelForLine(line)}
                <span class="w-1 h-1 rounded-full bg-ink/15"></span>
                <span
                  class={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border ${
                    companyToneForLine(line) === "official"
                      ? "bg-emerald-500/12 border-emerald-500/30 text-ink/80"
                      : companyToneForLine(line) === "unofficial"
                        ? "bg-amber-500/12 border-amber-500/30 text-ink/80"
                        : "bg-ink/5 border-ink/10 text-muted"
                  }`}
                >
                  {companyLabelForLine(line)}
                </span>
              {/if}
            </div>
          </div>

          <!-- Price -->
          <div class="text-right">
            <div class="font-bold font-mono">
              {fmtMoney(
                (currencyPrimary === "USD" ? toNum(line.price_usd) : toNum(line.price_lbp)) * toNum(line.qty),
                currencyPrimary
              )}
            </div>
            <div class="text-xs text-muted">
              {fmtMoney(
                (currencyPrimary === "USD" ? toNum(line.price_usd) : toNum(line.price_lbp)) * toNum(line.qty_factor, 1),
                currencyPrimary
              )} / {lineUom(line)}
            </div>
          </div>

          <!-- Remove -->
          <button 
            class="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500/20 text-red-400 opacity-0 group-hover:opacity-100 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-lg"
            on:click={() => removeLine(i)}
            aria-label="Remove line"
          >
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
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
</style>
