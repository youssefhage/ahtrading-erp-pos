<script>
  export let isOpen = false;
  export let total = 0;
  export let currency = "USD";
  export let mode = "sale"; // "sale" | "return"
  export let busy = false;
  export let onConfirm = (method) => {}; // Pass method back
  export let onCancel = () => {};
  
  let paymentMethod = "cash";

  const fmtTotal = (v) => {
    const n = Number(v) || 0;
    if ((currency || "").toUpperCase() === "LBP") return `${Math.round(n).toLocaleString()}`;
    return `${n.toFixed(2)}`;
  };

  $: allowedMethods = mode === "return"
    ? ["cash", "card", "transfer"]
    : ["cash", "card", "transfer", "credit"];

  $: if (!allowedMethods.includes(paymentMethod)) paymentMethod = "cash";
</script>

{#if isOpen}
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 animation-fade-in">
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
        <div class="p-6 text-center border-b border-ink/10">
          <h2 class="text-2xl font-bold text-ink tracking-tight">{mode === "return" ? "Confirm Refund" : "Confirm Payment"}</h2>
          <p class="text-sm text-muted mt-1">Select your preferred payment method</p>
        </div>

        <div class="p-8 flex flex-col items-center gap-8">
          <div class="text-center relative">
            <div class="absolute inset-0 bg-accent/15 blur-3xl rounded-full"></div>
            <div class="relative">
              <span class="text-6xl num-readable font-extrabold text-ink tracking-tighter drop-shadow-lg">
                {fmtTotal(total)}
              </span>
              <span class="text-xl text-accent font-bold ml-2">{currency}</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 w-full">
            <button 
              class="group relative flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border transition-all duration-300
              {paymentMethod === 'cash' 
                ? 'bg-emerald-500/18 border-emerald-500/45 shadow-[0_10px_28px_rgba(16,185,129,0.22)]' 
                : 'bg-surface-highlight/50 border-ink/10 hover:bg-surface-highlight/60 hover:border-accent/30'}"
              on:click={() => paymentMethod = 'cash'}
              disabled={busy}
            >
              <div class="p-3 rounded-full {paymentMethod === 'cash' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/35' : 'bg-ink/5 text-ink/70 group-hover:bg-accent/15 group-hover:text-accent'} transition-all duration-300">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'cash' ? 'text-emerald-500' : 'text-ink/80 group-hover:text-ink'} transition-colors">Cash</span>
            </button>

            <button
              class="group relative flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border transition-all duration-300
              {paymentMethod === 'card'
                ? 'bg-blue-500/18 border-blue-500/45 shadow-[0_10px_28px_rgba(59,130,246,0.22)]'
                : 'bg-surface-highlight/50 border-ink/10 hover:bg-surface-highlight/60 hover:border-accent/30'}"
              on:click={() => paymentMethod = 'card'}
              disabled={busy}
            >
              <div class="p-3 rounded-full {paymentMethod === 'card' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/35' : 'bg-ink/5 text-ink/70 group-hover:bg-accent/15 group-hover:text-accent'} transition-all duration-300">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'card' ? 'text-blue-500' : 'text-ink/80 group-hover:text-ink'} transition-colors">Card</span>
            </button>

            <button
              class="group relative flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border transition-all duration-300
              {paymentMethod === 'transfer'
                ? 'bg-purple-500/18 border-purple-500/45 shadow-[0_10px_28px_rgba(168,85,247,0.22)]'
                : 'bg-surface-highlight/50 border-ink/10 hover:bg-surface-highlight/60 hover:border-accent/30'}"
              on:click={() => paymentMethod = 'transfer'}
              disabled={busy}
            >
              <div class="p-3 rounded-full {paymentMethod === 'transfer' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/35' : 'bg-ink/5 text-ink/70 group-hover:bg-accent/15 group-hover:text-accent'} transition-all duration-300">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M4 12h16M4 17h16" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'transfer' ? 'text-purple-500' : 'text-ink/80 group-hover:text-ink'} transition-colors">Transfer</span>
            </button>
            
            {#if mode !== "return"}
            <button
              class="group relative flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border transition-all duration-300
              {paymentMethod === 'credit' 
                ? 'bg-amber-500/18 border-amber-500/45 shadow-[0_10px_28px_rgba(245,158,11,0.22)]' 
                : 'bg-surface-highlight/50 border-ink/10 hover:bg-surface-highlight/60 hover:border-accent/30'}"
              on:click={() => paymentMethod = 'credit'}
              disabled={busy}
            >
              <div class="p-3 rounded-full {paymentMethod === 'credit' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/35' : 'bg-ink/5 text-ink/70 group-hover:bg-accent/15 group-hover:text-accent'} transition-all duration-300">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'credit' ? 'text-amber-500' : 'text-ink/80 group-hover:text-ink'} transition-colors">Credit</span>
            </button>
            {/if}
          </div>
        </div>

        <div class="p-6 border-t border-ink/10 bg-surface-highlight/40 flex gap-4">
          <button 
            class="flex-1 py-4 px-6 rounded-xl border border-ink/10 bg-surface-highlight/50 text-ink/75 hover:text-ink hover:bg-surface-highlight/60 font-bold transition-colors"
            on:click={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button 
            class="flex-[2] py-4 px-6 rounded-xl bg-accent bg-gradient-to-r from-accent to-accent-hover text-[rgb(var(--color-accent-content))] font-bold text-lg tracking-wide shadow-lg shadow-accent/25 hover:shadow-accent/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
            on:click={() => onConfirm(paymentMethod)}
            disabled={busy}
          >
            {mode === "return" ? "Confirm Refund" : "Complete Sale"}
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
</style>
