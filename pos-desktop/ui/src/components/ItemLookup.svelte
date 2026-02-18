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
  $: if (!qn) { activeIndex = 0; selected = null; batches = []; batchesError = ""; batchesKey = ""; uomIdx = 0; }

  const ensureFocus = async () => {
    await tick();
    if (inputEl && inputEl.focus) inputEl.focus();
  };

  $: if (isActive) ensureFocus();

  const pick = (it) => {
    selected = it;
    batches = [];
    batchesError = "";
    batchesKey = "";
    uomIdx = 0;
  };

  $: if (autoPick) {
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
  <section class="glass-panel rounded-2xl p-4 flex flex-col overflow-hidden">
    <header class="mb-3">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-extrabold tracking-tight">Item Lookup</h2>
        <div class="text-[11px] text-muted whitespace-nowrap">
          ↑↓ select · Enter view · Esc clear
        </div>
      </div>
      <div class="mt-3 relative group">
        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg class="h-5 w-5 text-muted group-focus-within:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          class="block w-full pl-10 pr-3 py-3 rounded-xl bg-bg/50 border border-ink/10 text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all duration-200"
          placeholder="Search SKU, name, barcode..."
          on:keydown={onListKeyDown}
        />
      </div>
    </header>

    <div class="flex-1 overflow-hidden">
      {#if !qn}
        <div class="h-full flex flex-col items-center justify-center text-muted select-none opacity-70">
          <p class="text-sm">Scan or type to search</p>
          <p class="text-[11px] mt-2">Tip: barcode scans land here automatically</p>
        </div>
      {:else if (results || []).length === 0}
        <div class="h-full flex items-center justify-center text-muted select-none">
          <p class="text-sm">No matches</p>
        </div>
      {:else}
        <div
          class="h-full overflow-y-auto pr-1 space-y-2 custom-scrollbar"
          role="listbox"
          tabindex="0"
          aria-label="Item search results"
          on:keydown={onListKeyDown}
        >
          {#each results as it, i}
            <button
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              class={`w-full text-left rounded-xl border px-3 py-3 transition-all duration-150 ${
                i === activeIndex ? "border-accent/40 ring-1 ring-accent/25 bg-surface/55" : "border-ink/10 bg-surface/40 hover:bg-surface/55 hover:border-accent/20"
              }`}
              on:mouseenter={() => activeIndex = i}
              on:focus={() => activeIndex = i}
              on:click={() => pick(it)}
            >
              <div class="flex items-start gap-3">
	                <div class="min-w-0 flex-1">
	                  <div class="min-w-0">
	                    <div class={`clamp-2 text-ink ${nameSizeClass(it.name)}`}>{it.name || "Unknown Item"}</div>
	                    <div class="mt-1 text-[10px] font-mono text-muted truncate">{it.sku || "NO SKU"}</div>
	                  </div>
	                  <div class="mt-1 flex items-center gap-2 text-[11px] text-muted">
	                    {#if it.barcode}<span class="font-mono">{it.barcode}</span>{/if}
	                    {#if it.track_batches || it.track_expiry}
                      <span class="px-2 py-0.5 rounded-full border border-ink/10 bg-ink/5 text-[10px] font-bold">
                        {it.track_batches ? "Batch" : ""}{it.track_batches && it.track_expiry ? "+" : ""}{it.track_expiry ? "Expiry" : ""}
                      </span>
                    {/if}
                  </div>
                </div>

                <div class="shrink-0 flex flex-col items-end gap-1">
                  <span class={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border ${tonePill(it)}`}>
                    {companyLabel(it)}
                  </span>
                  <span class="text-[11px] num-readable text-ink/90">{fmtMoney(withVat(priceBase(it)), currencyPrimary)}</span>
                  <span class="text-[10px] text-emerald-300">After VAT</span>
                  <span class="text-[10px] num-readable text-muted">{fmtMoney(priceBase(it), currencyPrimary)} before</span>
                </div>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <!-- Right: Details -->
  <section class="glass-panel rounded-2xl p-4 flex flex-col overflow-hidden">
    {#if !selected}
      <div class="h-full flex flex-col items-center justify-center text-muted select-none opacity-70">
        <p class="text-sm">Select an item to view details</p>
      </div>
    {:else}
      <header class="pb-3 border-b border-ink/10">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <h3 class="text-lg font-extrabold tracking-tight truncate">{selected.name || "Unknown Item"}</h3>
              <span class={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border ${tonePill(selected)}`}>
                {companyLabel(selected)}
              </span>
            </div>
            <div class="mt-1 flex items-center gap-2 text-[11px] text-muted">
              <span class="font-mono">{selected.sku || "NO SKU"}</span>
              <span class="w-1 h-1 rounded-full bg-ink/15"></span>
              <span class="font-mono">{selected.id}</span>
            </div>
          </div>

          <div class="shrink-0 flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-2 rounded-full text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors"
              on:click={() => cycleUom(1)}
              title="Cycle UOM"
            >
              {#if selectedUomOpt()}
                {@const opt = selectedUomOpt()}
                {opt.uom}{toNum(opt.qty_factor, 1) !== 1 ? ` x${toNum(opt.qty_factor, 1)}` : ""}
              {:else}
                UOM
              {/if}
            </button>
            <button
              type="button"
              class="px-4 py-2 rounded-full text-xs font-extrabold border border-accent/30 bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
              on:click={addSelectedToCart}
              title="Add to cart"
            >
              Add
            </button>
          </div>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto pr-1 space-y-4 custom-scrollbar">
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 pt-4">
          <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
            <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Pricing</div>
            <div class="mt-3 space-y-2 num-readable">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted">After VAT ({currencyPrimary})</span>
                <span class="text-sm font-bold text-emerald-300">{fmtMoney(withVat(priceBase(selected)), currencyPrimary)}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted">Before VAT ({currencyPrimary})</span>
                <span class="text-sm font-bold">{fmtMoney(priceBase(selected), currencyPrimary)}</span>
              </div>
              <div class="h-px bg-ink/10"></div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted">After VAT (USD)</span>
                <span class="text-sm font-bold text-emerald-300">{fmtMoney(withVat(selected.price_usd || 0), "USD")}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted">After VAT (LBP)</span>
                <span class="text-sm font-bold text-emerald-300">{fmtMoney(withVat(selected.price_lbp || 0), "LBP")}</span>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
            <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Inventory Policy</div>
            <div class="mt-3 text-sm">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted">UOM</span>
                <span class="font-mono font-semibold">{selected.unit_of_measure || "pcs"}</span>
              </div>
              <div class="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <div class="rounded-xl border border-ink/10 bg-ink/5 px-3 py-2">
                  <div class="text-[10px] font-bold text-muted uppercase tracking-wider">Batches</div>
                  <div class="font-semibold text-ink/90">{selected.track_batches ? "Yes" : "No"}</div>
                </div>
                <div class="rounded-xl border border-ink/10 bg-ink/5 px-3 py-2">
                  <div class="text-[10px] font-bold text-muted uppercase tracking-wider">Expiry</div>
                  <div class="font-semibold text-ink/90">{selected.track_expiry ? "Yes" : "No"}</div>
                </div>
              </div>
              <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px]">
                <div class="rounded-xl border border-ink/10 bg-ink/5 px-3 py-2">
                  <div class="text-[10px] font-bold text-muted uppercase tracking-wider">Shelf Life</div>
                  <div class="font-mono font-semibold text-ink/90">{toNum(selected.default_shelf_life_days, 0) || "—"}</div>
                </div>
                <div class="rounded-xl border border-ink/10 bg-ink/5 px-3 py-2">
                  <div class="text-[10px] font-bold text-muted uppercase tracking-wider">Min Days</div>
                  <div class="font-mono font-semibold text-ink/90">{toNum(selected.min_shelf_life_days_for_sale, 0) || "—"}</div>
                </div>
                <div class="rounded-xl border border-ink/10 bg-ink/5 px-3 py-2">
                  <div class="text-[10px] font-bold text-muted uppercase tracking-wider">Warn Days</div>
                  <div class="font-mono font-semibold text-ink/90">{toNum(selected.expiry_warning_days, 0) || "—"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Barcodes</div>
            <div class="text-[11px] text-muted">{(itemBarcodes(selected) || []).length} known</div>
          </div>
          <div class="mt-3 space-y-2">
            {#if (itemBarcodes(selected) || []).length === 0}
              <div class="text-sm text-muted">No cached barcodes.</div>
            {:else}
              {#each itemBarcodes(selected) as b}
                <div class="flex items-center justify-between gap-3 rounded-xl border border-ink/10 bg-ink/5 px-3 py-2">
                  <div class="min-w-0">
                    <div class="font-mono text-sm font-semibold truncate">{b.barcode}</div>
                    <div class="text-[11px] text-muted truncate">
                      {b.label || "—"}
                    </div>
                  </div>
                  <div class="shrink-0 text-right text-[11px] text-muted font-mono">
                    <div>{b.uom_code || selected.unit_of_measure || "pcs"}</div>
                    <div>x{toNum(b.qty_factor, 1) || 1}{b.is_primary ? " · primary" : ""}</div>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        {#if selected.track_batches || selected.track_expiry}
          <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Eligible Batches</div>
                <div class="text-[11px] text-muted mt-1">Online-only; uses warehouse stock on hand.</div>
              </div>
              <button
                type="button"
                class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors disabled:opacity-60"
                on:click={fetchBatches}
                disabled={batchesLoading}
              >
                {batchesLoading ? "Loading..." : "Load"}
              </button>
            </div>

            {#if batchesError}
              <div class="mt-3 text-sm text-red-400">{batchesError}</div>
            {:else if batches.length > 0}
              <div class="mt-3 overflow-x-auto">
                <table class="w-full text-sm">
                  <thead class="text-[11px] text-muted uppercase tracking-wider">
                    <tr>
                      <th class="text-left py-2 pr-2">Batch</th>
                      <th class="text-left py-2 pr-2">Expiry</th>
                      <th class="text-right py-2 pr-2">On hand</th>
                      <th class="text-right py-2 pr-2">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each batches as r}
                      <tr class="border-t border-ink/10">
                        <td class="py-2 pr-2 font-mono">{r.batch_no || r.batch_id}</td>
                        <td class="py-2 pr-2 font-mono">{r.expiry_date || "—"}</td>
                        <td class="py-2 pr-2 text-right font-mono font-semibold">{toNum(r.on_hand, 0)}</td>
                        <td class="py-2 pr-2 text-right font-mono text-muted">{r.days_to_expiry ?? "—"}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else if batchesKey}
              <div class="mt-3 text-sm text-muted">No eligible batches found.</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.35); border-radius: 10px; }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.55); }
</style>
