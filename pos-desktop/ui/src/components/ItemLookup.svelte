<script>
  import { tick } from "svelte";

  export let items = []; // tagged with { companyKey }
  export let query = "";
  export let autoPick = 0; // increment to trigger auto-selection (used by barcode scans)
  export let isActive = false;
  export let currencyPrimary = "USD";
  export let vatRate = 0;

  export let otherCompanyKey = "unofficial";
  export let barcodesByItemIdOrigin = new Map();
  export let barcodesByItemIdOther = new Map();

  export let uomOptionsFor = (item) => [];
  export let companyLabel = (obj) => "";
  export let companyTone = (obj) => "";
  export let addToCart = (item, extra = {}) => {};
  export let loadBatches = async (companyKey, itemId) => ({ batches: [] });
  export let resolveByTerm = (term) => null; // optional: exact barcode/SKU resolver

  let inputEl = null;
  let activeIndex = 0;
  let selected = null;
  let autoPickHandled = 0;
  let lastQuerySnapshot = "";

  let batchesLoading = false;
  let batchesError = "";
  let batchesKey = "";
  let batches = [];

  let uomIdx = 0;

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

  const tonePill = (obj) => {
    const t = companyTone(obj);
    if (t === "official") return "bg-emerald-500/12 border-emerald-500/30 text-ink/80";
    if (t === "unofficial") return "bg-amber-500/12 border-amber-500/30 text-ink/80";
    return "bg-ink/5 border-ink/10 text-muted";
  };

  const fmtMoney = (v, currency = "USD") => {
    const n = Math.max(0, Number(v) || 0);
    if (currency === "LBP") return `${Math.round(n).toLocaleString()} LBP`;
    return `${n.toFixed(2)} USD`;
  };

  const normalizeVatRate = (value) => {
    let n = toNum(value, 0);
    if (n > 1 && n <= 100) n = n / 100;
    return Math.max(0, n);
  };

  $: vatFactor = 1 + normalizeVatRate(vatRate);
  const withVat = (v) => Math.max(0, toNum(v, 0)) * vatFactor;
  const priceBase = (it) => (currencyPrimary === "LBP" ? toNum(it?.price_lbp, 0) : toNum(it?.price_usd, 0));

  const normalize = (v) => String(v || "").trim().toLowerCase();

  const itemBarcodes = (item) => {
    const map = item?.companyKey === otherCompanyKey ? barcodesByItemIdOther : barcodesByItemIdOrigin;
    const rows = map?.get(String(item?.id || "")) || [];
    return rows || [];
  };

  const _buildSearchRows = (list, mapOrigin, mapOther, otherKey) => {
    const rows = [];
    for (const raw of list || []) {
      if (!raw) continue;
      const it = raw?.companyKey ? raw : { ...raw, companyKey: "official" };
      const map = it?.companyKey === otherKey ? mapOther : mapOrigin;
      const rowsByItem = map?.get(String(it?.id || "")) || [];
      const allBarcodes = [];
      for (const b of rowsByItem) {
        const bc = String(b?.barcode || "").trim();
        if (bc) allBarcodes.push(bc);
      }
      rows.push({
        it,
        sku: normalize(it.sku),
        name: normalize(it.name),
        primaryBarcode: String(it.barcode || "").trim(),
        barcodes: allBarcodes,
      });
    }
    return rows;
  };

  const scoreItem = (row, q, qRaw) => {
    if (!row || !q) return 0;
    const sku = row.sku;
    const name = row.name;
    const primaryBarcode = row.primaryBarcode;

    if (sku && sku === q) return 1000;
    if (primaryBarcode && primaryBarcode === qRaw) return 950;
    for (const bc of row.barcodes || []) {
      if (bc === qRaw) return 940;
    }

    if (sku && sku.startsWith(q)) return 820;
    if (primaryBarcode && primaryBarcode.includes(qRaw)) return 520;
    if (name && name.includes(q)) return 500;
    for (const bc of row.barcodes || []) {
      if (bc.includes(qRaw)) return 480;
    }
    return 0;
  };

  $: searchRows = _buildSearchRows(items, barcodesByItemIdOrigin, barcodesByItemIdOther, otherCompanyKey);
  $: qn = normalize(query);
  $: qRaw = String(query || "").trim();
  $: results = (() => {
    if (!qn) return [];
    const out = [];
    const cap = 120;
    for (const row of searchRows || []) {
      const s = scoreItem(row, qn, qRaw);
      if (s <= 0) continue;
      out.push({ it: row.it, s });
      if (out.length >= cap) break;
    }
    out.sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      return String(a?.it?.sku || "").localeCompare(String(b?.it?.sku || ""));
    });
    return out.slice(0, 80).map((x) => x.it);
  })();

  $: if (results && results.length > 0 && activeIndex >= results.length) activeIndex = 0;
  
  const sameItem = (a, b) => {
    if (!a || !b) return false;
    return String(a?.id || "") === String(b?.id || "") && String(a?.companyKey || "") === String(b?.companyKey || "");
  };

  const isSelectedItem = (it) => sameItem(it, selected);

  const clearSelection = ({ resetIndex = false } = {}) => {
    selected = null;
    batches = [];
    batchesError = "";
    batchesKey = "";
    uomIdx = 0;
    if (resetIndex) activeIndex = 0;
  };

  $: if (!qn) {
    activeIndex = 0;
    clearSelection({ resetIndex: false });
  }

  $: if (String(query || "") !== lastQuerySnapshot) {
    lastQuerySnapshot = String(query || "");
    clearSelection({ resetIndex: false });
  }

  const ensureFocus = async () => {
    await tick();
    if (inputEl && inputEl.focus) inputEl.focus();
  };

  $: if (isActive) ensureFocus();

  const pick = (it) => {
    clearSelection({ resetIndex: false });
    selected = it || null;
  };

  $: if (autoPick && autoPick !== autoPickHandled) {
    autoPickHandled = autoPick;
    clearSelection({ resetIndex: true });
    // autoPick increments; when it changes we attempt best-effort selection.
    if (qn) {
      let resolved = null;
      try { resolved = resolveByTerm ? resolveByTerm(String(query || "")) : null; } catch (_) {}
      if (resolved?.item) {
        pick(resolved.item);
        const idx = (results || []).findIndex((x) => String(x?.id) === String(resolved.item.id) && String(x?.companyKey) === String(resolved.item.companyKey));
        if (idx >= 0) activeIndex = idx;
      } else if ((results || []).length > 0) {
        pick(results[0]);
        activeIndex = 0;
      }
    }
  }

  const onListKeyDown = (e) => {
    if (!e) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min((results?.length || 1) - 1, activeIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = (results || [])[activeIndex];
      if (it) pick(it);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      query = "";
      return;
    }
    if (e.key === "Tab") return;
  };

  const selectedUomOpt = () => {
    const it = selected;
    if (!it) return null;
    const opts = uomOptionsFor(it) || [];
    if (!opts.length) return { uom: it.unit_of_measure || "pcs", qty_factor: 1, label: it.unit_of_measure || "pcs" };
    const idx = Math.max(0, Math.min(opts.length - 1, uomIdx));
    return opts[idx];
  };

  const cycleUom = (dir = 1) => {
    const it = selected;
    if (!it) return;
    const opts = uomOptionsFor(it) || [];
    if (opts.length <= 1) return;
    const next = (uomIdx + dir + opts.length) % opts.length;
    uomIdx = next;
  };

  const addSelectedToCart = () => {
    if (!selected) return;
    const opt = selectedUomOpt();
    const qty_factor = toNum(opt?.qty_factor, 1) || 1;
    const uom = String(opt?.uom || selected.unit_of_measure || "pcs");
    addToCart(selected, { companyKey: selected.companyKey, qty_factor, uom });
  };

  const fetchBatches = async () => {
    if (!selected) return;
    const k = `${selected.companyKey}|${selected.id}`;
    if (batchesKey === k && batches.length) return;
    batchesLoading = true;
    batchesError = "";
    batchesKey = k;
    batches = [];
    try {
      const res = await loadBatches(selected.companyKey, selected.id);
      batches = res?.batches || [];
    } catch (e) {
      batchesError = e?.message || String(e);
    } finally {
      batchesLoading = false;
    }
  };
</script>

<div class="h-full w-full overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(420px,560px)_1fr] gap-6">
  <!-- Left: Search + Results -->
  <section class="glass-panel rounded-3xl flex flex-col overflow-hidden relative group/lookup-list">
    <div class="absolute inset-0 bg-surface/40 pointer-events-none rounded-3xl"></div>
    
    <header class="relative z-10 p-5 shrink-0 border-b border-white/5">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-3">
          <div class="h-8 w-1 rounded-full bg-accent shadow-[0_0_10px_rgba(45,212,191,0.5)]"></div>
          <h2 class="text-lg font-bold tracking-tight">Item Lookup</h2>
        </div>
        <div class="text-[10px] font-mono font-medium text-muted/60 bg-surface-highlight/50 px-2 py-1 rounded-lg border border-white/5">
          Type to search or scan
        </div>
      </div>
      
      <div class="relative group">
        <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
          <svg class="h-5 w-5 text-muted group-focus-within:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          class="block w-full pl-11 pr-4 py-3.5 rounded-xl bg-bg/50 border border-white/5 hover:border-white/10
                 text-ink placeholder-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50
                 transition-all duration-200 shadow-inner shadow-black/20"
          placeholder="Search SKU, name, barcode..."
          on:keydown={onListKeyDown}
        />
      </div>
    </header>

    <div class="relative z-10 flex-1 overflow-hidden">
      {#if !qn}
        <div class="h-full flex flex-col items-center justify-center text-muted/40 select-none pb-10">
          <div class="p-6 rounded-full bg-surface-highlight/30 mb-4 border border-white/5">
            <svg class="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p class="font-medium tracking-wide">Start typing or scan to search</p>
          <p class="text-xs opacity-60 mt-2 font-mono">Barcodes auto-select</p>
        </div>
      {:else if (results || []).length === 0}
         <div class="h-full flex flex-col items-center justify-center text-muted select-none pb-10">
            <p class="font-medium">No matches found</p>
            <button class="mt-4 text-accent hover:text-accent-hover text-sm font-bold tracking-wide" on:click={() => query = ""}>
              Clear search
            </button>
          </div>
      {:else}
        <div
          class="h-full overflow-y-auto p-3 space-y-2 custom-scrollbar"
          role="listbox"
          tabindex="0"
          aria-label="Item search results"
          on:keydown={onListKeyDown}
        >
          {#each results as it, i}
            {@const selectedInList = isSelectedItem(it)}
            <button
              type="button"
              role="option"
              aria-selected={selectedInList}
              class={`w-full text-left rounded-2xl border px-3.5 py-3 transition-all duration-150 ${
                selectedInList
                  ? "border-accent/60 ring-1 ring-accent/30 bg-accent/10 shadow-[0_10px_30px_rgba(34,197,94,0.12)]"
                  : i === activeIndex
                    ? "border-accent/40 ring-1 ring-accent/20 bg-surface/55"
                    : "border-transparent bg-surface/40 hover:bg-surface/60 hover:border-white/5"
              }`}
              on:mouseenter={() => activeIndex = i}
              on:focus={() => activeIndex = i}
              on:click={() => pick(it)}
            >
              <div class="flex items-start gap-3.5">
	                <div class="min-w-0 flex-1">
	                  <div class="min-w-0">
	                    <div class={`clamp-2 leading-tight ${nameSizeClass(it.name)} ${selectedInList ? "text-accent" : "text-ink"}`}>{it.name || "Unknown Item"}</div>
	                    <div class={`mt-1 text-[10px] font-mono tracking-wider truncate ${selectedInList ? "text-accent/85" : "text-muted"}`}>{it.sku || "NO SKU"}</div>
	                  </div>
	                  
                    <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      {#if selectedInList}
                        <span class="px-2 py-0.5 rounded-md border border-accent/40 bg-accent/15 text-[9px] font-extrabold text-accent uppercase tracking-wide">
                          Selected
                        </span>
                      {/if}
                      {#if it.barcode}
                         <span class="font-mono text-xs opacity-70 bg-black/20 px-1.5 py-0.5 rounded">{it.barcode}</span>
                      {/if}
	                    {#if it.track_batches || it.track_expiry}
                        <span class="px-1.5 py-0.5 rounded border border-white/10 bg-surface-highlight/50 text-[9px] font-bold text-ink/70 uppercase tracking-wide">
                          {it.track_batches ? "Batch" : ""}{it.track_batches && it.track_expiry ? "+" : ""}{it.track_expiry ? "Expiry" : ""}
                        </span>
                      {/if}
                    </div>
                  </div>

                  <div class="shrink-0 flex flex-col items-end gap-1">
                    {#if companyLabel(it)}
                      <span class={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${tonePill(it)}`}>
                        {companyLabel(it)}
                      </span>
                    {/if}
                    <div class="text-right leading-none mt-1">
                      <div class="font-bold text-sm text-ink num-readable tracking-tight">
                        {fmtMoney(withVat(priceBase(it)), currencyPrimary)}
                      </div>
                      <div class="text-[9px] text-muted num-readable mt-0.5 opacity-70">
                        {fmtMoney(priceBase(it), currencyPrimary)} <span class="text-[8px] uppercase">pre-vat</span>
                      </div>
                    </div>
                  </div>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <!-- Right: Details -->
  <section class="glass-panel rounded-3xl flex flex-col overflow-hidden relative group/lookup-details">
    <div class="absolute inset-0 bg-surface/40 pointer-events-none rounded-3xl"></div>
    
    {#if !selected}
      <div class="h-full flex flex-col items-center justify-center text-muted select-none opacity-60 z-10">
        <div class="p-4 rounded-full bg-surface-highlight/30 mb-3 border border-white/5">
           <svg class="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <p class="text-sm font-medium">Select an item to view details</p>
      </div>
    {:else}
      <header class="relative z-10 p-5 pb-4 border-b border-white/5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="text-xl font-extrabold tracking-tight leading-snug text-ink">{selected.name || "Unknown Item"}</h3>
            <div class="mt-2 flex flex-wrap items-center gap-3">
              <span class={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${tonePill(selected)}`}>
                {companyLabel(selected)}
              </span>
              <div class="flex items-center gap-2 text-[11px] text-muted font-mono bg-black/20 px-2 py-0.5 rounded-md border border-white/5">
                <span>{selected.sku || "NO SKU"}</span>
                <span class="w-1 h-1 rounded-full bg-white/20"></span>
                <span>{selected.id}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 mt-4">
          <button
            type="button"
            class="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border border-white/10 bg-surface-highlight/40 hover:bg-surface-highlight/60 text-ink transition-colors flex items-center justify-between group/uom-btn"
            on:click={() => cycleUom(1)}
            title="Cycle UOM"
          >
            <span class="text-muted group-hover/uom-btn:text-ink transition-colors">Unit</span>
            {#if selectedUomOpt()}
              {@const opt = selectedUomOpt()}
              <span class="text-accent">{opt.uom}{toNum(opt.qty_factor, 1) !== 1 ? ` x${toNum(opt.qty_factor, 1)}` : ""}</span>
            {:else}
              <span>Default</span>
            {/if}
          </button>
          
          <button
            type="button"
            class="flex-1 px-4 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-widest border border-accent/40 bg-accent hover:bg-accent-hover text-[rgb(var(--color-accent-content))] shadow-lg shadow-accent/20 hover:shadow-accent/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
            on:click={addSelectedToCart}
          >
            Add to Cart
          </button>
        </div>
      </header>

      <div class="relative z-10 flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div class="rounded-2xl border border-white/5 bg-surface-highlight/20 p-4">
            <div class="text-[10px] font-bold uppercase tracking-widest text-muted mb-3 opacity-80">Pricing Structure</div>
            <div class="space-y-2.5 num-readable text-sm">
              <div class="flex items-center justify-between">
                <span class="text-muted/80">Net Price ({currencyPrimary})</span>
                <span class="font-bold text-emerald-400">{fmtMoney(withVat(priceBase(selected)), currencyPrimary)}</span>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted/60">Base Price</span>
                <span class="font-medium text-ink/70">{fmtMoney(priceBase(selected), currencyPrimary)}</span>
              </div>
              <div class="my-2 h-px bg-white/5 w-full"></div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted/60">USD Equivalent</span>
                <span class="font-medium text-emerald-400/80">{fmtMoney(withVat(selected.price_usd || 0), "USD")}</span>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-white/5 bg-surface-highlight/20 p-4">
            <div class="text-[10px] font-bold uppercase tracking-widest text-muted mb-3 opacity-80">Inventory Rules</div>
             <div class="space-y-3">
                <div class="flex items-center justify-between">
                    <span class="text-xs text-muted/80">Base UOM</span>
                    <span class="font-mono text-xs font-bold bg-white/5 px-2 py-0.5 rounded">{selected.unit_of_measure || "pcs"}</span>
                </div>
                
                <div class="grid grid-cols-2 gap-2">
                   <div class={`px-2 py-1.5 rounded-lg border text-center ${selected.track_batches ? "border-emerald-500/20 bg-emerald-500/10" : "border-white/5 bg-white/5"}`}>
                      <div class="text-[9px] font-bold uppercase tracking-wider text-muted">Batches</div>
                      <div class={`text-xs font-bold ${selected.track_batches ? "text-emerald-400" : "text-muted"}`}>{selected.track_batches ? "Active" : "Off"}</div>
                   </div>
                   <div class={`px-2 py-1.5 rounded-lg border text-center ${selected.track_expiry ? "border-emerald-500/20 bg-emerald-500/10" : "border-white/5 bg-white/5"}`}>
                      <div class="text-[9px] font-bold uppercase tracking-wider text-muted">Expiry</div>
                      <div class={`text-xs font-bold ${selected.track_expiry ? "text-emerald-400" : "text-muted"}`}>{selected.track_expiry ? "Active" : "Off"}</div>
                   </div>
                </div>
             </div>
          </div>
        </div>

        <!-- Shelf Life Grid -->
        <div class="grid grid-cols-3 gap-2">
             <div class="rounded-xl border border-white/5 bg-surface-highlight/10 p-3 text-center">
                <div class="text-[9px] font-bold uppercase tracking-wider text-muted/70 mb-1">Shelf Life</div>
                <div class="font-mono text-sm font-bold">{toNum(selected.default_shelf_life_days, 0) || "—"}</div>
             </div>
             <div class="rounded-xl border border-white/5 bg-surface-highlight/10 p-3 text-center">
                <div class="text-[9px] font-bold uppercase tracking-wider text-muted/70 mb-1">Min Days</div>
                <div class="font-mono text-sm font-bold">{toNum(selected.min_shelf_life_days_for_sale, 0) || "—"}</div>
             </div>
              <div class="rounded-xl border border-white/5 bg-surface-highlight/10 p-3 text-center">
                <div class="text-[9px] font-bold uppercase tracking-wider text-muted/70 mb-1">Warning</div>
                <div class="font-mono text-sm font-bold text-amber-400">{toNum(selected.expiry_warning_days, 0) || "—"}</div>
             </div>
        </div>

        <div class="rounded-2xl border border-white/5 bg-surface-highlight/20 p-4">
          <div class="flex items-center justify-between gap-3 mb-3">
            <div class="text-[10px] font-bold uppercase tracking-widest text-muted opacity-80">Barcodes</div>
            <div class="text-[10px] text-muted font-mono bg-white/5 px-1.5 py-0.5 rounded">{(itemBarcodes(selected) || []).length} found</div>
          </div>
          <div class="space-y-2">
            {#if (itemBarcodes(selected) || []).length === 0}
              <div class="text-xs text-muted italic p-2 text-center">No associated barcodes.</div>
            {:else}
              {#each itemBarcodes(selected) as b}
                <div class="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-surface-highlight/30 px-3 py-2">
                  <div class="min-w-0">
                    <div class="font-mono text-xs font-bold text-ink/90 truncate">{b.barcode}</div>
                    <div class="text-[10px] text-muted truncate mt-0.5">
                      {b.label || "Standard"}
                    </div>
                  </div>
                  <div class="shrink-0 text-right text-[10px] text-muted font-mono bg-black/20 px-2 py-1 rounded">
                    <div>{b.uom_code || selected.unit_of_measure || "pcs"}</div>
                    {#if toNum(b.qty_factor, 1) !== 1}<div class="text-accent">x{toNum(b.qty_factor, 1)}</div>{/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        {#if selected.track_batches || selected.track_expiry}
          <div class="rounded-2xl border border-white/5 bg-surface-highlight/20 p-4">
            <div class="flex items-center justify-between gap-3 mb-3">
              <div>
                <div class="text-[10px] font-bold uppercase tracking-widest text-muted opacity-80">Batch Availability</div>
                <div class="text-[10px] text-muted mt-0.5">Live from warehouse</div>
              </div>
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-white/10 bg-surface-highlight/50 hover:bg-surface-highlight hover:text-white transition-colors disabled:opacity-50"
                on:click={fetchBatches}
                disabled={batchesLoading}
              >
                {batchesLoading ? "Loading..." : "Check Stock"}
              </button>
            </div>

            {#if batchesError}
              <div class="p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-xs text-red-400 font-medium">{batchesError}</div>
            {:else if batches.length > 0}
              <div class="overflow-x-auto rounded-xl border border-white/5">
                <table class="w-full text-xs text-left">
                  <thead class="bg-white/5 text-muted uppercase tracking-wider font-bold text-[9px]">
                    <tr>
                      <th class="py-2 px-3">Batch</th>
                      <th class="py-2 px-3">Expiry</th>
                      <th class="py-2 px-3 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-white/5">
                    {#each batches as r}
                      <tr class="bg-surface-highlight/10 hover:bg-surface-highlight/30 transition-colors">
                        <td class="py-2 px-3 font-mono font-medium text-ink">{r.batch_no || r.batch_id}</td>
                        <td class="py-2 px-3 font-mono text-muted">{r.expiry_date || "—"}</td>
                        <td class="py-2 px-3 text-right font-mono font-bold text-emerald-400">{toNum(r.on_hand, 0)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else if batchesKey}
              <div class="text-xs text-muted italic text-center py-2">No active batches available.</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
</style>
