"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Settings } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost, getCompanyId } from "@/lib/api";
import { FALLBACK_FX_RATE_USD_LBP } from "@/lib/constants";
import { formatDateTime } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { ConfirmDialog } from "@/components/business/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TaxCode = {
  id: string;
  name: string;
  rate: string | number;
  tax_type: string;
  reporting_currency: string;
  item_refs?: number;
  tax_line_refs?: number;
};
type ExchangeRateRow = { id: string; rate_date: string; rate_type: string; usd_to_lbp: string | number };
type AccountRole = { code: string; description: string };
type CoaAccount = { id: string; account_code: string; name_en: string; is_postable: boolean };
type AccountDefaultRow = { role_code: string; account_code: string; name_en: string };
type PaymentMethodRow = { method: string; role_code: string; created_at: string };
type CompanySettingRow = { key: string; value_json: any; updated_at: string };
type CompanyProfile = {
  id: string;
  name: string;
  legal_name: string | null;
  registration_no: string | null;
  vat_no: string | null;
  base_currency: string;
  vat_currency: string;
  default_rate_type: string;
  created_at?: string;
  updated_at?: string;
};

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function taxRateToPercent(raw: string | number): number {
  const n = Number(raw || 0);
  if (!Number.isFinite(n)) return 0;
  return n <= 1 ? n * 100 : n;
}

function taxRateInputToDecimal(raw: string): number {
  const n = Number(raw || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? n / 100 : n;
}

const SALES_INVOICE_TEMPLATE_OPTIONS = [
  { id: "official_classic", label: "Client Invoice - No VAT (Temporary)" },
  { id: "official_compact", label: "Client Invoice - No VAT (Temporary Alias)" },
  { id: "standard", label: "Standard Invoice" },
];

export default function ConfigPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <ConfigPage />
    </Suspense>
  );
}

function ConfigPage() {
  const sp = useSearchParams();
  const tab = String(sp.get("tab") || "policies").trim() || "policies";
  const [status, setStatus] = useState("");
  const loading = status.startsWith("Loading");
  const statusIsBusy = /^(Loading|Saving|Updating|Creating|Deleting)\b/.test(status);

  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [rates, setRates] = useState<ExchangeRateRow[]>([]);
  const [roles, setRoles] = useState<AccountRole[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [defaults, setDefaults] = useState<AccountDefaultRow[]>([]);
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [settings, setSettings] = useState<CompanySettingRow[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);

  // Company profile
  const [companyEditName, setCompanyEditName] = useState("");
  const [companyEditLegalName, setCompanyEditLegalName] = useState("");
  const [companyEditRegistrationNo, setCompanyEditRegistrationNo] = useState("");
  const [companyEditVatNo, setCompanyEditVatNo] = useState("");
  const [companyEditBaseCurrency, setCompanyEditBaseCurrency] = useState("USD");
  const [companyEditVatCurrency, setCompanyEditVatCurrency] = useState("LBP");
  const [companyEditRateType, setCompanyEditRateType] = useState("market");
  const [companyOpen, setCompanyOpen] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);

  // Loyalty settings
  const [pointsPerUsd, setPointsPerUsd] = useState("0");
  const [pointsPerLbp, setPointsPerLbp] = useState("0");
  const [savingLoyalty, setSavingLoyalty] = useState(false);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);

  // AI policy
  const [allowExternalAi, setAllowExternalAi] = useState(true);
  const [aiProvider, setAiProvider] = useState("openai");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiItemModel, setAiItemModel] = useState("");
  const [aiInvoiceVisionModel, setAiInvoiceVisionModel] = useState("");
  const [aiInvoiceTextModel, setAiInvoiceTextModel] = useState("");
  const [savingAiPolicy, setSavingAiPolicy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Inventory policy
  const [requireManualLotSelection, setRequireManualLotSelection] = useState(false);
  const [savingInventoryPolicy, setSavingInventoryPolicy] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  // AP 3-way match policy
  const [apPctThreshold, setApPctThreshold] = useState("0.15");
  const [apAbsUsdThreshold, setApAbsUsdThreshold] = useState("25");
  const [apAbsLbpThreshold, setApAbsLbpThreshold] = useState("2500000");
  const [apTaxDiffPctThreshold, setApTaxDiffPctThreshold] = useState("0.02");
  const [apTaxDiffLbpThreshold, setApTaxDiffLbpThreshold] = useState("500000");
  const [savingApPolicy, setSavingApPolicy] = useState(false);
  const [apOpen, setApOpen] = useState(false);

  // Pricing policy
  const [targetMarginPct, setTargetMarginPct] = useState("0.20");
  const [usdRoundStep, setUsdRoundStep] = useState("0.25");
  const [lbpRoundStep, setLbpRoundStep] = useState("5000");
  const [savingPricingPolicy, setSavingPricingPolicy] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  // Print policy
  const [salesInvoicePdfTemplate, setSalesInvoicePdfTemplate] = useState("official_classic");
  const [savingPrintPolicy, setSavingPrintPolicy] = useState(false);
  const [printPolicyOpen, setPrintPolicyOpen] = useState(false);

  // Tax code form
  const [taxName, setTaxName] = useState("");
  const [taxRate, setTaxRate] = useState("11");
  const [taxType, setTaxType] = useState("vat");
  const [taxCurrency, setTaxCurrency] = useState("LBP");
  const [taxOpen, setTaxOpen] = useState(false);
  const [savingTax, setSavingTax] = useState(false);
  const [taxEditOpen, setTaxEditOpen] = useState(false);
  const [taxEditId, setTaxEditId] = useState("");
  const [taxEditName, setTaxEditName] = useState("");
  const [taxEditRate, setTaxEditRate] = useState("0");
  const [taxEditType, setTaxEditType] = useState("vat");
  const [taxEditCurrency, setTaxEditCurrency] = useState("LBP");
  const [savingTaxEdit, setSavingTaxEdit] = useState(false);
  const [deletingTaxId, setDeletingTaxId] = useState<string | null>(null);

  // Exchange rate form
  const [rateDate, setRateDate] = useState(todayISO());
  const [rateType, setRateType] = useState("market");
  const [usdToLbp, setUsdToLbp] = useState(String(FALLBACK_FX_RATE_USD_LBP));
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
  const accountDefaultsRows = useMemo(
    () =>
      roles.map((r) => {
        const d = defaultByRole.get(r.code);
        const a = d?.account_code ? accountByCode.get(d.account_code) : undefined;
        return {
          role_code: r.code,
          account_code: d?.account_code || "",
          name_en: a?.name_en || d?.name_en || "",
        };
      }),
    [roles, defaultByRole, accountByCode],
  );

  const accountDefaultsColumns = useMemo<ColumnDef<{ role_code: string; account_code: string; name_en: string }>[]>(
    () => [
      {
        id: "role_code",
        accessorFn: (r) => r.role_code,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.role_code}</span>,
      },
      {
        id: "account_code",
        accessorFn: (r) => r.account_code,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.account_code || "-"}</span>,
      },
      {
        id: "name_en",
        accessorFn: (r) => r.name_en,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.name_en || "-"}</span>,
      },
    ],
    [],
  );

  const paymentMethodColumns = useMemo<ColumnDef<PaymentMethodRow>[]>(
    () => [
      {
        id: "method",
        accessorFn: (m) => m.method,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Method" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.method}</span>,
      },
      {
        id: "role_code",
        accessorFn: (m) => m.role_code,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.role_code}</span>,
      },
      {
        id: "created_at",
        accessorFn: (m) => m.created_at,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => <span className="font-mono text-sm text-muted-foreground">{formatDateTime(row.original.created_at)}</span>,
      },
    ],
    [],
  );

  /* eslint-disable react-hooks/exhaustive-deps */
  const taxCodeColumns = useMemo<ColumnDef<TaxCode>[]>(
    () => [
      {
        id: "name",
        accessorFn: (t) => t.name,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="text-sm">{row.original.name}</span>,
      },
      {
        id: "rate",
        accessorFn: (t) => Number(t.rate || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Rate" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {taxRateToPercent(row.original.rate).toLocaleString("en-US", { maximumFractionDigits: 2 })}%
          </span>
        ),
      },
      {
        id: "tax_type",
        accessorFn: (t) => t.tax_type,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => <span className="text-sm">{row.original.tax_type}</span>,
      },
      {
        id: "reporting_currency",
        accessorFn: (t) => t.reporting_currency,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Currency" />,
        cell: ({ row }) => <Badge variant="secondary">{row.original.reporting_currency}</Badge>,
      },
      {
        id: "in_use",
        accessorFn: (t) => Number(t.item_refs || 0) + Number(t.tax_line_refs || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="In Use" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {(Number(row.original.item_refs || 0) + Number(row.original.tax_line_refs || 0)).toLocaleString("en-US")}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTaxEditId(t.id);
                  setTaxEditName(t.name || "");
                  setTaxEditRate(String(taxRateToPercent(t.rate)));
                  setTaxEditType(t.tax_type || "vat");
                  setTaxEditCurrency(t.reporting_currency || "LBP");
                  setTaxEditOpen(true);
                }}
              >
                Edit
              </Button>
              <ConfirmDialog
                title={`Delete tax code "${t.name}"?`}
                description="This cannot be undone."
                confirmLabel="Delete"
                variant="destructive"
                onConfirm={() => deleteTaxCode(t)}
                trigger={
                  <Button variant="ghost" size="sm" disabled={deletingTaxId === t.id}>
                    {deletingTaxId === t.id ? "Deleting..." : "Delete"}
                  </Button>
                }
              />
            </div>
          );
        },
      },
    ],
    [deletingTaxId],
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  const exchangeRateColumns = useMemo<ColumnDef<ExchangeRateRow>[]>(
    () => [
      {
        id: "rate_date",
        accessorFn: (r) => r.rate_date,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.rate_date}</span>,
      },
      {
        id: "rate_type",
        accessorFn: (r) => r.rate_type,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => <span className="text-sm">{row.original.rate_type}</span>,
      },
      {
        id: "usd_to_lbp",
        accessorFn: (r) => Number(r.usd_to_lbp || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="USD to LL" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {Number(row.original.usd_to_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        ),
      },
    ],
    [],
  );

  async function load() {
    setStatus("Loading...");
    try {
      const companyId = String(getCompanyId() || "").trim();
      const companyReq = companyId
        ? apiGet<{ company: CompanyProfile }>(`/companies/${encodeURIComponent(companyId)}`).catch(() => null)
        : Promise.resolve(null);
      const [tc, er, ar, ca, ad, pm, cs, co] = await Promise.all([
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes"),
        apiGet<{ rates: ExchangeRateRow[] }>("/config/exchange-rates"),
        apiGet<{ roles: AccountRole[] }>("/config/account-roles"),
        apiGet<{ accounts: CoaAccount[] }>("/coa/accounts"),
        apiGet<{ defaults: AccountDefaultRow[] }>("/config/account-defaults"),
        apiGet<{ methods: PaymentMethodRow[] }>("/config/payment-methods"),
        apiGet<{ settings: CompanySettingRow[] }>("/pricing/company-settings"),
        companyReq,
      ]);
      setTaxCodes(tc.tax_codes || []);
      setRates(er.rates || []);
      setRoles(ar.roles || []);
      setAccounts(ca.accounts || []);
      setDefaults(ad.defaults || []);
      setMethods(pm.methods || []);
      setSettings(cs.settings || []);
      setCompany(co?.company || null);
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
    const pol = settings.find((s) => s.key === "print_policy");
    const raw = String((pol?.value_json || {})?.sales_invoice_pdf_template || "").trim().toLowerCase();
    const allowed = SALES_INVOICE_TEMPLATE_OPTIONS.some((opt) => opt.id === raw);
    setSalesInvoicePdfTemplate(allowed ? raw : "official_classic");
  }, [settings]);

  useEffect(() => {
    if (!defaultRole && roles.length) setDefaultRole(roles[0]?.code || "");
    if (!methodRole && roles.length) setMethodRole(roles[0]?.code || "");
  }, [roles, defaultRole, methodRole]);

  useEffect(() => {
    setCompanyEditName(String(company?.name || ""));
    setCompanyEditLegalName(String(company?.legal_name || ""));
    setCompanyEditRegistrationNo(String(company?.registration_no || ""));
    setCompanyEditVatNo(String(company?.vat_no || ""));
    setCompanyEditBaseCurrency(String(company?.base_currency || "USD"));
    setCompanyEditVatCurrency(String(company?.vat_currency || "LBP"));
    setCompanyEditRateType(String(company?.default_rate_type || "market"));
  }, [company]);

  async function saveCompany(e: React.FormEvent): Promise<boolean> {
    e.preventDefault();
    if (!company?.id) { setStatus("company is not selected"); return false; }
    if (!companyEditName.trim()) { setStatus("company name is required"); return false; }
    setSavingCompany(true);
    setStatus("Saving company profile...");
    try {
      await apiPatch<{ company: CompanyProfile }>(`/companies/${encodeURIComponent(company.id)}`, {
        name: companyEditName.trim(),
        legal_name: companyEditLegalName.trim() || null,
        registration_no: companyEditRegistrationNo.trim() || null,
        vat_no: companyEditVatNo.trim() || null,
        base_currency: companyEditBaseCurrency || "USD",
        vat_currency: companyEditVatCurrency || "LBP",
        default_rate_type: companyEditRateType || "market",
      });
      await load();
      setStatus("");
      return true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSavingCompany(false);
    }
  }

  async function createTaxCode(e: React.FormEvent) {
    e.preventDefault();
    if (!taxName.trim()) { setStatus("tax code name is required"); return; }
    setSavingTax(true);
    setStatus("Saving tax code...");
    try {
      await apiPost("/config/tax-codes", { name: taxName.trim(), rate: taxRateInputToDecimal(taxRate), tax_type: taxType || "vat", reporting_currency: taxCurrency || "LBP" });
      setTaxName("");
      setTaxOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTax(false);
    }
  }

  async function updateTaxCode(e: React.FormEvent) {
    e.preventDefault();
    if (!taxEditId) { setStatus("tax code id is required"); return; }
    if (!taxEditName.trim()) { setStatus("tax code name is required"); return; }
    setSavingTaxEdit(true);
    setStatus("Updating tax code...");
    try {
      await apiPatch(`/config/tax-codes/${taxEditId}`, { name: taxEditName.trim(), rate: taxRateInputToDecimal(taxEditRate), tax_type: taxEditType || "vat", reporting_currency: taxEditCurrency || "LBP" });
      setTaxEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTaxEdit(false);
    }
  }

  async function deleteTaxCode(taxCode: TaxCode) {
    setDeletingTaxId(taxCode.id);
    setStatus(`Deleting tax code "${taxCode.name}"...`);
    try {
      await apiDelete(`/config/tax-codes/${taxCode.id}`);
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingTaxId(null);
    }
  }

  async function upsertRate(e: React.FormEvent) {
    e.preventDefault();
    if (!rateDate) { setStatus("rate_date is required"); return; }
    setSavingRate(true);
    setStatus("Saving exchange rate...");
    try {
      await apiPost("/config/exchange-rates", { rate_date: rateDate, rate_type: rateType || "market", usd_to_lbp: Number(usdToLbp || 0) });
      setRateOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingRate(false);
    }
  }

  async function setDefault(e: React.FormEvent) {
    e.preventDefault();
    if (!defaultRole) { setStatus("role_code is required"); return; }
    if (!defaultAccountCode) { setStatus("account_code is required"); return; }
    setSavingDefault(true);
    setStatus("Saving account default...");
    try {
      await apiPost("/config/account-defaults", { role_code: defaultRole, account_code: defaultAccountCode });
      setDefaultAccountCode("");
      setDefaultOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDefault(false);
    }
  }

  async function upsertMethod(e: React.FormEvent) {
    e.preventDefault();
    if (!methodName.trim()) { setStatus("method is required"); return; }
    if (!methodRole) { setStatus("role_code is required"); return; }
    setSavingMethod(true);
    setStatus("Saving payment method mapping...");
    try {
      await apiPost("/config/payment-methods", { method: methodName.trim(), role_code: methodRole });
      setMethodOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingMethod(false);
    }
  }

  async function savePolicySetting(key: string, value_json: any, setLoading: (v: boolean) => void, label: string): Promise<boolean> {
    setLoading(true);
    setStatus(`Saving ${label}...`);
    try {
      const current = ((settings.find((s) => s.key === key)?.value_json || {}) as any) || {};
      await apiPost("/pricing/company-settings", { key, value_json: { ...current, ...value_json } });
      await load();
      setStatus("");
      return true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function savePricingPolicy(e: React.FormEvent): Promise<boolean> {
    e.preventDefault();
    return savePolicySetting("pricing_policy", {
      target_margin_pct: Number(targetMarginPct || 0),
      usd_round_step: Number(usdRoundStep || 0),
      lbp_round_step: Number(lbpRoundStep || 0),
    }, setSavingPricingPolicy, "pricing policy");
  }

  async function savePrintPolicy(e: React.FormEvent): Promise<boolean> {
    e.preventDefault();
    const normalized = SALES_INVOICE_TEMPLATE_OPTIONS.some((opt) => opt.id === salesInvoicePdfTemplate) ? salesInvoicePdfTemplate : "official_classic";
    return savePolicySetting("print_policy", { sales_invoice_pdf_template: normalized }, setSavingPrintPolicy, "print policy");
  }

  async function saveLoyalty(e: React.FormEvent): Promise<boolean> {
    e.preventDefault();
    setSavingLoyalty(true);
    setStatus("Saving loyalty settings...");
    try {
      await apiPost("/pricing/company-settings", { key: "loyalty", value_json: { points_per_usd: Number(pointsPerUsd || 0), points_per_lbp: Number(pointsPerLbp || 0) } });
      await load();
      setStatus("");
      return true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSavingLoyalty(false);
    }
  }

  async function saveAi(e: React.FormEvent): Promise<boolean> {
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
          invoice_text_model: aiInvoiceTextModel.trim() || null,
        },
      });
      await load();
      setStatus("");
      return true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSavingAiPolicy(false);
    }
  }

  async function saveInventory(e: React.FormEvent): Promise<boolean> {
    e.preventDefault();
    return savePolicySetting("inventory", { require_manual_lot_selection: Boolean(requireManualLotSelection) }, setSavingInventoryPolicy, "inventory policy");
  }

  async function saveApPolicy(e: React.FormEvent): Promise<boolean> {
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
          tax_diff_lbp_threshold: Number(apTaxDiffLbpThreshold || 0),
        },
      });
      await load();
      setStatus("");
      return true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSavingApPolicy(false);
    }
  }

  /* ---- helper: field display ---- */
  function FieldDisplay(props: { label: string; value: string; className?: string }) {
    return (
      <div className={`rounded-md border bg-muted/30 p-3 ${props.className || ""}`}>
        <div className="text-xs font-medium text-muted-foreground">{props.label}</div>
        <div className="mt-1 text-sm text-foreground">{props.value || "-"}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Config"
        description="Company-level settings and policies."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={statusIsBusy}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Loading..." : "Refresh"}
          </Button>
        }
      />

      {status && !statusIsBusy && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="company" asChild><a href="/system/config?tab=company">Company</a></TabsTrigger>
          <TabsTrigger value="policies" asChild><a href="/system/config?tab=policies">Policies</a></TabsTrigger>
          <TabsTrigger value="accounting" asChild><a href="/system/config?tab=accounting">Accounting</a></TabsTrigger>
          <TabsTrigger value="tax" asChild><a href="/system/config?tab=tax">Tax &amp; FX</a></TabsTrigger>
          <TabsTrigger value="loyalty" asChild><a href="/system/config?tab=loyalty">Loyalty</a></TabsTrigger>
          <TabsTrigger value="ai" asChild><a href="/system/config?tab=ai">AI</a></TabsTrigger>
        </TabsList>

        {/* ==================== COMPANY ==================== */}
        <TabsContent value="company" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4" />Company Profile</CardTitle>
                  <CardDescription>Edit legal and operational company information used across ERP and POS.</CardDescription>
                </div>
                <Dialog open={companyOpen} onOpenChange={setCompanyOpen}>
                  <DialogTrigger asChild><Button variant="outline" size="sm" disabled={!company?.id}>Edit</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Company Profile</DialogTitle>
                      <DialogDescription>Update company identity, tax and currency defaults.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={async (e) => { const ok = await saveCompany(e); if (ok) setCompanyOpen(false); }} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Company Name</label>
                        <Input value={companyEditName} onChange={(e) => setCompanyEditName(e.target.value)} placeholder="AH Trading Official" />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Legal Name</label>
                        <Input value={companyEditLegalName} onChange={(e) => setCompanyEditLegalName(e.target.value)} placeholder="AH Trading S.A.R.L." />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Registration No</label>
                        <Input value={companyEditRegistrationNo} onChange={(e) => setCompanyEditRegistrationNo(e.target.value)} placeholder="123456" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">VAT No</label>
                        <Input value={companyEditVatNo} onChange={(e) => setCompanyEditVatNo(e.target.value)} placeholder="VAT-001122" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Base Currency</label>
                        <Select value={companyEditBaseCurrency} onValueChange={setCompanyEditBaseCurrency}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="LBP">LBP</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">VAT Currency</label>
                        <Select value={companyEditVatCurrency} onValueChange={setCompanyEditVatCurrency}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="LBP">LBP</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Default FX Rate Type</label>
                        <Select value={companyEditRateType} onValueChange={setCompanyEditRateType}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="market">market</SelectItem>
                            <SelectItem value="official">official</SelectItem>
                            <SelectItem value="internal">internal</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="md:col-span-2 flex justify-end">
                        <Button type="submit" disabled={savingCompany}>{savingCompany ? "Saving..." : "Save"}</Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {company ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <FieldDisplay label="Company Name" value={company.name || "-"} />
                  <FieldDisplay label="Legal Name" value={company.legal_name || "-"} />
                  <FieldDisplay label="Registration No" value={company.registration_no || "-"} />
                  <FieldDisplay label="VAT No" value={company.vat_no || "-"} />
                  <FieldDisplay label="Base Currency" value={company.base_currency || "-"} />
                  <FieldDisplay label="VAT Currency" value={company.vat_currency || "-"} />
                  <FieldDisplay label="Default FX Rate Type" value={company.default_rate_type || "-"} className="md:col-span-2" />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No company selected.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== POLICIES ==================== */}
        <TabsContent value="policies" className="space-y-6">
          {/* Inventory Policy */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Inventory Policy</CardTitle>
                  <CardDescription>Operational guardrails for batch/expiry-managed items.</CardDescription>
                </div>
                <Dialog open={inventoryOpen} onOpenChange={setInventoryOpen}>
                  <DialogTrigger asChild><Button variant="outline" size="sm">Edit</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Inventory Policy</DialogTitle><DialogDescription>Adjust how POS and sales posting handle lots/expiry.</DialogDescription></DialogHeader>
                    <form onSubmit={async (e) => { const ok = await saveInventory(e); if (ok) setInventoryOpen(false); }} className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Manual Lot Selection Required</label>
                        <Select value={requireManualLotSelection ? "yes" : "no"} onValueChange={(v) => setRequireManualLotSelection(v === "yes")}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="no">no (auto-FEFO allowed)</SelectItem>
                            <SelectItem value="yes">yes (POS must select a batch/expiry)</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">When enabled, sales posting for expiry/batch-tracked items requires explicit lot selection (no auto allocation).</p>
                      </div>
                      <div className="flex justify-end"><Button type="submit" disabled={savingInventoryPolicy}>{savingInventoryPolicy ? "Saving..." : "Save"}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <FieldDisplay label="Manual Lot Selection" value={requireManualLotSelection ? "Required" : "Not required"} />
            </CardContent>
          </Card>

          {/* AP 3-Way Match */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>AP 3-Way Match Policy</CardTitle>
                  <CardDescription>Variance thresholds that auto-hold supplier invoices linked to goods receipts.</CardDescription>
                </div>
                <Dialog open={apOpen} onOpenChange={setApOpen}>
                  <DialogTrigger asChild><Button variant="outline" size="sm">Edit</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>AP 3-Way Match Policy</DialogTitle><DialogDescription>Variance thresholds for holds.</DialogDescription></DialogHeader>
                    <form onSubmit={async (e) => { const ok = await saveApPolicy(e); if (ok) setApOpen(false); }} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Pct Threshold</label>
                        <Input value={apPctThreshold} onChange={(e) => setApPctThreshold(e.target.value)} placeholder="0.15" />
                        <div className="text-xs text-muted-foreground">Example: 0.15 = 15%</div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Abs USD Threshold</label>
                        <Input value={apAbsUsdThreshold} onChange={(e) => setApAbsUsdThreshold(e.target.value)} placeholder="25" />
                        <div className="text-xs text-muted-foreground">Per-unit difference (USD)</div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Abs LBP Threshold</label>
                        <Input value={apAbsLbpThreshold} onChange={(e) => setApAbsLbpThreshold(e.target.value)} placeholder="2500000" />
                        <div className="text-xs text-muted-foreground">Fallback when only LBP is present</div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Tax Diff Pct</label>
                        <Input value={apTaxDiffPctThreshold} onChange={(e) => setApTaxDiffPctThreshold(e.target.value)} placeholder="0.02" />
                        <div className="text-xs text-muted-foreground">Tax mismatch threshold (% of base)</div>
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Tax Diff LBP</label>
                        <Input value={apTaxDiffLbpThreshold} onChange={(e) => setApTaxDiffLbpThreshold(e.target.value)} placeholder="500000" />
                        <div className="text-xs text-muted-foreground">Minimum absolute tax mismatch (LBP)</div>
                      </div>
                      <div className="flex justify-end md:col-span-2"><Button type="submit" disabled={savingApPolicy}>{savingApPolicy ? "Saving..." : "Save"}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <FieldDisplay label="Pct" value={apPctThreshold} />
                <FieldDisplay label="Abs USD" value={apAbsUsdThreshold} />
                <FieldDisplay label="Abs LBP" value={apAbsLbpThreshold} />
              </div>
            </CardContent>
          </Card>

          {/* Pricing Policy */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Pricing Policy</CardTitle>
                  <CardDescription>Controls suggested sell prices (target margin + rounding).</CardDescription>
                </div>
                <Dialog open={pricingOpen} onOpenChange={setPricingOpen}>
                  <DialogTrigger asChild><Button variant="outline" size="sm">Edit</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>Pricing Policy</DialogTitle><DialogDescription>Controls target margins and rounding steps.</DialogDescription></DialogHeader>
                    <form onSubmit={async (e) => { const ok = await savePricingPolicy(e); if (ok) setPricingOpen(false); }} className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Target Margin (pct)</label>
                        <Input value={targetMarginPct} onChange={(e) => setTargetMarginPct(e.target.value)} placeholder="0.20" />
                        <div className="text-xs text-muted-foreground">Example: 0.20 = 20% gross margin target</div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">USD Round Step</label>
                        <Input value={usdRoundStep} onChange={(e) => setUsdRoundStep(e.target.value)} placeholder="0.25" />
                        <div className="text-xs text-muted-foreground">Suggested USD prices round up to this step</div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">LBP Round Step</label>
                        <Input value={lbpRoundStep} onChange={(e) => setLbpRoundStep(e.target.value)} placeholder="5000" />
                        <div className="text-xs text-muted-foreground">Suggested LBP prices round up to this step</div>
                      </div>
                      <div className="flex justify-end"><Button type="submit" disabled={savingPricingPolicy}>{savingPricingPolicy ? "Saving..." : "Save"}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <FieldDisplay label="Target Margin" value={targetMarginPct} />
                <FieldDisplay label="USD Round Step" value={usdRoundStep} />
                <FieldDisplay label="LBP Round Step" value={lbpRoundStep} />
              </div>
            </CardContent>
          </Card>

          {/* Print Policy */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Print Policy</CardTitle>
                  <CardDescription>Default A4 sales invoice PDF template used by exports and POS print flows.</CardDescription>
                </div>
                <Dialog open={printPolicyOpen} onOpenChange={setPrintPolicyOpen}>
                  <DialogTrigger asChild><Button variant="outline" size="sm">Edit</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Print Policy</DialogTitle><DialogDescription>Set the company default template for sales invoice PDFs.</DialogDescription></DialogHeader>
                    <form onSubmit={async (e) => { const ok = await savePrintPolicy(e); if (ok) setPrintPolicyOpen(false); }} className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Sales Invoice PDF Template</label>
                        <Select value={salesInvoicePdfTemplate} onValueChange={setSalesInvoicePdfTemplate}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SALES_INVOICE_TEMPLATE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex justify-end"><Button type="submit" disabled={savingPrintPolicy}>{savingPrintPolicy ? "Saving..." : "Save"}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <FieldDisplay label="Sales Invoice PDF Template" value={SALES_INVOICE_TEMPLATE_OPTIONS.find((opt) => opt.id === salesInvoicePdfTemplate)?.label || salesInvoicePdfTemplate} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== ACCOUNTING ==================== */}
        <TabsContent value="accounting" className="space-y-6">
          {/* Account Defaults */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Account Defaults</CardTitle>
                  <CardDescription>These mappings are required for automatic GL posting (POS sales, goods receipts, supplier invoices, payments).</CardDescription>
                </div>
                <Dialog open={defaultOpen} onOpenChange={setDefaultOpen}>
                  <DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" />Set Default</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>Set Account Default</DialogTitle><DialogDescription>Maps an account role to a company COA account.</DialogDescription></DialogHeader>
                    <form onSubmit={setDefault} className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-1.5 md:col-span-1">
                        <label className="text-xs font-medium text-muted-foreground">Role</label>
                        <Select value={defaultRole || "__none__"} onValueChange={(v) => setDefaultRole(v === "__none__" ? "" : v)}>
                          <SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select role...</SelectItem>
                            {roles.map((r) => (<SelectItem key={r.code} value={r.code}>{r.code} - {r.description}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Account</label>
                        <Select value={defaultAccountCode || "__none__"} onValueChange={(v) => setDefaultAccountCode(v === "__none__" ? "" : v)}>
                          <SelectTrigger><SelectValue placeholder="Select account..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select account...</SelectItem>
                            {accounts.map((a) => (<SelectItem key={a.account_code} value={a.account_code}>{a.account_code} - {a.name_en}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="md:col-span-3 flex justify-end"><Button type="submit" disabled={savingDefault}>{savingDefault ? "Saving..." : "Save"}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable columns={accountDefaultsColumns} data={accountDefaultsRows} isLoading={loading} searchPlaceholder="Search role / account..." />
            </CardContent>
          </Card>

          {/* Payment Method Mappings */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Payment Method Mappings</CardTitle>
                  <CardDescription>Map payment method strings to an account role, then configure the role above.</CardDescription>
                </div>
                <Dialog open={methodOpen} onOpenChange={setMethodOpen}>
                  <DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" />Upsert Mapping</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>Upsert Payment Method Mapping</DialogTitle><DialogDescription>Example methods: cash, bank, card, transfer.</DialogDescription></DialogHeader>
                    <form onSubmit={upsertMethod} className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-1.5 md:col-span-1">
                        <label className="text-xs font-medium text-muted-foreground">Method</label>
                        <Input value={methodName} onChange={(e) => setMethodName(e.target.value)} placeholder="cash / bank / card / transfer" />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Role</label>
                        <Select value={methodRole || "__none__"} onValueChange={(v) => setMethodRole(v === "__none__" ? "" : v)}>
                          <SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select role...</SelectItem>
                            {roles.map((r) => (<SelectItem key={r.code} value={r.code}>{r.code} - {r.description}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="md:col-span-3 flex justify-end"><Button type="submit" disabled={savingMethod}>{savingMethod ? "Saving..." : "Save"}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable columns={paymentMethodColumns} data={methods} isLoading={loading} searchPlaceholder="Search method / role..." />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== TAX & FX ==================== */}
        <TabsContent value="tax" className="space-y-6">
          {/* Tax Codes */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Tax Codes (VAT)</CardTitle>
                  <CardDescription>Create and list tax codes used in invoices and reports.</CardDescription>
                </div>
                <Dialog open={taxOpen} onOpenChange={setTaxOpen}>
                  <DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" />Create Tax Code</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>Create Tax Code</DialogTitle><DialogDescription>Used on sales/purchase invoices and VAT reporting.</DialogDescription></DialogHeader>
                    <form onSubmit={createTaxCode} className="grid grid-cols-1 gap-4 md:grid-cols-4">
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Name</label>
                        <Input value={taxName} onChange={(e) => setTaxName(e.target.value)} placeholder="11%" />
                      </div>
                      <div className="space-y-1.5 md:col-span-1">
                        <label className="text-xs font-medium text-muted-foreground">Rate (%)</label>
                        <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
                      </div>
                      <div className="space-y-1.5 md:col-span-1">
                        <label className="text-xs font-medium text-muted-foreground">Reporting Currency</label>
                        <Select value={taxCurrency} onValueChange={setTaxCurrency}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="LBP">LL</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Tax Type</label>
                        <Input value={taxType} onChange={(e) => setTaxType(e.target.value)} placeholder="vat" />
                      </div>
                      <div className="md:col-span-2 flex items-end justify-end"><Button type="submit" disabled={savingTax}>{savingTax ? "Saving..." : "Save"}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable columns={taxCodeColumns} data={taxCodes} isLoading={loading} searchPlaceholder="Search tax codes..." />

              {/* Tax Edit Dialog */}
              <Dialog open={taxEditOpen} onOpenChange={setTaxEditOpen}>
                <DialogContent className="max-w-2xl">
                  <DialogHeader><DialogTitle>Edit Tax Code</DialogTitle><DialogDescription>Update VAT code fields used in invoices and reports.</DialogDescription></DialogHeader>
                  <form onSubmit={updateTaxCode} className="grid grid-cols-1 gap-4 md:grid-cols-4">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">Name</label>
                      <Input value={taxEditName} onChange={(e) => setTaxEditName(e.target.value)} placeholder="11%" />
                    </div>
                    <div className="space-y-1.5 md:col-span-1">
                      <label className="text-xs font-medium text-muted-foreground">Rate (%)</label>
                      <Input value={taxEditRate} onChange={(e) => setTaxEditRate(e.target.value)} />
                    </div>
                    <div className="space-y-1.5 md:col-span-1">
                      <label className="text-xs font-medium text-muted-foreground">Reporting Currency</label>
                      <Select value={taxEditCurrency} onValueChange={setTaxEditCurrency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LBP">LL</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">Tax Type</label>
                      <Input value={taxEditType} onChange={(e) => setTaxEditType(e.target.value)} placeholder="vat" />
                    </div>
                    <div className="md:col-span-2 flex items-end justify-end"><Button type="submit" disabled={savingTaxEdit}>{savingTaxEdit ? "Saving..." : "Save Changes"}</Button></div>
                  </form>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Exchange Rates */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Exchange Rates</CardTitle>
                  <CardDescription>USD to LL daily rates used for dual-currency reporting.</CardDescription>
                </div>
                <Dialog open={rateOpen} onOpenChange={setRateOpen}>
                  <DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" />Upsert Rate</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>Upsert Exchange Rate</DialogTitle><DialogDescription>Used for dual-currency reporting and locked rates.</DialogDescription></DialogHeader>
                    <form onSubmit={upsertRate} className="grid grid-cols-1 gap-4 md:grid-cols-4">
                      <div className="space-y-1.5 md:col-span-1">
                        <label className="text-xs font-medium text-muted-foreground">Date</label>
                        <Input value={rateDate} onChange={(e) => setRateDate(e.target.value)} placeholder="YYYY-MM-DD" />
                      </div>
                      <div className="space-y-1.5 md:col-span-1">
                        <label className="text-xs font-medium text-muted-foreground">Type</label>
                        <Input value={rateType} onChange={(e) => setRateType(e.target.value)} placeholder="market" />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">USD to LL</label>
                        <Input value={usdToLbp} onChange={(e) => setUsdToLbp(e.target.value)} />
                      </div>
                      <div className="md:col-span-4 flex justify-end"><Button type="submit" disabled={savingRate}>{savingRate ? "Saving..." : "Save"}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable columns={exchangeRateColumns} data={rates} isLoading={loading} searchPlaceholder="Search rates..." />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== LOYALTY ==================== */}
        <TabsContent value="loyalty" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Loyalty</CardTitle>
                  <CardDescription>Configure loyalty points accrual. POS and posted sales invoices accrue points; returns and invoice voids reverse them.</CardDescription>
                </div>
                <Dialog open={loyaltyOpen} onOpenChange={setLoyaltyOpen}>
                  <DialogTrigger asChild><Button variant="outline" size="sm">Edit</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Loyalty</DialogTitle><DialogDescription>Configure points accrual.</DialogDescription></DialogHeader>
                    <form onSubmit={async (e) => { const ok = await saveLoyalty(e); if (ok) setLoyaltyOpen(false); }} className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Points per USD</label>
                        <Input value={pointsPerUsd} onChange={(e) => setPointsPerUsd(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Points per LL</label>
                        <Input value={pointsPerLbp} onChange={(e) => setPointsPerLbp(e.target.value)} />
                      </div>
                      <div className="flex justify-end"><Button type="submit" disabled={savingLoyalty}>{savingLoyalty ? "Saving..." : "Save"}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <FieldDisplay label="Points per USD" value={pointsPerUsd} />
                <FieldDisplay label="Points per LL" value={pointsPerLbp} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== AI ==================== */}
        <TabsContent value="ai" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>AI Policy</CardTitle>
                  <CardDescription>Controls whether the platform can send documents/names to external AI services and which provider to use.</CardDescription>
                </div>
                <Dialog open={aiOpen} onOpenChange={setAiOpen}>
                  <DialogTrigger asChild><Button variant="outline" size="sm">Edit</Button></DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>AI Policy</DialogTitle><DialogDescription>Controls external AI processing settings.</DialogDescription></DialogHeader>
                    <form onSubmit={async (e) => { const ok = await saveAi(e); if (ok) setAiOpen(false); }} className="grid grid-cols-1 gap-4">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox checked={allowExternalAi} onCheckedChange={(checked) => setAllowExternalAi(!!checked)} />
                        Allow external AI processing
                      </label>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Provider</label>
                        <Select value={aiProvider} onValueChange={setAiProvider}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai">OpenAI (hosted)</SelectItem>
                            <SelectItem value="openai_compatible">OpenAI-compatible (custom base URL)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Base URL (optional)</label>
                        <Input value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://api.openai.com" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">API Key (optional)</label>
                        <Input type="password" value={aiApiKey} onChange={(e) => setAiApiKey(e.target.value)} placeholder="Leave blank to use server environment" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Item Naming Model</label>
                        <Input value={aiItemModel} onChange={(e) => setAiItemModel(e.target.value)} placeholder="gpt-4o-mini" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Invoice Vision Model</label>
                        <Input value={aiInvoiceVisionModel} onChange={(e) => setAiInvoiceVisionModel(e.target.value)} placeholder="gpt-4o-mini" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Invoice Text Model</label>
                        <Input value={aiInvoiceTextModel} onChange={(e) => setAiInvoiceTextModel(e.target.value)} placeholder="gpt-4o-mini" />
                      </div>
                      <div className="flex justify-end"><Button type="submit" disabled={savingAiPolicy}>{savingAiPolicy ? "Saving..." : "Save"}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <FieldDisplay label="External Processing" value={allowExternalAi ? "Allowed" : "Not allowed"} />
                <FieldDisplay label="Provider" value={aiProvider} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                If disabled, AI import and AI naming will still work in draft + attachment mode, but without external extraction/suggestions. Leaving model/base URL/API key blank will fall back to server environment variables.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
