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
  export let customerDraft = { name: "", phone: "", email: "" };
  
  const MIN_CHARS = 2;
  const DEBOUNCE_MS = 160;

  let timer = null;
  let activeIndex = -1;
  let listEl = null;
  let itemEls = [];

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

<div class="glass-panel p-4 rounded-xl space-y-3 relative z-30">
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-bold text-muted uppercase tracking-wider">Customer</h3>
    {#if activeCustomer}
      <button 
        class="text-xs text-red-400 hover:text-red-300 transition-colors"
        on:click={() => selectCustomer(null)}
      >
        Remove
      </button>
    {/if}
  </div>

  {#if activeCustomer}
    <div class="flex items-center gap-3 p-3 rounded-lg bg-surface/50 border border-emerald-500/30">
      <div class="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm">
        {activeCustomer.name.charAt(0).toUpperCase()}
      </div>
      <div>
        <p class="font-bold text-sm">{activeCustomer.name}</p>
        <p class="text-xs text-muted">{activeCustomer.phone || activeCustomer.email || "No contact info"}</p>
      </div>
    </div>
  {:else if addCustomerMode}
    <div class="space-y-3 animation-fade-in">
      <h4 class="text-sm font-medium">New Customer</h4>
      <input 
        class="w-full bg-bg/50 border border-ink/10 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none"
        placeholder="Name *" 
        bind:value={customerDraft.name}
      />
      <input 
        class="w-full bg-bg/50 border border-ink/10 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none"
        placeholder="Phone" 
        bind:value={customerDraft.phone}
      />
      <input 
        class="w-full bg-bg/50 border border-ink/10 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none"
        placeholder="Email" 
        bind:value={customerDraft.email}
      />
      <div class="flex gap-2 justify-end">
        <button 
          class="px-3 py-1.5 text-xs text-muted hover:text-ink transition-colors"
          on:click={() => addCustomerMode = false}
        >
          Cancel
        </button>
        <button 
          class="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors font-medium"
          on:click={createCustomer}
        >
          Save
        </button>
      </div>
    </div>
  {:else}
    <div class="relative">
      <div class="flex gap-2">
        <input 
          class="flex-1 bg-bg/50 border border-ink/10 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none"
          placeholder="Search customer..." 
          bind:value={customerSearch}
          on:keydown={onInputKeyDown}
          on:input={() => scheduleSearch(false)}
          aria-expanded={customerResults.length > 0}
          aria-activedescendant={activeIndex >= 0 ? `custopt-${activeIndex}` : undefined}
        />
        <button 
          class="p-2 bg-surface hover:bg-ink/5 rounded-lg border border-ink/10 transition-colors"
          on:click={() => scheduleSearch(true)}
          title="Search"
          aria-label="Search"
        >
          {#if customerSearching}
            <svg class="w-5 h-5 text-muted animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4V2m0 20v-2m10-8h-2M4 12H2m17.657-5.657-1.414 1.414M7.757 16.243l-1.414 1.414m0-11.314L7.757 7.757m9.9 9.9 1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" />
            </svg>
          {:else}
            <svg class="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          {/if}
        </button>
      </div>

      {#if (customerSearch || "").trim().length > 0 && (customerSearch || "").trim().length < MIN_CHARS}
        <div class="mt-2 text-xs text-muted">
          Type at least {MIN_CHARS} characters…
        </div>
      {/if}
      
      {#if customerResults.length > 0}
        <div
          class="absolute top-full left-0 right-0 mt-2 glass-popover rounded-xl z-[60] max-h-72 overflow-y-auto"
          bind:this={listEl}
          role="listbox"
        >
          {#each customerResults as customer, i}
            <button 
              id={`custopt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              bind:this={itemEls[i]}
              class={`w-full text-left p-3 transition-colors border-b border-ink/10 last:border-0 outline-none ${
                i === activeIndex
                  ? "bg-accent/20 ring-1 ring-accent/30 border-l-2 border-l-accent"
                  : "hover:bg-ink/5 border-l-2 border-l-transparent"
              }`}
              on:click={() => selectCustomer(customer)}
              on:mousedown|preventDefault={() => selectCustomer(customer)}
            >
              <div class="flex items-center justify-between gap-3">
                <p class="font-extrabold text-sm text-ink truncate">{customer.name}</p>
                {#if customer.loyalty_points != null}
                  <span class="text-[11px] text-ink/70 whitespace-nowrap bg-ink/5 border border-ink/10 rounded-full px-2 py-0.5">
                    {customer.loyalty_points} pts
                  </span>
                {/if}
              </div>
              <p class="text-[12px] text-ink/70 truncate">
                {customer.phone || customer.email || "-"}
              </p>
            </button>
          {/each}
        </div>
      {/if}

      <div class="mt-2 text-center">
        <button 
          class="text-xs text-accent hover:text-accent-hover transition-colors"
          on:click={() => addCustomerMode = true}
        >
          + Create new customer
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .animation-fade-in {
    animation: fadeIn 0.2s ease-out;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
