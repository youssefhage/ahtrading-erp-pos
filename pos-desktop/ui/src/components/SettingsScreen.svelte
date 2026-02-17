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
  export let runStressBenchmark = async (lineCount) => null;
  export let setupLogin = async (payload) => ({ ok: false, error: "setup login unavailable", payload });
  export let setupBranches = async (payload) => ({ ok: false, error: "setup branches unavailable", payload });
  export let setupDevices = async (payload) => ({ ok: false, error: "setup devices unavailable", payload });
  export let setupRegisterDevice = async (payload) => ({ ok: false, error: "setup register unavailable", payload });

  let off = {};
  let un = {};

  let offTokenDraft = "";
  let unTokenDraft = "";
  let offClearToken = false;
  let unClearToken = false;

  let busy = false;
  let notice = "";
  let err = "";
  let benchBusy = false;
  let benchErr = "";
  let benchCount = 500;
  let benchRuns = [];
  let sharedCloudUrl = "";
  let setupApiBase = "";
  let setupEmail = "";
  let setupPassword = "";
  let setupMfaCode = "";
  let setupMfaToken = "";
  let setupToken = "";
  let setupCompanies = [];
  let setupCompanyOptions = [];
  let setupCompanyOfficial = "";
  let setupCompanyUnofficial = "";
  let setupBranchOfficial = "";
  let setupBranchUnofficial = "";
  let setupBranchesOfficial = [];
  let setupBranchesUnofficial = [];
  let setupDevicePickOfficial = "";
  let setupDevicePickUnofficial = "";
  let setupDevicesOfficial = [];
  let setupDevicesUnofficial = [];
  let setupDeviceCodeOfficial = "POS-01";
  let setupDeviceCodeUnofficial = "POS-02";
  let setupBusy = false;
  let setupErr = "";
  let setupNotice = "";

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
    edge_api_base_url: String(cfg?.edge_api_base_url || "").trim(),
    cloud_api_base_url: String(cfg?.cloud_api_base_url || "").trim(),
    company_id: String(cfg?.company_id || "").trim(),
    device_id: String(cfg?.device_id || "").trim(),
    warehouse_id: String(cfg?.warehouse_id || "").trim(),
    branch_id: String(cfg?.branch_id || "").trim(),
    device_code: String(cfg?.device_code || "").trim(),
    pricing_currency: String(cfg?.pricing_currency || "").trim(),
    exchange_rate: cfg?.exchange_rate ?? "",
    vat_rate: cfg?.vat_rate ?? "",
    outbox_stale_warn_minutes: cfg?.outbox_stale_warn_minutes ?? 5,
    require_manager_approval_credit: !!cfg?.require_manager_approval_credit,
    require_manager_approval_returns: !!cfg?.require_manager_approval_returns,
    require_manager_approval_cross_company: !!cfg?.require_manager_approval_cross_company,
  });

  const hasTokenText = (cfg) => (cfg?.has_device_token ? "Set" : "Not set");

  $: off = copyFrom(officialConfig);
  $: un = copyFrom(unofficialConfig);
  $: if (!String(sharedCloudUrl || "").trim()) {
    sharedCloudUrl = String(off.cloud_api_base_url || un.cloud_api_base_url || "").trim();
  }
  $: if (!String(setupApiBase || "").trim()) {
    setupApiBase = String(sharedCloudUrl || off.cloud_api_base_url || un.cloud_api_base_url || "").trim();
  }

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

      // Hybrid URL logic: if cloud/edge urls are set, keep api_base_url as the active target.
      const edge = String(payload.edge_api_base_url || "").trim();
      const cloud = String(payload.cloud_api_base_url || "").trim();
      if (edge || cloud) {
        payload.api_base_url = edge || cloud || String(payload.api_base_url || "").trim();
      }

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

  const applyCloudUrlToBoth = () => {
    const v = String(sharedCloudUrl || "").trim();
    off.cloud_api_base_url = v;
    un.cloud_api_base_url = v;
    notice = v ? "Applied Cloud URL to Official and Unofficial." : "Cleared Cloud URL for both agents.";
    err = "";
  };

  const normalizeDeviceCode = (v, fallback = "POS-01") => {
    const code = String(v || "").trim().toUpperCase();
    return code || fallback;
  };

  const toCompanyOptions = (rows) => {
    const out = [];
    for (const row of rows || []) {
      if (typeof row === "string") {
        const id = String(row || "").trim();
        if (id) out.push({ id, label: id });
        continue;
      }
      const id = String(row?.id || "").trim();
      if (!id) continue;
      const label = String(row?.name || row?.legal_name || id).trim() || id;
      out.push({ id, label });
    }
    return out;
  };

  const toBranchRows = (rows) => {
    const out = [];
    for (const row of rows || []) {
      const id = String(row?.id || "").trim();
      if (!id) continue;
      const name = String(row?.name || id).trim() || id;
      out.push({ id, name });
    }
    return out;
  };

  const toDeviceRows = (rows) => {
    const out = [];
    for (const row of rows || []) {
      const code = normalizeDeviceCode(row?.device_code || "", "");
      if (!code) continue;
      out.push({
        id: String(row?.id || "").trim(),
        device_code: code,
        branch_id: String(row?.branch_id || "").trim(),
        branch_name: String(row?.branch_name || "").trim(),
      });
    }
    out.sort((a, b) => String(a.device_code || "").localeCompare(String(b.device_code || "")));
    return out;
  };

  $: setupCompanyOptions = toCompanyOptions(setupCompanies);

  const setupCompanyLabel = (companyId) => {
    const id = String(companyId || "").trim();
    const row = (setupCompanyOptions || []).find((c) => String(c.id || "").trim() === id);
    return String(row?.label || id || "company").trim();
  };

  const resetSetupSession = () => {
    setupMfaToken = "";
    setupToken = "";
    setupCompanies = [];
    setupCompanyOfficial = "";
    setupCompanyUnofficial = "";
    setupBranchOfficial = "";
    setupBranchUnofficial = "";
    setupBranchesOfficial = [];
    setupBranchesUnofficial = [];
    setupDevicePickOfficial = "";
    setupDevicePickUnofficial = "";
    setupDevicesOfficial = [];
    setupDevicesUnofficial = [];
    setupDeviceCodeOfficial = "POS-01";
    setupDeviceCodeUnofficial = "POS-02";
  };

  const applyPickedDevice = (kind) => {
    const isUnofficial = kind === "unofficial";
    const picked = String(isUnofficial ? setupDevicePickUnofficial : setupDevicePickOfficial).trim().toUpperCase();
    const list = isUnofficial ? (setupDevicesUnofficial || []) : (setupDevicesOfficial || []);
    const row = list.find((d) => String(d?.device_code || "").trim().toUpperCase() === picked);
    if (isUnofficial) {
      if (row) {
        setupDeviceCodeUnofficial = normalizeDeviceCode(row.device_code, "POS-02");
        if (!setupBranchUnofficial && String(row.branch_id || "").trim()) setupBranchUnofficial = String(row.branch_id || "").trim();
      } else if (!String(setupDeviceCodeUnofficial || "").trim()) {
        setupDeviceCodeUnofficial = "POS-02";
      }
      return;
    }
    if (row) {
      setupDeviceCodeOfficial = normalizeDeviceCode(row.device_code, "POS-01");
      if (!setupBranchOfficial && String(row.branch_id || "").trim()) setupBranchOfficial = String(row.branch_id || "").trim();
    } else if (!String(setupDeviceCodeOfficial || "").trim()) {
      setupDeviceCodeOfficial = "POS-01";
    }
  };

  const refreshSetupCompany = async (kind) => {
    const isUnofficial = kind === "unofficial";
    const companyId = String(isUnofficial ? setupCompanyUnofficial : setupCompanyOfficial).trim();
    if (!companyId || !String(setupToken || "").trim() || !String(setupApiBase || "").trim()) {
      if (isUnofficial) {
        setupBranchesUnofficial = [];
        setupDevicesUnofficial = [];
        setupDevicePickUnofficial = "";
      } else {
        setupBranchesOfficial = [];
        setupDevicesOfficial = [];
        setupDevicePickOfficial = "";
      }
      return;
    }

    setupBusy = true;
    setupErr = "";
    try {
      const payload = {
        api_base_url: String(setupApiBase || "").trim(),
        token: String(setupToken || "").trim(),
        company_id: companyId,
      };
      const [bRes, dRes] = await Promise.allSettled([
        setupBranches(payload),
        setupDevices(payload),
      ]);
      const branches = bRes.status === "fulfilled" ? toBranchRows(bRes.value?.branches || []) : [];
      const devices = dRes.status === "fulfilled" ? toDeviceRows(dRes.value?.devices || []) : [];
      if (isUnofficial) {
        setupBranchesUnofficial = branches;
        setupDevicesUnofficial = devices;
      } else {
        setupBranchesOfficial = branches;
        setupDevicesOfficial = devices;
      }
      applyPickedDevice(kind);
    } catch (e) {
      setupErr = e?.message || String(e);
    } finally {
      setupBusy = false;
    }
  };

  const runSetupLogin = async () => {
    setupBusy = true;
    setupErr = "";
    setupNotice = "";
    try {
      const apiBase = String(setupApiBase || "").trim();
      const email = String(setupEmail || "").trim();
      const password = String(setupPassword || "");
      if (!apiBase) throw new Error("Cloud API URL is required.");
      if (!email) throw new Error("Email is required.");
      if (!password) throw new Error("Password is required.");

      const res = await setupLogin({
        api_base_url: apiBase,
        email,
        password,
      });

      if (res?.mfa_required) {
        setupMfaToken = String(res?.mfa_token || "").trim();
        setupNotice = "MFA required. Enter code and click Verify MFA.";
        setupToken = "";
        return;
      }

      setupMfaToken = "";
      setupToken = String(res?.token || "").trim();
      setupCompanies = Array.isArray(res?.companies) ? res.companies : [];
      const activeCompany = String(res?.active_company_id || "").trim();
      const firstCompany = String((toCompanyOptions(setupCompanies)[0] || {}).id || "").trim();
      setupCompanyOfficial = activeCompany || firstCompany;
      setupCompanyUnofficial = activeCompany || firstCompany;
      await refreshSetupCompany("official");
      if (unofficialEnabled) await refreshSetupCompany("unofficial");
      setupNotice = "Connected. Select company and POS, then Apply Express Setup.";
    } catch (e) {
      setupErr = e?.message || String(e);
      resetSetupSession();
    } finally {
      setupBusy = false;
    }
  };

  const runSetupVerifyMfa = async () => {
    setupBusy = true;
    setupErr = "";
    setupNotice = "";
    try {
      const apiBase = String(setupApiBase || "").trim();
      const mfaToken = String(setupMfaToken || "").trim();
      const mfaCode = String(setupMfaCode || "").trim();
      if (!apiBase) throw new Error("Cloud API URL is required.");
      if (!mfaToken) throw new Error("MFA token missing. Click Log In again.");
      if (!mfaCode) throw new Error("MFA code is required.");

      const res = await setupLogin({
        api_base_url: apiBase,
        mfa_token: mfaToken,
        mfa_code: mfaCode,
      });
      if (res?.mfa_required) throw new Error("MFA code not accepted. Try a fresh code.");

      setupMfaToken = "";
      setupMfaCode = "";
      setupToken = String(res?.token || "").trim();
      setupCompanies = Array.isArray(res?.companies) ? res.companies : [];
      const activeCompany = String(res?.active_company_id || "").trim();
      const firstCompany = String((toCompanyOptions(setupCompanies)[0] || {}).id || "").trim();
      setupCompanyOfficial = activeCompany || firstCompany;
      setupCompanyUnofficial = activeCompany || firstCompany;
      await refreshSetupCompany("official");
      if (unofficialEnabled) await refreshSetupCompany("unofficial");
      setupNotice = "MFA verified. Select company and POS, then Apply Express Setup.";
    } catch (e) {
      setupErr = e?.message || String(e);
    } finally {
      setupBusy = false;
    }
  };

  const applyExpressSetup = async () => {
    setupBusy = true;
    setupErr = "";
    setupNotice = "";
    try {
      const apiBase = String(setupApiBase || "").trim();
      const token = String(setupToken || "").trim();
      const companyOff = String(setupCompanyOfficial || "").trim();
      const companyUn = String(setupCompanyUnofficial || setupCompanyOfficial || "").trim();
      const branchOff = String(setupBranchOfficial || "").trim();
      const branchUn = String(setupBranchUnofficial || "").trim();
      const codeOff = normalizeDeviceCode(setupDeviceCodeOfficial || setupDevicePickOfficial, "POS-01");
      const codeUn = normalizeDeviceCode(setupDeviceCodeUnofficial || setupDevicePickUnofficial, "POS-02");
      if (!apiBase) throw new Error("Cloud API URL is required.");
      if (!token) throw new Error("You are not logged in. Click Log In first.");
      if (!companyOff) throw new Error("Select Official company.");
      if (!codeOff) throw new Error("Official POS code is required.");
      if (unofficialEnabled && !companyUn) throw new Error("Select Unofficial company.");
      if (unofficialEnabled && !codeUn) throw new Error("Unofficial POS code is required.");
      if (unofficialEnabled && companyOff === companyUn && codeOff === codeUn) {
        throw new Error("Official and Unofficial cannot use the same POS code in the same company.");
      }

      const regOff = await setupRegisterDevice({
        api_base_url: apiBase,
        token,
        company_id: companyOff,
        branch_id: branchOff,
        device_code: codeOff,
        reset_token: true,
      });

      await saveConfigFor("official", {
        api_base_url: apiBase,
        cloud_api_base_url: apiBase,
        company_id: companyOff,
        branch_id: branchOff || "",
        device_code: codeOff,
        device_id: String(regOff?.device_id || "").trim(),
        device_token: String(regOff?.device_token || "").trim(),
      });
      try { await syncPullFor("official"); } catch (_) {}

      if (unofficialEnabled) {
        const regUn = await setupRegisterDevice({
          api_base_url: apiBase,
          token,
          company_id: companyUn,
          branch_id: branchUn,
          device_code: codeUn,
          reset_token: true,
        });
        await saveConfigFor("unofficial", {
          api_base_url: apiBase,
          cloud_api_base_url: apiBase,
          company_id: companyUn,
          branch_id: branchUn || "",
          device_code: codeUn,
          device_id: String(regUn?.device_id || "").trim(),
          device_token: String(regUn?.device_token || "").trim(),
        });
        try { await syncPullFor("unofficial"); } catch (_) {}
      }

      setupNotice = `Connected successfully. Official: ${setupCompanyLabel(companyOff)}${unofficialEnabled ? ` · Unofficial: ${setupCompanyLabel(companyUn)}` : ""}.`;
      notice = "Express setup applied and sync pull started.";
      err = "";
    } catch (e) {
      setupErr = e?.message || String(e);
    } finally {
      setupBusy = false;
    }
  };

  const fmtMs = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(2)} ms`;
  };

  const fmtTime = (iso) => {
    try {
      return new Date(String(iso || "")).toLocaleTimeString();
    } catch (_) {
      return String(iso || "");
    }
  };

  const runBench = async (count) => {
    benchBusy = true;
    benchErr = "";
    try {
      const report = await runStressBenchmark(count);
      if (!report) throw new Error("Benchmark did not return data.");
      benchRuns = [report, ...(benchRuns || [])].slice(0, 10);
    } catch (e) {
      benchErr = e?.message || String(e);
    } finally {
      benchBusy = false;
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
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Express Onboarding</div>
            <div class="mt-1 text-sm text-ink/90">
              Log in once, pick company and POS from dropdowns, and auto-connect both agents.
            </div>
          </div>
          <div class={`px-3 py-1 rounded-full border text-[11px] font-extrabold ${pillTone(setupToken ? "ok" : (setupMfaToken ? "warn" : "neutral"))}`}>
            {setupToken ? "Connected" : (setupMfaToken ? "MFA" : "Not connected")}
          </div>
        </div>

        {#if setupErr}
          <div class="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{setupErr}</div>
        {/if}
        {#if setupNotice}
          <div class="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-ink/80">{setupNotice}</div>
        {/if}

        <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="md:col-span-2">
            <label class="text-xs text-muted" for="setup_api_base_url">Cloud API URL</label>
            <input
              id="setup_api_base_url"
              class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
              placeholder="https://app.melqard.com/api"
              bind:value={setupApiBase}
              disabled={setupBusy}
            />
          </div>
          <div>
            <label class="text-xs text-muted" for="setup_email">Email</label>
            <input
              id="setup_email"
              class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent/50 focus:outline-none"
              placeholder="name@company.com"
              bind:value={setupEmail}
              disabled={setupBusy || !!setupToken}
            />
          </div>
          <div>
            <label class="text-xs text-muted" for="setup_password">Password</label>
            <input
              id="setup_password"
              type="password"
              class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent/50 focus:outline-none"
              placeholder="••••••••"
              bind:value={setupPassword}
              disabled={setupBusy || !!setupToken}
            />
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="px-4 py-2 rounded-xl text-xs font-semibold border border-accent/30 bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-60"
            on:click={runSetupLogin}
            disabled={setupBusy || !!setupToken}
          >
            {setupBusy && !setupToken ? "Connecting..." : "Log In"}
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors disabled:opacity-60"
            on:click={() => { resetSetupSession(); setupErr = ""; setupNotice = ""; }}
            disabled={setupBusy}
          >
            Clear
          </button>
        </div>

        {#if setupMfaToken}
          <div class="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
            <input
              class="w-full bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
              placeholder="MFA code"
              bind:value={setupMfaCode}
              disabled={setupBusy}
            />
            <button
              type="button"
              class="px-4 py-3 rounded-xl text-xs font-semibold border border-accent/30 bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-60"
              on:click={runSetupVerifyMfa}
              disabled={setupBusy}
            >
              Verify MFA
            </button>
          </div>
        {/if}

        {#if setupToken}
          <div class="mt-4 rounded-xl border border-ink/10 bg-bg/35 p-3 space-y-3">
            <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Official</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-muted" for="setup_off_company">Company</label>
                <select
                  id="setup_off_company"
                  class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent/50 focus:outline-none"
                  bind:value={setupCompanyOfficial}
                  on:change={() => refreshSetupCompany("official")}
                  disabled={setupBusy}
                >
                  <option value="">Select company...</option>
                  {#each setupCompanyOptions as c}
                    <option value={c.id}>{c.label}</option>
                  {/each}
                </select>
              </div>
              <div>
                <label class="text-xs text-muted" for="setup_off_branch">Branch (optional)</label>
                <select
                  id="setup_off_branch"
                  class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent/50 focus:outline-none"
                  bind:value={setupBranchOfficial}
                  disabled={setupBusy}
                >
                  <option value="">No branch</option>
                  {#each setupBranchesOfficial as b}
                    <option value={b.id}>{b.name}</option>
                  {/each}
                </select>
              </div>
              <div>
                <label class="text-xs text-muted" for="setup_off_device_pick">POS from company (optional)</label>
                <select
                  id="setup_off_device_pick"
                  class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent/50 focus:outline-none"
                  bind:value={setupDevicePickOfficial}
                  on:change={() => applyPickedDevice("official")}
                  disabled={setupBusy}
                >
                  <option value="">Create/use manual code...</option>
                  {#each setupDevicesOfficial as d}
                    <option value={d.device_code}>{d.device_code}{d.branch_name ? ` (${d.branch_name})` : ""}</option>
                  {/each}
                </select>
              </div>
              <div>
                <label class="text-xs text-muted" for="setup_off_device_code">POS code</label>
                <input
                  id="setup_off_device_code"
                  class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                  bind:value={setupDeviceCodeOfficial}
                  disabled={setupBusy}
                />
              </div>
            </div>
          </div>

          {#if unofficialEnabled}
            <div class="mt-3 rounded-xl border border-ink/10 bg-bg/35 p-3 space-y-3">
              <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Unofficial</div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="text-xs text-muted" for="setup_un_company">Company</label>
                  <select
                    id="setup_un_company"
                    class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent/50 focus:outline-none"
                    bind:value={setupCompanyUnofficial}
                    on:change={() => refreshSetupCompany("unofficial")}
                    disabled={setupBusy}
                  >
                    <option value="">Select company...</option>
                    {#each setupCompanyOptions as c}
                      <option value={c.id}>{c.label}</option>
                    {/each}
                  </select>
                </div>
                <div>
                  <label class="text-xs text-muted" for="setup_un_branch">Branch (optional)</label>
                  <select
                    id="setup_un_branch"
                    class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent/50 focus:outline-none"
                    bind:value={setupBranchUnofficial}
                    disabled={setupBusy}
                  >
                    <option value="">No branch</option>
                    {#each setupBranchesUnofficial as b}
                      <option value={b.id}>{b.name}</option>
                    {/each}
                  </select>
                </div>
                <div>
                  <label class="text-xs text-muted" for="setup_un_device_pick">POS from company (optional)</label>
                  <select
                    id="setup_un_device_pick"
                    class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent/50 focus:outline-none"
                    bind:value={setupDevicePickUnofficial}
                    on:change={() => applyPickedDevice("unofficial")}
                    disabled={setupBusy}
                  >
                    <option value="">Create/use manual code...</option>
                    {#each setupDevicesUnofficial as d}
                      <option value={d.device_code}>{d.device_code}{d.branch_name ? ` (${d.branch_name})` : ""}</option>
                    {/each}
                  </select>
                </div>
                <div>
                  <label class="text-xs text-muted" for="setup_un_device_code">POS code</label>
                  <input
                    id="setup_un_device_code"
                    class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                    bind:value={setupDeviceCodeUnofficial}
                    disabled={setupBusy}
                  />
                </div>
              </div>
            </div>
          {:else}
            <div class="mt-3 text-xs text-muted">
              Secondary agent is disabled. Set Other Agent URL first if you want dual-company onboarding.
            </div>
          {/if}

          <div class="mt-3">
            <button
              type="button"
              class="px-5 py-3 rounded-xl bg-accent text-white font-extrabold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98] disabled:opacity-60"
              on:click={applyExpressSetup}
              disabled={setupBusy}
            >
              {setupBusy ? "Applying..." : "Apply Express Setup"}
            </button>
          </div>
        {/if}
      </div>

      <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
        <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Quick Guide</div>
        <div class="mt-3 text-sm text-ink/90 space-y-2">
          <div>
            1. Set your <span class="font-mono">Cloud API URL</span>, then use <span class="font-mono">Apply to Both Agents</span>.
          </div>
          <div>
            2. Paste <span class="font-mono">Company ID</span>, <span class="font-mono">POS Device ID</span>, and <span class="font-mono">Device Token</span> from Admin device registration.
          </div>
          <div>
            3. Save each agent, then press <span class="font-mono">Pull</span> to cache items/customers/cashiers for offline operation.
          </div>
        </div>
      </div>

      <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Stress Benchmark</div>
            <div class="mt-1 text-sm text-ink/90">
              Runs a repeatable synthetic cart benchmark and restores your current cart after completion.
            </div>
          </div>
          <div class={`px-3 py-1 rounded-full border text-[11px] font-extrabold ${pillTone(benchBusy ? "warn" : "ok")}`}>
            {benchBusy ? "Running" : "Ready"}
          </div>
        </div>

        {#if benchErr}
          <div class="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {benchErr}
          </div>
        {/if}

        <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors disabled:opacity-60"
            on:click={() => runBench(200)}
            disabled={benchBusy}
          >
            Run 200
          </button>
          <button
            type="button"
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors disabled:opacity-60"
            on:click={() => runBench(500)}
            disabled={benchBusy}
          >
            Run 500
          </button>
          <button
            type="button"
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors disabled:opacity-60"
            on:click={() => runBench(1000)}
            disabled={benchBusy}
          >
            Run 1000
          </button>
          <button
            type="button"
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-ink/10 bg-ink/5 hover:bg-ink/10 transition-colors disabled:opacity-60"
            on:click={() => { benchRuns = []; benchErr = ""; }}
            disabled={benchBusy || !(benchRuns || []).length}
          >
            Clear
          </button>
        </div>

        <div class="mt-3 flex items-center gap-2">
          <label for="bench_custom_count" class="text-xs text-muted whitespace-nowrap">Custom lines</label>
          <input
            id="bench_custom_count"
            type="number"
            min="50"
            max="2000"
            step="50"
            bind:value={benchCount}
            class="w-28 bg-bg/50 border border-ink/10 rounded-xl px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
          />
          <button
            type="button"
            class="px-3 py-2 rounded-xl text-xs font-semibold border border-accent/30 bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-60"
            on:click={() => runBench(benchCount)}
            disabled={benchBusy}
          >
            Run Custom
          </button>
        </div>

        {#if (benchRuns || []).length > 0}
          <div class="mt-4 space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
            {#each benchRuns as run}
              <div class="rounded-xl border border-ink/10 bg-bg/35 p-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-xs font-extrabold text-ink/90">
                    {run.line_count} lines
                  </div>
                  <div class="text-[11px] text-muted">
                    {fmtTime(run.started_at)}
                  </div>
                </div>
                <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div class="text-muted">Build cart</div><div class="text-right font-mono">{fmtMs(run.build_cart_ms)}</div>
                  <div class="text-muted">First render</div><div class="text-right font-mono">{fmtMs(run.first_render_ms)}</div>
                  <div class="text-muted">Partial reprice</div><div class="text-right font-mono">{fmtMs(run.partial_reprice_ms)}</div>
                  <div class="text-muted">Full reprice</div><div class="text-right font-mono">{fmtMs(run.full_reprice_ms)}</div>
                  <div class="text-muted">Qty update</div><div class="text-right font-mono">{fmtMs(run.single_qty_update_ms)}</div>
                  <div class="text-muted">UOM update</div><div class="text-right font-mono">{fmtMs(run.single_uom_update_ms)}</div>
                  <div class="text-muted">Total run</div><div class="text-right font-mono font-extrabold">{fmtMs(run.total_benchmark_ms)}</div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </section>

  <!-- Right column: agent config forms -->
  <section class="glass-panel rounded-2xl p-4 overflow-hidden flex flex-col">
    <header class="pb-3 border-b border-ink/10 flex items-center justify-between gap-4">
      <div>
        <h3 class="text-lg font-extrabold tracking-tight">Agents</h3>
        <p class="text-sm text-muted mt-1">Cloud-first setup with simple fields. Open Advanced only when needed.</p>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-4 pt-4">
      <div class="rounded-2xl border border-ink/10 bg-surface/35 p-4">
        <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Cloud URL Quick Apply</div>
        <div class="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <input
            class="w-full bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
            placeholder="https://app.melqard.com/api"
            bind:value={sharedCloudUrl}
          />
          <button
            type="button"
            class="px-4 py-3 rounded-xl text-xs font-semibold border border-accent/30 bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-60"
            on:click={applyCloudUrlToBoth}
            disabled={busy}
          >
            Apply to Both Agents
          </button>
        </div>
        <div class="mt-2 text-[11px] text-muted">
          This fills <span class="font-mono">cloud_api_base_url</span> for Official and Unofficial. You still save each agent separately.
        </div>
      </div>

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

        <div class="mt-4 rounded-xl border border-ink/10 bg-bg/35 p-3">
          <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Cloud Setup (Recommended)</div>
          <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label for="off_cloud_api_base_url" class="text-xs text-muted">Cloud API URL</label>
              <input id="off_cloud_api_base_url" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" placeholder="https://app.melqard.com/api" bind:value={off.cloud_api_base_url} />
            </div>
            <div>
              <label for="off_company_id" class="text-xs text-muted">Company ID</label>
              <input id="off_company_id" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" placeholder="UUID" bind:value={off.company_id} />
            </div>
            <div>
              <label for="off_device_id" class="text-xs text-muted">POS Device ID</label>
              <input id="off_device_id" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" placeholder="UUID" bind:value={off.device_id} />
            </div>
            <div>
              <div class="flex items-center justify-between">
                <label for="off_device_token" class="text-xs text-muted">Device Token</label>
                <span class="text-[11px] text-muted">Current: {hasTokenText(officialConfig)}</span>
              </div>
              <input
                id="off_device_token"
                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                type="password"
                placeholder="Paste token from POS Devices"
                bind:value={offTokenDraft}
              />
              <label class="mt-2 flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" bind:checked={offClearToken} />
                Clear token on save
              </label>
            </div>
          </div>
          <div class="mt-2 text-[11px] text-muted">
            Tip: generate these values from Admin → System → POS Devices (Reset Token & Setup).
          </div>
        </div>

        <details class="settings-advanced mt-3">
          <summary>Advanced official settings</summary>
          <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label for="off_edge_api_base_url" class="text-xs text-muted">Edge API URL (LAN fallback, optional)</label>
              <input id="off_edge_api_base_url" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" placeholder="http://192.168.1.10:8001" bind:value={off.edge_api_base_url} />
            </div>
            <div>
              <label for="off_api_base_url" class="text-xs text-muted">Active API URL (auto)</label>
              <input id="off_api_base_url" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono opacity-70" bind:value={off.api_base_url} readonly />
            </div>
            <div>
              <label for="off_warehouse_id" class="text-xs text-muted">warehouse_id</label>
              <input id="off_warehouse_id" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" bind:value={off.warehouse_id} />
            </div>
            <div>
              <label for="off_outbox_stale_warn_minutes" class="text-xs text-muted">outbox_stale_warn_minutes</label>
              <input
                id="off_outbox_stale_warn_minutes"
                type="number"
                min="1"
                max="1440"
                class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                bind:value={off.outbox_stale_warn_minutes}
              />
            </div>
          </div>
          <div class="mt-3 rounded-xl border border-ink/10 bg-bg/35 p-3">
            <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Risk Controls</div>
            <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              <label class="flex items-center gap-2 text-xs text-ink/90">
                <input type="checkbox" bind:checked={off.require_manager_approval_credit} />
                Require manager approval for credit
              </label>
              <label class="flex items-center gap-2 text-xs text-ink/90">
                <input type="checkbox" bind:checked={off.require_manager_approval_returns} />
                Require manager approval for returns
              </label>
              <label class="flex items-center gap-2 text-xs text-ink/90 md:col-span-2">
                <input type="checkbox" bind:checked={off.require_manager_approval_cross_company} />
                Require manager approval for cross-company/flagged invoices
              </label>
            </div>
          </div>
        </details>

        <div class="mt-3 flex justify-end">
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
          <div class="mt-4 rounded-xl border border-ink/10 bg-bg/35 p-3">
            <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Cloud Setup (Recommended)</div>
            <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label for="un_cloud_api_base_url" class="text-xs text-muted">Cloud API URL</label>
                <input id="un_cloud_api_base_url" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" placeholder="https://app.melqard.com/api" bind:value={un.cloud_api_base_url} />
              </div>
              <div>
                <label for="un_company_id" class="text-xs text-muted">Company ID</label>
                <input id="un_company_id" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" placeholder="UUID" bind:value={un.company_id} />
              </div>
              <div>
                <label for="un_device_id" class="text-xs text-muted">POS Device ID</label>
                <input id="un_device_id" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" placeholder="UUID" bind:value={un.device_id} />
              </div>
              <div>
                <div class="flex items-center justify-between">
                  <label for="un_device_token" class="text-xs text-muted">Device Token</label>
                  <span class="text-[11px] text-muted">Current: {hasTokenText(unofficialConfig)}</span>
                </div>
                <input
                  id="un_device_token"
                  class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                  type="password"
                  placeholder="Paste token from POS Devices"
                  bind:value={unTokenDraft}
                />
                <label class="mt-2 flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" bind:checked={unClearToken} />
                  Clear token on save
                </label>
              </div>
            </div>
          </div>

          <details class="settings-advanced mt-3">
            <summary>Advanced unofficial settings</summary>
            <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label for="un_edge_api_base_url" class="text-xs text-muted">Edge API URL (LAN fallback, optional)</label>
                <input id="un_edge_api_base_url" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" placeholder="http://192.168.1.10:8001" bind:value={un.edge_api_base_url} />
              </div>
              <div>
                <label for="un_api_base_url" class="text-xs text-muted">Active API URL (auto)</label>
                <input id="un_api_base_url" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono opacity-70" bind:value={un.api_base_url} readonly />
              </div>
              <div>
                <label for="un_warehouse_id" class="text-xs text-muted">warehouse_id</label>
                <input id="un_warehouse_id" class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none" bind:value={un.warehouse_id} />
              </div>
              <div>
                <label for="un_outbox_stale_warn_minutes" class="text-xs text-muted">outbox_stale_warn_minutes</label>
                <input
                  id="un_outbox_stale_warn_minutes"
                  type="number"
                  min="1"
                  max="1440"
                  class="w-full mt-1 bg-bg/50 border border-ink/10 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-accent/50 focus:outline-none"
                  bind:value={un.outbox_stale_warn_minutes}
                />
              </div>
            </div>
            <div class="mt-3 rounded-xl border border-ink/10 bg-bg/35 p-3">
              <div class="text-xs font-extrabold uppercase tracking-wider text-muted">Risk Controls</div>
              <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                <label class="flex items-center gap-2 text-xs text-ink/90">
                  <input type="checkbox" bind:checked={un.require_manager_approval_credit} />
                  Require manager approval for credit
                </label>
                <label class="flex items-center gap-2 text-xs text-ink/90">
                  <input type="checkbox" bind:checked={un.require_manager_approval_returns} />
                  Require manager approval for returns
                </label>
                <label class="flex items-center gap-2 text-xs text-ink/90 md:col-span-2">
                  <input type="checkbox" bind:checked={un.require_manager_approval_cross_company} />
                  Require manager approval for cross-company/flagged invoices
                </label>
              </div>
            </div>
          </details>

          <div class="mt-3 flex justify-end">
            <button
              type="button"
              class="px-5 py-3 rounded-xl bg-accent text-white font-extrabold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 transition-all active:scale-[0.98] disabled:opacity-60"
              on:click={() => saveOne("unofficial")}
              disabled={busy}
            >
              Save Unofficial
            </button>
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
  .settings-advanced > summary {
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted, #94a3b8);
    user-select: none;
  }
</style>
