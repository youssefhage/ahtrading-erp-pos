<script>
  export let isOpen = false;
  export let total = 0;
  export let currency = "USD";
  export let exchangeRate = 0; // USD-to-LBP rate (e.g. 89500)
  export let mode = "sale"; // "sale" | "return"
  export let busy = false;
  export let lineCount = 0;
  export let customerName = "";
  export let hasCustomer = false;
  export let onConfirm = (method, cashTendered) => {};
  export let onCancel = () => {};

  // ── View state: "choose" → "cash" | "credit" ─────────────────────
  let view = "choose"; // "choose" | "cash" | "credit"
  let paymentMethod = "cash";
  let cashPrimary = "";
  let cashSecondary = "";
  let primaryInputEl;

  const roundUsd = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
  const roundLbp = (v) => Math.round((Number(v) || 0) * 100) / 100;

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

  // ── Payment methods ────────────────────────────────────────────────
  $: allowedMethods = mode === "return" ? ["cash"] : ["cash", "credit"];

  // ── Numeric values & calculations ─────────────────────────────────
  $: pNum = Number(cashPrimary) || 0;
  $: sNum = Number(cashSecondary) || 0;

  // Convert secondary → primary equivalent (exchangeRate is USD-to-LBP)
  $: sEquiv = (() => {
    if (!hasDual || sNum <= 0 || exchangeRate <= 0) return 0;
    return isLbp
      ? roundLbp(sNum * exchangeRate)    // secondary is USD → multiply to get LBP
      : roundUsd(sNum / exchangeRate);   // secondary is LBP → divide to get USD
  })();

  $: totalPaid = pNum + sEquiv;
  $: tTotal = Number(total) || 0;
  $: changeDue = Math.max(0, totalPaid - tTotal);
  $: amountShort = Math.max(0, tTotal - totalPaid);
  $: isPartialCredit = view === "cash" && totalPaid > 0 && totalPaid < tTotal && hasCustomer;
  $: creditRemainder = Math.max(0, tTotal - totalPaid);
  $: creditRemainderSecondary = (() => {
    if (!hasDual || exchangeRate <= 0 || creditRemainder <= 0) return 0;
    return isLbp
      ? roundUsd(creditRemainder / exchangeRate)
      : roundLbp(creditRemainder * exchangeRate);
  })();
  $: sufficient = view !== "cash" || totalPaid >= tTotal || isPartialCredit;

  // Change in secondary currency (for display alongside primary)
  $: changeDueSecondary = (() => {
    if (!hasDual || exchangeRate <= 0 || changeDue <= 0) return 0;
    return isLbp
      ? roundUsd(changeDue / exchangeRate)   // primary LBP → change in USD
      : roundLbp(changeDue * exchangeRate);  // primary USD → change in LBP
  })();

  // ── Focus primary input when entering cash view ───────────────────
  $: if (view === "cash" && primaryInputEl) {
    setTimeout(() => primaryInputEl?.focus?.(), 80);
  }

  // ── Reset when modal opens ────────────────────────────────────────
  $: if (isOpen) {
    // For returns (cash only), skip straight to the cash calculator
    if (allowedMethods.length === 1 && allowedMethods[0] === "cash") {
      view = "cash";
      paymentMethod = "cash";
    } else {
      view = "choose";
      paymentMethod = "cash";
    }
    cashPrimary = "";
    cashSecondary = "";
  }

  // ── Actions ────────────────────────────────────────────────────────
  function chooseCash() {
    paymentMethod = "cash";
    view = "cash";
    // Default to exact amount
    cashPrimary = isLbp ? String(Math.round(tTotal)) : String(tTotal);
    cashSecondary = "";
  }

  function chooseCredit() {
    paymentMethod = "credit";
    view = "credit";
  }

  function goBack() {
    view = "choose";
    cashPrimary = "";
    cashSecondary = "";
  }

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
      ? String(roundUsd(tTotal / exchangeRate).toFixed(2))
      : String(Math.round(roundLbp(tTotal * exchangeRate)));
  }

  function handleKeydown(e) {
    if (e.key === "Escape" && !busy) {
      if (view !== "choose" && allowedMethods.length > 1) goBack();
      else onCancel();
    }
    if (e.key === "Enter" && sufficient && !busy && view !== "choose") handleConfirm();
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

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- VIEW: Choose Payment Method                                -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        {#if view === "choose"}
          <div class="p-6 flex flex-col items-center gap-6">
            <!-- Total Amount (large) -->
            <div class="text-center relative py-2">
              <div class="absolute inset-0 bg-accent/15 blur-3xl rounded-full"></div>
              <div class="relative">
                <span class="text-5xl num-readable font-extrabold text-ink tracking-tighter drop-shadow-lg">
                  {fmtDisplay(total)}
                </span>
                <span class="text-lg text-accent font-bold ml-2">{currency}</span>
              </div>
            </div>

            <!-- Two big method buttons -->
            <div class="grid grid-cols-2 gap-4 w-full">
              <button
                class="group flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-ink/10 bg-surface-highlight/50 hover:bg-emerald-500/12 hover:border-emerald-500/40 active:scale-[0.97] transition-all duration-200"
                on:click={chooseCash}
                disabled={busy}
              >
                <div class="p-3 rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
                  <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                </div>
                <span class="font-bold text-base text-ink/90 group-hover:text-emerald-600 transition-colors">Cash</span>
              </button>

              <button
                class="group flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-ink/10 bg-surface-highlight/50 hover:bg-amber-500/12 hover:border-amber-500/40 active:scale-[0.97] transition-all duration-200"
                on:click={chooseCredit}
                disabled={busy}
              >
                <div class="p-3 rounded-full bg-amber-500 text-white shadow-lg shadow-amber-500/30">
                  <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <span class="font-bold text-base text-ink/90 group-hover:text-amber-600 transition-colors">Credit</span>
              </button>
            </div>
          </div>

          <!-- Footer: Cancel only -->
          <div class="p-5 border-t border-ink/10 bg-surface-highlight/40">
            <button
              class="w-full py-3.5 px-5 rounded-xl border border-ink/10 bg-surface-highlight/50 text-ink/75 hover:text-ink hover:bg-surface-highlight/60 font-bold transition-colors"
              on:click={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
          </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- VIEW: Credit Confirmation                                  -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        {:else if view === "credit"}
          <div class="p-6 flex flex-col items-center gap-5">
            <!-- Total -->
            <div class="text-center relative py-2">
              <div class="absolute inset-0 bg-accent/15 blur-3xl rounded-full"></div>
              <div class="relative">
                <span class="text-5xl num-readable font-extrabold text-ink tracking-tighter drop-shadow-lg">
                  {fmtDisplay(total)}
                </span>
                <span class="text-lg text-accent font-bold ml-2">{currency}</span>
              </div>
            </div>

            <!-- Credit badge -->
            <div class="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-amber-500/12 border border-amber-500/30">
              <div class="p-1.5 rounded-full bg-amber-500 text-white">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <span class="font-bold text-amber-600 text-sm">Credit Sale</span>
            </div>
          </div>

          <!-- Footer: Back + Complete -->
          <div class="p-5 border-t border-ink/10 bg-surface-highlight/40 flex gap-3">
            <button
              class="flex-1 py-3.5 px-5 rounded-xl border border-ink/10 bg-surface-highlight/50 text-ink/75 hover:text-ink hover:bg-surface-highlight/60 font-bold transition-colors"
              on:click={goBack}
              disabled={busy}
            >
              Back
            </button>
            <button
              class="flex-[2] py-3.5 px-5 rounded-xl font-bold text-lg tracking-wide transition-all
                bg-accent bg-gradient-to-r from-accent to-accent-hover text-[rgb(var(--color-accent-content))] shadow-lg shadow-accent/25 hover:shadow-accent/40 hover:scale-[1.02] active:scale-[0.98]
                {busy ? 'opacity-60 pointer-events-none' : ''}"
              on:click={handleConfirm}
              disabled={busy}
            >
              {#if busy}
                <span class="flex items-center justify-center gap-2">
                  <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Processing...
                </span>
              {:else}
                Complete Sale
              {/if}
            </button>
          </div>

        <!-- ═══════════════════════════════════════════════════════════ -->
        <!-- VIEW: Cash Calculator                                      -->
        <!-- ═══════════════════════════════════════════════════════════ -->
        {:else if view === "cash"}
          <div class="p-5 flex flex-col gap-4">
            <!-- Compact total reminder -->
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold text-muted uppercase tracking-wider">Total</span>
              <div>
                <span class="text-2xl num-readable font-extrabold text-ink">{fmtDisplay(total)}</span>
                <span class="text-sm text-accent font-bold ml-1.5">{currency}</span>
              </div>
            </div>

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

              <!-- Secondary Currency (dual mode) -->
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

              <!-- Change / Short / Partial Credit / Exact indicator -->
              {#if sufficient && changeDue > 0}
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
              {:else if isPartialCredit}
                <div class="flex items-center justify-between p-3 rounded-xl bg-amber-500/15 border border-amber-500/30">
                  <div class="flex items-center gap-2">
                    <div class="p-1 rounded-full bg-amber-500 text-white">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <span class="text-sm font-bold text-amber-600">On Credit</span>
                  </div>
                  <div class="text-right">
                    <span class="text-2xl num-readable font-extrabold text-ink">{fmtPrimary(creditRemainder)}</span>
                    {#if hasDual && creditRemainderSecondary > 0}
                      <span class="block text-sm num-readable font-semibold text-muted mt-0.5">
                        {fmtSecondary(creditRemainderSecondary)}
                      </span>
                    {/if}
                  </div>
                </div>
              {:else if sufficient && changeDue === 0 && totalPaid > 0}
                <div class="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                  <svg class="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
                  <span class="text-sm font-bold text-emerald-600">Exact amount</span>
                </div>
              {:else if !sufficient && totalPaid > 0}
                <div class="flex items-center justify-between p-3 rounded-xl bg-red-500/15 border border-red-500/30">
                  <span class="text-sm font-bold text-red-600">Short</span>
                  <span class="text-2xl num-readable font-extrabold text-ink">{fmtPrimary(amountShort)}</span>
                </div>
              {/if}
            </div>
          </div>

          <!-- Footer: Back + Complete Sale -->
          <div class="p-5 border-t border-ink/10 bg-surface-highlight/40 flex gap-3">
            {#if allowedMethods.length > 1}
              <button
                class="flex-1 py-3.5 px-5 rounded-xl border border-ink/10 bg-surface-highlight/50 text-ink/75 hover:text-ink hover:bg-surface-highlight/60 font-bold transition-colors"
                on:click={goBack}
                disabled={busy}
              >
                Back
              </button>
            {:else}
              <button
                class="flex-1 py-3.5 px-5 rounded-xl border border-ink/10 bg-surface-highlight/50 text-ink/75 hover:text-ink hover:bg-surface-highlight/60 font-bold transition-colors"
                on:click={onCancel}
                disabled={busy}
              >
                Cancel
              </button>
            {/if}
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
        {/if}
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
