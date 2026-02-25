<script>
  export let isOpen = false;
  export let total = 0;
  export let currency = "USD";
  export let mode = "sale"; // "sale" | "return"
  export let busy = false;
  export let lineCount = 0;
  export let customerName = "";
  export let onConfirm = (method, cashTendered) => {};
  export let onCancel = () => {};

  let paymentMethod = "cash";
  let cashTendered = "";
  let cashInputEl;

  const fmtTotal = (v) => {
    const n = Number(v) || 0;
    if ((currency || "").toUpperCase() === "LBP") return `${Math.round(n).toLocaleString()}`;
    return `${n.toFixed(2)}`;
  };

  const fmtChange = (v) => {
    const n = Number(v) || 0;
    if ((currency || "").toUpperCase() === "LBP") return `${Math.round(n).toLocaleString()} LBP`;
    return `$${n.toFixed(2)}`;
  };

  const quickAmounts = (currency || "").toUpperCase() === "LBP"
    ? [50000, 100000, 250000, 500000, 1000000]
    : [5, 10, 20, 50, 100];

  $: allowedMethods = mode === "return"
    ? ["cash", "card", "transfer"]
    : ["cash", "card", "transfer", "credit"];

  $: if (!allowedMethods.includes(paymentMethod)) paymentMethod = "cash";

  $: cashNum = Number(cashTendered) || 0;
  $: changeDue = Math.max(0, cashNum - (Number(total) || 0));
  $: cashSufficient = paymentMethod !== "cash" || cashNum >= (Number(total) || 0);

  // Focus cash input when switching to cash method
  $: if (paymentMethod === "cash" && cashInputEl) {
    setTimeout(() => cashInputEl?.focus?.(), 50);
  }

  // Reset cash tendered when modal opens/closes
  $: if (isOpen) {
    cashTendered = "";
  }

  function handleConfirm() {
    if (paymentMethod === "cash") {
      onConfirm(paymentMethod, cashNum);
    } else {
      onConfirm(paymentMethod, 0);
    }
  }

  function setQuickAmount(amount) {
    cashTendered = String(amount);
  }

  function setExactAmount() {
    cashTendered = String(Number(total) || 0);
  }

  function handleKeydown(e) {
    if (e.key === "Escape" && !busy) {
      onCancel();
    }
    if (e.key === "Enter" && cashSufficient && !busy) {
      handleConfirm();
    }
  }
</script>

<svelte:window on:keydown={isOpen ? handleKeydown : undefined} />

{#if isOpen}
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 animation-fade-in" role="dialog" aria-modal="true" aria-label={mode === "return" ? "Confirm Refund" : "Confirm Payment"}>
    <!-- Backdrop with blur -->
    <button
      class="absolute inset-0 bg-black/55 backdrop-blur-md transition-all duration-300"
      type="button"
      aria-label="Close payment"
      on:click={onCancel}
      disabled={busy}
    ></button>

    <!-- Modal Content -->
    <div class="relative w-full max-w-lg glass-panel rounded-3xl shadow-2xl overflow-hidden transform transition-all scale-100 opacity-100 z-10 border border-ink/10 bg-surface/70">
      <div class="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent pointer-events-none"></div>

      <div class="relative z-10">
        <!-- Header -->
        <div class="p-5 text-center border-b border-ink/10">
          <h2 class="text-2xl font-bold text-ink tracking-tight">{mode === "return" ? "Confirm Refund" : "Confirm Payment"}</h2>
          <div class="flex items-center justify-center gap-3 mt-1.5 text-sm text-muted">
            <span>{lineCount} item{lineCount !== 1 ? 's' : ''}</span>
            {#if customerName}
              <span class="w-1 h-1 rounded-full bg-ink/20"></span>
              <span class="text-ink/70 font-medium">{customerName}</span>
            {/if}
          </div>
        </div>

        <div class="p-6 flex flex-col items-center gap-6">
          <!-- Total Amount -->
          <div class="text-center relative">
            <div class="absolute inset-0 bg-accent/15 blur-3xl rounded-full"></div>
            <div class="relative">
              <span class="text-5xl num-readable font-extrabold text-ink tracking-tighter drop-shadow-lg">
                {fmtTotal(total)}
              </span>
              <span class="text-lg text-accent font-bold ml-2">{currency}</span>
            </div>
          </div>

          <!-- Payment Methods -->
          <div class="grid grid-cols-2 gap-3 w-full">
            <button
              class="group relative flex flex-col items-center justify-center gap-2.5 p-4 rounded-2xl border transition-all duration-300
              {paymentMethod === 'cash'
                ? 'bg-emerald-500/18 border-emerald-500/45 shadow-[0_10px_28px_rgba(16,185,129,0.22)]'
                : 'bg-surface-highlight/50 border-ink/10 hover:bg-surface-highlight/60 hover:border-accent/30'}"
              on:click={() => paymentMethod = 'cash'}
              disabled={busy}
            >
              <div class="p-2.5 rounded-full {paymentMethod === 'cash' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/35' : 'bg-ink/5 text-ink/70 group-hover:bg-accent/15 group-hover:text-accent'} transition-all duration-300">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'cash' ? 'text-emerald-500' : 'text-ink/80 group-hover:text-ink'} transition-colors">Cash</span>
            </button>

            <button
              class="group relative flex flex-col items-center justify-center gap-2.5 p-4 rounded-2xl border transition-all duration-300
              {paymentMethod === 'card'
                ? 'bg-blue-500/18 border-blue-500/45 shadow-[0_10px_28px_rgba(59,130,246,0.22)]'
                : 'bg-surface-highlight/50 border-ink/10 hover:bg-surface-highlight/60 hover:border-accent/30'}"
              on:click={() => paymentMethod = 'card'}
              disabled={busy}
            >
              <div class="p-2.5 rounded-full {paymentMethod === 'card' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/35' : 'bg-ink/5 text-ink/70 group-hover:bg-accent/15 group-hover:text-accent'} transition-all duration-300">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'card' ? 'text-blue-500' : 'text-ink/80 group-hover:text-ink'} transition-colors">Card</span>
            </button>

            <button
              class="group relative flex flex-col items-center justify-center gap-2.5 p-4 rounded-2xl border transition-all duration-300
              {paymentMethod === 'transfer'
                ? 'bg-purple-500/18 border-purple-500/45 shadow-[0_10px_28px_rgba(168,85,247,0.22)]'
                : 'bg-surface-highlight/50 border-ink/10 hover:bg-surface-highlight/60 hover:border-accent/30'}"
              on:click={() => paymentMethod = 'transfer'}
              disabled={busy}
            >
              <div class="p-2.5 rounded-full {paymentMethod === 'transfer' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/35' : 'bg-ink/5 text-ink/70 group-hover:bg-accent/15 group-hover:text-accent'} transition-all duration-300">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'transfer' ? 'text-purple-500' : 'text-ink/80 group-hover:text-ink'} transition-colors">Transfer</span>
            </button>

            {#if mode !== "return"}
            <button
              class="group relative flex flex-col items-center justify-center gap-2.5 p-4 rounded-2xl border transition-all duration-300
              {paymentMethod === 'credit'
                ? 'bg-amber-500/18 border-amber-500/45 shadow-[0_10px_28px_rgba(245,158,11,0.22)]'
                : 'bg-surface-highlight/50 border-ink/10 hover:bg-surface-highlight/60 hover:border-accent/30'}"
              on:click={() => paymentMethod = 'credit'}
              disabled={busy}
            >
              <div class="p-2.5 rounded-full {paymentMethod === 'credit' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/35' : 'bg-ink/5 text-ink/70 group-hover:bg-accent/15 group-hover:text-accent'} transition-all duration-300">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'credit' ? 'text-amber-500' : 'text-ink/80 group-hover:text-ink'} transition-colors">Credit</span>
            </button>
            {/if}
          </div>

          <!-- Cash Tendered Section (only for cash payments) -->
          {#if paymentMethod === "cash"}
            <div class="w-full space-y-3 p-4 rounded-2xl bg-surface-highlight/30 border border-white/5">
              <label class="block">
                <span class="text-xs font-bold uppercase tracking-wider text-muted mb-1.5 block">Cash Tendered</span>
                <div class="relative">
                  <span class="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-bold">{(currency || "").toUpperCase() === "LBP" ? "LBP" : "$"}</span>
                  <input
                    bind:this={cashInputEl}
                    type="number"
                    step="any"
                    min="0"
                    bind:value={cashTendered}
                    placeholder="0.00"
                    class="w-full pl-12 pr-4 py-3 rounded-xl bg-surface/60 border border-white/10 focus:border-accent/50 focus:ring-2 focus:ring-accent/30 text-2xl num-readable font-bold text-ink text-right focus:outline-none transition-all"
                    disabled={busy}
                  />
                </div>
              </label>

              <!-- Quick Amount Buttons -->
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="flex-1 min-w-[60px] py-2.5 rounded-xl text-sm font-bold border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition-all"
                  on:click={setExactAmount}
                  disabled={busy}
                >
                  Exact
                </button>
                {#each quickAmounts as amt}
                  <button
                    type="button"
                    class="flex-1 min-w-[60px] py-2.5 rounded-xl text-sm font-bold num-readable border border-white/10 bg-surface-highlight/50 text-ink/80 hover:bg-surface-highlight/70 hover:border-accent/30 hover:text-ink active:scale-95 transition-all"
                    on:click={() => setQuickAmount(amt)}
                    disabled={busy}
                  >
                    {(currency || "").toUpperCase() === "LBP" ? `${(amt/1000).toFixed(0)}K` : `$${amt}`}
                  </button>
                {/each}
              </div>

              <!-- Change Due -->
              {#if cashNum > 0}
                <div class="flex items-center justify-between p-3 rounded-xl {cashSufficient ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}">
                  <span class="text-sm font-bold {cashSufficient ? 'text-emerald-400' : 'text-red-400'}">
                    {cashSufficient ? 'Change Due' : 'Amount Short'}
                  </span>
                  <span class="text-2xl num-readable font-extrabold {cashSufficient ? 'text-emerald-300' : 'text-red-300'}">
                    {cashSufficient ? fmtChange(changeDue) : fmtChange((Number(total) || 0) - cashNum)}
                  </span>
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
              {cashSufficient && !busy
                ? 'bg-accent bg-gradient-to-r from-accent to-accent-hover text-[rgb(var(--color-accent-content))] shadow-lg shadow-accent/25 hover:shadow-accent/40 hover:scale-[1.02] active:scale-[0.98]'
                : 'bg-surface-highlight/60 text-ink/40 cursor-not-allowed'}"
            on:click={handleConfirm}
            disabled={!cashSufficient || busy}
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
