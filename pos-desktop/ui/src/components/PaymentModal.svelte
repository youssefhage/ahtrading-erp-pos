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
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 animation-fade-in">
    <!-- Backdrop with blur -->
    <button
      class="absolute inset-0 bg-black/60 backdrop-blur-md transition-all duration-300"
      type="button"
      aria-label="Close payment"
      on:click={onCancel}
    ></button>

    <!-- Modal Content -->
    <div class="relative w-full max-w-lg glass-panel rounded-3xl shadow-2xl overflow-hidden transform transition-all scale-100 opacity-100 z-10 border border-white/10 bg-surface/40">
      <div class="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none"></div>
      
      <div class="relative z-10">
        <div class="p-6 text-center border-b border-white/5">
          <h2 class="text-2xl font-bold text-white tracking-tight">{mode === "return" ? "Confirm Refund" : "Confirm Payment"}</h2>
          <p class="text-sm text-gray-400 mt-1">Select your preferred payment method</p>
        </div>

        <div class="p-8 flex flex-col items-center gap-8">
          <div class="text-center relative">
            <div class="absolute inset-0 bg-accent/20 blur-3xl rounded-full"></div>
            <div class="relative">
              <span class="text-6xl num-readable font-extrabold text-white tracking-tighter drop-shadow-lg">
                {fmtTotal(total)}
              </span>
              <span class="text-xl text-accent font-bold ml-2">{currency}</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 w-full">
            <button 
              class="group relative flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border transition-all duration-300
              {paymentMethod === 'cash' 
                ? 'bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.2)]' 
                : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}"
              on:click={() => paymentMethod = 'cash'}
            >
              <div class="p-3 rounded-full {paymentMethod === 'cash' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30' : 'bg-white/5 text-gray-400 group-hover:bg-white/10 group-hover:text-white'} transition-all duration-300">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'cash' ? 'text-emerald-400' : 'text-gray-400 group-hover:text-white'} transition-colors">Cash</span>
            </button>

            <button
              class="group relative flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border transition-all duration-300
              {paymentMethod === 'card'
                ? 'bg-blue-500/20 border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
                : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}"
              on:click={() => paymentMethod = 'card'}
            >
              <div class="p-3 rounded-full {paymentMethod === 'card' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30' : 'bg-white/5 text-gray-400 group-hover:bg-white/10 group-hover:text-white'} transition-all duration-300">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'card' ? 'text-blue-400' : 'text-gray-400 group-hover:text-white'} transition-colors">Card</span>
            </button>

            <button
              class="group relative flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border transition-all duration-300
              {paymentMethod === 'transfer'
                ? 'bg-purple-500/20 border-purple-500/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}"
              on:click={() => paymentMethod = 'transfer'}
            >
              <div class="p-3 rounded-full {paymentMethod === 'transfer' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30' : 'bg-white/5 text-gray-400 group-hover:bg-white/10 group-hover:text-white'} transition-all duration-300">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M4 12h16M4 17h16" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'transfer' ? 'text-purple-400' : 'text-gray-400 group-hover:text-white'} transition-colors">Transfer</span>
            </button>
            
            {#if mode !== "return"}
            <button
              class="group relative flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border transition-all duration-300
              {paymentMethod === 'credit' 
                ? 'bg-amber-500/20 border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.2)]' 
                : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}"
              on:click={() => paymentMethod = 'credit'}
            >
              <div class="p-3 rounded-full {paymentMethod === 'credit' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30' : 'bg-white/5 text-gray-400 group-hover:bg-white/10 group-hover:text-white'} transition-all duration-300">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <span class="font-bold text-sm tracking-wide {paymentMethod === 'credit' ? 'text-amber-400' : 'text-gray-400 group-hover:text-white'} transition-colors">Credit</span>
            </button>
            {/if}
          </div>
        </div>

        <div class="p-6 border-t border-white/5 bg-black/20 flex gap-4">
          <button 
            class="flex-1 py-4 px-6 rounded-xl border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 font-bold transition-colors"
            on:click={onCancel}
          >
            Cancel
          </button>
          <button 
            class="flex-[2] py-4 px-6 rounded-xl bg-gradient-to-r from-accent to-accent-hover text-white font-bold text-lg tracking-wide shadow-lg shadow-accent/25 hover:shadow-accent/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
            on:click={() => onConfirm(paymentMethod)}
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
