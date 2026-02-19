"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { apiDelete, apiGet, apiPatch, apiPost, getCompanyId } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ConfirmButton } from "@/components/confirm-button";
import { Page, PageHeader, Section } from "@/components/page";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

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
  { id: "official_classic", label: "Official Classic" },
  { id: "official_compact", label: "Official Compact" },
  { id: "standard", label: "Standard" },
];

export default function ConfigPage() {
  const sp = useSearchParams();
  const tab = String(sp.get("tab") || "policies").trim() || "policies";
  const [status, setStatus] = useState("");

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

  // Loyalty settings (company_settings.key='loyalty')
  const [pointsPerUsd, setPointsPerUsd] = useState("0");
  const [pointsPerLbp, setPointsPerLbp] = useState("0");
  const [savingLoyalty, setSavingLoyalty] = useState(false);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);

  // AI policy (company_settings.key='ai')
  const [allowExternalAi, setAllowExternalAi] = useState(true);
  const [aiProvider, setAiProvider] = useState("openai");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiItemModel, setAiItemModel] = useState("");
  const [aiInvoiceVisionModel, setAiInvoiceVisionModel] = useState("");
  const [aiInvoiceTextModel, setAiInvoiceTextModel] = useState("");
  const [savingAiPolicy, setSavingAiPolicy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Inventory policy (company_settings.key='inventory')
  const [requireManualLotSelection, setRequireManualLotSelection] = useState(false);
  const [savingInventoryPolicy, setSavingInventoryPolicy] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  // AP 3-way match policy (company_settings.key='ap_3way_match')
  const [apPctThreshold, setApPctThreshold] = useState("0.15");
  const [apAbsUsdThreshold, setApAbsUsdThreshold] = useState("25");
  const [apAbsLbpThreshold, setApAbsLbpThreshold] = useState("2500000");
  const [apTaxDiffPctThreshold, setApTaxDiffPctThreshold] = useState("0.02");
  const [apTaxDiffLbpThreshold, setApTaxDiffLbpThreshold] = useState("500000");
  const [savingApPolicy, setSavingApPolicy] = useState(false);
  const [apOpen, setApOpen] = useState(false);

  // Pricing policy (company_settings.key='pricing_policy')
  const [targetMarginPct, setTargetMarginPct] = useState("0.20");
  const [usdRoundStep, setUsdRoundStep] = useState("0.25");
  const [lbpRoundStep, setLbpRoundStep] = useState("5000");
  const [savingPricingPolicy, setSavingPricingPolicy] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  // Print policy (company_settings.key='print_policy')
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
  const accountDefaultsColumns = useMemo((): Array<DataTableColumn<{ role_code: string; account_code: string; name_en: string }>> => {
    return [
      {
        id: "role_code",
        header: "Role",
        sortable: true,
        mono: true,
        accessor: (r) => r.role_code,
        cell: (r) => <span className="font-mono text-xs">{r.role_code}</span>,
      },
      {
        id: "account_code",
        header: "Account",
        sortable: true,
        mono: true,
        accessor: (r) => r.account_code,
        cell: (r) => <span className="font-mono text-xs">{r.account_code || "-"}</span>,
      },
      {
        id: "name_en",
        header: "Name",
        sortable: true,
        accessor: (r) => r.name_en,
        cell: (r) => <span className="text-xs text-fg-muted">{r.name_en || "-"}</span>,
      },
    ];
  }, []);
  const paymentMethodColumns = useMemo((): Array<DataTableColumn<PaymentMethodRow>> => {
    return [
      {
        id: "method",
        header: "Method",
        sortable: true,
        mono: true,
        accessor: (m) => m.method,
        cell: (m) => <span className="font-mono text-xs">{m.method}</span>,
      },
      {
        id: "role_code",
        header: "Role",
        sortable: true,
        mono: true,
        accessor: (m) => m.role_code,
        cell: (m) => <span className="font-mono text-xs">{m.role_code}</span>,
      },
      {
        id: "created_at",
        header: "Created",
        sortable: true,
        mono: true,
        accessor: (m) => m.created_at,
        cell: (m) => <span className="text-xs text-fg-muted">{formatDateTime(m.created_at)}</span>,
      },
    ];
  }, []);
  const taxCodeColumns: Array<DataTableColumn<TaxCode>> = [
      {
        id: "name",
        header: "Name",
        sortable: true,
        accessor: (t) => t.name,
        cell: (t) => t.name,
      },
      {
        id: "rate",
        header: "Rate",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (t) => Number(t.rate || 0),
        cell: (t) => (
          <span className="font-mono text-xs">
            {taxRateToPercent(t.rate).toLocaleString("en-US", { maximumFractionDigits: 2 })}%
          </span>
        ),
      },
      {
        id: "tax_type",
        header: "Type",
        sortable: true,
        accessor: (t) => t.tax_type,
        cell: (t) => t.tax_type,
      },
      {
        id: "reporting_currency",
        header: "Currency",
        sortable: true,
        accessor: (t) => t.reporting_currency,
        cell: (t) => t.reporting_currency,
      },
      {
        id: "in_use",
        header: "In Use",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (t) => Number(t.item_refs || 0) + Number(t.tax_line_refs || 0),
        cell: (t) => (
          <span className="font-mono text-xs">
            {(Number(t.item_refs || 0) + Number(t.tax_line_refs || 0)).toLocaleString("en-US")}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        align: "right",
        globalSearch: false,
        cell: (t) => (
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
            <ConfirmButton
              type="button"
              variant="ghost"
              size="sm"
              title={`Delete tax code "${t.name}"?`}
              description="This cannot be undone."
              confirmText="Delete"
              confirmVariant="destructive"
              disabled={deletingTaxId === t.id}
              onError={(err) => setStatus(err instanceof Error ? err.message : String(err))}
              onConfirm={() => deleteTaxCode(t)}
            >
              {deletingTaxId === t.id ? "Deleting..." : "Delete"}
            </ConfirmButton>
          </div>
        ),
      },
    ];
  const exchangeRateColumns = useMemo((): Array<DataTableColumn<ExchangeRateRow>> => {
    return [
      {
        id: "rate_date",
        header: "Date",
        sortable: true,
        mono: true,
        accessor: (r) => r.rate_date,
        cell: (r) => <span className="font-mono text-xs">{r.rate_date}</span>,
      },
      {
        id: "rate_type",
        header: "Type",
        sortable: true,
        accessor: (r) => r.rate_type,
        cell: (r) => r.rate_type,
      },
      {
        id: "usd_to_lbp",
        header: "USD to LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.usd_to_lbp || 0),
        cell: (r) => (
          <span className="font-mono text-xs">
            {Number(r.usd_to_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        ),
      },
    ];
  }, []);

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
    if (!company?.id) {
      setStatus("company is not selected");
      return false;
    }
    if (!companyEditName.trim()) {
      setStatus("company name is required");
      return false;
    }
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
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
      return false;
    } finally {
      setSavingCompany(false);
    }
  }

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
        rate: taxRateInputToDecimal(taxRate),
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

  async function updateTaxCode(e: React.FormEvent) {
    e.preventDefault();
    if (!taxEditId) {
      setStatus("tax code id is required");
      return;
    }
    if (!taxEditName.trim()) {
      setStatus("tax code name is required");
      return;
    }
    setSavingTaxEdit(true);
    setStatus("Updating tax code...");
    try {
      await apiPatch(`/config/tax-codes/${taxEditId}`, {
        name: taxEditName.trim(),
        rate: taxRateInputToDecimal(taxEditRate),
        tax_type: taxEditType || "vat",
        reporting_currency: taxEditCurrency || "LBP"
      });
      setTaxEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
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
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setDeletingTaxId(null);
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

  async function savePricingPolicy(e: React.FormEvent): Promise<boolean> {
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
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
      return false;
    } finally {
      setSavingPricingPolicy(false);
    }
  }

  async function savePrintPolicy(e: React.FormEvent): Promise<boolean> {
    e.preventDefault();
    setSavingPrintPolicy(true);
    setStatus("Saving print policy...");
    try {
      const current = ((settings.find((s) => s.key === "print_policy")?.value_json || {}) as any) || {};
      const normalized = SALES_INVOICE_TEMPLATE_OPTIONS.some((opt) => opt.id === salesInvoicePdfTemplate)
        ? salesInvoicePdfTemplate
        : "official_classic";
      await apiPost("/pricing/company-settings", {
        key: "print_policy",
        value_json: {
          ...current,
          sales_invoice_pdf_template: normalized,
        },
      });
      await load();
      setStatus("");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
      return false;
    } finally {
      setSavingPrintPolicy(false);
    }
  }

  async function saveLoyalty(e: React.FormEvent): Promise<boolean> {
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
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
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
          invoice_text_model: aiInvoiceTextModel.trim() || null
        }
      });
      await load();
      setStatus("");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
      return false;
    } finally {
      setSavingAiPolicy(false);
    }
  }

  async function saveInventory(e: React.FormEvent): Promise<boolean> {
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
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
      return false;
    } finally {
      setSavingInventoryPolicy(false);
    }
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
          tax_diff_lbp_threshold: Number(apTaxDiffLbpThreshold || 0)
        }
      });
      await load();
      setStatus("");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
      return false;
    } finally {
      setSavingApPolicy(false);
    }
  }

  return (
    <Page width="lg" className="px-4">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="Config"
        description="Company-level settings and policies."
        actions={
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        }
        meta={
          <TabBar
            tabs={[
              { label: "Company", href: "/system/config?tab=company", activeQuery: { key: "tab", value: "company" } },
              { label: "Policies", href: "/system/config?tab=policies", activeQuery: { key: "tab", value: "policies" } },
              { label: "Accounting", href: "/system/config?tab=accounting", activeQuery: { key: "tab", value: "accounting" } },
              { label: "Tax & FX", href: "/system/config?tab=tax", activeQuery: { key: "tab", value: "tax" } },
              { label: "Loyalty", href: "/system/config?tab=loyalty", activeQuery: { key: "tab", value: "loyalty" } },
              { label: "AI", href: "/system/config?tab=ai", activeQuery: { key: "tab", value: "ai" } },
            ]}
          />
        }
      />

      {tab === "company" ? (
        <Section
          title="Company Profile"
          description="Edit legal and operational company information used across ERP and POS."
          actions={
            <Dialog open={companyOpen} onOpenChange={setCompanyOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={!company?.id}>
                  Edit
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Company Profile</DialogTitle>
                  <DialogDescription>Update company identity, tax and currency defaults.</DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={async (e) => {
                    const ok = await saveCompany(e);
                    if (ok) setCompanyOpen(false);
                  }}
                  className="grid grid-cols-1 gap-3 md:grid-cols-2"
                >
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Company Name</label>
                    <Input value={companyEditName} onChange={(e) => setCompanyEditName(e.target.value)} placeholder="AH Trading Official" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Legal Name</label>
                    <Input value={companyEditLegalName} onChange={(e) => setCompanyEditLegalName(e.target.value)} placeholder="AH Trading S.A.R.L." />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Registration No</label>
                    <Input
                      value={companyEditRegistrationNo}
                      onChange={(e) => setCompanyEditRegistrationNo(e.target.value)}
                      placeholder="123456"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">VAT No</label>
                    <Input value={companyEditVatNo} onChange={(e) => setCompanyEditVatNo(e.target.value)} placeholder="VAT-001122" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Base Currency</label>
                    <select className="ui-select" value={companyEditBaseCurrency} onChange={(e) => setCompanyEditBaseCurrency(e.target.value)}>
                      <option value="USD">USD</option>
                      <option value="LBP">LBP</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">VAT Currency</label>
                    <select className="ui-select" value={companyEditVatCurrency} onChange={(e) => setCompanyEditVatCurrency(e.target.value)}>
                      <option value="USD">USD</option>
                      <option value="LBP">LBP</option>
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Default FX Rate Type</label>
                    <select className="ui-select" value={companyEditRateType} onChange={(e) => setCompanyEditRateType(e.target.value)}>
                      <option value="market">market</option>
                      <option value="official">official</option>
                      <option value="internal">internal</option>
                    </select>
                  </div>
                  <div className="md:col-span-2 flex justify-end">
                    <Button type="submit" disabled={savingCompany}>
                      {savingCompany ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          }
        >
          {company ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
                <div className="text-xs font-medium text-fg-muted">Company Name</div>
                <div className="mt-1 text-sm text-foreground">{company.name || "-"}</div>
              </div>
              <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
                <div className="text-xs font-medium text-fg-muted">Legal Name</div>
                <div className="mt-1 text-sm text-foreground">{company.legal_name || "-"}</div>
              </div>
              <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
                <div className="text-xs font-medium text-fg-muted">Registration No</div>
                <div className="mt-1 text-sm text-foreground">{company.registration_no || "-"}</div>
              </div>
              <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
                <div className="text-xs font-medium text-fg-muted">VAT No</div>
                <div className="mt-1 text-sm text-foreground">{company.vat_no || "-"}</div>
              </div>
              <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
                <div className="text-xs font-medium text-fg-muted">Base Currency</div>
                <div className="mt-1 text-sm text-foreground">{company.base_currency || "-"}</div>
              </div>
              <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
                <div className="text-xs font-medium text-fg-muted">VAT Currency</div>
                <div className="mt-1 text-sm text-foreground">{company.vat_currency || "-"}</div>
              </div>
              <div className="rounded-md border border-border bg-bg-sunken/10 p-3 md:col-span-2">
                <div className="text-xs font-medium text-fg-muted">Default FX Rate Type</div>
                <div className="mt-1 text-sm text-foreground">{company.default_rate_type || "-"}</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-fg-muted">No company selected.</div>
          )}
        </Section>
      ) : null}

      {tab === "policies" ? (
        <>
      <Section
        title="Inventory Policy"
        description="Operational guardrails for batch/expiry-managed items."
        actions={
          <Dialog open={inventoryOpen} onOpenChange={setInventoryOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Edit</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Inventory Policy</DialogTitle>
                <DialogDescription>Adjust how POS and sales posting handle lots/expiry.</DialogDescription>
              </DialogHeader>
              <form
                onSubmit={async (e) => {
                  const ok = await saveInventory(e);
                  if (ok) setInventoryOpen(false);
                }}
                className="grid grid-cols-1 gap-3"
              >
                <div className="space-y-1">
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
                <div className="flex justify-end">
                  <Button type="submit" disabled={savingInventoryPolicy}>
                    {savingInventoryPolicy ? "..." : "Save"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
            <div className="text-xs font-medium text-fg-muted">Manual Lot Selection</div>
            <div className="mt-1 text-sm text-foreground">{requireManualLotSelection ? "Required" : "Not required"}</div>
          </div>
        </div>
      </Section>

      <Section
        title="AP 3-Way Match Policy"
        description="Variance thresholds that auto-hold supplier invoices linked to goods receipts."
        actions={
          <Dialog open={apOpen} onOpenChange={setApOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Edit</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>AP 3-Way Match Policy</DialogTitle>
                <DialogDescription>Variance thresholds for holds.</DialogDescription>
              </DialogHeader>
              <form
                onSubmit={async (e) => {
                  const ok = await saveApPolicy(e);
                  if (ok) setApOpen(false);
                }}
                className="grid grid-cols-1 gap-3 md:grid-cols-2"
              >
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Pct Threshold</label>
                  <Input value={apPctThreshold} onChange={(e) => setApPctThreshold(e.target.value)} placeholder="0.15" />
                  <div className="text-xs text-fg-subtle">Example: 0.15 = 15%</div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Abs USD Threshold</label>
                  <Input value={apAbsUsdThreshold} onChange={(e) => setApAbsUsdThreshold(e.target.value)} placeholder="25" />
                  <div className="text-xs text-fg-subtle">Per-unit difference (USD)</div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Abs LBP Threshold</label>
                  <Input value={apAbsLbpThreshold} onChange={(e) => setApAbsLbpThreshold(e.target.value)} placeholder="2500000" />
                  <div className="text-xs text-fg-subtle">Fallback when only LBP is present</div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Tax Diff Pct</label>
                  <Input value={apTaxDiffPctThreshold} onChange={(e) => setApTaxDiffPctThreshold(e.target.value)} placeholder="0.02" />
                  <div className="text-xs text-fg-subtle">Tax mismatch threshold (% of base)</div>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">Tax Diff LBP</label>
                  <Input value={apTaxDiffLbpThreshold} onChange={(e) => setApTaxDiffLbpThreshold(e.target.value)} placeholder="500000" />
                  <div className="text-xs text-fg-subtle">Minimum absolute tax mismatch (LBP)</div>
                </div>
                <div className="flex justify-end md:col-span-2">
                  <Button type="submit" disabled={savingApPolicy}>
                    {savingApPolicy ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
            <div className="text-xs font-medium text-fg-muted">Pct</div>
            <div className="mt-1 text-sm text-foreground">{apPctThreshold}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
            <div className="text-xs font-medium text-fg-muted">Abs USD</div>
            <div className="mt-1 text-sm text-foreground">{apAbsUsdThreshold}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
            <div className="text-xs font-medium text-fg-muted">Abs LBP</div>
            <div className="mt-1 text-sm text-foreground">{apAbsLbpThreshold}</div>
          </div>
        </div>
      </Section>

      <Section
        title="Pricing Policy"
        description="Controls suggested sell prices (target margin + rounding)."
        actions={
          <Dialog open={pricingOpen} onOpenChange={setPricingOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Edit</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Pricing Policy</DialogTitle>
                <DialogDescription>Controls target margins and rounding steps.</DialogDescription>
              </DialogHeader>
              <form
                onSubmit={async (e) => {
                  const ok = await savePricingPolicy(e);
                  if (ok) setPricingOpen(false);
                }}
                className="grid grid-cols-1 gap-3"
              >
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Target Margin (pct)</label>
                  <Input value={targetMarginPct} onChange={(e) => setTargetMarginPct(e.target.value)} placeholder="0.20" />
                  <div className="text-xs text-fg-subtle">Example: 0.20 = 20% gross margin target</div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">USD Round Step</label>
                  <Input value={usdRoundStep} onChange={(e) => setUsdRoundStep(e.target.value)} placeholder="0.25" />
                  <div className="text-xs text-fg-subtle">Suggested USD prices round up to this step</div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">LBP Round Step</label>
                  <Input value={lbpRoundStep} onChange={(e) => setLbpRoundStep(e.target.value)} placeholder="5000" />
                  <div className="text-xs text-fg-subtle">Suggested LBP prices round up to this step</div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={savingPricingPolicy}>
                    {savingPricingPolicy ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
            <div className="text-xs font-medium text-fg-muted">Target Margin</div>
            <div className="mt-1 text-sm text-foreground">{targetMarginPct}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
            <div className="text-xs font-medium text-fg-muted">USD Round Step</div>
            <div className="mt-1 text-sm text-foreground">{usdRoundStep}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
            <div className="text-xs font-medium text-fg-muted">LBP Round Step</div>
            <div className="mt-1 text-sm text-foreground">{lbpRoundStep}</div>
          </div>
        </div>
      </Section>

      <Section
        title="Print Policy"
        description="Default A4 sales invoice PDF template used by exports and POS print flows."
        actions={
          <Dialog open={printPolicyOpen} onOpenChange={setPrintPolicyOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Edit</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Print Policy</DialogTitle>
                <DialogDescription>Set the company default template for sales invoice PDFs.</DialogDescription>
              </DialogHeader>
              <form
                onSubmit={async (e) => {
                  const ok = await savePrintPolicy(e);
                  if (ok) setPrintPolicyOpen(false);
                }}
                className="grid grid-cols-1 gap-3"
              >
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Sales Invoice PDF Template</label>
                  <select className="ui-select" value={salesInvoicePdfTemplate} onChange={(e) => setSalesInvoicePdfTemplate(e.target.value)}>
                    {SALES_INVOICE_TEMPLATE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={savingPrintPolicy}>
                    {savingPrintPolicy ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
            <div className="text-xs font-medium text-fg-muted">Sales Invoice PDF Template</div>
            <div className="mt-1 text-sm text-foreground">
              {SALES_INVOICE_TEMPLATE_OPTIONS.find((opt) => opt.id === salesInvoicePdfTemplate)?.label || salesInvoicePdfTemplate}
            </div>
          </div>
        </div>
      </Section>
        </>
      ) : null}

      {tab === "accounting" ? (
        <>
          <Section
            title="Account Defaults"
            description="These mappings are required for automatic GL posting (POS sales, goods receipts, supplier invoices, payments)."
            actions={
              <Dialog open={defaultOpen} onOpenChange={setDefaultOpen}>
                <DialogTrigger asChild>
                  <Button>Set Default</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Set Account Default</DialogTitle>
                    <DialogDescription>Maps an account role (AR, SALES, VAT_PAYABLE, etc.) to a company COA account.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={setDefault} className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Role</label>
                      <select className="ui-select" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
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
                      <select className="ui-select" value={defaultAccountCode} onChange={(e) => setDefaultAccountCode(e.target.value)}>
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
            }
          >
            <DataTable<{ role_code: string; account_code: string; name_en: string }>
              tableId="system.config.account_defaults"
              rows={accountDefaultsRows}
              columns={accountDefaultsColumns}
              getRowId={(r) => r.role_code}
              emptyText="No roles found."
              enableGlobalFilter={false}
              initialSort={{ columnId: "role_code", dir: "asc" }}
            />
          </Section>

          <Section
            title="Payment Method Mappings"
            description="Map UI/payment method strings (cash, bank, card, transfer) to an account role, then configure the role’s account default above."
            actions={
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
                      <select className="ui-select" value={methodRole} onChange={(e) => setMethodRole(e.target.value)}>
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
            }
          >
            <DataTable<PaymentMethodRow>
              tableId="system.config.payment_methods"
              rows={methods}
              columns={paymentMethodColumns}
              getRowId={(m) => m.method}
              emptyText="No payment method mappings yet."
              enableGlobalFilter={false}
              initialSort={{ columnId: "method", dir: "asc" }}
            />
          </Section>
        </>
      ) : null}

      {tab === "loyalty" ? (
        <Section
          title="Loyalty"
          description="Configure loyalty points accrual. POS and posted sales invoices accrue points; returns and invoice voids reverse them."
          actions={
            <Dialog open={loyaltyOpen} onOpenChange={setLoyaltyOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Edit</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Loyalty</DialogTitle>
                  <DialogDescription>Configure points accrual.</DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={async (e) => {
                    const ok = await saveLoyalty(e);
                    if (ok) setLoyaltyOpen(false);
                  }}
                  className="grid grid-cols-1 gap-3"
                >
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Points per USD</label>
                    <Input value={pointsPerUsd} onChange={(e) => setPointsPerUsd(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Points per LL</label>
                    <Input value={pointsPerLbp} onChange={(e) => setPointsPerLbp(e.target.value)} />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={savingLoyalty}>
                      {savingLoyalty ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          }
        >
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
              <div className="text-xs font-medium text-fg-muted">Points per USD</div>
              <div className="mt-1 text-sm text-foreground">{pointsPerUsd}</div>
            </div>
            <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
              <div className="text-xs font-medium text-fg-muted">Points per LL</div>
              <div className="mt-1 text-sm text-foreground">{pointsPerLbp}</div>
            </div>
          </div>
        </Section>
      ) : null}

      {tab === "ai" ? (
        <Section
          title="AI Policy"
          description="Controls whether the platform can send documents/names to external AI services and which provider to use."
          actions={
            <Dialog open={aiOpen} onOpenChange={setAiOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Edit</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>AI Policy</DialogTitle>
                  <DialogDescription>Controls external AI processing settings.</DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={async (e) => {
                    const ok = await saveAi(e);
                    if (ok) setAiOpen(false);
                  }}
                  className="grid grid-cols-1 gap-3"
                >
                  <label className="flex items-center gap-2 text-sm text-fg-muted">
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
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Base URL (optional)</label>
                    <Input value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://api.openai.com" />
                  </div>
                  <div className="space-y-1">
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
                    <Input value={aiInvoiceVisionModel} onChange={(e) => setAiInvoiceVisionModel(e.target.value)} placeholder="gpt-4o-mini" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Invoice Text Model</label>
                    <Input value={aiInvoiceTextModel} onChange={(e) => setAiInvoiceTextModel(e.target.value)} placeholder="gpt-4o-mini" />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={savingAiPolicy}>
                      {savingAiPolicy ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          }
        >
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
              <div className="text-xs font-medium text-fg-muted">External Processing</div>
              <div className="mt-1 text-sm text-foreground">{allowExternalAi ? "Allowed" : "Not allowed"}</div>
            </div>
            <div className="rounded-md border border-border bg-bg-sunken/10 p-3">
              <div className="text-xs font-medium text-fg-muted">Provider</div>
              <div className="mt-1 text-sm text-foreground">{aiProvider}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-fg-subtle">
            If disabled, AI import and AI naming will still work in draft + attachment mode, but without external extraction/suggestions. Leaving
            model/base URL/API key blank will fall back to server environment variables.
          </p>
        </Section>
      ) : null}

      {tab === "tax" ? (
        <>
          <Section
            title="Tax Codes (VAT)"
            description="Create and list tax codes used in invoices and reports."
            actions={
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
                      <Input value={taxName} onChange={(e) => setTaxName(e.target.value)} placeholder="11%" />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Rate (%)</label>
                      <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Reporting Currency</label>
                      <select className="ui-select" value={taxCurrency} onChange={(e) => setTaxCurrency(e.target.value)}>
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
            }
          >
            <DataTable<TaxCode>
              tableId="system.config.tax_codes"
              rows={taxCodes}
              columns={taxCodeColumns}
              getRowId={(t) => t.id}
              emptyText="No tax codes yet."
              enableGlobalFilter={false}
              initialSort={{ columnId: "name", dir: "asc" }}
            />

            <Dialog open={taxEditOpen} onOpenChange={setTaxEditOpen}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Edit Tax Code</DialogTitle>
                  <DialogDescription>Update VAT code fields used in invoices and reports.</DialogDescription>
                </DialogHeader>
                <form onSubmit={updateTaxCode} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Name</label>
                    <Input value={taxEditName} onChange={(e) => setTaxEditName(e.target.value)} placeholder="11%" />
                  </div>
                  <div className="space-y-1 md:col-span-1">
                    <label className="text-xs font-medium text-fg-muted">Rate (%)</label>
                    <Input value={taxEditRate} onChange={(e) => setTaxEditRate(e.target.value)} />
                  </div>
                  <div className="space-y-1 md:col-span-1">
                    <label className="text-xs font-medium text-fg-muted">Reporting Currency</label>
                    <select className="ui-select" value={taxEditCurrency} onChange={(e) => setTaxEditCurrency(e.target.value)}>
                      <option value="LBP">LL</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Tax Type</label>
                    <Input value={taxEditType} onChange={(e) => setTaxEditType(e.target.value)} placeholder="vat" />
                  </div>
                  <div className="md:col-span-2 flex items-end justify-end">
                    <Button type="submit" disabled={savingTaxEdit}>
                      {savingTaxEdit ? "..." : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </Section>

          <Section
            title="Exchange Rates"
            description="USD to LL daily rates used for dual-currency reporting."
            actions={
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
            }
          >
            <DataTable<ExchangeRateRow>
              tableId="system.config.exchange_rates"
              rows={rates}
              columns={exchangeRateColumns}
              getRowId={(r) => r.id}
              emptyText="No exchange rates yet."
              enableGlobalFilter={false}
              initialSort={{ columnId: "rate_date", dir: "desc" }}
            />
          </Section>
        </>
      ) : null}
    </Page>
  );
}
