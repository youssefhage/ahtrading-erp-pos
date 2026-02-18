<script>
  export let status = "";
  export let edgeStateText = "";
  export let syncBadge = "";
  export let hasConnection = false;
  export let cashierName = "";
  export let shiftText = "";
  export let showTabs = false;

  const tone = (kind) => {
    if (kind === "ok") return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 font-medium";
    if (kind === "warn") return "bg-amber-500/10 border-amber-500/20 text-amber-400 font-medium";
    if (kind === "bad") return "bg-red-500/10 border-red-500/20 text-red-400 font-medium";
    return "bg-surface-highlight border-ink/10 text-muted hover:text-ink transition-colors";
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

  const _edgeKind = (text) => {
    const t = _toText(text).toLowerCase();
    if (!t) return "neutral";
    if (t.includes("offline")) return "bad";
    if (t.includes("auth")) return "warn";
    if (t.includes("online")) return "ok";
    return "neutral";
  };

  $: systemKind = hasConnection ? "ok" : "bad";
  $: outboxKind = _outboxKind(syncBadge);
  $: edgeKind = _edgeKind(edgeStateText);
  $: cashierKind = _toText(cashierName).toLowerCase().includes("not signed") ? "warn" : "neutral";
  $: shiftKind = _toText(shiftText).toLowerCase().includes("open") ? "ok" : "neutral";
  $: outboxCompactText = outboxKind === "ok" ? "READY" : (outboxKind === "warn" ? "SYNCING" : "OFFLINE");
</script>

<div class="min-h-screen bg-bg text-ink font-sans selection:bg-accent/20 selection:text-accent flex flex-col">

  <!-- Topbar -->
  <header class="sticky top-0 z-50 w-full glass shadow-sm">
    <div class="relative px-6 py-3">
      <div class="flex items-center justify-between gap-6">
        
        <!-- Brand & Status -->
        <div class="flex items-center gap-4 shrink-0">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-hover text-white shadow-lg shadow-accent/20 font-bold text-sm tracking-wide">
              WP
            </div>
            
            <div class="hidden md:flex flex-col">
              <span class="text-xs font-bold tracking-wider text-muted uppercase">System Status</span>
              <span class="flex items-center gap-2 text-sm font-semibold text-ink">
                <span class={`h-2 w-2 rounded-full ${hasConnection ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "bg-red-400"}`}></span>
                {status || "Disconnected"}
              </span>
            </div>
          </div>
        </div>

        <!-- Status Indicators (Scrollable on mobile) -->
        <div class="flex-1 min-w-0 flex justify-center">
          <div class="flex items-center gap-3 overflow-x-auto no-scrollbar py-1 px-4">
            
            <!-- Edge -->
            <div class={`group flex items-center gap-3 rounded-full border px-4 py-1.5 ${tone(edgeKind)} backdrop-blur-md transition-all`}>
              <div class="text-[10px] font-bold uppercase tracking-widest opacity-70">Edge</div>
              <div class="w-px h-3 bg-current opacity-20"></div>
              <div class="text-xs font-semibold whitespace-nowrap">{edgeStateText || "—"}</div>
            </div>

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
        <div class="mt-4 pt-4 border-t border-ink/10">
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
