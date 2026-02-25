<script>
  export let syncBadge = "";
  export let officialStatus = "";
  export let unofficialStatus = "";
  export let cashierName = "";
  export let cashierOfficialName = "";
  export let cashierUnofficialName = "";
  export let cashierOfficialManager = false;
  export let cashierUnofficialManager = false;
  export let shiftText = "";
  export let showTabs = false;
  export let plainBackground = false;

  const tone = (kind) => {
    if (kind === "ok") return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 font-medium";
    if (kind === "warn") return "bg-amber-500/10 border-amber-500/20 text-amber-400 font-medium";
    if (kind === "bad") return "bg-red-500/10 border-red-500/20 text-red-400 font-medium";
    return "bg-surface-highlight border-white/5 text-muted hover:text-ink transition-colors";
  };

  const _toText = (v) => String(v || "").trim();

  const _outboxKind = (badge, officialConnected, unofficialConnected) => {
    if (!officialConnected || !unofficialConnected) return "bad";
    const t = _toText(badge);
    const lower = t.toLowerCase();
    if (!t || t === "—") return "neutral";
    if (lower.includes("offline") || lower.includes("disconnected") || lower.includes("locked") || lower.includes("error") || lower.includes("failed")) {
      return "bad";
    }
    if (lower === "synced") return "ok";
    if (lower.includes("stale") || lower.includes("syncing")) return "warn";
    const nums = Array.from(t.matchAll(/(\d+)/g)).map((m) => Number(m[1] || 0));
    const sum = nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    return sum > 0 ? "warn" : "ok";
  };

  const _isConnected = (value) => _toText(value).toLowerCase() === "ready";
  $: officialConnected = _isConnected(officialStatus);
  $: unofficialConnected = _isConnected(unofficialStatus);
  $: outboxKind = _outboxKind(syncBadge, officialConnected, unofficialConnected);
  $: hasStructuredCashier = !!(_toText(cashierOfficialName) || _toText(cashierUnofficialName));
  $: officialCashierText = _toText(cashierOfficialName) || "Not Signed In";
  $: unofficialCashierText = _toText(cashierUnofficialName) || "Not Signed In";
  $: legacyCashierText = _toText(cashierName) || "—";
  $: cashierKind = hasStructuredCashier
    ? (officialCashierText.toLowerCase().includes("not signed") || unofficialCashierText.toLowerCase().includes("not signed") ? "warn" : "neutral")
    : (legacyCashierText.toLowerCase().includes("not signed") ? "warn" : "neutral");
  $: shiftKind = _toText(shiftText).toLowerCase().includes("open") ? "ok" : "neutral";
  $: outboxCompactText = outboxKind === "ok" ? "SYNCED" : (outboxKind === "warn" ? "SYNCING" : "OFFLINE");
</script>

<div class="h-screen bg-bg text-ink font-sans flex flex-col relative overflow-hidden">
  <!-- Background Glows -->
  {#if !plainBackground}
    <div class="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-accent/5 rounded-full blur-[120px] pointer-events-none"></div>
    <div class="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-purple-500/5 rounded-full blur-[100px] pointer-events-none"></div>
  {/if}

  <!-- Topbar — single compact row: tabs | status pills | actions -->
  <header class="shrink-0 z-50 w-full glass shadow-lg shadow-black/5">
    <div class="relative px-2 py-1.5">
      <div class="flex items-center gap-1.5 min-w-0">

        <!-- Navigation Tabs (left-aligned, compact) -->
        {#if showTabs}
          <nav class="flex items-center gap-1 shrink-0" aria-label="Screens">
            <slot name="tabs" />
          </nav>
          <div class="w-px h-5 bg-white/10 shrink-0"></div>
        {/if}

        <!-- Status pills — compact inline -->
        <div class="flex items-center gap-1.5 shrink-0">
          <div class={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${tone(officialConnected ? "ok" : "bad")} transition-all`}>
            <span class={`h-1.5 w-1.5 rounded-full ${officialConnected ? "bg-emerald-400" : "bg-red-400"}`}></span>
            <div class="text-[9px] font-bold uppercase tracking-wider opacity-80">O</div>
          </div>
          <div class={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${tone(unofficialConnected ? "ok" : "bad")} transition-all`}>
            <span class={`h-1.5 w-1.5 rounded-full ${unofficialConnected ? "bg-emerald-400" : "bg-red-400"}`}></span>
            <div class="text-[9px] font-bold uppercase tracking-wider opacity-80">U</div>
          </div>
          <div class={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${tone(outboxKind)} transition-all`}>
            <span class={`h-1.5 w-1.5 rounded-full ${outboxKind === "ok" ? "bg-emerald-400" : outboxKind === "warn" ? "bg-amber-400" : "bg-red-400"}`}></span>
            <div class="text-[9px] font-bold uppercase tracking-wider whitespace-nowrap">{outboxCompactText}</div>
          </div>
        </div>

        <!-- Cashier + Shift (truncatable) -->
        <div class="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <div class={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${tone(cashierKind)} transition-all min-w-0`} title={hasStructuredCashier ? `O: ${officialCashierText} | U: ${unofficialCashierText}` : legacyCashierText}>
            <div class="text-[9px] font-bold uppercase tracking-wider opacity-70 shrink-0">Cashier</div>
            <div class="w-px h-3 bg-current opacity-20 shrink-0"></div>
            {#if hasStructuredCashier}
              <div class="flex items-center gap-1 text-[10px] font-semibold whitespace-nowrap min-w-0 overflow-hidden">
                <span class="inline-flex items-center gap-0.5 min-w-0">
                  <span class="text-[9px] opacity-70 font-bold shrink-0">O</span>
                  <span class="truncate max-w-[56px]">{officialCashierText}</span>
                </span>
                <span class="opacity-30 shrink-0">|</span>
                <span class="inline-flex items-center gap-0.5 min-w-0">
                  <span class="text-[9px] opacity-70 font-bold shrink-0">U</span>
                  <span class="truncate max-w-[56px]">{unofficialCashierText}</span>
                </span>
              </div>
            {:else}
              <div class="text-[10px] font-semibold whitespace-nowrap truncate max-w-[80px]">{legacyCashierText}</div>
            {/if}
          </div>
          <div class={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${tone(shiftKind)} transition-all shrink-0`}>
            <div class="text-[9px] font-bold uppercase tracking-wider opacity-70">Shift</div>
            <div class="w-px h-3 bg-current opacity-20"></div>
            <div class="text-[10px] font-semibold whitespace-nowrap">{shiftText || "—"}</div>
          </div>
        </div>

        <!-- Actions rail (fills remaining space, scrollable) -->
        <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar justify-end">
          <slot name="top-actions" />
        </div>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="flex-1 min-h-0 w-full max-w-[1920px] mx-auto px-1.5 py-1.5 md:px-2 md:py-1.5 lg:px-3 lg:py-2 overflow-hidden flex flex-col">
    <slot />
  </main>
</div>

<style>
  /* Optional: Fade mask for scrollable areas */
  .mask-fade-sides {
    mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
  }
</style>
