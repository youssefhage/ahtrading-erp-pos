<script>
  export let cart = [];
  export let config = {};
  export let vatDisplayMode = "both";
  export let vatRateForLine = (line) => 0;
  export let updateQty = (index, qty) => {};
  export let uomOptionsForLine = (line) => [];
  export let updateUom = (index, opt) => {};
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

  const nameSizeClass = (name) => {
    const n = String(name || "").trim().length;
    if (n <= 18) return "text-base font-semibold";
    if (n <= 32) return "text-sm font-semibold";
    if (n <= 48) return "text-sm font-medium";
    return "text-xs font-medium";
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
    return f !== 1 ? `${u} x${f}` : u;
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
</script>

<section class="glass-panel rounded-3xl flex flex-col h-full w-full overflow-hidden relative group/panel">
  <div class="absolute inset-0 bg-surface/40 pointer-events-none"></div>
  
  <header class="relative p-5 border-b border-white/5 flex items-center justify-between shrink-0 z-10">
    <div class="flex items-center gap-3">
      <div class="h-8 w-1 rounded-full bg-accent shadow-[0_0_10px_rgba(45,212,191,0.5)]"></div>
      <h2 class="text-lg font-bold tracking-tight">Current Sale</h2>
    </div>
    <div class="flex items-center gap-3">
      <span class="px-2.5 py-1 rounded-lg bg-surface-highlight border border-white/5 text-xs font-mono text-muted">{cart.length} items</span>
      {#if cart.length > 0}
        <button 
          on:click={clearCart} 
          class="text-xs font-bold text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/10 hover:border-red-500/20 active:scale-95"
        >
          Clear
        </button>
      {/if}
    </div>
  </header>

  <div class="relative flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 z-10">
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
      <div class="grid grid-cols-[minmax(0,1fr)_120px_140px_130px] gap-3 px-3 py-1 text-[10px] uppercase tracking-wider text-muted/80 font-bold">
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
        {@const unitPriceEx = unitTotalPrice(line, false)}
        {@const unitPriceInc = unitTotalPrice(line, true)}
        {@const lineAmountPrimary = vatMode === "ex" ? lineAmountEx : lineAmountInc}
        {@const unitPricePrimary = vatMode === "ex" ? unitPriceEx : unitPriceInc}
        {@const preDiscBase = currencyPrimary === "USD" ? toNum(line.pre_discount_unit_price_usd, 0) : toNum(line.pre_discount_unit_price_lbp, 0)}
        <div class="group relative grid grid-cols-[minmax(0,1fr)_120px_140px_130px] gap-3 p-3.5 rounded-2xl bg-surface/40 hover:bg-surface/60 border border-white/5 hover:border-white/10 transition-all duration-200 shadow-sm hover:shadow-md">
          <div class="min-w-0 pr-2">
            <h4 class={`leading-snug text-ink/95 clamp-2 group-hover:text-accent transition-colors duration-200 ${nameSizeClass(line.name)}`}>{line.name || "Unknown Item"}</h4>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
              <span class="font-mono text-[10px] text-muted tracking-wider">{line.sku || "NO SKU"}</span>
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
              <span class={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${vatRate > 0 ? "text-blue-300 border-blue-400/20 bg-blue-500/10" : "text-muted border-white/10 bg-surface-highlight/40"}`}>
                {vatRate > 0 ? `VAT ${fmtVatPct(vatRate)}` : "No VAT"}
              </span>
              {#if toNum(line.discount_pct, 0) > 0}
                <span class="text-[10px] font-bold text-accent px-1.5 py-0.5 rounded bg-accent/10 border border-accent/10">
                  -{fmtPct(line.discount_pct)}
                </span>
              {/if}
            </div>
          </div>

          <div class="flex items-center">
            <div class="flex items-center bg-surface-highlight/40 rounded-xl border border-white/5 p-0.5 w-full shadow-inner shadow-black/20">
              <button
                type="button"
                class="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-white/5 transition-colors active:scale-90"
                on:click={() => updateQty(i, toNum(line.qty_entered, 0) - 1)}
                aria-label="Decrease quantity"
                title="Decrease quantity"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M20 12H4" /></svg>
              </button>
              <input
                type="number"
                class="qty-input flex-1 w-0 bg-transparent text-center font-bold num-readable text-sm text-ink focus:outline-none focus:text-accent selection:bg-accent/20"
                value={line.qty_entered}
                on:change={(e) => updateQty(i, e.target.value)}
                on:keydown={(e) => e.key === "Enter" && e.currentTarget?.blur?.()}
                on:focus={selectField}
                on:click={selectField}
              />
              <button
                type="button"
                class="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-white/5 transition-colors active:scale-90"
                on:click={() => updateQty(i, toNum(line.qty_entered, 0) + 1)}
                aria-label="Increase quantity"
                title="Increase quantity"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" /></svg>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-center">
            {#if uomOpts.length > 1}
              <div class="relative group/uom w-full">
                <select
                  class="w-full appearance-none pl-3 pr-7 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-surface-highlight/50 border border-white/5 hover:border-accent/30 text-ink/80 hover:text-accent cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-accent/50"
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
              <span class="w-full text-center text-xs font-bold uppercase tracking-wider text-muted/70 px-3 py-2 rounded-xl bg-surface-highlight/30 border border-white/5">
                {lineUom(line)}
              </span>
            {/if}
          </div>

          <div class="flex flex-col items-end justify-center min-w-[90px]">
            <div class="font-bold text-lg text-ink num-readable leading-none tracking-tight">
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
            class="absolute top-2 right-2 p-1.5 rounded-lg text-muted/40 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
            on:click={() => removeLine(i)}
            title="Remove Item"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
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
</style>
