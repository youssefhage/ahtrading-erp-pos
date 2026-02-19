<script>
  import { onDestroy, tick } from "svelte";

  export let activeCustomer = null;
  export let customerResults = [];
  export let customerSearch = "";
  export let addCustomerMode = false;
  export let customerSearching = false;
  
  export let searchCustomers = () => {};
  export let selectCustomer = (c) => {};
  export let createCustomer = () => {};
  export let customerDraft = {
    name: "",
    phone: "",
    email: "",
    party_type: "individual",
    customer_type: "retail",
    legal_name: "",
    membership_no: "",
    payment_terms_days: "",
    tax_id: "",
    vat_no: "",
    notes: "",
    marketing_opt_in: false,
    is_active: true,
  };
  
  const MIN_CHARS = 2;
  const DEBOUNCE_MS = 160;

  let timer = null;
  let activeIndex = -1;
  let listEl = null;
  let itemEls = [];
  let newCustomerNameEl = null;
  let showAdvancedFields = false;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleSearch = (immediate = false) => {
    clearTimer();
    activeIndex = -1;
    const q = (customerSearch || "").trim();
    if (q.length < MIN_CHARS) return;
    if (immediate) {
      searchCustomers();
      return;
    }
    timer = setTimeout(() => searchCustomers(), DEBOUNCE_MS);
  };

  const onInputKeyDown = (e) => {
    if (!e) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if ((customerResults || []).length === 0) scheduleSearch(true);
      activeIndex = Math.min((customerResults || []).length - 1, Math.max(0, activeIndex + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      return;
    }
    if (e.key === "Enter") {
      if (activeIndex >= 0 && (customerResults || [])[activeIndex]) {
        e.preventDefault();
        selectCustomer(customerResults[activeIndex]);
        return;
      }
      scheduleSearch(true);
      return;
    }
    if (e.key === "Escape") {
      activeIndex = -1;
      return;
    }
  };

  $: if (!activeCustomer && !addCustomerMode) {
    const q = (customerSearch || "").trim();
    if (q.length === 0) {
      clearTimer();
      activeIndex = -1;
    } else {
      scheduleSearch(false);
    }
  }

  $: if ((customerResults || []).length > 0 && activeIndex >= customerResults.length) {
    activeIndex = customerResults.length - 1;
  }

  $: if (addCustomerMode) {
    tick().then(() => {
      // Avoid `autofocus` attr; focus programmatically when the form appears.
      newCustomerNameEl?.focus?.();
    });
  }

  $: if (!addCustomerMode) {
    showAdvancedFields = false;
  }

  // Keep the highlighted row visible while using arrow keys.
  $: (async () => {
    if (!listEl) return;
    if (activeIndex < 0) return;
    await tick();
    const el = itemEls?.[activeIndex];
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: "nearest" });
    }
  })();

  onDestroy(() => clearTimer());
</script>

<div class="glass-panel p-5 rounded-[2rem] space-y-5 relative z-30 group/customer transition-all duration-300 hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-white/5 bg-surface/30 backdrop-blur-md">
  <div class="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-transparent opacity-50 rounded-[2rem] pointer-events-none"></div>

  <div class="relative z-10 flex items-center justify-between">
    <div class="flex items-center gap-3">
       <div class="h-6 w-1 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
       <h3 class="text-xs font-bold text-muted uppercase tracking-[0.2em]">Customer</h3>
    </div>
    {#if activeCustomer}
      <button 
        class="text-[10px] font-bold uppercase tracking-wider text-red-400 hover:text-red-300 transition-colors bg-red-500/10 hover:bg-red-500/20 px-2 py-1 rounded-lg border border-red-500/20"
        on:click={() => selectCustomer(null)}
      >
        Remove
      </button>
    {/if}
  </div>

  {#if activeCustomer}
    <div class="relative z-10 flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 shadow-inner group-hover/customer:border-indigo-500/30 transition-colors">
      <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-indigo-500/25">
        {activeCustomer.name.charAt(0).toUpperCase()}
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-bold text-lg text-ink truncate tracking-tight">{activeCustomer.name}</p>
        <div class="flex items-center gap-2 text-xs text-muted/80">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
          <span class="truncate">{activeCustomer.phone || activeCustomer.email || "No contact info"}</span>
        </div>
      </div>
      {#if activeCustomer.loyalty_points}
         <div class="flex flex-col items-end">
            <span class="text-[10px] uppercase font-bold text-muted tracking-wider">Points</span>
            <span class="text-indigo-400 font-bold font-mono">{activeCustomer.loyalty_points}</span>
         </div>
      {/if}
    </div>
  {:else if addCustomerMode}
    <div class="relative z-10 space-y-3 animation-fade-in bg-surface/20 p-4 rounded-2xl border border-white/5">
      <h4 class="text-sm font-bold text-ink">New Customer</h4>
      <div class="space-y-2">
        <input 
          class="w-full bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all placeholder-muted/50"
          placeholder="Name *" 
          bind:value={customerDraft.name}
          bind:this={newCustomerNameEl}
        />
        <div class="grid grid-cols-2 gap-2">
          <input 
            class="w-full bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all placeholder-muted/50"
            placeholder="Phone" 
            bind:value={customerDraft.phone}
          />
          <input 
            class="w-full bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all placeholder-muted/50"
            placeholder="Email" 
            bind:value={customerDraft.email}
          />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="sr-only">Party Type</span>
            <select
              class="w-full bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all"
              bind:value={customerDraft.party_type}
            >
              <option value="individual">Individual</option>
              <option value="business">Business</option>
            </select>
          </label>
          <label class="block">
            <span class="sr-only">Customer Type</span>
            <select
              class="w-full bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all"
              bind:value={customerDraft.customer_type}
            >
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="b2b">B2B</option>
            </select>
          </label>
        </div>
        <button
          class="w-full px-3 py-2 rounded-xl border border-white/10 text-xs font-semibold text-muted hover:text-ink hover:border-indigo-500/30 transition-colors flex items-center justify-between"
          on:click={() => (showAdvancedFields = !showAdvancedFields)}
          type="button"
        >
          <span>Advanced details</span>
          <span class={`transition-transform ${showAdvancedFields ? "rotate-180" : ""}`}>v</span>
        </button>
        {#if showAdvancedFields}
          <div class="space-y-2 pt-1">
            <div class="grid grid-cols-2 gap-2">
              <input
                class="w-full bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all placeholder-muted/50"
                placeholder="Membership No."
                bind:value={customerDraft.membership_no}
              />
              <input
                class="w-full bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all placeholder-muted/50"
                placeholder="Legal Name"
                bind:value={customerDraft.legal_name}
              />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <input
                class="w-full bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all placeholder-muted/50"
                type="number"
                min="0"
                step="1"
                placeholder="Payment Terms (days)"
                bind:value={customerDraft.payment_terms_days}
              />
              <input
                class="w-full bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all placeholder-muted/50"
                placeholder="Tax ID"
                bind:value={customerDraft.tax_id}
              />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <input
                class="w-full bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all placeholder-muted/50"
                placeholder="VAT No."
                bind:value={customerDraft.vat_no}
              />
              <label class="flex items-center gap-2 rounded-xl border border-white/10 bg-bg/40 px-3 py-2.5 text-xs text-muted">
                <input
                  class="h-3.5 w-3.5 rounded border-white/20 bg-bg/70"
                  type="checkbox"
                  bind:checked={customerDraft.marketing_opt_in}
                />
                Marketing opt-in
              </label>
            </div>
            <textarea
              class="w-full min-h-[70px] resize-y bg-bg/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all placeholder-muted/50"
              placeholder="Notes"
              bind:value={customerDraft.notes}
            ></textarea>
          </div>
        {/if}
      </div>
      <div class="flex gap-2 justify-end pt-1">
        <button 
          class="px-4 py-2 text-xs font-semibold text-muted hover:text-ink transition-colors"
          on:click={() => addCustomerMode = false}
        >
          Cancel
        </button>
        <button 
          class="px-4 py-2 text-xs bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/25 transition-all font-bold tracking-wide active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={createCustomer}
          disabled={!String(customerDraft.name || "").trim()}
        >
          Save Customer
        </button>
      </div>
    </div>
  {:else}
    <div class="relative z-10">
      <div class="flex gap-2 relative z-50">
        <div class="relative flex-1 group/search">
           <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg class="h-4 w-4 text-muted group-focus-within/search:text-indigo-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
           </div>
          <input 
            class="w-full bg-bg/50 border border-white/10 rounded-xl pl-9 pr-3 py-3 text-sm shadow-inner focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:outline-none transition-all placeholder-muted/50"
            placeholder="Search customer by name or phone..." 
            bind:value={customerSearch}
            on:keydown={onInputKeyDown}
            on:input={() => scheduleSearch(false)}
            aria-expanded={customerResults.length > 0}
            aria-activedescendant={activeIndex >= 0 ? `custopt-${activeIndex}` : undefined}
          />
        </div>
        <button 
          class="p-3 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/20 transition-all hover:shadow-[0_0_15px_rgba(99,102,241,0.15)] active:scale-[0.95]"
          on:click={() => scheduleSearch(true)}
          title="Search"
          aria-label="Search"
        >
          {#if customerSearching}
            <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4V2m0 20v-2m10-8h-2M4 12H2m17.657-5.657-1.414 1.414M7.757 16.243l-1.414 1.414m0-11.314L7.757 7.757m9.9 9.9 1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" />
            </svg>
          {:else}
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          {/if}
        </button>
      </div>

      {#if (customerSearch || "").trim().length > 0 && (customerSearch || "").trim().length < MIN_CHARS}
        <div class="mt-2 text-xs text-muted/60 pl-1 italic">
          Type at least {MIN_CHARS} characters…
        </div>
      {/if}
      
      {#if customerResults.length > 0}
        <div
          class="absolute top-full left-0 right-0 mt-3 glass-popover rounded-xl z-[60] max-h-72 overflow-y-auto custom-scrollbar shadow-2xl ring-1 ring-black/5"
          bind:this={listEl}
          role="listbox"
        >
          {#each customerResults as customer, i}
            <button 
              id={`custopt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              bind:this={itemEls[i]}
              class={`w-full text-left p-3.5 transition-all outline-none border-l-2 flex items-center justify-between group/opt ${
                i === activeIndex
                  ? "bg-indigo-500/10 border-indigo-500"
                  : "hover:bg-white/5 border-transparent hover:border-white/10"
              }`}
              on:click={() => selectCustomer(customer)}
              on:mousedown|preventDefault={() => selectCustomer(customer)}
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class={`font-bold text-sm truncate transition-colors ${i === activeIndex ? "text-indigo-300" : "text-ink group-hover/opt:text-indigo-200"}`}>{customer.name}</p>
                </div>
                <p class="text-xs text-muted group-hover/opt:text-muted/80 truncate mt-0.5 font-mono">
                  {customer.phone || customer.email || "-"}
                </p>
              </div>
              {#if customer.loyalty_points != null}
                <span class="shrink-0 text-[10px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-md px-1.5 py-0.5">
                  {customer.loyalty_points} pts
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}

      <div class="mt-4 text-center">
        <button 
          class="text-xs font-bold uppercase tracking-wide text-indigo-400 hover:text-indigo-300 transition-colors flex items-center justify-center gap-1 mx-auto group/create"
          on:click={() => addCustomerMode = true}
        >
          <span class="bg-indigo-500/10 rounded-full p-1 group-hover/create:bg-indigo-500/20 transition-colors">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
          </span>
          Create new customer
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .animation-fade-in {
    animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-5px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
</style>
