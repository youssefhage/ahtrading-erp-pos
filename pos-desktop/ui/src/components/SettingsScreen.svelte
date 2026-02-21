<script>
  export let officialConfig = {};
  export let unofficialConfig = {};
  export let isCloudOnlyMode = false;
  export let unofficialEnabled = true;
  export let unofficialStatus = "Pending";

  export let otherAgentUrl = "";
  export let otherAgentDraftUrl = "";
  export let saveOtherAgent = async () => {};

  export let saveConfigFor = async (companyKey, payload) => {};
  export let testSyncFor = async (companyKey) => {};
  export let syncPullFor = async (companyKey) => {};
  export let syncPushFor = async (companyKey) => {};
  export let openPrintingSettings = async () => {};
  export let runStressBenchmark = async (lineCount) => null;
  export let vatDisplayMode = "both";
  export let onVatDisplayModeChange = (mode) => {};
  export let showPriceDisplayControls = false;
  export let onShowPriceDisplayControlsChange = (enabled) => {};
  export let setupLogin = async (payload) => ({ ok: false, error: "setup login unavailable", payload });
  export let setupBranches = async (payload) => ({ ok: false, error: "setup branches unavailable", payload });
  export let setupDevices = async (payload) => ({ ok: false, error: "setup devices unavailable", payload });
  export let setupRegisterDevice = async (payload) => ({ ok: false, error: "setup register unavailable", payload });
  export let versionText = "";

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
  let setupBusy = false;
  let setupErr = "";
  let setupNotice = "";

  let testOff = null;
  let testUn = null;
  $: syncOff = summarizeSync(testOff);
  $: syncUn = summarizeSync(testUn);

  const normalizeUrl = (v) => {
    const t = String(v || "").trim();
    return t;
  };

  const copyFrom = (cfg) => ({
    api_base_url: String(cfg?.api_base_url || "").trim(),
    cloud_api_base_url: String(cfg?.cloud_api_base_url || "").trim(),
    company_id: String(cfg?.company_id || "").trim(),
    device_id: String(cfg?.device_id || "").trim(),
    warehouse_id: String(cfg?.warehouse_id || "").trim(),
    branch_id: String(cfg?.branch_id || "").trim(),
    device_code: String(cfg?.device_code || "").trim(),
    pricing_currency: String(cfg?.pricing_currency || "").trim(),
    exchange_rate: cfg?.exchange_rate ?? "",
    outbox_stale_warn_minutes: cfg?.outbox_stale_warn_minutes ?? 5,
    require_manager_approval_credit: !!cfg?.require_manager_approval_credit,
    require_manager_approval_returns: !!cfg?.require_manager_approval_returns,
    require_manager_approval_cross_company: !!cfg?.require_manager_approval_cross_company,
  });

  const hasTokenText = (cfg) => (cfg?.has_device_token ? "Set" : "Not set");
  const vatPercentText = (cfg) => `${(Number(cfg?.vat_rate || 0) * 100).toFixed(2)}%`;

  $: off = copyFrom(officialConfig);
  $: un = copyFrom(unofficialConfig);
  $: dualOnboardingEnabled = !!unofficialEnabled;
  $: if (!String(sharedCloudUrl || "").trim()) {
    sharedCloudUrl = String(off.cloud_api_base_url || un.cloud_api_base_url || "").trim();
  }
  $: if (!String(setupApiBase || "").trim()) {
    setupApiBase = String(sharedCloudUrl || off.cloud_api_base_url || un.cloud_api_base_url || "").trim();
  }

  const pillTone = (kind) => {
    if (kind === "ok") return "bg-emerald-500/10 border-emerald-500/25 text-emerald-400";
    if (kind === "warn") return "bg-amber-500/10 border-amber-500/25 text-amber-400";
    if (kind === "bad") return "bg-red-500/10 border-red-500/25 text-red-400";
    return "bg-white/5 border-white/10 text-muted";
  };

  const summarizeSync = (st) => {
    if (!st) return { kind: "neutral", text: "Not tested" };
    if (st.error) return { kind: "bad", text: st.error };
    const ok = !!(st.sync_ok ?? st.edge_ok);
    const auth = !!(st.sync_auth_ok ?? st.edge_auth_ok);
    if (!ok) return { kind: "bad", text: "Offline" };
    if (ok && !auth) return { kind: "warn", text: "Online (auth failed)" };
    return { kind: "ok", text: "Online" };
  };

  const _syncStatusAuthOk = (st) => !!(st?.sync_auth_ok ?? st?.edge_auth_ok);
  const _syncStatusOnline = (st) => !!(st?.sync_ok ?? st?.edge_ok);
  const _syncStatusInvalidToken = (st) => {
    const statusCode = Number(st?.status || 0);
    const msg = String(st?.error || "").trim().toLowerCase();
    return (
      statusCode === 401 ||
      statusCode === 403 ||
      msg.includes("invalid device token") ||
      msg.includes("missing device") ||
      msg.includes("device token")
    );
  };

  const saveOne = async (companyKey) => {
    busy = true;
    err = "";
    notice = "";
    try {
      const payload = companyKey === "official" ? { ...off } : { ...un };

      // Cloud-first URL logic: keep api_base_url aligned with cloud target when set.
      const cloud = String(payload.cloud_api_base_url || "").trim();
      if (cloud) {
        payload.api_base_url = cloud;
      }
      delete payload.edge_api_base_url;

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
      const st = await testSyncFor(companyKey);
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

  const normalizeCompanyName = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

  const looksUnofficialCompany = (value) => {
    const name = normalizeCompanyName(value);
    if (!name) return false;
    return (
      name.includes("unofficial") ||
      name.includes("unnoficial") ||
      name.includes("unoficial") ||
      name.includes("nonofficial") ||
      name.includes("unoff")
    );
  };

  const looksOfficialCompany = (value) => {
    const name = normalizeCompanyName(value);
    if (!name) return false;
    return name.includes("official") && !looksUnofficialCompany(value);
  };

  const pickSetupCompanies = (rows, activeCompanyId = "") => {
    const options = toCompanyOptions(rows);
    if (!options.length) return { official: "", unofficial: "" };

    const used = new Set();
    const claim = (id) => {
      const v = String(id || "").trim();
      if (!v || used.has(v)) return "";
      used.add(v);
      return v;
    };
    const firstWhere = (pred) => {
      for (const opt of options) {
        if (used.has(opt.id)) continue;
        if (pred(opt)) return opt.id;
      }
      return "";
    };

    const activeId = String(activeCompanyId || "").trim();
    const active = options.find((c) => c.id === activeId) || null;

    let official = "";
    let unofficial = "";

    if (active && looksOfficialCompany(active.label)) official = claim(active.id);
    if (active && looksUnofficialCompany(active.label)) unofficial = claim(active.id);

    if (!official) official = claim(firstWhere((c) => looksOfficialCompany(c.label)));
    if (!unofficial) unofficial = claim(firstWhere((c) => looksUnofficialCompany(c.label)));

    if (!official && activeId && !used.has(activeId)) official = claim(activeId);
    if (!official) official = claim(options[0].id) || String(options[0]?.id || "").trim();

    if (!unofficial) {
      unofficial = claim(firstWhere(() => true));
      if (!unofficial) unofficial = official;
    }

    return { official, unofficial };
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
  };

  const applyPickedDevice = (kind) => {
    const isUnofficial = kind === "unofficial";
    const picked = String(isUnofficial ? setupDevicePickUnofficial : setupDevicePickOfficial).trim().toUpperCase();
    const list = isUnofficial ? (setupDevicesUnofficial || []) : (setupDevicesOfficial || []);
    const row = list.find((d) => String(d?.device_code || "").trim().toUpperCase() === picked);
    if (isUnofficial) {
      if (row) {
        if (!setupBranchUnofficial && String(row.branch_id || "").trim()) setupBranchUnofficial = String(row.branch_id || "").trim();
      }
      return;
    }
    if (row) {
      if (!setupBranchOfficial && String(row.branch_id || "").trim()) setupBranchOfficial = String(row.branch_id || "").trim();
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
        const currentPick = normalizeDeviceCode(setupDevicePickUnofficial, "");
        const currentCfgCode = normalizeDeviceCode(unofficialConfig?.device_code || "", "");
        const validCodes = new Set(devices.map((d) => normalizeDeviceCode(d?.device_code || "", "")));
        if (!currentPick || !validCodes.has(currentPick)) {
          setupDevicePickUnofficial = validCodes.has(currentCfgCode)
            ? currentCfgCode
            : (devices[0]?.device_code || "");
        }
      } else {
        setupBranchesOfficial = branches;
        setupDevicesOfficial = devices;
        const currentPick = normalizeDeviceCode(setupDevicePickOfficial, "");
        const currentCfgCode = normalizeDeviceCode(officialConfig?.device_code || "", "");
        const validCodes = new Set(devices.map((d) => normalizeDeviceCode(d?.device_code || "", "")));
        if (!currentPick || !validCodes.has(currentPick)) {
          setupDevicePickOfficial = validCodes.has(currentCfgCode)
            ? currentCfgCode
            : (devices[0]?.device_code || "");
        }
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
      const picked = pickSetupCompanies(setupCompanies, activeCompany);
      setupCompanyOfficial = picked.official;
      setupCompanyUnofficial = picked.unofficial;
      await refreshSetupCompany("official");
      if (dualOnboardingEnabled) await refreshSetupCompany("unofficial");
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
      const picked = pickSetupCompanies(setupCompanies, activeCompany);
      setupCompanyOfficial = picked.official;
      setupCompanyUnofficial = picked.unofficial;
      await refreshSetupCompany("official");
      if (dualOnboardingEnabled) await refreshSetupCompany("unofficial");
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
      const codeOff = normalizeDeviceCode(setupDevicePickOfficial, "");
      const codeUn = normalizeDeviceCode(setupDevicePickUnofficial, "");
      if (!apiBase) throw new Error("Cloud API URL is required.");
      if (!token) throw new Error("You are not logged in. Click Log In first.");
      if (!companyOff) throw new Error("Select Official company.");
      if (!codeOff) throw new Error("Select an Official POS source.");
      if (dualOnboardingEnabled && !companyUn) throw new Error("Select Unofficial company.");
      if (dualOnboardingEnabled && !codeUn) throw new Error("Select an Unofficial POS source.");
      if (dualOnboardingEnabled && companyOff === companyUn && codeOff === codeUn) {
        throw new Error("Official and Unofficial cannot use the same POS source in the same company.");
      }

      const canReuseDeviceCredentials = ({
        currentCfg,
        targetCompanyId,
        targetDeviceCode,
        selectedDeviceId = "",
      }) => {
        const companyId = String(currentCfg?.company_id || "").trim();
        const deviceId = String(currentCfg?.device_id || "").trim();
        const deviceToken = String(currentCfg?.device_token || "").trim();
        const currentCode = normalizeDeviceCode(currentCfg?.device_code || "", "");
        const targetCompany = String(targetCompanyId || "").trim();
        const targetCode = normalizeDeviceCode(targetDeviceCode || "", "");
        const selectedId = String(selectedDeviceId || "").trim();
        if (!companyId || !deviceId || !deviceToken || !targetCompany) return false;
        if (companyId !== targetCompany) return false;
        if (targetCode && currentCode && targetCode !== currentCode) return false;
        if (selectedId && selectedId !== deviceId) return false;
        return true;
      };

      const evaluateReuseDecision = async ({
        companyKey,
        currentCfg,
        targetCompanyId,
        targetDeviceCode,
        selectedDeviceId = "",
      }) => {
        if (!canReuseDeviceCredentials({
          currentCfg,
          targetCompanyId,
          targetDeviceCode,
          selectedDeviceId,
        })) return { reuse: false, stale: false };
        try {
          const st = await testSyncFor(companyKey);
          if (_syncStatusAuthOk(st)) return { reuse: true, stale: false };
          if (_syncStatusInvalidToken(st)) return { reuse: false, stale: true };
          if (!_syncStatusOnline(st)) return { reuse: true, stale: false };
          return { reuse: true, stale: false };
        } catch (_) {
          return { reuse: true, stale: false };
        }
      };

      const selectedOff = (setupDevicesOfficial || []).find(
        (d) => normalizeDeviceCode(d?.device_code || "", "") === codeOff
      );
      const selectedUn = (setupDevicesUnofficial || []).find(
        (d) => normalizeDeviceCode(d?.device_code || "", "") === codeUn
      );

      const reuseOffResult = await evaluateReuseDecision({
        companyKey: "official",
        currentCfg: officialConfig,
        targetCompanyId: companyOff,
        targetDeviceCode: codeOff,
        selectedDeviceId: String(selectedOff?.id || "").trim(),
      });
      const reuseOff = !!reuseOffResult.reuse;

      const regOff = reuseOff
        ? {
            device_id: String(officialConfig?.device_id || "").trim(),
            device_token: String(officialConfig?.device_token || "").trim(),
            reused: true,
          }
        : await setupRegisterDevice({
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

      let regUn = null;
      let reuseUnResult = { reuse: false, stale: false };
      if (dualOnboardingEnabled) {
        reuseUnResult = await evaluateReuseDecision({
          companyKey: "unofficial",
          currentCfg: unofficialConfig,
          targetCompanyId: companyUn,
          targetDeviceCode: codeUn,
          selectedDeviceId: String(selectedUn?.id || "").trim(),
        });
        const reuseUn = !!reuseUnResult.reuse;
        regUn = reuseUn
          ? {
              device_id: String(unofficialConfig?.device_id || "").trim(),
              device_token: String(unofficialConfig?.device_token || "").trim(),
              reused: true,
            }
          : await setupRegisterDevice({
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

      setupNotice = `Connected successfully. Official: ${setupCompanyLabel(companyOff)}${dualOnboardingEnabled ? ` · Unofficial: ${setupCompanyLabel(companyUn)}` : ""}.`;
      const reused = [
        regOff?.reused ? "Official" : "",
        regUn?.reused ? "Unofficial" : "",
      ].filter(Boolean);
      notice = reused.length > 0
        ? `Express setup applied. Reused ${reused.join(" + ")} device credentials and started sync pull.`
        : "Express setup applied and sync pull started.";
      if (reuseOffResult?.stale || (dualOnboardingEnabled && reuseUnResult?.stale)) {
        setupNotice = `${setupNotice} Device token was refreshed for stale credentials.`;
      }
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

  const toFiniteOrNull = (...values) => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const normalizeBenchReport = (report) => {
    const row = report && typeof report === "object" ? { ...report } : {};
    const timestamp = String(row.timestamp || row.started_at || new Date().toISOString());
    const itemCount = Math.max(0, Math.trunc(toFiniteOrNull(row.item_count, row.line_count, 0) || 0));
    const writeMs = toFiniteOrNull(
      row.write_ms,
      row.full_reprice_ms,
      row.partial_reprice_ms,
      row.total_benchmark_ms
    );
    const readMs = toFiniteOrNull(
      row.read_ms,
      row.first_render_ms,
      row.build_cart_ms
    );
    return {
      ...row,
      timestamp,
      item_count: itemCount,
      write_ms: writeMs,
      read_ms: readMs,
    };
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
      benchRuns = [normalizeBenchReport(report), ...(benchRuns || [])].slice(0, 10);
    } catch (e) {
      benchErr = e?.message || String(e);
    } finally {
      benchBusy = false;
    }
  };
</script>

<div class="h-full w-full overflow-hidden grid grid-cols-1 xl:grid-cols-[minmax(520px,720px)_1fr] gap-6 p-1">
  <!-- Left column: how it works + other agent -->
  <section class="glass-panel rounded-[2rem] p-6 overflow-hidden flex flex-col gap-6 relative group/settings">
    <div class="absolute inset-0 bg-surface/30 pointer-events-none rounded-[2rem]"></div>
    
    <header class="relative z-10 shrink-0 border-b border-white/5 pb-4">
      <h2 class="text-2xl font-bold tracking-tight text-ink mb-2">Settings</h2>
      <p class="text-sm text-muted/80 leading-relaxed max-w-lg">
        The POS UI talks to local agents. Each agent syncs to Cloud via <span class="font-mono text-accent bg-accent/10 px-1 py-0.5 rounded text-xs">api_base_url</span>.
      </p>
      {#if versionText}
        <p class="mt-2 text-[10px] font-mono text-muted/70">{versionText}</p>
      {/if}
    </header>

    <div class="relative z-10 flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6">
      {#if err}
        <div class="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300 text-sm font-medium animate-pulse">Error: {err}</div>
      {/if}
      {#if notice}
        <div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300 text-sm font-medium">{notice}</div>
      {/if}

      <div class="glass-panel rounded-xl p-5 border border-white/5 bg-surface/20">
        <div class="flex items-center justify-between gap-4 mb-4">
          <div>
            <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-1">Unified Mode</div>
            <div class="text-sm text-ink/90 leading-snug max-w-md">
              POS opens directly. Configure company and device credentials from POS Settings.
              {#if !isCloudOnlyMode}
                Other Agent URL remains optional.
              {/if}
            </div>
          </div>
          <div class={`px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${pillTone(dualOnboardingEnabled ? "ok" : "warn")}`}>
            {dualOnboardingEnabled ? (unofficialStatus || "Enabled") : "Disabled"}
          </div>
        </div>

        {#if !isCloudOnlyMode}
          <div class="pt-4 border-t border-white/5">
            <label class="text-xs font-bold text-muted uppercase tracking-wide mb-2 block" for="other-agent-url-settings">Other Agent URL</label>
            <div class="flex gap-2">
              <input
                id="other-agent-url-settings"
                class="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-3 font-mono text-xs focus:ring-2 focus:ring-accent/50 focus:border-accent/50 focus:outline-none transition-all placeholder-muted/30 text-ink"
                placeholder="http://127.0.0.1:7072"
                bind:value={otherAgentDraftUrl}
              />
              <button
                type="button"
                class="px-4 py-2 rounded-xl bg-accent/20 text-accent border border-accent/30 text-xs font-bold hover:bg-accent/30 hover:border-accent/40 transition-colors disabled:opacity-60 whitespace-nowrap"
                on:click={saveOtherAgent}
                disabled={busy}
              >
                Save
              </button>
            </div>
            <div class="mt-2 flex items-center justify-between text-[10px] text-muted/60">
              <span>Current: <span class="font-mono text-ink/70">{normalizeUrl(otherAgentUrl) || "—"}</span></span>
              <span>Leave blank to keep secondary company on cloud mode.</span>
            </div>
          </div>
        {/if}

        <div class="pt-4 border-t border-white/5">
          <div class="text-xs font-bold text-muted uppercase tracking-wide mb-2">Device & Printing</div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="px-4 py-2 rounded-xl bg-accent/20 text-accent border border-accent/30 text-xs font-bold hover:bg-accent/30 hover:border-accent/40 transition-colors disabled:opacity-60"
              on:click={openPrintingSettings}
              disabled={busy}
            >
              Open Printing Settings
            </button>
            <span class="text-[10px] text-muted/70">
              Printer mapping now lives under Settings.
            </span>
          </div>
        </div>
      </div>

      {#if false}
      <div class="glass-panel rounded-xl p-5 border border-white/5 bg-surface/20">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-1">Express Onboarding</div>
            <div class="text-sm text-ink/90 leading-snug">
              Log in once, pick company and POS, and auto-connect both agents.
            </div>
          </div>
          <div class={`px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${pillTone(setupToken ? "ok" : (setupMfaToken ? "warn" : "neutral"))}`}>
            {setupToken ? "Connected" : (setupMfaToken ? "MFA Required" : "Not Connected")}
          </div>
        </div>

        {#if setupErr}
          <div class="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 font-mono">{setupErr}</div>
        {/if}
        {#if setupNotice}
          <div class="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 font-mono">{setupNotice}</div>
        {/if}

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="text-[10px] font-bold text-muted uppercase tracking-wide mb-1.5 block" for="setup_api_base_url">Cloud API URL</label>
            <input
              id="setup_api_base_url"
              class="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 font-mono text-xs focus:ring-2 focus:ring-accent/50 focus:border-accent/50 focus:outline-none transition-all placeholder-muted/30 text-ink"
              placeholder="https://app.melqard.com/api"
              bind:value={setupApiBase}
              disabled={setupBusy}
            />
          </div>
          <div>
            <label class="text-[10px] font-bold text-muted uppercase tracking-wide mb-1.5 block" for="setup_email">Email</label>
            <input
              id="setup_email"
              class="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-accent/50 focus:border-accent/50 focus:outline-none transition-all placeholder-muted/30 text-ink"
              placeholder="name@company.com"
              bind:value={setupEmail}
              disabled={setupBusy || !!setupToken}
            />
          </div>
          <div>
            <label class="text-[10px] font-bold text-muted uppercase tracking-wide mb-1.5 block" for="setup_password">Password</label>
            <input
              id="setup_password"
              type="password"
              class="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-accent/50 focus:border-accent/50 focus:outline-none transition-all placeholder-muted/30 text-ink"
              placeholder="••••••••"
              bind:value={setupPassword}
              disabled={setupBusy || !!setupToken}
            />
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide border border-accent/30 bg-accent/20 text-accent hover:bg-accent/30 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/10 transition-all disabled:opacity-50 disabled:pointer-events-none"
            on:click={runSetupLogin}
            disabled={setupBusy || !!setupToken}
          >
            {setupBusy && !setupToken ? "Connecting..." : "Log In"}
          </button>
          <button
            type="button"
            class="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide border border-white/10 bg-white/5 text-muted hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
            on:click={() => { resetSetupSession(); setupErr = ""; setupNotice = ""; }}
            disabled={setupBusy}
          >
            Clear
          </button>
        </div>

        {#if setupMfaToken}
          <div class="mt-4 pt-4 border-t border-white/5 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
            <input
              class="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 font-mono text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none placeholder-muted/30 text-ink"
              placeholder="Enter MFA code"
              bind:value={setupMfaCode}
              disabled={setupBusy}
            />
            <button
              type="button"
              class="px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide border border-accent/30 bg-accent/20 text-accent hover:bg-accent/30 transition-all disabled:opacity-50"
              on:click={runSetupVerifyMfa}
              disabled={setupBusy}
            >
              Verify MFA
            </button>
          </div>
        {/if}

        {#if setupToken}
          <div class="mt-6 space-y-4 pt-2">
            <!-- Official Config Section -->
            <div class="rounded-xl border border-white/5 bg-black/20 p-4 space-y-4">
              <div class="flex items-center gap-2">
                <div class="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"></div>
                <div class="text-xs font-bold uppercase tracking-wider text-muted">Official Configuration</div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="md:col-span-2">
                  <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="setup_off_company">Company</label>
                  <select
                    id="setup_off_company"
                    class="w-full bg-surface/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none text-ink"
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
                  <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="setup_off_branch">Branch (optional)</label>
                  <select
                    id="setup_off_branch"
                    class="w-full bg-surface/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none text-ink"
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
                  <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="setup_off_device_pick">POS Source</label>
                  <select
                    id="setup_off_device_pick"
                    class="w-full bg-surface/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none text-ink"
                    bind:value={setupDevicePickOfficial}
                    on:change={() => applyPickedDevice("official")}
                    disabled={setupBusy}
                  >
                    <option value="">Select POS source...</option>
                    {#each setupDevicesOfficial as d}
                      <option value={d.device_code}>{d.device_code}{d.branch_name ? ` (${d.branch_name})` : ""}</option>
                    {/each}
                  </select>
                </div>
              </div>
              {#if setupDevicesOfficial.length === 0}
                <div class="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-muted">
                  No POS sources found for Official. Check `pos:manage` access and device setup in Admin.
                </div>
              {/if}
            </div>

            <!-- Unofficial Config Section -->
            {#if dualOnboardingEnabled}
              <div class="rounded-xl border border-white/5 bg-black/20 p-4 space-y-4">
                 <div class="flex items-center gap-2">
                   <div class="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]"></div>
                   <div class="text-xs font-bold uppercase tracking-wider text-muted">Unofficial Configuration</div>
                 </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="md:col-span-2">
                    <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="setup_un_company">Company</label>
                    <select
                      id="setup_un_company"
                      class="w-full bg-surface/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none text-ink"
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
                    <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="setup_un_branch">Branch (optional)</label>
                    <select
                      id="setup_un_branch"
                      class="w-full bg-surface/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none text-ink"
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
                    <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="setup_un_device_pick">POS Source</label>
                    <select
                      id="setup_un_device_pick"
                      class="w-full bg-surface/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-accent/50 focus:outline-none text-ink"
                      bind:value={setupDevicePickUnofficial}
                      on:change={() => applyPickedDevice("unofficial")}
                      disabled={setupBusy}
                    >
                      <option value="">Select POS source...</option>
                      {#each setupDevicesUnofficial as d}
                        <option value={d.device_code}>{d.device_code}{d.branch_name ? ` (${d.branch_name})` : ""}</option>
                      {/each}
                    </select>
                  </div>
                </div>
                {#if setupDevicesUnofficial.length === 0}
                  <div class="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-muted">
                    No POS sources found for Unofficial. Check `pos:manage` access and device setup in Admin.
                  </div>
                {/if}
              </div>
            {/if}

            <div class="pt-2">
              <button
                type="button"
                class="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-lg tracking-wide shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 disabled:grayscale"
                on:click={applyExpressSetup}
                disabled={setupBusy}
              >
                {setupBusy ? "Applying Setup..." : "Apply Express Setup"}
              </button>
            </div>
          </div>
        {/if}
      </div>
      {/if}
    </div>
  </section>

  <!-- Right column: manual config -->
  <section class="glass-panel rounded-[2rem] p-6 overflow-hidden flex flex-col gap-6 relative group/manual">
    <div class="absolute inset-0 bg-surface/30 pointer-events-none rounded-[2rem]"></div>
    
    <header class="relative z-10 shrink-0 border-b border-white/5 pb-4 flex items-center justify-between">
      <h2 class="text-2xl font-bold tracking-tight text-ink">Manual Config</h2>
      <div class="flex gap-2">
        <button
          class="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs font-bold text-muted hover:text-white hover:bg-white/10 transition-colors"
          on:click={() => runBench(benchCount)}
          disabled={benchBusy}
          title="Run local database stress test"
        >
          {benchBusy ? "Running..." : "Run Benchmark"}
        </button>
      </div>
    </header>

    <div class="relative z-10 flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
      <!-- Benchmark Results -->
      {#if benchErr}
        <div class="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300 text-sm">{benchErr}</div>
      {/if}
      {#if benchRuns.length > 0}
        <div class="glass-panel rounded-xl p-4 border border-white/5 bg-surface/20">
          <h3 class="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-3">Benchmark Results (Last {benchRuns.length})</h3>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead>
                <tr class="border-b border-white/5 text-muted/60">
                  <th class="py-2 pl-2">Time</th>
                  <th class="py-2">Write (ms)</th>
                  <th class="py-2">Read (ms)</th>
                  <th class="py-2">Items</th>
                </tr>
              </thead>
              <tbody class="font-mono">
                {#each benchRuns as run}
                  <tr class="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                    <td class="py-2 pl-2 text-ink">{fmtTime(run.timestamp)}</td>
                    <td class="py-2 text-accent/80">{fmtMs(run.write_ms)}</td>
                    <td class="py-2 text-sky-400/80">{fmtMs(run.read_ms)}</td>
                    <td class="py-2 text-muted">{run.item_count}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}

      <div class="glass-panel rounded-xl p-4 border border-white/5 bg-surface/20">
        <h3 class="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-3">POS Display</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="pos_price_display_mode">Default Price Display</label>
            <select
              id="pos_price_display_mode"
              class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold focus:ring-1 focus:ring-accent/50 focus:outline-none text-ink"
              value={vatDisplayMode}
              on:change={(e) => onVatDisplayModeChange(e?.target?.value || "both")}
            >
              <option value="ex">Ex VAT</option>
              <option value="inc">Incl VAT</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div class="rounded-xl border border-white/5 bg-surface-highlight/20 px-3 py-2 flex items-center justify-between gap-3">
            <div class="text-xs text-ink/90">Show quick buttons in checkout</div>
            <label class="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                class="accent-accent w-4 h-4"
                checked={showPriceDisplayControls}
                on:change={(e) => onShowPriceDisplayControlsChange(!!e?.target?.checked)}
              />
            </label>
          </div>
        </div>
        <p class="mt-2 text-[10px] text-muted/70">
          Keep this off to save vertical space. Checkout will still use the default mode selected above.
        </p>
      </div>

      <!-- Official Manual -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]"></div>
            <h3 class="text-sm font-bold uppercase tracking-widest text-emerald-400">Official</h3>
          </div>
          <div class="flex gap-2">
            <span class={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${pillTone(syncOff.kind)}`}>{syncOff.text}</span>
            <button class="text-xs text-muted hover:text-white underline underline-offset-2 transition-colors" on:click={() => runTest('official')} disabled={busy}>Check Connectivity</button>
          </div>
        </div>

        <div class="glass-panel rounded-xl p-5 border border-white/5 bg-surface/20 space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="md:col-span-2">
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="off_api">API Base URL</label>
              <input id="off_api" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none text-ink" bind:value={off.api_base_url} />
            </div>
            <div>
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="off_co">Company ID</label>
              <input id="off_co" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none text-ink" bind:value={off.company_id} />
            </div>
            <div>
              <div class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1">POS Source</div>
              <div class="w-full bg-black/10 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs text-ink/80">
                {off.device_code || "Not selected"}
              </div>
            </div>
            <div>
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="off_br">Branch ID</label>
              <input id="off_br" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none text-ink" bind:value={off.branch_id} />
            </div>
            <div>
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="off_curr">Currency</label>
              <input id="off_curr" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none text-ink" bind:value={off.pricing_currency} />
            </div>
            <div>
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="off_rate">Exchange Rate</label>
              <input id="off_rate" type="number" step="100" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none text-ink" bind:value={off.exchange_rate} />
            </div>
          </div>
          <div class="text-[11px] text-muted/80 bg-surface-highlight/30 border border-white/5 rounded-lg px-3 py-2">
            VAT is derived from company settings and cannot be edited here. Run Pull Sync to refresh after company/device changes.
            Current: <span class="font-mono text-ink">{vatPercentText(officialConfig)}</span>
          </div>
          
          <div class="pt-2 border-t border-white/5">
             <div class="flex items-center justify-between mb-2">
               <label class="text-[10px] text-muted font-bold uppercase tracking-wide" for="off_token">Device Token</label>
               <span class="text-[10px] text-muted/60 uppercase font-mono">{hasTokenText(officialConfig)}</span>
             </div>
             <div class="flex gap-2">
                <input id="off_token" class="flex-1 bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none text-ink placeholder-muted/20" placeholder="(Hidden) Enter new to overwrite" bind:value={offTokenDraft} />
                 <label class="flex items-center gap-2 text-xs text-muted cursor-pointer hover:text-red-300 transition-colors">
                  <input type="checkbox" bind:checked={offClearToken} class="accent-red-500 w-3.5 h-3.5" />
                  Clear
                </label>
             </div>
          </div>

          <div class="flex flex-wrap gap-2 pt-2">
             <button class="px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/30 transition-all disabled:opacity-50" on:click={() => saveOne('official')} disabled={busy}>Save Official</button>
             <button class="px-4 py-2 rounded-xl bg-white/5 text-muted hover:text-ink hover:bg-white/10 border border-white/5 text-xs font-bold transition-all disabled:opacity-50" on:click={() => runPull('official')} disabled={busy}>Pull Sync</button>
             <button class="px-4 py-2 rounded-xl bg-white/5 text-muted hover:text-ink hover:bg-white/10 border border-white/5 text-xs font-bold transition-all disabled:opacity-50" on:click={() => runPush('official')} disabled={busy}>Push Sync</button>
          </div>
        </div>
      </div>

      <!-- Unofficial Manual -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]"></div>
            <h3 class="text-sm font-bold uppercase tracking-widest text-amber-400">Unofficial</h3>
          </div>
          <div class="flex gap-2">
            <span class={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${pillTone(syncUn.kind)}`}>{syncUn.text}</span>
            <button class="text-xs text-muted hover:text-white underline underline-offset-2 transition-colors" on:click={() => runTest('unofficial')} disabled={busy}>Check Connectivity</button>
          </div>
        </div>

        <div class="glass-panel rounded-xl p-5 border border-white/5 bg-surface/20 space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="md:col-span-2">
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="un_api">API Base URL</label>
              <input id="un_api" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 focus:outline-none text-ink" bind:value={un.api_base_url} />
            </div>
            <div>
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="un_co">Company ID</label>
              <input id="un_co" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 focus:outline-none text-ink" bind:value={un.company_id} />
            </div>
            <div>
              <div class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1">POS Source</div>
              <div class="w-full bg-black/10 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs text-ink/80">
                {un.device_code || "Not selected"}
              </div>
            </div>
            <div>
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="un_br">Branch ID</label>
              <input id="un_br" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 focus:outline-none text-ink" bind:value={un.branch_id} />
            </div>
            <div>
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="un_curr">Currency</label>
              <input id="un_curr" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 focus:outline-none text-ink" bind:value={un.pricing_currency} />
            </div>
            <div>
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="un_rate">Exchange Rate</label>
              <input id="un_rate" type="number" step="100" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 focus:outline-none text-ink" bind:value={un.exchange_rate} />
            </div>
            <div>
              <label class="text-[10px] text-muted font-bold uppercase tracking-wide mb-1 block" for="un_warn">Warn Stale Minutes</label>
              <input id="un_warn" type="number" class="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 focus:outline-none text-ink" bind:value={un.outbox_stale_warn_minutes} />
            </div>
          </div>
          <div class="text-[11px] text-muted/80 bg-surface-highlight/30 border border-white/5 rounded-lg px-3 py-2">
            VAT is derived from company settings and cannot be edited here. Run Pull Sync to refresh after company/device changes.
            Current: <span class="font-mono text-ink">{vatPercentText(unofficialConfig)}</span>
          </div>
          
          <div class="pt-2 border-t border-white/5">
             <div class="flex items-center justify-between mb-2">
               <label class="text-[10px] text-muted font-bold uppercase tracking-wide" for="un_token">Device Token</label>
               <span class="text-[10px] text-muted/60 uppercase font-mono">{hasTokenText(unofficialConfig)}</span>
             </div>
             <div class="flex gap-2">
                <input id="un_token" class="flex-1 bg-black/20 border border-white/10 rounded-xl px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 focus:outline-none text-ink placeholder-muted/20" placeholder="(Hidden) Enter new to overwrite" bind:value={unTokenDraft} />
                <label class="flex items-center gap-2 text-xs text-muted cursor-pointer hover:text-red-300 transition-colors">
                  <input type="checkbox" bind:checked={unClearToken} class="accent-red-500 w-3.5 h-3.5" />
                  Clear
                </label>
             </div>
          </div>

          <div class="flex flex-wrap gap-2 pt-2">
             <button class="px-4 py-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold hover:bg-amber-500/30 transition-all disabled:opacity-50" on:click={() => saveOne('unofficial')} disabled={busy}>Save Unofficial</button>
             <button class="px-4 py-2 rounded-xl bg-white/5 text-muted hover:text-ink hover:bg-white/10 border border-white/5 text-xs font-bold transition-all disabled:opacity-50" on:click={() => runPull('unofficial')} disabled={busy}>Pull Sync</button>
             <button class="px-4 py-2 rounded-xl bg-white/5 text-muted hover:text-ink hover:bg-white/10 border border-white/5 text-xs font-bold transition-all disabled:opacity-50" on:click={() => runPush('unofficial')} disabled={busy}>Push Sync</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  /* Custom Scrollbar for Settings */
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 9999px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 9999px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
  }
</style>
