<script>
  export let cart = [];
  export let config = {};
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

  $: currencyPrimary = (config.pricing_currency || "USD").toUpperCase();
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
      {#each cart as line, i (line.key || `${line.companyKey || "official"}|${line.id || ""}|${line.qty_factor || 1}|${line.uom || line.unit_of_measure || "pcs"}`)}
        {@const uomOpts = uomOptionsForLine(line) || []}
        {@const uomSel = findUomOpt(uomOpts, line)}
        <div class="group relative grid grid-cols-[minmax(0,1fr)_140px_150px_160px] items-center gap-3 p-3 rounded-2xl bg-surface/40 border border-ink/10 hover:bg-surface/60 focus-within:bg-surface/70 focus-within:border-accent/45 focus-within:ring-2 focus-within:ring-accent/30 transition-colors">
          <!-- Item -->
          <div class="min-w-0">
            <h4 class={`leading-tight clamp-2 ${nameSizeClass(line.name)}`}>{line.name || "Unknown Item"}</h4>
            <div class="flex items-center gap-2 mt-1 text-xs text-muted">
              <span class="font-mono text-[10px]">{line.sku || "NO SKU"}</span>
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

          <!-- Quantity -->
          <div class="rounded-2xl border border-ink/10 bg-ink/5 p-2">
            <div class="grid grid-cols-[40px_1fr_40px] items-center gap-2">
              <button
                type="button"
                class="h-10 w-10 rounded-xl border border-ink/10 bg-surface/40 hover:bg-surface/60 transition-colors text-ink/80 font-extrabold"
                on:click={() => updateQty(i, toNum(line.qty_entered, 0) - 1)}
                aria-label="Decrease quantity"
                title="Decrease"
              >
                -
              </button>
              <input
                type="number"
                class="h-10 w-full text-center bg-transparent num-readable text-lg font-extrabold tracking-tight focus:outline-none focus:ring-2 focus:ring-accent/30 rounded-xl"
                value={line.qty_entered}
                on:change={(e) => updateQty(i, e.target.value)}
                on:keydown={(e) => e.key === "Enter" && e.currentTarget?.blur?.()}
                on:focus={selectField}
                on:click={selectField}
                aria-label="Quantity"
              />
              <button
                type="button"
                class="h-10 w-10 rounded-xl border border-ink/10 bg-surface/40 hover:bg-surface/60 transition-colors text-ink/80 font-extrabold"
                on:click={() => updateQty(i, toNum(line.qty_entered, 0) + 1)}
                aria-label="Increase quantity"
                title="Increase"
              >
                +
              </button>
            </div>
          </div>

          <!-- UOM -->
          <div class="rounded-2xl border border-ink/10 bg-ink/5 p-2">
            <div class="text-[10px] uppercase tracking-wide text-muted mb-1 text-center">UOM</div>
            {#if uomOpts.length > 1}
              <div class="relative">
                <select
                  class="w-full h-10 appearance-none pl-3 pr-9 rounded-xl text-sm font-extrabold tracking-wide border border-ink/10 bg-surface/40 hover:bg-surface/60 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/30"
                  title={`Change UOM (${uomMetaText(uomOpts)})`}
                  value={optValue(uomSel.opt || uomOpts[0])}
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
                <svg
                  class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              <div class="mt-1 text-[10px] text-muted text-center">
                {uomMetaText(uomOpts)}
              </div>
            {:else}
              <div class="h-10 flex items-center justify-center rounded-xl border border-ink/10 bg-surface/30 text-sm font-extrabold tracking-wide opacity-85">
                {optLabel(uomSel.opt || { uom: lineUom(line), qty_factor: toNum(line.qty_factor, 1) || 1 }, lineUom(line))}
              </div>
              <div class="mt-1 text-[10px] text-muted text-center">
                {uomMetaText(uomOpts)}
              </div>
            {/if}
          </div>

          <!-- Price -->
          <div class="text-right">
            <div class="font-extrabold num-readable text-lg">
              {fmtMoney(
                (currencyPrimary === "USD" ? toNum(line.price_usd) : toNum(line.price_lbp)) * toNum(line.qty),
                currencyPrimary
              )}
            </div>
            <div class="text-xs text-muted">
              {#if toNum(line.pre_discount_unit_price_usd, 0) > 0 || toNum(line.pre_discount_unit_price_lbp, 0) > 0}
                <span class="line-through opacity-70 mr-2 num-readable">
                  {fmtMoney(
                    (currencyPrimary === "USD" ? toNum(line.pre_discount_unit_price_usd) : toNum(line.pre_discount_unit_price_lbp)) * toNum(line.qty_factor, 1),
                    currencyPrimary
                  )}
                </span>
                <span class="text-ink/80 num-readable">
                  {fmtMoney(
                    (currencyPrimary === "USD" ? toNum(line.price_usd) : toNum(line.price_lbp)) * toNum(line.qty_factor, 1),
                    currencyPrimary
                  )}
                </span>
                {#if toNum(line.discount_pct, 0) > 0}
                  <span class="ml-2 px-2 py-0.5 rounded-full text-[10px] font-extrabold tracking-wide border bg-accent/15 border-accent/25 text-accent">
                    -{fmtPct(line.discount_pct)}
                  </span>
                {/if}
                <span class="ml-2">/ {lineUom(line)}</span>
              {:else}
                <span class="num-readable">{fmtMoney(
                  (currencyPrimary === "USD" ? toNum(line.price_usd) : toNum(line.price_lbp)) * toNum(line.qty_factor, 1),
                  currencyPrimary
                )}</span> / {lineUom(line)}
              {/if}
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
