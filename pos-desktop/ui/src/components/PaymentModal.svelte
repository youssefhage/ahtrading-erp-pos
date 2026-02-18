<script>
  export let isOpen = false;
  export let total = 0;
  export let currency = "USD";
  export let mode = "sale"; // "sale" | "return"
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
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- Backdrop -->
    <button
      class="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
      type="button"
      aria-label="Close payment"
      on:click={onCancel}
    ></button>

    <!-- Modal Content -->
    <div class="relative w-full max-w-md bg-surface border border-ink/10 rounded-2xl shadow-2xl overflow-hidden transform transition-all scale-100 opacity-100 z-10">
      <div class="p-6 border-b border-ink/10 text-center">
        <h2 class="text-xl font-bold text-ink">{mode === "return" ? "Confirm Refund" : "Confirm Payment"}</h2>
        <p class="text-sm text-muted mt-1">Select method</p>
      </div>

      <div class="p-8 flex flex-col items-center gap-6">
        <div class="text-center">
          <span class="text-5xl num-readable font-bold text-ink tracking-tighter">
            {fmtTotal(total)}
          </span>
          <span class="text-lg text-muted font-medium ml-2">{currency}</span>
        </div>

        <div class="grid grid-cols-2 gap-4 w-full">
          <button 
            class="flex flex-col items-center justify-center gap-3 p-4 rounded-xl border transition-all duration-200
            {paymentMethod === 'cash' 
              ? 'bg-accent/10 border-accent text-accent shadow-[0_0_20px_rgba(6,182,212,0.15)]' 
              : 'bg-ink/5 border-transparent text-muted hover:bg-ink/10 hover:text-ink'}"
            on:click={() => paymentMethod = 'cash'}
          >
            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            <span class="font-medium text-sm">Cash</span>
          </button>

          <button
            class="flex flex-col items-center justify-center gap-3 p-4 rounded-xl border transition-all duration-200
            {paymentMethod === 'card'
              ? 'bg-accent/10 border-accent text-accent shadow-[0_0_20px_rgba(6,182,212,0.15)]'
              : 'bg-ink/5 border-transparent text-muted hover:bg-ink/10 hover:text-ink'}"
            on:click={() => paymentMethod = 'card'}
          >
            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
            <span class="font-medium text-sm">Card</span>
          </button>

          <button
            class="flex flex-col items-center justify-center gap-3 p-4 rounded-xl border transition-all duration-200
            {paymentMethod === 'transfer'
              ? 'bg-accent/10 border-accent text-accent shadow-[0_0_20px_rgba(6,182,212,0.15)]'
              : 'bg-ink/5 border-transparent text-muted hover:bg-ink/10 hover:text-ink'}"
            on:click={() => paymentMethod = 'transfer'}
          >
            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7h16M4 12h16M4 17h16" /></svg>
            <span class="font-medium text-sm">Transfer</span>
          </button>
          
          {#if mode !== "return"}
          <button
            class="flex flex-col items-center justify-center gap-3 p-4 rounded-xl border transition-all duration-200
            {paymentMethod === 'credit' 
              ? 'bg-accent/10 border-accent text-accent shadow-[0_0_20px_rgba(6,182,212,0.15)]' 
              : 'bg-ink/5 border-transparent text-muted hover:bg-ink/10 hover:text-ink'}"
            on:click={() => paymentMethod = 'credit'}
          >
            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
            <span class="font-medium text-sm">Credit</span>
          </button>
          {/if}
        </div>
      </div>

      <div class="p-6 border-t border-ink/10 bg-surface/50 flex gap-3">
        <button 
          class="flex-1 py-3 px-4 rounded-xl border border-ink/10 text-muted hover:text-ink hover:bg-ink/5 font-medium transition-colors"
          on:click={onCancel}
        >
          Cancel
        </button>
        <button 
          class="flex-[2] py-3 px-4 rounded-xl bg-accent text-white font-bold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98]"
          on:click={() => onConfirm(paymentMethod)}
        >
          {mode === "return" ? "Complete Return" : "Complete Sale"}
        </button>
      </div>
    </div>
  </div>
{/if}
