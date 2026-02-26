<script>
  export let isOpen = false;
  export let total = 0;
  export let currency = "USD";
  export let exchangeRate = 0; // USD-to-LBP rate (e.g. 89500)
  export let mode = "sale"; // "sale" | "return"
  export let busy = false;
  export let lineCount = 0;
  export let customerName = "";
  export let onConfirm = (method, cashTendered) => {};
  export let onCancel = () => {};

  let paymentMethod = "cash";
  let cashPrimary = "";
  let cashSecondary = "";
  let primaryInputEl;

  // ── Currency helpers ───────────────────────────────────────────────
  $: isLbp = (currency || "").toUpperCase() === "LBP";
  $: hasDual = !!(exchangeRate > 0);
  $: primaryLabel = isLbp ? "LBP" : "USD";
  $: secondaryLabel = isLbp ? "USD" : "LBP";
  $: primaryPrefix = isLbp ? "LBP" : "$";
  $: secondaryPrefix = isLbp ? "$" : "LBP";

  // ── Formatting ─────────────────────────────────────────────────────
  function fmtUsd(v) { return `$${(Number(v) || 0).toFixed(2)}`; }
  function fmtLbp(v) { return `${Math.round(Number(v) || 0).toLocaleString()} LBP`; }
  function fmtDisplay(v) {
    const n = Number(v) || 0;
    return (currency || "").toUpperCase() === "LBP"
      ? Math.round(n).toLocaleString()
      : n.toFixed(2);
  }
  function fmtPrimary(v) { return (currency || "").toUpperCase() === "LBP" ? fmtLbp(v) : fmtUsd(v); }
  function fmtSecondary(v) { return (currency || "").toUpperCase() === "LBP" ? fmtUsd(v) : fmtLbp(v); }

  // ── Quick amounts ──────────────────────────────────────────────────
  $: primaryQuicks = isLbp
    ? [100000, 250000, 500000, 1000000]
    : [5, 10, 20, 50, 100];
  $: secondaryQuicks = isLbp
    ? [5, 10, 20, 50]
    : [100000, 250000, 500000, 1000000];

  function fmtQuickLabel(amt, isLbpCurrency) {
    if (isLbpCurrency) {
      if (amt >= 1000000) return `${(amt / 1000000).toFixed(amt % 1000000 === 0 ? 0 : 1)}M`;
      if (amt >= 1000) return `${(amt / 1000).toFixed(0)}K`;
      return String(amt);
    }
    return `$${amt}`;
  }

  // ── Payment methods (hide Card & Transfer) ────────────────────────
  $: allowedMethods = mode === "return" ? ["cash"] : ["cash", "credit"];
  $: if (!allowedMethods.includes(paymentMethod)) paymentMethod = "cash";

  // ── Numeric values & calculations ─────────────────────────────────
  $: pNum = Number(cashPrimary) || 0;
  $: sNum = Number(cashSecondary) || 0;

  // Convert secondary → primary equivalent
  // exchangeRate is always USD-to-LBP
  $: sEquiv = (() => {
    if (!hasDual || sNum <= 0 || exchangeRate <= 0) return 0;
    return isLbp
      ? sNum * exchangeRate    // secondary is USD → multiply to get LBP
      : sNum / exchangeRate;   // secondary is LBP → divide to get USD
  })();

  $: totalPaid = pNum + sEquiv;
  $: tTotal = Number(total) || 0;
  $: changeDue = Math.max(0, totalPaid - tTotal);
  $: amountShort = Math.max(0, tTotal - totalPaid);
  $: sufficient = paymentMethod !== "cash" || totalPaid >= tTotal;

  // Change in secondary currency (for display alongside primary)
  $: changeDueSecondary = (() => {
    if (!hasDual || exchangeRate <= 0 || changeDue <= 0) return 0;
    return isLbp
      ? changeDue / exchangeRate   // primary LBP → change in USD
      : changeDue * exchangeRate;  // primary USD → change in LBP
  })();

  // ── Focus primary input on cash selection ─────────────────────────
  $: if (paymentMethod === "cash" && primaryInputEl) {
    setTimeout(() => primaryInputEl?.focus?.(), 50);
  }

  // ── Reset when modal opens → default to exact amount ──────────────
  $: if (isOpen) {
    cashPrimary = isLbp ? String(Math.round(Number(total) || 0)) : String(Number(total) || 0);
    cashSecondary = "";
    paymentMethod = "cash";
  }

  // ── Actions ────────────────────────────────────────────────────────
  function handleConfirm() {
    onConfirm(paymentMethod, paymentMethod === "cash" ? totalPaid : 0);
  }

  function setExactPrimary() {
    cashPrimary = isLbp ? String(Math.round(tTotal)) : String(tTotal);
    cashSecondary = "";
  }

  function setExactSecondary() {
    if (!hasDual || exchangeRate <= 0) return;
    cashPrimary = "";
    cashSecondary = isLbp
      ? String((tTotal / exchangeRate).toFixed(2))          // LBP total → USD
      : String(Math.round(tTotal * exchangeRate));           // USD total → LBP
  }

  function handleKeydown(e) {
    if (e.key === "Escape" && !busy) onCancel();
    if (e.key === "Enter" && sufficient && !busy) handleConfirm();
  }
</script>

<svelte:window on:keydown={isOpen ? handleKeydown : undefined} />

{#if isOpen}
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 animation-fade-in"
    role="dialog" aria-modal="true"
    aria-label={mode === "return" ? "Confirm Refund" : "Confirm Payment"}>

    <!-- Backdrop -->
    <button
      class="absolute inset-0 bg-black/55 backdrop-blur-md transition-all duration-300"
      type="button" aria-label="Close payment"
      on:click={onCancel} disabled={busy}
    ></button>

    <!-- Modal -->
    <div class="relative w-full max-w-lg glass-panel rounded-3xl shadow-2xl overflow-hidden transform transition-all scale-100 opacity-100 z-10 border border-ink/10 bg-surface/70">
      <div class="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent pointer-events-none"></div>

      <div class="relative z-10 max-h-[90vh] overflow-y-auto">
        <!-- Header -->
        <div class="p-5 text-center border-b border-ink/10">
          <h2 class="text-2xl font-bold text-ink tracking-tight">
            {mode === "return" ? "Confirm Refund" : "Confirm Payment"}
          </h2>
          <div class="flex items-center justify-center gap-3 mt-1.5 text-sm text-muted">
            <span>{lineCount} item{lineCount !== 1 ? "s" : ""}</span>
            {#if customerName}
              <span class="w-1 h-1 rounded-full bg-ink/20"></span>
              <span class="text-ink/70 font-medium">{customerName}</span>
            {/if}
          </div>
        </div>

        <div class="p-6 flex flex-col items-center gap-5">
          <!-- Total Amount -->
          <div class="text-center relative">
            <div class="absolute inset-0 bg-accent/15 blur-3xl rounded-full"></div>
            <div class="relative">
              <span class="text-5xl num-readable font-extrabold text-ink tracking-tighter drop-shadow-lg">
                {fmtDisplay(total)}
              </span>
              <span class="text-lg text-accent font-bold ml-2">{currency}</span>
            </div>
          </div>

          <!-- Payment Methods (only show selector when >1 option) -->
          {#if allowedMethods.length > 1}
            <div class="grid grid-cols-2 gap-3 w-full">
              <!-- Cash -->
              <button
                class="group relative flex flex-col items-center justify-center gap-2.5 p-4 rounded-2xl border transition-all duration-300
                  {paymentMethod === 'cash'
                    ? 'bg-emerald-500/18 border-emerald-500/45 shadow-[0_10px_28px_rgba(16,185,129,0.22)]'
                    : 'bg-surface-highlight/50 border-ink/10 hover:bg-surface-highlight/60 hover:border-accent/30'}"
                on:click={() => (paymentMethod = "cash")}
                disabled={busy}
              >
                <div class="p-2.5 rounded-full {paymentMethod === 'cash' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/35' : 'bg-ink/5 text-ink/70 group-hover:bg-accent/15 group-hover:text-accent'} transition-all duration-300">
                  <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                </div>
                <span class="font-bold text-sm tracking-wide {paymentMethod === 'cash' ? 'text-emerald-500' : 'text-ink/80 group-hover:text-ink'} transition-colors">Cash</span>
              </button>

              <!-- Credit (sale only) -->
              {#if allowedMethods.includes("credit")}
                <button
                  class="group relative flex flex-col items-center justify-center gap-2.5 p-4 rounded-2xl border transition-all duration-300
                    {paymentMethod === 'credit'
                      ? 'bg-amber-500/18 border-amber-500/45 shadow-[0_10px_28px_rgba(245,158,11,0.22)]'
                      : 'bg-surface-highlight/50 border-ink/10 hover:bg-surface-highlight/60 hover:border-accent/30'}"
                  on:click={() => (paymentMethod = "credit")}
                  disabled={busy}
                >
                  <div class="p-2.5 rounded-full {paymentMethod === 'credit' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/35' : 'bg-ink/5 text-ink/70 group-hover:bg-accent/15 group-hover:text-accent'} transition-all duration-300">
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <span class="font-bold text-sm tracking-wide {paymentMethod === 'credit' ? 'text-amber-500' : 'text-ink/80 group-hover:text-ink'} transition-colors">Credit</span>
                </button>
              {/if}
            </div>
          {/if}

          <!-- ─── Cash Received Section ───────────────────────────── -->
          {#if paymentMethod === "cash"}
            <div class="w-full space-y-3 p-4 rounded-2xl bg-surface-highlight/30 border border-white/5">

              <!-- Primary Currency Input -->
              <label class="block">
                <span class="text-xs font-bold uppercase tracking-wider text-muted mb-1.5 block">
                  Received ({primaryLabel})
                </span>
                <div class="relative">
                  <span class="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-bold">{primaryPrefix}</span>
                  <input
                    bind:this={primaryInputEl}
                    type="number" step="any" min="0"
                    bind:value={cashPrimary}
                    placeholder="0.00"
                    class="w-full pl-12 pr-4 py-3 rounded-xl bg-surface/60 border border-white/10 focus:border-accent/50 focus:ring-2 focus:ring-accent/30 text-2xl num-readable font-bold text-ink text-right focus:outline-none transition-all"
                    disabled={busy}
                  />
                </div>
              </label>

              <!-- Primary Quick Amounts -->
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="flex-1 min-w-[60px] py-2.5 rounded-xl text-sm font-bold border transition-all active:scale-95
                    {pNum === tTotal && tTotal > 0 && sNum === 0
                      ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-500'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'}"
                  on:click={setExactPrimary}
                  disabled={busy}
                >
                  Exact
                </button>
                {#each primaryQuicks as amt}
                  <button
                    type="button"
                    class="flex-1 min-w-[60px] py-2.5 rounded-xl text-sm font-bold num-readable border border-white/10 bg-surface-highlight/50 text-ink/80 hover:bg-surface-highlight/70 hover:border-accent/30 hover:text-ink active:scale-95 transition-all"
                    on:click={() => (cashPrimary = String(amt))}
                    disabled={busy}
                  >
                    {fmtQuickLabel(amt, isLbp)}
                  </button>
                {/each}
              </div>

              <!-- ─── Secondary Currency (dual mode) ──────────────── -->
              {#if hasDual}
                <div class="border-t border-ink/8 pt-3 mt-1">
                  <label class="block">
                    <span class="text-xs font-bold uppercase tracking-wider text-muted mb-1.5 block">
                      + {secondaryLabel}
                    </span>
                    <div class="relative">
                      <span class="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-bold">{secondaryPrefix}</span>
                      <input
                        type="number" step="any" min="0"
                        bind:value={cashSecondary}
                        placeholder="0"
                        class="w-full pl-14 pr-4 py-3 rounded-xl bg-surface/60 border border-white/10 focus:border-accent/50 focus:ring-2 focus:ring-accent/30 text-2xl num-readable font-bold text-ink text-right focus:outline-none transition-all"
                        disabled={busy}
                      />
                    </div>
                  </label>

                  <!-- Secondary Quick Amounts -->
                  <div class="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      class="flex-1 min-w-[60px] py-2.5 rounded-xl text-sm font-bold border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 active:scale-95 transition-all"
                      on:click={setExactSecondary}
                      disabled={busy}
                    >
                      Exact
                    </button>
                    {#each secondaryQuicks as amt}
                      <button
                        type="button"
                        class="flex-1 min-w-[60px] py-2.5 rounded-xl text-sm font-bold num-readable border border-white/10 bg-surface-highlight/50 text-ink/80 hover:bg-surface-highlight/70 hover:border-accent/30 hover:text-ink active:scale-95 transition-all"
                        on:click={() => (cashSecondary = String(amt))}
                        disabled={busy}
                      >
                        {fmtQuickLabel(amt, !isLbp)}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- ─── Change / Short / Exact indicator ────────────── -->
              {#if sufficient && changeDue > 0}
                <!-- Change due -->
                <div class="flex items-center justify-between p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30">
                  <span class="text-sm font-bold text-emerald-600">Change</span>
                  <div class="text-right">
                    <span class="text-2xl num-readable font-extrabold text-ink">{fmtPrimary(changeDue)}</span>
                    {#if hasDual && changeDueSecondary > 0}
                      <span class="block text-sm num-readable font-semibold text-muted mt-0.5">
                        {fmtSecondary(changeDueSecondary)}
                      </span>
                    {/if}
                  </div>
                </div>
              {:else if sufficient && changeDue === 0 && totalPaid > 0}
                <!-- Exact match -->
                <div class="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                  <svg class="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
                  <span class="text-sm font-bold text-emerald-600">Exact amount</span>
                </div>
              {:else if !sufficient && totalPaid > 0}
                <!-- Amount short -->
                <div class="flex items-center justify-between p-3 rounded-xl bg-red-500/15 border border-red-500/30">
                  <span class="text-sm font-bold text-red-600">Short</span>
                  <span class="text-2xl num-readable font-extrabold text-ink">{fmtPrimary(amountShort)}</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Footer Actions -->
        <div class="p-5 border-t border-ink/10 bg-surface-highlight/40 flex gap-3">
          <button
            class="flex-1 py-3.5 px-5 rounded-xl border border-ink/10 bg-surface-highlight/50 text-ink/75 hover:text-ink hover:bg-surface-highlight/60 font-bold transition-colors"
            on:click={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            class="flex-[2] py-3.5 px-5 rounded-xl font-bold text-lg tracking-wide transition-all
              {sufficient && !busy
                ? 'bg-accent bg-gradient-to-r from-accent to-accent-hover text-[rgb(var(--color-accent-content))] shadow-lg shadow-accent/25 hover:shadow-accent/40 hover:scale-[1.02] active:scale-[0.98]'
                : 'bg-surface-highlight/60 text-ink/40 cursor-not-allowed'}"
            on:click={handleConfirm}
            disabled={!sufficient || busy}
          >
            {#if busy}
              <span class="flex items-center justify-center gap-2">
                <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Processing...
              </span>
            {:else}
              {mode === "return" ? "Confirm Refund" : "Complete Sale"}
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .animation-fade-in {
    animation: fadeIn 0.2s ease-out;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  /* Hide native number input spinners */
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"] {
    appearance: textfield;
    -moz-appearance: textfield;
  }
</style>
