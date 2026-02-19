<script>
  export let items = [];
  export let suggestions = [];
  export let scanTerm = "";
  export let addToCart = (item, extra = {}) => {};
  export let uomOptionsFor = (item) => [];
  export let collapseCatalog = () => {};
  export let currencyPrimary = "USD";
  export let vatRate = 0;
  export let onScanKeyDown = (e) => false; // should return true if it handled Enter (barcode/SKU)
  export let companyLabel = (item) => ""; // e.g. "Official" / "Unofficial"
  export let companyTone = (item) => ""; // e.g. "official" / "unofficial" (CSS hook)

  const MAX_RESULTS = 12; // Keep Catalog non-scroll (only Cart should scroll)
  const MAX_UOM_KEYS = 9;

  let activeIndex = 0;
  let uomIdxByKey = new Map(); // itemKey -> selected option index

  const nameSizeClass = (name) => {
    const n = String(name || "").trim().length;
    if (n <= 18) return "text-base font-extrabold";
    if (n <= 32) return "text-sm font-bold";
    if (n <= 48) return "text-sm font-semibold";
    return "text-xs font-semibold";
  };

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

  const normalizeVatRate = (value) => {
    let n = toNum(value, 0);
    if (n > 1 && n <= 100) n = n / 100;
    return Math.max(0, n);
  };

  $: vatFactor = 1 + normalizeVatRate(vatRate);
  const basePrice = (item) => (currencyPrimary === "LBP" ? toNum(item?.price_lbp, 0) : toNum(item?.price_usd, 0));
  const afterVatPrice = (item) => basePrice(item) * vatFactor;

  const optValue = (o) => {
    const u = String(o?.uom || "").trim();
    const f = toNum(o?.qty_factor, 1) || 1;
    return `${u}|${f}`;
  };

  const optLabel = (o) => {
    const u = String(o?.uom || "").trim() || "pcs";
    const f = toNum(o?.qty_factor, 1) || 1;
    const lbl = String(o?.label || "").trim();
    if (lbl) return lbl;
    return f !== 1 ? `${u} x${f}` : u;
  };

  const tonePill = (item) => {
    const t = companyTone(item);
    if (t === "official") return "bg-emerald-500/12 border-emerald-500/30 text-ink/80";
    if (t === "unofficial") return "bg-amber-500/12 border-amber-500/30 text-ink/80";
    return "bg-ink/5 border-ink/10 text-muted";
  };

  $: visible = (suggestions || []).slice(0, MAX_RESULTS);

  const itemKey = (item) => `${String(item?.companyKey || "official")}|${String(item?.id || "")}`;

  const getUomOptions = (item) => {
    const opts = uomOptionsFor ? (uomOptionsFor(item) || []) : [];
    return Array.isArray(opts) ? opts : [];
  };

  const getUomIndex = (item) => {
    const k = itemKey(item);
    const opts = getUomOptions(item);
    let idx = toNum(uomIdxByKey.get(k), 0);
    if (idx < 0) idx = 0;
    if (opts.length === 0) return 0;
    if (idx >= opts.length) idx = 0;
    return idx;
  };

  const getUomSelected = (item) => {
    const opts = getUomOptions(item);
    const idx = getUomIndex(item);
    return opts[idx] || null;
  };

  const cycleUom = (item, delta = 1) => {
    const opts = getUomOptions(item);
    if (opts.length <= 1) return;
    const k = itemKey(item);
    const idx = getUomIndex(item);
    const next = (idx + delta + opts.length) % opts.length;
    uomIdxByKey = new Map(uomIdxByKey);
    uomIdxByKey.set(k, next);
  };

  const setUomIndex = (item, idx) => {
    const opts = getUomOptions(item);
    if (opts.length === 0) return;
    const next = Math.max(0, Math.min(opts.length - 1, toNum(idx, 0)));
    uomIdxByKey = new Map(uomIdxByKey);
    uomIdxByKey.set(itemKey(item), next);
  };

  const addItem = (item) => {
    if (!item) return;
    const sel = getUomSelected(item);
    if (sel && (toNum(sel.qty_factor, 1) !== 1 || String(sel.uom || "").trim())) {
      addToCart(item, { qty_factor: toNum(sel.qty_factor, 1), uom: String(sel.uom || "").trim(), qty_entered: 1 });
      return;
    }
    addToCart(item, { qty_entered: 1 });
  };

  const onSearchKeyDown = (e) => {
    if (!e) return;

    if (e.key === "ArrowDown") {
      if (visible.length === 0) return;
      e.preventDefault();
      activeIndex = Math.min(visible.length - 1, activeIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      if (visible.length === 0) return;
      e.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      return;
    }
    if (e.key === "u" || e.key === "U") {
      if (visible.length === 0) return;
      e.preventDefault();
      const it = visible[activeIndex];
      cycleUom(it, e.key === "U" ? -1 : 1);
      return;
    }
    if (e.key && e.key.length === 1 && e.key >= "1" && e.key <= String(MAX_UOM_KEYS)) {
      if (visible.length === 0) return;
      // 1..9 selects UOM index
      e.preventDefault();
      const it = visible[activeIndex];
      const idx = Number(e.key) - 1;
      setUomIndex(it, idx);
      return;
    }
    if (e.key === "Enter" || e.key === "NumpadEnter" || e.key === "Tab") {
      // First allow the parent to treat this as barcode / exact SKU.
      const handled = (onScanKeyDown && onScanKeyDown(e) === true);
      if (handled) return;

      if (visible.length > 0) {
        e.preventDefault();
        addItem(visible[activeIndex] || visible[0]);
        scanTerm = "";
      }
      return;
    }
  };

  $: if (visible && visible.length > 0 && activeIndex >= visible.length) activeIndex = 0;
  $: if (!scanTerm.trim()) activeIndex = 0;
</script>

<section class="glass-panel rounded-3xl flex flex-col h-full overflow-hidden relative group/catalog">
  <div class="absolute inset-0 bg-surface/40 pointer-events-none rounded-3xl"></div>

  <header class="relative z-10 p-5 shrink-0 border-b border-white/5">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
         <div class="h-8 w-1 rounded-full bg-accent shadow-[0_0_10px_rgba(45,212,191,0.5)]"></div>
         <h2 class="text-lg font-bold tracking-tight">Catalog</h2>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-mono font-medium text-muted bg-surface-highlight/50 px-2.5 py-1 rounded-lg border border-white/5">
          {items.length} items
        </span>
        <button
          class="h-8 w-8 rounded-lg border border-white/5 bg-surface-highlight/50 hover:bg-surface-highlight hover:border-white/10 transition-colors flex items-center justify-center text-muted hover:text-ink"
          on:click={collapseCatalog}
          title="Hide Catalog"
          aria-label="Hide Catalog"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>
    </div>
    
    <!-- Search -->
    <div class="relative group">
      <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
        <svg class="h-5 w-5 text-muted group-focus-within:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        bind:value={scanTerm}
        type="text"
        class="block w-full pl-11 pr-4 py-3.5 rounded-xl bg-bg/50 border border-white/5 hover:border-white/10
               text-ink placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50
               transition-all duration-200 shadow-inner shadow-black/20"
        placeholder="Scan barcode or type to search..."
        data-scan-input="1"
        on:keydown={onSearchKeyDown}
      />
    </div>
  </header>

  <div class="relative z-10 flex-1 overflow-hidden pr-1">
    {#if !scanTerm.trim()}
      <div class="h-full flex flex-col items-center justify-center text-muted/40 select-none pb-10">
        <div class="p-6 rounded-full bg-surface-highlight/30 mb-4 border border-white/5">
          <svg class="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <p class="font-medium tracking-wide">Start typing or scan to search</p>
      </div>
    {:else if suggestions.length === 0}
      <div class="h-full flex flex-col items-center justify-center text-muted select-none pb-10">
        <p class="font-medium">No matches found</p>
        <button class="mt-4 text-accent hover:text-accent-hover text-sm font-bold tracking-wide" on:click={() => scanTerm = ""}>
          Clear search
        </button>
      </div>
    {:else}
      <div class="p-3 space-y-2 overflow-y-auto h-full custom-scrollbar">
        {#each visible as item, i}
          {@const sel = getUomSelected(item)}
          {@const opts = getUomOptions(item)}
          {@const isActive = i === activeIndex}
          <div
            role="button"
            tabindex="0"
            class={`group w-full flex items-center gap-3.5 rounded-2xl border px-3.5 py-3 text-left cursor-pointer
                   transition-all duration-150
                   focus:outline-none focus:ring-2 focus:ring-accent/40
                   ${isActive 
                      ? "border-accent/40 bg-accent/5 ring-1 ring-accent/20 shadow-lg shadow-accent/5" 
                      : "border-transparent bg-surface/40 hover:bg-surface/60 hover:border-white/5 hover:shadow-md"
                   }`}
            on:mouseenter={() => activeIndex = i}
            on:focus={() => activeIndex = i}
            on:click={() => addItem(item)}
            on:keydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), addItem(item))}
            title="Add to cart"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-3 min-w-0">
                <div class="min-w-0 flex-1">
                  <div class={`clamp-2 leading-tight transition-colors duration-200 ${nameSizeClass(item.name)} ${isActive ? "text-accent" : "text-ink"}`}>{item.name || "Unknown Item"}</div>
                  <div class="mt-1 flex items-center gap-2">
                     <span class={`text-[10px] font-mono tracking-wider transition-colors truncate ${isActive ? "text-accent/85" : "text-muted group-hover:text-ink/60"}`}>
                      {item.sku || "NO SKU"}
                    </span>
                    {#if companyLabel(item)}
                      <span class={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${tonePill(item)}`}>
                        {companyLabel(item)}
                      </span>
                    {/if}
                  </div>
                </div>
                {#if isActive}
                  <span class="shrink-0 px-2 py-1 rounded-lg border border-accent/30 bg-accent/10 text-[10px] font-extrabold tracking-wide text-accent shadow-[0_0_10px_rgba(45,212,191,0.2)]">
                    Selected
                  </span>
                {/if}
              </div>
              {#if item.barcode}
                <div class="mt-1.5 text-[10px] text-muted/60 truncate font-mono">
                  {item.barcode}
                </div>
              {/if}
            </div>

            <div class="flex items-center gap-3 shrink-0">
              {#if sel}
                {#if opts.length > 2}
                  <div class="relative group/uom">
                    <select
                      class="appearance-none pl-2.5 pr-7 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border bg-surface-highlight/50 border-white/5 hover:border-accent/30 hover:text-accent transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/25"
                      title="UOM (dropdown)"
                      value={optValue(sel)}
                      on:change|stopPropagation={(e) => {
                        const v = String(e?.target?.value || "");
                        const idx = (opts || []).findIndex((o) => optValue(o) === v);
                        if (idx >= 0) setUomIndex(item, idx);
                      }}
                      on:click|stopPropagation={() => {}}
                    >
                      {#each opts as o}
                        <option value={optValue(o)}>{optLabel(o)}</option>
                      {/each}
                    </select>
                    <svg
                      class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted group-hover/uom:text-accent"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                {:else}
                  <button
                    type="button"
                    class="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border bg-surface-highlight/50 border-white/5 hover:border-accent/30 hover:text-accent transition-colors"
                    title={opts.length > 1 ? "UOM (tap to toggle, U to cycle, 1-9 to select)" : "UOM"}
                    on:click|stopPropagation={() => cycleUom(item, 1)}
                  >
                    {sel.label || sel.uom}
                  </button>
                {/if}
              {/if}

              <div class="text-right leading-none">
                <div class="font-bold text-sm text-ink num-readable tracking-tight">
                  {fmtMoney(afterVatPrice(item), currencyPrimary)}
                </div>
                <!-- <div class="text-[9px] text-emerald-400 mt-0.5 font-medium">Net</div> -->
                <div class="text-[9px] text-muted num-readable mt-0.5 opacity-70">
                  {fmtMoney(basePrice(item), currencyPrimary)} <span class="text-[8px] uppercase">pre-vat</span>
                </div>
              </div>
              
              <span
                class={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${
                  isActive 
                    ? "bg-accent text-[rgb(var(--color-accent-content))] shadow-lg shadow-accent/40 scale-105" 
                    : "bg-surface-highlight/50 text-muted hover:bg-white/10 hover:text-ink"
                }`}
                aria-hidden="true"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </span>
            </div>
          </div>
        {/each}

        {#if suggestions.length > MAX_RESULTS}
          <div class="mt-2 text-xs text-center text-muted py-2 opacity-70">
            Showing top {MAX_RESULTS} results. Keep typing...
          </div>
        {/if}

        <div class="mt-2 pt-2 border-t border-white/5 text-[10px] text-muted/50 flex items-center justify-between select-none font-mono">
          <span>Arrows: navigate</span>
          <span>Enter: add</span>
          <span>U: cycle UOM</span>
        </div>
      </div>
    {/if}
  </div>
</section>
