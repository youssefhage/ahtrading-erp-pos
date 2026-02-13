<script>
  export let officialConfig = {};
  export let unofficialConfig = {};
  export let unofficialEnabled = true;
  export let unofficialStatus = "Pending";

  export let otherAgentUrl = "";
  export let otherAgentDraftUrl = "";
  export let saveOtherAgent = async () => {};

  export let saveConfigFor = async (companyKey, payload) => {};
  export let testEdgeFor = async (companyKey) => {};
  export let syncPullFor = async (companyKey) => {};
  export let syncPushFor = async (companyKey) => {};

  let off = {};
  let un = {};

  let offTokenDraft = "";
  let unTokenDraft = "";
  let offClearToken = false;
  let unClearToken = false;

  let busy = false;
  let notice = "";
  let err = "";

  let testOff = null;
  let testUn = null;
  $: edgeOff = summarizeEdge(testOff);
  $: edgeUn = summarizeEdge(testUn);

  const normalizeUrl = (v) => {
    const t = String(v || "").trim();
    return t;
  };

  const copyFrom = (cfg) => ({
    api_base_url: String(cfg?.api_base_url || "").trim(),
    company_id: String(cfg?.company_id || "").trim(),
    device_id: String(cfg?.device_id || "").trim(),
    warehouse_id: String(cfg?.warehouse_id || "").trim(),
    branch_id: String(cfg?.branch_id || "").trim(),
    device_code: String(cfg?.device_code || "").trim(),
    pricing_currency: String(cfg?.pricing_currency || "").trim(),
    exchange_rate: cfg?.exchange_rate ?? "",
    vat_rate: cfg?.vat_rate ?? "",
  });

  const hasTokenText = (cfg) => (cfg?.has_device_token ? "Set" : "Not set");

  $: off = copyFrom(officialConfig);
  $: un = copyFrom(unofficialConfig);

  const pillTone = (kind) => {
    if (kind === "ok") return "bg-emerald-500/10 border-emerald-500/25 text-ink/80";
    if (kind === "warn") return "bg-amber-500/10 border-amber-500/25 text-ink/80";
    if (kind === "bad") return "bg-red-500/10 border-red-500/25 text-ink/80";
    return "bg-ink/5 border-ink/10 text-muted";
  };

  const summarizeEdge = (st) => {
    if (!st) return { kind: "neutral", text: "Not tested" };
    if (st.error) return { kind: "bad", text: st.error };
    const ok = !!st.edge_ok;
    const auth = !!st.edge_auth_ok;
    if (!ok) return { kind: "bad", text: "Offline" };
    if (ok && !auth) return { kind: "warn", text: "Online (auth failed)" };
    return { kind: "ok", text: "Online" };
  };

  const saveOne = async (companyKey) => {
    busy = true;
    err = "";
    notice = "";
    try {
      const payload = companyKey === "official" ? { ...off } : { ...un };

      // Only write token if user explicitly supplies one or clears it.
      if (companyKey === "official") {
        if (offClearToken) payload.device_token = "";
        else if (String(offTokenDraft || "").trim()) payload.device_token = String(offTokenDraft || "").trim();
      } else {
        if (unClearToken) payload.device_token = "";
        else if (String(unTokenDraft || "").trim()) payload.device_token = String(unTokenDraft || "").trim();
      }

      await saveConfigFor(companyKey, payload);
      notice = `${companyKey} saved`;

      // Clear token drafts after save.
      if (companyKey === "official") { offTokenDraft = ""; offClearToken = false; }
      else { unTokenDraft = ""; unClearToken = false; }
    } catch (e) {
      err = e?.message || String(e);
    } finally {
      busy = false;
    }
  };

  const runTest = async (companyKey) => {
    busy = true;
    err = "";
    try {
      const st = await testEdgeFor(companyKey);
      if (companyKey === "official") testOff = st;
      else testUn = st;
    } catch (e) {
      err = e?.message || String(e);
    } finally {
      busy = false;
    }
  };

  const runPull = async (companyKey) => {
    busy = true;
    err = "";
    notice = "";
    try {
      await syncPullFor(companyKey);
      notice = `${companyKey} pulled`;
    } catch (e) {
      err = e?.message || String(e);
    } finally {
      busy = false;
    }
  };

  const runPush = async (companyKey) => {
    busy = true;
    err = "";
    notice = "";
    try {
      await syncPushFor(companyKey);
      notice = `${companyKey} pushed`;
    } catch (e) {
      err = e?.message || String(e);
    } finally {
      busy = false;
    }
  };
</script>

<div class="h-full w-full overflow-hidden grid grid-cols-1 xl:grid-cols-[minmax(520px,720px)_1fr] gap-6">
  <!-- Left column: how it works + other agent -->
  <section class="glass-panel rounded-2xl p-4 overflow-hidden flex flex-col">
    <header class="pb-3 border-b border-ink/10">
      <h2 class="text-lg font-extrabold tracking-tight">Settings</h2>
      <p class="text-sm text-muted mt-1">
        The POS UI talks to local agents. Each agent syncs to either On-Prem Edge or Cloud via <span class="font-mono">api_base_url</span>.
      </p>
    </header>

    <div class="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-4 pt-4">
      {#if err}
        <div class="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-400 text-sm">{err}</div>
      {/if}
      {#if notice}
        <div class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-ink/80 text-sm">{notice}</div>
      {/if}

      <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Unified Mode</div>
            <div class="text-sm mt-1">
              Other Agent is the second local agent (the other company), not the cloud.
            </div>
          </div>
          <div class={`px-3 py-2 rounded-full border text-xs font-extrabold ${pillTone(unofficialEnabled ? "ok" : "warn")}`}>
            {unofficialEnabled ? (unofficialStatus || "Enabled") : "Disabled"}
          </div>
        </div>

        <div class="mt-4">
          <label class="text-xs text-muted" for="other-agent-url-settings">Other Agent URL</label>
          <input
            id="other-agent-url-settings"
            class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
            placeholder="http://127.0.0.1:7072"
            bind:value={otherAgentDraftUrl}
          />
          <div class="mt-3 flex items-center justify-between gap-3">
            <div class="text-[11px] text-muted">
              Current: <span class="font-mono">{normalizeUrl(otherAgentUrl) || "—"}</span>
            </div>
            <button
              type="button"
              class="px-4 py-2 rounded-xl bg-accent/20 text-accent border border-accent/30 text-xs font-extrabold hover:bg-accent/30 transition-colors disabled:opacity-60"
              on:click={saveOtherAgent}
              disabled={busy}
            >
              Save Other Agent
            </button>
          </div>
        </div>
      </div>

      <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
        <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Quick Guide</div>
        <div class="mt-3 text-sm text-ink/90 space-y-2">
          <div>
            1. Set <span class="font-mono">api_base_url</span> to On-Prem Edge (LAN) or Cloud (internet).
          </div>
          <div>
            2. Set <span class="font-mono">device_id</span> and <span class="font-mono">device_token</span> from Admin device registration.
          </div>
          <div>
            3. Press Sync Pull to cache items/customers/cashiers for offline operation.
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Right column: agent config forms -->
  <section class="glass-panel rounded-2xl p-4 overflow-hidden flex flex-col">
    <header class="pb-3 border-b border-ink/10 flex items-center justify-between gap-4">
      <div>
        <h3 class="text-lg font-extrabold tracking-tight">Agents</h3>
        <p class="text-sm text-muted mt-1">Configure Official and Unofficial separately.</p>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-4 pt-4">
      <!-- Official -->
      <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <div class="text-sm font-extrabold">Official</div>
            <span class={`px-3 py-1 rounded-full border text-[11px] font-extrabold ${pillTone(edgeOff.kind)}`}>{edgeOff.text}</span>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors" on:click={() => runTest("official")} disabled={busy}>Test</button>
            <button type="button" class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors" on:click={() => runPull("official")} disabled={busy}>Pull</button>
            <button type="button" class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors" on:click={() => runPush("official")} disabled={busy}>Push</button>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-muted">api_base_url (Edge or Cloud)</label>
            <input class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" bind:value={off.api_base_url} />
          </div>
          <div>
            <label class="text-xs text-muted">warehouse_id</label>
            <input class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" bind:value={off.warehouse_id} />
          </div>
          <div>
            <label class="text-xs text-muted">company_id</label>
            <input class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" bind:value={off.company_id} />
          </div>
          <div>
            <label class="text-xs text-muted">device_id</label>
            <input class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" bind:value={off.device_id} />
          </div>
        </div>

        <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <div>
            <div class="flex items-center justify-between">
              <label class="text-xs text-muted">device_token</label>
              <span class="text-[11px] text-muted">Current: {hasTokenText(officialConfig)}</span>
            </div>
            <input
              class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
              type="password"
              placeholder="Enter token to set/replace"
              bind:value={offTokenDraft}
            />
            <label class="mt-2 flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" bind:checked={offClearToken} />
              Clear token
            </label>
          </div>
          <div class="flex justify-end">
            <button
              type="button"
              class="px-5 py-3 rounded-xl bg-accent text-white font-extrabold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98] disabled:opacity-60"
              on:click={() => saveOne("official")}
              disabled={busy}
            >
              Save Official
            </button>
          </div>
        </div>
      </div>

      <!-- Unofficial -->
      <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <div class="text-sm font-extrabold">Unofficial</div>
            <span class={`px-3 py-1 rounded-full border text-[11px] font-extrabold ${pillTone(edgeUn.kind)}`}>{edgeUn.text}</span>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors disabled:opacity-60" on:click={() => runTest("unofficial")} disabled={busy || !unofficialEnabled}>Test</button>
            <button type="button" class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors disabled:opacity-60" on:click={() => runPull("unofficial")} disabled={busy || !unofficialEnabled}>Pull</button>
            <button type="button" class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors disabled:opacity-60" on:click={() => runPush("unofficial")} disabled={busy || !unofficialEnabled}>Push</button>
          </div>
        </div>

        {#if !unofficialEnabled}
          <div class="mt-3 text-sm text-muted">Unofficial agent is disabled. Set Other Agent URL to enable.</div>
        {:else}
          <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-muted">api_base_url (Edge or Cloud)</label>
              <input class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" bind:value={un.api_base_url} />
            </div>
            <div>
              <label class="text-xs text-muted">warehouse_id</label>
              <input class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" bind:value={un.warehouse_id} />
            </div>
            <div>
              <label class="text-xs text-muted">company_id</label>
              <input class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" bind:value={un.company_id} />
            </div>
            <div>
              <label class="text-xs text-muted">device_id</label>
              <input class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" bind:value={un.device_id} />
            </div>
          </div>

          <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <div>
              <div class="flex items-center justify-between">
                <label class="text-xs text-muted">device_token</label>
                <span class="text-[11px] text-muted">Current: {hasTokenText(unofficialConfig)}</span>
              </div>
              <input
                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                type="password"
                placeholder="Enter token to set/replace"
                bind:value={unTokenDraft}
              />
              <label class="mt-2 flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" bind:checked={unClearToken} />
                Clear token
              </label>
            </div>
            <div class="flex justify-end">
              <button
                type="button"
                class="px-5 py-3 rounded-xl bg-accent text-white font-extrabold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98] disabled:opacity-60"
                on:click={() => saveOne("unofficial")}
                disabled={busy}
              >
                Save Unofficial
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </section>
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.35); border-radius: 10px; }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.55); }
</style>
