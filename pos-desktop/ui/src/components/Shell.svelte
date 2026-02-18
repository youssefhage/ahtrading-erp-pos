<script>
  export let status = "";
  export let edgeStateText = "";
  export let syncBadge = "";
  export let hasConnection = false;
  export let cashierName = "";
  export let shiftText = "";
  export let showTabs = false;

  const tone = (kind) => {
    if (kind === "ok") return "bg-emerald-500/10 border-emerald-500/25 text-ink/80";
    if (kind === "warn") return "bg-amber-500/10 border-amber-500/25 text-ink/80";
    if (kind === "bad") return "bg-red-500/10 border-red-500/25 text-ink/80";
    return "bg-ink/5 border-ink/10 text-muted";
  };

  const _toText = (v) => String(v || "").trim();

  const _outboxKind = (badge) => {
    const t = _toText(badge);
    if (!t || t === "—") return "neutral";
    if (t.toLowerCase() === "synced") return "ok";
    const nums = Array.from(t.matchAll(/(\\d+)/g)).map((m) => Number(m[1] || 0));
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
  <header class="sticky top-0 z-40 w-full glass border-b border-ink/10 shadow-[0_12px_36px_rgba(2,8,23,0.10)]">
    <div class="relative px-6 py-3 lg:px-8">
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-ink/15 to-transparent"></div>

      <div class="flex items-center gap-4 min-w-0">
        <!-- Status (keep simple, always visible) -->
        <div class="flex items-center gap-2 rounded-3xl border border-ink/10 bg-gradient-to-br from-surface/95 to-surface/70 px-3 py-2 shadow-sm shrink-0">
          <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-accent font-extrabold text-white shadow-lg shadow-accent/25 ring-1 ring-accent/25">
            WP
          </div>
          <span class={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider shadow-sm ${tone(systemKind)}`}>
            <span class={`h-2 w-2 rounded-full ${hasConnection ? "bg-emerald-300" : "bg-red-300"}`}></span>
            {status || "—"}
          </span>
        </div>

        <!-- Status strip (scrolls horizontally if needed, never adds height) -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
            <div class={`inline-flex items-center gap-2 rounded-2xl border bg-surface/45 px-3 py-2 ${tone(edgeKind)} shadow-sm shrink-0`}>
              <div class="text-[10px] font-extrabold uppercase tracking-wider opacity-80">Edge</div>
              <div class="text-xs font-semibold text-ink/90 whitespace-nowrap">{edgeStateText || "—"}</div>
            </div>

            <div class={`inline-flex items-center gap-2 rounded-2xl border bg-surface/45 px-3 py-2 ${tone(outboxKind)} shadow-sm shrink-0`}>
              <span class={`h-2 w-2 rounded-full ${outboxKind === "ok" ? "bg-emerald-300" : outboxKind === "warn" ? "bg-amber-300" : "bg-red-300"}`}></span>
              <div class="text-xs font-extrabold uppercase tracking-wider text-ink/90 whitespace-nowrap">{outboxCompactText}</div>
            </div>

            <div class={`inline-flex items-center gap-2 rounded-2xl border bg-surface/45 px-3 py-2 ${tone(cashierKind)} shadow-sm shrink-0`}>
              <div class="text-[10px] font-extrabold uppercase tracking-wider opacity-80">Cashier</div>
              <div class="text-xs font-semibold text-ink/90 whitespace-nowrap">{cashierName || "—"}</div>
            </div>

            <div class={`inline-flex items-center gap-2 rounded-2xl border bg-surface/45 px-3 py-2 ${tone(shiftKind)} shadow-sm shrink-0`}>
              <div class="text-[10px] font-extrabold uppercase tracking-wider opacity-80">Shift</div>
              <div class="text-xs font-semibold text-ink/90 whitespace-nowrap">{shiftText || "—"}</div>
            </div>
          </div>
        </div>

        <!-- Actions (scrolls horizontally, stays one-line) -->
        <div class="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 shrink-0">
          <slot name="top-actions" />
        </div>
      </div>

      {#if showTabs}
        <div class="mt-3 pt-3 border-t border-ink/10">
          <nav class="flex items-center gap-2 overflow-x-auto no-scrollbar rounded-2xl bg-surface/45 border border-ink/10 px-2 py-2" aria-label="Screens">
            <slot name="tabs" />
          </nav>
        </div>
      {/if}
    </div>
  </header>

  <!-- Main Content -->
  <main class="p-6 max-w-[1920px] mx-auto flex-1 overflow-hidden w-full">
    <slot />
  </main>
</div>
