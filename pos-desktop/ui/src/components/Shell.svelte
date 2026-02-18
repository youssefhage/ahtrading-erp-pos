<script>
  export let syncBadge = "";
  export let officialStatus = "";
  export let unofficialStatus = "";
  export let cashierName = "";
  export let shiftText = "";
  export let showTabs = false;

  const tone = (kind) => {
    if (kind === "ok") return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 font-medium";
    if (kind === "warn") return "bg-amber-500/10 border-amber-500/20 text-amber-400 font-medium";
    if (kind === "bad") return "bg-red-500/10 border-red-500/20 text-red-400 font-medium";
    return "bg-surface-highlight border-white/5 text-muted hover:text-ink transition-colors";
  };

  const _toText = (v) => String(v || "").trim();

  const _outboxKind = (badge) => {
    const t = _toText(badge);
    if (!t || t === "—") return "neutral";
    if (t.toLowerCase() === "synced") return "ok";
    const nums = Array.from(t.matchAll(/(\d+)/g)).map((m) => Number(m[1] || 0));
    const sum = nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    return sum > 0 ? "warn" : "ok";
  };

  $: outboxKind = _outboxKind(syncBadge);
  $: cashierKind = _toText(cashierName).toLowerCase().includes("not signed") ? "warn" : "neutral";
  $: shiftKind = _toText(shiftText).toLowerCase().includes("open") ? "ok" : "neutral";
  $: outboxCompactText = outboxKind === "ok" ? "SYNCED" : (outboxKind === "warn" ? "SYNCING" : "OFFLINE");
  const _isConnected = (value) => _toText(value).toLowerCase() === "ready";
  $: officialConnected = _isConnected(officialStatus);
  $: unofficialConnected = _isConnected(unofficialStatus);
</script>

<div class="min-h-screen bg-bg text-ink font-sans selection:bg-accent/20 selection:text-accent flex flex-col relative overflow-hidden">
  <!-- Background Glows -->
  <div class="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-accent/5 rounded-full blur-[120px] pointer-events-none"></div>
  <div class="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-purple-500/5 rounded-full blur-[100px] pointer-events-none"></div>

  <!-- Topbar -->
  <header class="sticky top-0 z-50 w-full glass shadow-lg shadow-black/5">
    <div class="relative px-6 py-3">
      <div class="flex items-center justify-between gap-6">
        
        <!-- Company Connectivity -->
        <div class="flex items-center gap-4 shrink-0">
          <div class="flex items-center gap-2">
            <div class={`group flex items-center gap-2 rounded-full border px-3 py-1.5 ${tone(officialConnected ? "ok" : "bad")} backdrop-blur-md transition-all`}>
              <span class={`h-1.5 w-1.5 rounded-full ${officialConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`}></span>
              <div class="text-[10px] font-bold uppercase tracking-widest opacity-80">Official</div>
              <div class="w-px h-3 bg-current opacity-20"></div>
              <div class="text-xs font-semibold whitespace-nowrap">{officialConnected ? "Connected" : "Disconnected"}</div>
            </div>
            <div class={`group flex items-center gap-2 rounded-full border px-3 py-1.5 ${tone(unofficialConnected ? "ok" : "bad")} backdrop-blur-md transition-all`}>
              <span class={`h-1.5 w-1.5 rounded-full ${unofficialConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`}></span>
              <div class="text-[10px] font-bold uppercase tracking-widest opacity-80">Unofficial</div>
              <div class="w-px h-3 bg-current opacity-20"></div>
              <div class="text-xs font-semibold whitespace-nowrap">{unofficialConnected ? "Connected" : "Disconnected"}</div>
            </div>
          </div>
        </div>

        <!-- Status Indicators (Scrollable on mobile) -->
        <div class="flex-1 min-w-0 flex justify-center">
          <div class="flex items-center gap-3 overflow-x-auto no-scrollbar py-1 px-4 mask-fade-sides">
            
            <!-- Sync -->
            <div class={`group flex items-center gap-3 rounded-full border px-4 py-1.5 ${tone(outboxKind)} backdrop-blur-md transition-all`}>
               <span class={`h-1.5 w-1.5 rounded-full ${outboxKind === "ok" ? "bg-emerald-400 animate-pulse" : outboxKind === "warn" ? "bg-amber-400" : "bg-red-400"}`}></span>
              <div class="text-xs font-bold uppercase tracking-widest whitespace-nowrap">{outboxCompactText}</div>
            </div>

            <!-- Cashier -->
            <div class={`group flex items-center gap-3 rounded-full border px-4 py-1.5 ${tone(cashierKind)} backdrop-blur-md transition-all`}>
              <div class="text-[10px] font-bold uppercase tracking-widest opacity-70">Cashier</div>
              <div class="w-px h-3 bg-current opacity-20"></div>
              <div class="text-xs font-semibold whitespace-nowrap clamp-1 max-w-[120px]">{cashierName || "—"}</div>
            </div>

             <!-- Shift -->
             <div class={`group flex items-center gap-3 rounded-full border px-4 py-1.5 ${tone(shiftKind)} backdrop-blur-md transition-all`}>
              <div class="text-[10px] font-bold uppercase tracking-widest opacity-70">Shift</div>
              <div class="w-px h-3 bg-current opacity-20"></div>
              <div class="text-xs font-semibold whitespace-nowrap">{shiftText || "—"}</div>
            </div>
          </div>
        </div>

        <!-- Right Actions -->
        <div class="flex items-center gap-3 shrink-0">
          <slot name="top-actions" />
        </div>
      </div>

      <!-- Navigation Tabs -->
      {#if showTabs}
        <div class="mt-4 pt-4 border-t border-white/5">
          <nav class="flex items-center gap-2 overflow-x-auto no-scrollbar" aria-label="Screens">
            <slot name="tabs" />
          </nav>
        </div>
      {/if}
    </div>
  </header>

  <!-- Main Content -->
  <main class="flex-1 w-full max-w-[1920px] mx-auto p-4 lg:p-6 overflow-hidden flex flex-col">
    <slot />
  </main>
</div>

<style>
  /* Optional: Fade mask for scrollable areas */
  .mask-fade-sides {
    mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
  }
</style>
