"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

type TaxCode = { id: string; name: string; rate: string | number; tax_type: string; reporting_currency: string };
type ExchangeRateRow = { id: string; rate_date: string; rate_type: string; usd_to_lbp: string | number };
type AccountRole = { code: string; description: string };
type CoaAccount = { id: string; account_code: string; name_en: string; is_postable: boolean };
type AccountDefaultRow = { role_code: string; account_code: string; name_en: string };
type PaymentMethodRow = { method: string; role_code: string; created_at: string };
type CompanySettingRow = { key: string; value_json: any; updated_at: string };

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ConfigPage() {
  const [status, setStatus] = useState("");

  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [rates, setRates] = useState<ExchangeRateRow[]>([]);
  const [roles, setRoles] = useState<AccountRole[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [defaults, setDefaults] = useState<AccountDefaultRow[]>([]);
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [settings, setSettings] = useState<CompanySettingRow[]>([]);

  // Loyalty settings (company_settings.key='loyalty')
  const [pointsPerUsd, setPointsPerUsd] = useState("0");
  const [pointsPerLbp, setPointsPerLbp] = useState("0");
  const [savingLoyalty, setSavingLoyalty] = useState(false);

  // AI policy (company_settings.key='ai')
  const [allowExternalAi, setAllowExternalAi] = useState(true);
  const [aiProvider, setAiProvider] = useState("openai");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiItemModel, setAiItemModel] = useState("");
  const [aiInvoiceVisionModel, setAiInvoiceVisionModel] = useState("");
  const [aiInvoiceTextModel, setAiInvoiceTextModel] = useState("");
  const [savingAiPolicy, setSavingAiPolicy] = useState(false);

  // Inventory policy (company_settings.key='inventory')
  const [requireManualLotSelection, setRequireManualLotSelection] = useState(false);
  const [savingInventoryPolicy, setSavingInventoryPolicy] = useState(false);

  // AP 3-way match policy (company_settings.key='ap_3way_match')
  const [apPctThreshold, setApPctThreshold] = useState("0.15");
  const [apAbsUsdThreshold, setApAbsUsdThreshold] = useState("25");
  const [apAbsLbpThreshold, setApAbsLbpThreshold] = useState("2500000");
  const [apTaxDiffPctThreshold, setApTaxDiffPctThreshold] = useState("0.02");
  const [apTaxDiffLbpThreshold, setApTaxDiffLbpThreshold] = useState("500000");
  const [savingApPolicy, setSavingApPolicy] = useState(false);

  // Pricing policy (company_settings.key='pricing_policy')
  const [targetMarginPct, setTargetMarginPct] = useState("0.20");
  const [usdRoundStep, setUsdRoundStep] = useState("0.25");
  const [lbpRoundStep, setLbpRoundStep] = useState("5000");
  const [savingPricingPolicy, setSavingPricingPolicy] = useState(false);

  // Tax code form
  const [taxName, setTaxName] = useState("");
  const [taxRate, setTaxRate] = useState("11");
  const [taxType, setTaxType] = useState("vat");
  const [taxCurrency, setTaxCurrency] = useState("LBP");
  const [taxOpen, setTaxOpen] = useState(false);
  const [savingTax, setSavingTax] = useState(false);

  // Exchange rate form
  const [rateDate, setRateDate] = useState(todayISO());
  const [rateType, setRateType] = useState("market");
  const [usdToLbp, setUsdToLbp] = useState("90000");
  const [rateOpen, setRateOpen] = useState(false);
  const [savingRate, setSavingRate] = useState(false);

  // Account defaults form
  const [defaultRole, setDefaultRole] = useState("");
  const [defaultAccountCode, setDefaultAccountCode] = useState("");
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);

  // Payment method mapping form
  const [methodName, setMethodName] = useState("cash");
  const [methodRole, setMethodRole] = useState("");
  const [methodOpen, setMethodOpen] = useState(false);
  const [savingMethod, setSavingMethod] = useState(false);

  const accountByCode = useMemo(() => new Map(accounts.map((a) => [a.account_code, a])), [accounts]);
  const defaultByRole = useMemo(() => new Map(defaults.map((d) => [d.role_code, d])), [defaults]);

  async function load() {
    setStatus("Loading...");
    try {
      const [tc, er, ar, ca, ad, pm, cs] = await Promise.all([
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes"),
        apiGet<{ rates: ExchangeRateRow[] }>("/config/exchange-rates"),
        apiGet<{ roles: AccountRole[] }>("/config/account-roles"),
        apiGet<{ accounts: CoaAccount[] }>("/coa/accounts"),
        apiGet<{ defaults: AccountDefaultRow[] }>("/config/account-defaults"),
        apiGet<{ methods: PaymentMethodRow[] }>("/config/payment-methods"),
        apiGet<{ settings: CompanySettingRow[] }>("/pricing/company-settings")
      ]);
      setTaxCodes(tc.tax_codes || []);
      setRates(er.rates || []);
      setRoles(ar.roles || []);
      setAccounts(ca.accounts || []);
      setDefaults(ad.defaults || []);
      setMethods(pm.methods || []);
      setSettings(cs.settings || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const loyalty = settings.find((s) => s.key === "loyalty");
    const v = (loyalty?.value_json || {}) as any;
    setPointsPerUsd(String(v?.points_per_usd ?? 0));
    setPointsPerLbp(String(v?.points_per_lbp ?? 0));
  }, [settings]);

  useEffect(() => {
    const ai = settings.find((s) => s.key === "ai");
    const v = (ai?.value_json || {}) as any;
    setAllowExternalAi(Boolean(v?.allow_external_processing ?? true));
    setAiProvider(String(v?.provider || "openai"));
    setAiBaseUrl(String(v?.base_url || ""));
    setAiApiKey(String(v?.api_key || ""));
    setAiItemModel(String(v?.item_naming_model || ""));
    setAiInvoiceVisionModel(String(v?.invoice_vision_model || ""));
    setAiInvoiceTextModel(String(v?.invoice_text_model || ""));
  }, [settings]);

  useEffect(() => {
    const inv = settings.find((s) => s.key === "inventory");
    const v = (inv?.value_json || {}) as any;
    setRequireManualLotSelection(Boolean(v?.require_manual_lot_selection ?? false));
  }, [settings]);

  useEffect(() => {
    const ap = settings.find((s) => s.key === "ap_3way_match");
    const v = (ap?.value_json || {}) as any;
    setApPctThreshold(String(v?.pct_threshold ?? "0.15"));
    setApAbsUsdThreshold(String(v?.abs_usd_threshold ?? "25"));
    setApAbsLbpThreshold(String(v?.abs_lbp_threshold ?? "2500000"));
    setApTaxDiffPctThreshold(String(v?.tax_diff_pct_threshold ?? "0.02"));
    setApTaxDiffLbpThreshold(String(v?.tax_diff_lbp_threshold ?? "500000"));
  }, [settings]);

  useEffect(() => {
    const pp = settings.find((s) => s.key === "pricing_policy");
    const v = (pp?.value_json || {}) as any;
    setTargetMarginPct(String(v?.target_margin_pct ?? "0.20"));
    setUsdRoundStep(String(v?.usd_round_step ?? "0.25"));
    setLbpRoundStep(String(v?.lbp_round_step ?? "5000"));
  }, [settings]);

  useEffect(() => {
    if (!defaultRole && roles.length) setDefaultRole(roles[0]?.code || "");
    if (!methodRole && roles.length) setMethodRole(roles[0]?.code || "");
  }, [roles, defaultRole, methodRole]);

  async function createTaxCode(e: React.FormEvent) {
    e.preventDefault();
    if (!taxName.trim()) {
      setStatus("tax code name is required");
      return;
    }
    setSavingTax(true);
    setStatus("Saving tax code...");
    try {
      await apiPost("/config/tax-codes", {
        name: taxName.trim(),
        rate: Number(taxRate || 0),
        tax_type: taxType || "vat",
        reporting_currency: taxCurrency || "LBP"
      });
      setTaxName("");
      setTaxOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingTax(false);
    }
  }

  async function upsertRate(e: React.FormEvent) {
    e.preventDefault();
    if (!rateDate) {
      setStatus("rate_date is required");
      return;
    }
    setSavingRate(true);
    setStatus("Saving exchange rate...");
    try {
      await apiPost("/config/exchange-rates", {
        rate_date: rateDate,
        rate_type: rateType || "market",
        usd_to_lbp: Number(usdToLbp || 0)
      });
      setRateOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingRate(false);
    }
  }

  async function setDefault(e: React.FormEvent) {
    e.preventDefault();
    if (!defaultRole) {
      setStatus("role_code is required");
      return;
    }
    if (!defaultAccountCode) {
      setStatus("account_code is required");
      return;
    }
    setSavingDefault(true);
    setStatus("Saving account default...");
    try {
      await apiPost("/config/account-defaults", {
        role_code: defaultRole,
        account_code: defaultAccountCode
      });
      setDefaultAccountCode("");
      setDefaultOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingDefault(false);
    }
  }

  async function upsertMethod(e: React.FormEvent) {
    e.preventDefault();
    if (!methodName.trim()) {
      setStatus("method is required");
      return;
    }
    if (!methodRole) {
      setStatus("role_code is required");
      return;
    }
    setSavingMethod(true);
    setStatus("Saving payment method mapping...");
    try {
      await apiPost("/config/payment-methods", {
        method: methodName.trim(),
        role_code: methodRole
      });
      setMethodOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingMethod(false);
    }
  }

  async function savePricingPolicy(e: React.FormEvent) {
    e.preventDefault();
    setSavingPricingPolicy(true);
    setStatus("Saving pricing policy...");
    try {
      await apiPost("/pricing/company-settings", {
        key: "pricing_policy",
        value_json: {
          target_margin_pct: Number(targetMarginPct || 0),
          usd_round_step: Number(usdRoundStep || 0),
          lbp_round_step: Number(lbpRoundStep || 0),
        },
      });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingPricingPolicy(false);
    }
  }

  async function saveLoyalty(e: React.FormEvent) {
    e.preventDefault();
    setSavingLoyalty(true);
    setStatus("Saving loyalty settings...");
    try {
      await apiPost("/pricing/company-settings", {
        key: "loyalty",
        value_json: {
          points_per_usd: Number(pointsPerUsd || 0),
          points_per_lbp: Number(pointsPerLbp || 0)
        }
      });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingLoyalty(false);
    }
  }

  async function saveAi(e: React.FormEvent) {
    e.preventDefault();
    setSavingAiPolicy(true);
    setStatus("Saving AI policy...");
    try {
      const ai = settings.find((s) => s.key === "ai");
      const current = (ai?.value_json || {}) as any;
      await apiPost("/pricing/company-settings", {
        key: "ai",
        value_json: {
          ...current,
          allow_external_processing: Boolean(allowExternalAi),
          provider: (aiProvider || "openai").trim(),
          base_url: aiBaseUrl.trim() || null,
          api_key: aiApiKey.trim() || null,
          item_naming_model: aiItemModel.trim() || null,
          invoice_vision_model: aiInvoiceVisionModel.trim() || null,
          invoice_text_model: aiInvoiceTextModel.trim() || null
        }
      });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingAiPolicy(false);
    }
  }

  async function saveInventory(e: React.FormEvent) {
    e.preventDefault();
    setSavingInventoryPolicy(true);
    setStatus("Saving inventory policy...");
    try {
      const inv = settings.find((s) => s.key === "inventory");
      const current = (inv?.value_json || {}) as any;
      await apiPost("/pricing/company-settings", {
        key: "inventory",
        value_json: {
          ...current,
          require_manual_lot_selection: Boolean(requireManualLotSelection)
        }
      });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingInventoryPolicy(false);
    }
  }

  async function saveApPolicy(e: React.FormEvent) {
    e.preventDefault();
    setSavingApPolicy(true);
    setStatus("Saving AP 3-way match policy...");
    try {
      await apiPost("/pricing/company-settings", {
        key: "ap_3way_match",
        value_json: {
          pct_threshold: Number(apPctThreshold || 0),
          abs_usd_threshold: Number(apAbsUsdThreshold || 0),
          abs_lbp_threshold: Number(apAbsLbpThreshold || 0),
          tax_diff_pct_threshold: Number(apTaxDiffPctThreshold || 0),
          tax_diff_lbp_threshold: Number(apTaxDiffLbpThreshold || 0)
        }
      });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingApPolicy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <div className="flex items-center justify-end">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Inventory Policy</CardTitle>
            <CardDescription>Operational guardrails for batch/expiry-managed items.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={saveInventory} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Manual Lot Selection Required</label>
                <select
                  className="ui-select"
                  value={requireManualLotSelection ? "yes" : "no"}
                  onChange={(e) => setRequireManualLotSelection(e.target.value === "yes")}
                >
                  <option value="no">no (auto-FEFO allowed)</option>
                  <option value="yes">yes (POS must select a batch/expiry)</option>
                </select>
                <p className="text-xs text-fg-muted">
                  When enabled, sales posting for expiry/batch-tracked items requires explicit lot selection (no auto allocation).
                </p>
              </div>
              <div className="md:col-span-1 flex items-end justify-end">
                <Button type="submit" disabled={savingInventoryPolicy}>
                  {savingInventoryPolicy ? "..." : "Save Inventory Policy"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AP 3-Way Match Policy</CardTitle>
            <CardDescription>Variance thresholds that auto-hold supplier invoices linked to goods receipts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={saveApPolicy} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Pct Threshold</label>
                <Input value={apPctThreshold} onChange={(e) => setApPctThreshold(e.target.value)} placeholder="0.15" />
                <div className="text-[11px] text-fg-subtle">Example: 0.15 = 15%</div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Abs USD Threshold</label>
                <Input value={apAbsUsdThreshold} onChange={(e) => setApAbsUsdThreshold(e.target.value)} placeholder="25" />
                <div className="text-[11px] text-fg-subtle">Per-unit difference (USD)</div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Abs LBP Threshold</label>
                <Input value={apAbsLbpThreshold} onChange={(e) => setApAbsLbpThreshold(e.target.value)} placeholder="2500000" />
                <div className="text-[11px] text-fg-subtle">Fallback when only LBP is present</div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Tax Diff Pct</label>
                <Input value={apTaxDiffPctThreshold} onChange={(e) => setApTaxDiffPctThreshold(e.target.value)} placeholder="0.02" />
                <div className="text-[11px] text-fg-subtle">Tax mismatch threshold (% of base)</div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Tax Diff LBP</label>
                <Input value={apTaxDiffLbpThreshold} onChange={(e) => setApTaxDiffLbpThreshold(e.target.value)} placeholder="500000" />
                <div className="text-[11px] text-fg-subtle">Minimum absolute tax mismatch (LBP)</div>
              </div>
              <div className="flex items-end justify-end md:col-span-6">
                <Button type="submit" disabled={savingApPolicy}>
                  {savingApPolicy ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pricing Policy</CardTitle>
            <CardDescription>Controls suggested sell prices (target margin + rounding).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={savePricingPolicy} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Target Margin (pct)</label>
                <Input value={targetMarginPct} onChange={(e) => setTargetMarginPct(e.target.value)} placeholder="0.20" />
                <div className="text-[11px] text-fg-subtle">Example: 0.20 = 20% gross margin target</div>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">USD Round Step</label>
                <Input value={usdRoundStep} onChange={(e) => setUsdRoundStep(e.target.value)} placeholder="0.25" />
                <div className="text-[11px] text-fg-subtle">Suggested USD prices round up to this step</div>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">LBP Round Step</label>
                <Input value={lbpRoundStep} onChange={(e) => setLbpRoundStep(e.target.value)} placeholder="5000" />
                <div className="text-[11px] text-fg-subtle">Suggested LBP prices round up to this step</div>
              </div>
              <div className="flex items-end justify-end md:col-span-6">
                <Button type="submit" disabled={savingPricingPolicy}>
                  {savingPricingPolicy ? "Saving..." : "Save Pricing Policy"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account Defaults</CardTitle>
            <CardDescription>
              These mappings are required for automatic GL posting (POS sales, goods receipts, supplier invoices, payments).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-end">
              <Dialog open={defaultOpen} onOpenChange={setDefaultOpen}>
                <DialogTrigger asChild>
                  <Button>Set Default</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Set Account Default</DialogTitle>
                    <DialogDescription>
                      Maps an account role (AR, SALES, VAT_PAYABLE, etc.) to a company COA account.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={setDefault} className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Role</label>
                      <select
                        className="ui-select"
                        value={defaultRole}
                        onChange={(e) => setDefaultRole(e.target.value)}
                      >
                        <option value="">Select role...</option>
                        {roles.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.code} · {r.description}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">Account</label>
                      <select
                        className="ui-select"
                        value={defaultAccountCode}
                        onChange={(e) => setDefaultAccountCode(e.target.value)}
                      >
                        <option value="">Select account...</option>
                        {accounts.map((a) => (
                          <option key={a.account_code} value={a.account_code}>
                            {a.account_code} · {a.name_en}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-3 flex justify-end">
                      <Button type="submit" disabled={savingDefault}>
                        {savingDefault ? "..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => {
                    const d = defaultByRole.get(r.code);
                    const a = d?.account_code ? accountByCode.get(d.account_code) : undefined;
                    return (
                      <tr key={r.code} className="ui-tr-hover">
                        <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                        <td className="px-3 py-2 font-mono text-xs">{d?.account_code || "-"}</td>
                        <td className="px-3 py-2 text-xs text-fg-muted">{a?.name_en || d?.name_en || "-"}</td>
                      </tr>
                    );
                  })}
                  {roles.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={3}>
                        No roles found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Loyalty</CardTitle>
            <CardDescription>
              Configure loyalty points accrual. POS and posted sales invoices will accrue points; returns and invoice voids reverse them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={saveLoyalty} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Points per USD</label>
                <Input value={pointsPerUsd} onChange={(e) => setPointsPerUsd(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Points per LL</label>
                <Input value={pointsPerLbp} onChange={(e) => setPointsPerLbp(e.target.value)} />
              </div>
              <div className="flex items-end justify-end">
                <Button type="submit" disabled={savingLoyalty}>
                  {savingLoyalty ? "Saving..." : "Save Loyalty"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Policy</CardTitle>
            <CardDescription>
              Controls whether the platform can send documents/names to external AI services and which provider to use.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={saveAi} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="flex items-center gap-2 text-sm text-fg-muted md:col-span-3">
                <input type="checkbox" checked={allowExternalAi} onChange={(e) => setAllowExternalAi(e.target.checked)} />
                Allow external AI processing
              </label>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Provider</label>
                <select className="ui-select w-full" value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
                  <option value="openai">OpenAI (hosted)</option>
                  <option value="openai_compatible">OpenAI-compatible (custom base URL)</option>
                </select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Base URL (optional)</label>
                <Input
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com"
                />
              </div>
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-fg-muted">API Key (optional)</label>
                <Input
                  type="password"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder="Leave blank to use server environment"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Item Naming Model</label>
                <Input value={aiItemModel} onChange={(e) => setAiItemModel(e.target.value)} placeholder="gpt-4o-mini" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Invoice Vision Model</label>
                <Input
                  value={aiInvoiceVisionModel}
                  onChange={(e) => setAiInvoiceVisionModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Invoice Text Model</label>
                <Input
                  value={aiInvoiceTextModel}
                  onChange={(e) => setAiInvoiceTextModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                />
              </div>
              <div className="flex justify-end md:col-span-3">
                <Button type="submit" disabled={savingAiPolicy}>
                  {savingAiPolicy ? "Saving..." : "Save AI Policy"}
                </Button>
              </div>
            </form>
            <p className="text-[11px] text-fg-subtle">
              If disabled, AI import and AI naming will still work in “draft + attachment” mode, but without external
              extraction/suggestions. Leaving model/base URL/API key blank will fall back to server environment variables.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Method Mappings</CardTitle>
            <CardDescription>
              Map UI/payment method strings (cash, bank, card, transfer) to an account role, then configure the role’s account default above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-end">
              <Dialog open={methodOpen} onOpenChange={setMethodOpen}>
                <DialogTrigger asChild>
                  <Button>Upsert Mapping</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Upsert Payment Method Mapping</DialogTitle>
                    <DialogDescription>
                      Example methods: cash, bank, card, transfer. This decides which GL cash/bank account gets debited.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={upsertMethod} className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Method</label>
                      <Input value={methodName} onChange={(e) => setMethodName(e.target.value)} placeholder="cash / bank / card / transfer" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">Role</label>
                      <select
                        className="ui-select"
                        value={methodRole}
                        onChange={(e) => setMethodRole(e.target.value)}
                      >
                        <option value="">Select role...</option>
                        {roles.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.code} · {r.description}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-3 flex justify-end">
                      <Button type="submit" disabled={savingMethod}>
                        {savingMethod ? "..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Method</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map((m) => (
                    <tr key={m.method} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{m.method}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.role_code}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{m.created_at}</td>
                    </tr>
                  ))}
                  {methods.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={3}>
                        No payment method mappings yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tax Codes (VAT)</CardTitle>
            <CardDescription>Create and list tax codes used in invoices and reports.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-end">
              <Dialog open={taxOpen} onOpenChange={setTaxOpen}>
                <DialogTrigger asChild>
                  <Button>Create Tax Code</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Create Tax Code</DialogTitle>
                    <DialogDescription>Used on sales/purchase invoices and VAT reporting.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createTaxCode} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">Name</label>
                      <Input value={taxName} onChange={(e) => setTaxName(e.target.value)} placeholder="VAT 11%" />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Rate (%)</label>
                      <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Reporting Currency</label>
                      <select
                        className="ui-select"
                        value={taxCurrency}
                        onChange={(e) => setTaxCurrency(e.target.value)}
                      >
                        <option value="LBP">LL</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">Tax Type</label>
                      <Input value={taxType} onChange={(e) => setTaxType(e.target.value)} placeholder="vat" />
                    </div>
                    <div className="md:col-span-2 flex items-end justify-end">
                      <Button type="submit" disabled={savingTax}>
                        {savingTax ? "..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Currency</th>
                  </tr>
                </thead>
                <tbody>
                  {taxCodes.map((t) => (
                    <tr key={t.id} className="ui-tr-hover">
                      <td className="px-3 py-2">{t.name}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(t.rate || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}%
                      </td>
                      <td className="px-3 py-2">{t.tax_type}</td>
                      <td className="px-3 py-2">{t.reporting_currency}</td>
                    </tr>
                  ))}
                  {taxCodes.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                        No tax codes yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Exchange Rates</CardTitle>
            <CardDescription>USD to LL daily rates used for dual-currency reporting.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-end">
              <Dialog open={rateOpen} onOpenChange={setRateOpen}>
                <DialogTrigger asChild>
                  <Button>Upsert Rate</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Upsert Exchange Rate</DialogTitle>
                    <DialogDescription>
                      Used for dual-currency reporting and for documents that need a locked USD→LL rate.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={upsertRate} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Date</label>
                      <Input value={rateDate} onChange={(e) => setRateDate(e.target.value)} placeholder="YYYY-MM-DD" />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Type</label>
                      <Input value={rateType} onChange={(e) => setRateType(e.target.value)} placeholder="market" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">USD→LL</label>
                      <Input value={usdToLbp} onChange={(e) => setUsdToLbp(e.target.value)} />
                    </div>
                    <div className="md:col-span-4 flex justify-end">
                      <Button type="submit" disabled={savingRate}>
                        {savingRate ? "..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">USD→LL</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{r.rate_date}</td>
                      <td className="px-3 py-2">{r.rate_type}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(r.usd_to_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                  {rates.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={3}>
                        No exchange rates yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>);
}
