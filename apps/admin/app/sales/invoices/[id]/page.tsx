"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, FileText, Package, Receipt } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { cn } from "@/lib/utils";
import { type DataTableColumn } from "@/components/data-table";
import { ShortcutLink } from "@/components/shortcut-link";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { DetailPageLayout } from "@/components/business/detail-page-layout";
import { StatusBadge } from "@/components/business/status-badge";
import { Banner } from "@/components/ui/banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import {
  VatBreakdownPanel,
  buildVatSharePct,
  type VatItemAttributionRow,
  type VatRateRow,
  type VatRawTaxLine,
  type VatSummaryModel,
} from "../_components/vat-breakdown-panel";

import { InvoiceOverviewTab, type SalesOverview, type CustomerAccountOverviewData } from "./_components/invoice-overview-tab";
import { InvoiceItemsTab } from "./_components/invoice-items-tab";
import { InvoiceTaxTab } from "./_components/invoice-tax-tab";
import { PostInvoiceDialog } from "./_components/post-invoice-dialog";
import { VoidInvoiceDialog, CancelDraftDialog, PrintPreviewDialog } from "./_components/void-invoice-dialog";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type PaymentMethodMapping = { method: string; role_code: string; created_at: string };
type TaxCode = { id: string; name: string; rate: string | number; tax_type: string; reporting_currency: string };

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  sales_channel?: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  subtotal_usd?: string | number;
  subtotal_lbp?: string | number;
  discount_total_usd?: string | number;
  discount_total_lbp?: string | number;
  exchange_rate: string | number;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  pricing_currency: string;
  settlement_currency: string;
  receipt_no?: string | null;
  invoice_date?: string;
  due_date?: string | null;
  created_at: string;
};

type InvoiceLine = {
  id: string;
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  item_tax_code_id?: string | null;
  qty: string | number;
  uom?: string | null;
  qty_factor?: string | number | null;
  qty_entered?: string | number | null;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
  unit_price_entered_usd?: string | number | null;
  unit_price_entered_lbp?: string | number | null;
  pre_discount_unit_price_usd?: string | number | null;
  pre_discount_unit_price_lbp?: string | number | null;
  discount_pct?: string | number | null;
  discount_amount_usd?: string | number | null;
  discount_amount_lbp?: string | number | null;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

type SalesPayment = {
  id: string;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  tender_usd?: string | number | null;
  tender_lbp?: string | number | null;
  created_at: string;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  base_usd: string | number;
  base_lbp: string | number;
  tax_usd: string | number;
  tax_lbp: string | number;
  tax_date: string | null;
  created_at: string;
};

type InvoiceDetail = {
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  payments: SalesPayment[];
  tax_lines: TaxLine[];
  print_policy?: { sales_invoice_pdf_template?: string | null } | null;
};

type CustomerAccountSnapshot = {
  id: string;
  credit_balance_usd: string | number;
  credit_balance_lbp: string | number;
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function n(v: unknown) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

function taxRateToPercent(raw: unknown): number {
  const x = Number(raw || 0);
  if (!Number.isFinite(x)) return 0;
  return x <= 1 ? x * 100 : x;
}

function taxRateToFraction(raw: unknown): number {
  const x = Number(raw || 0);
  if (!Number.isFinite(x)) return 0;
  return x > 1 ? x / 100 : x;
}

function hasTender(p: SalesPayment) {
  return n(p.tender_usd) !== 0 || n(p.tender_lbp) !== 0;
}

function normalizeSalesChannel(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "pos" || raw === "admin" || raw === "import" || raw === "api") return raw;
  return "admin";
}

function salesChannelLabel(value: unknown) {
  const channel = normalizeSalesChannel(value);
  if (channel === "pos") return "POS";
  if (channel === "import") return "Import";
  if (channel === "api") return "API";
  return "Admin";
}

function shortId(v: string, head = 8, tail = 4) {
  const s = (v || "").trim();
  if (!s) return "-";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

/* -------------------------------------------------------------------------- */
/*  Copy button                                                               */
/* -------------------------------------------------------------------------- */

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            disabled={!text || text === "-"}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch { /* ignore */ }
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : `Copy ${label || ""}`}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                            */
/* -------------------------------------------------------------------------- */

function SalesInvoiceShowInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  const searchParams = useSearchParams();

  /* ---- Core state ---- */
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [customerAccount, setCustomerAccount] = useState<CustomerAccountSnapshot | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [taxPreview, setTaxPreview] = useState<{
    base_usd: number; base_lbp: number; tax_usd: number; tax_lbp: number;
    total_usd: number; total_lbp: number; tax_code_id: string | null;
    tax_rows: Array<{ tax_code_id: string; base_usd: number; base_lbp: number; tax_usd: number; tax_lbp: number }>;
  } | null>(null);

  /* ---- Dialog state ---- */
  const [postOpen, setPostOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [invoiceMathOpen, setInvoiceMathOpen] = useState(false);

  /* ---- Derived ---- */
  const methodChoices = useMemo(() => {
    const fromConfig = paymentMethods.map((m) => String(m.method || "").trim().toLowerCase()).filter(Boolean);
    const merged = Array.from(new Set(fromConfig));
    merged.sort();
    return merged;
  }, [paymentMethods]);
  const hasPaymentMethodMappings = methodChoices.length > 0;

  const activeTab = useMemo(() => {
    const t = String(searchParams.get("tab") || "overview").toLowerCase();
    if (t === "lines" || t === "items") return "items";
    if (t === "tax") return "tax";
    return "overview";
  }, [searchParams]);

  /* ---- Sales overview ---- */
  const salesOverview = useMemo((): SalesOverview | null => {
    if (!detail) return null;
    const paidUsd = (detail.payments || []).reduce((a, p) => a + Number(p.amount_usd || 0), 0);
    const paidLbp = (detail.payments || []).reduce((a, p) => a + Number(p.amount_lbp || 0), 0);
    const tenderUsd = (detail.payments || []).reduce((a, p) => a + (hasTender(p) ? n(p.tender_usd) : 0), 0);
    const tenderLbp = (detail.payments || []).reduce((a, p) => a + (hasTender(p) ? n(p.tender_lbp) : 0), 0);
    const hasAnyTender = (detail.payments || []).some((p) => hasTender(p));
    const vatUsd = (detail.tax_lines || []).reduce((a, t) => a + n((t as any).tax_usd), 0);
    const vatLbp = (detail.tax_lines || []).reduce((a, t) => a + n((t as any).tax_lbp), 0);
    const totalUsd = Number(detail.invoice.total_usd || 0);
    const totalLbp = Number(detail.invoice.total_lbp || 0);
    const settle = String(detail.invoice.settlement_currency || "USD").toUpperCase();
    const balUsd = totalUsd - paidUsd;
    const balLbp = totalLbp - paidLbp;
    const subUsd = Number(detail.invoice.subtotal_usd ?? detail.invoice.total_usd ?? 0);
    const subLbp = Number(detail.invoice.subtotal_lbp ?? detail.invoice.total_lbp ?? 0);
    const discUsd = Number(detail.invoice.discount_total_usd ?? 0);
    const discLbp = Number(detail.invoice.discount_total_lbp ?? 0);
    const rate = Number(detail.invoice.exchange_rate || 0);
    const primaryTotal = settle === "LBP" ? totalLbp : totalUsd;
    const primaryPaid = settle === "LBP" ? paidLbp : paidUsd;
    const primaryBal = settle === "LBP" ? balLbp : balUsd;
    const secondaryTotal = settle === "LBP" ? totalUsd : totalLbp;
    const secondaryPaid = settle === "LBP" ? paidUsd : paidLbp;
    const secondaryBal = settle === "LBP" ? balUsd : balLbp;
    const primaryFmt = settle === "LBP" ? fmtLbp : fmtUsd;
    const secondaryFmt = settle === "LBP" ? fmtUsd : fmtLbp;
    const primaryTone = settle === "LBP" ? "text-sky-600" : "text-emerald-600";

    return {
      paidUsd, paidLbp, tenderUsd, tenderLbp, hasAnyTender, vatUsd, vatLbp,
      totalUsd, totalLbp, settle, balUsd, balLbp, subUsd, subLbp, discUsd, discLbp,
      rate, primaryTotal, primaryPaid, primaryBal, secondaryTotal, secondaryPaid, secondaryBal,
      primaryFmt, secondaryFmt, primaryTone,
    };
  }, [detail]);

  const customerAccountOverview = useMemo((): CustomerAccountOverviewData | null => {
    if (!salesOverview) return null;
    const hasCustomer = Boolean(String(detail?.invoice?.customer_id || "").trim());
    if (!hasCustomer) return { hasCustomer: false, hasBalance: false, overallUsd: 0, overallLbp: 0, excludingInvoiceUsd: 0, excludingInvoiceLbp: 0, includingInvoiceUsd: 0, includingInvoiceLbp: 0, invoiceIncludedNow: false };
    if (!customerAccount) return { hasCustomer: true, hasBalance: false, overallUsd: 0, overallLbp: 0, excludingInvoiceUsd: 0, excludingInvoiceLbp: 0, includingInvoiceUsd: 0, includingInvoiceLbp: 0, invoiceIncludedNow: detail?.invoice?.status === "posted" };
    const overallUsd = n(customerAccount.credit_balance_usd);
    const overallLbp = n(customerAccount.credit_balance_lbp);
    const invoiceDueUsd = n(salesOverview.balUsd);
    const invoiceDueLbp = n(salesOverview.balLbp);
    const invoiceIncludedNow = detail?.invoice?.status === "posted";
    const excludingInvoiceUsd = invoiceIncludedNow ? overallUsd - invoiceDueUsd : overallUsd;
    const excludingInvoiceLbp = invoiceIncludedNow ? overallLbp - invoiceDueLbp : overallLbp;
    const includingInvoiceUsd = invoiceIncludedNow ? overallUsd : overallUsd + invoiceDueUsd;
    const includingInvoiceLbp = invoiceIncludedNow ? overallLbp : overallLbp + invoiceDueLbp;
    return { hasCustomer: true, hasBalance: true, overallUsd, overallLbp, excludingInvoiceUsd, excludingInvoiceLbp, includingInvoiceUsd, includingInvoiceLbp, invoiceIncludedNow };
  }, [customerAccount, detail?.invoice?.customer_id, detail?.invoice?.status, salesOverview]);

  const invoicePrimaryBal = salesOverview?.primaryBal ?? 0;
  useEffect(() => { setInvoiceMathOpen(invoicePrimaryBal > 0); }, [detail?.invoice?.id, invoicePrimaryBal]);

  /* ---- Tax computations ---- */
  const taxById = useMemo(() => new Map((taxCodes || []).map((t) => [String(t.id), t])), [taxCodes]);
  const defaultVatTaxCodeId = useMemo(() => {
    const vats = (taxCodes || []).filter((t) => String(t.tax_type || "").toLowerCase() === "vat");
    vats.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return vats[0]?.id ? String(vats[0].id) : null;
  }, [taxCodes]);

  const taxSettlementCurrency = useMemo(() => {
    return String(detail?.invoice?.settlement_currency || "USD").toUpperCase() === "LBP" ? "LBP" : "USD";
  }, [detail?.invoice?.settlement_currency]);

  const taxBreakdown = useMemo(() => {
    const lines = detail?.tax_lines || [];
    const acc = new Map<string, { tax_code_id: string; label: string; ratePct: number | null; base_usd: number; base_lbp: number; tax_usd: number; tax_lbp: number }>();
    for (const t of lines) {
      const tid = String((t as any)?.tax_code_id || "").trim();
      if (!tid) continue;
      const tc = taxById.get(tid);
      const label = tc?.name ? String(tc.name) : tid;
      const ratePct = tc ? taxRateToPercent(tc.rate) : null;
      const prev = acc.get(tid) || { tax_code_id: tid, label, ratePct, base_usd: 0, base_lbp: 0, tax_usd: 0, tax_lbp: 0 };
      prev.base_usd += n((t as any)?.base_usd); prev.base_lbp += n((t as any)?.base_lbp);
      prev.tax_usd += n((t as any)?.tax_usd); prev.tax_lbp += n((t as any)?.tax_lbp);
      prev.label = label; prev.ratePct = ratePct;
      acc.set(tid, prev);
    }
    return Array.from(acc.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [detail?.tax_lines, taxById]);

  const draftTaxBreakdown = useMemo(() => {
    const lines = taxPreview?.tax_rows || [];
    const acc = new Map<string, { tax_code_id: string; label: string; ratePct: number | null; base_usd: number; base_lbp: number; tax_usd: number; tax_lbp: number }>();
    for (const t of lines) {
      const tid = String((t as any)?.tax_code_id || "").trim();
      if (!tid) continue;
      const tc = taxById.get(tid);
      const label = tc?.name ? String(tc.name) : tid;
      const ratePct = tc ? taxRateToPercent(tc.rate) : null;
      const prev = acc.get(tid) || { tax_code_id: tid, label, ratePct, base_usd: 0, base_lbp: 0, tax_usd: 0, tax_lbp: 0 };
      prev.base_usd += n((t as any)?.base_usd); prev.base_lbp += n((t as any)?.base_lbp);
      prev.tax_usd += n((t as any)?.tax_usd); prev.tax_lbp += n((t as any)?.tax_lbp);
      prev.label = label; prev.ratePct = ratePct;
      acc.set(tid, prev);
    }
    return Array.from(acc.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [taxPreview?.tax_rows, taxById]);

  function sumBreakdown(rows: typeof taxBreakdown) {
    let base_usd = 0, base_lbp = 0, tax_usd = 0, tax_lbp = 0;
    for (const r of rows) { base_usd += n(r.base_usd); base_lbp += n(r.base_lbp); tax_usd += n(r.tax_usd); tax_lbp += n(r.tax_lbp); }
    return { base_usd, base_lbp, tax_usd, tax_lbp };
  }
  const taxBreakdownTotals = useMemo(() => sumBreakdown(taxBreakdown), [taxBreakdown]);
  const draftTaxBreakdownTotals = useMemo(() => sumBreakdown(draftTaxBreakdown), [draftTaxBreakdown]);

  const activeTaxBreakdown = detail?.invoice?.status === "draft" ? draftTaxBreakdown : taxBreakdown;
  const activeTaxBreakdownTotals = detail?.invoice?.status === "draft" ? draftTaxBreakdownTotals : taxBreakdownTotals;

  /* ---- Tax panel props ---- */
  const taxPanelRateRows = useMemo((): VatRateRow[] => {
    const totalTax = { usd: n(activeTaxBreakdownTotals.tax_usd), lbp: n(activeTaxBreakdownTotals.tax_lbp) };
    const rows = activeTaxBreakdown.map((r) => {
      const effectivePctUsd = r.base_usd > 0 ? (r.tax_usd / r.base_usd) * 100 : null;
      const effectivePctLbp = r.base_lbp > 0 ? (r.tax_lbp / r.base_lbp) * 100 : null;
      const effectiveRatePct = Number.isFinite(Number(effectivePctUsd)) ? effectivePctUsd : Number.isFinite(Number(effectivePctLbp)) ? effectivePctLbp : null;
      const tax = { usd: n(r.tax_usd), lbp: n(r.tax_lbp) };
      return { id: r.tax_code_id, label: r.label, ratePct: r.ratePct, effectiveRatePct, taxableBase: { usd: n(r.base_usd), lbp: n(r.base_lbp) }, tax, shareOfTotalTaxPct: buildVatSharePct(tax, totalTax, taxSettlementCurrency) };
    });
    rows.sort((a, b) => {
      const aRef = taxSettlementCurrency === "LBP" ? (Math.abs(a.tax.lbp) > 0 ? a.tax.lbp : a.tax.usd) : (Math.abs(a.tax.usd) > 0 ? a.tax.usd : a.tax.lbp);
      const bRef = taxSettlementCurrency === "LBP" ? (Math.abs(b.tax.lbp) > 0 ? b.tax.lbp : b.tax.usd) : (Math.abs(b.tax.usd) > 0 ? b.tax.usd : b.tax.lbp);
      return Math.abs(bRef) - Math.abs(aRef);
    });
    return rows;
  }, [activeTaxBreakdown, activeTaxBreakdownTotals, taxSettlementCurrency]);

  const taxPanelItemRows = useMemo((): VatItemAttributionRow[] => {
    if (!detail) return [];
    const exchangeRate = n(detail.invoice.exchange_rate);
    const vatApplied = detail.invoice.status === "draft" ? true : (detail.tax_lines || []).length > 0;
    const baseRows = detail.lines.map((l) => {
      const itemLabel = String(l.item_name || "").trim() || String(l.item_sku || "").trim() || String(l.item_id || "").trim() || String(l.id);
      const tcidRaw = String((l as any).item_tax_code_id || defaultVatTaxCodeId || "").trim();
      if (!vatApplied || !tcidRaw) return { id: String(l.id), itemLabel, qty: n(l.qty_entered ?? l.qty), net: { usd: n(l.line_total_usd), lbp: n(l.line_total_lbp) }, vatRatePct: null as number | null, vat: { usd: 0, lbp: 0 }, shareOfTotalTaxPct: null as number | null };
      const tc = taxById.get(tcidRaw);
      if (!tc || String(tc.tax_type || "").toLowerCase() !== "vat") return { id: String(l.id), itemLabel, qty: n(l.qty_entered ?? l.qty), net: { usd: n(l.line_total_usd), lbp: n(l.line_total_lbp) }, vatRatePct: null as number | null, vat: { usd: 0, lbp: 0 }, shareOfTotalTaxPct: null as number | null };
      const rateFrac = taxRateToFraction(tc.rate);
      const vatRatePct = taxRateToPercent(tc.rate);
      const baseLbp = n((l as any).line_total_lbp);
      const vatLbp = baseLbp * rateFrac;
      const vatUsd = exchangeRate ? vatLbp / exchangeRate : n((l as any).line_total_usd) * rateFrac;
      return { id: String(l.id), itemLabel, qty: n(l.qty_entered ?? l.qty), net: { usd: n(l.line_total_usd), lbp: n(l.line_total_lbp) }, vatRatePct, vat: { usd: vatUsd, lbp: vatLbp }, shareOfTotalTaxPct: null as number | null };
    }).filter((r) => r.vatRatePct !== null || n(r.vat.usd) !== 0 || n(r.vat.lbp) !== 0);
    const total = baseRows.reduce<{ usd: number; lbp: number }>((acc, r) => ({ usd: acc.usd + n(r.vat.usd), lbp: acc.lbp + n(r.vat.lbp) }), { usd: 0, lbp: 0 });
    const rowsWithShare = baseRows.map((r) => ({ ...r, shareOfTotalTaxPct: buildVatSharePct(r.vat, total, taxSettlementCurrency) }));
    rowsWithShare.sort((a, b) => {
      const aRef = taxSettlementCurrency === "LBP" ? (Math.abs(a.vat.lbp) > 0 ? a.vat.lbp : a.vat.usd) : (Math.abs(a.vat.usd) > 0 ? a.vat.usd : a.vat.lbp);
      const bRef = taxSettlementCurrency === "LBP" ? (Math.abs(b.vat.lbp) > 0 ? b.vat.lbp : b.vat.usd) : (Math.abs(b.vat.usd) > 0 ? b.vat.usd : b.vat.lbp);
      return Math.abs(bRef) - Math.abs(aRef);
    });
    return rowsWithShare;
  }, [defaultVatTaxCodeId, detail, taxById, taxSettlementCurrency]);

  const taxPanelRawTaxLines = useMemo((): VatRawTaxLine[] => {
    if (!detail || detail.invoice.status === "draft") return [];
    return detail.tax_lines.map((t) => {
      const tc = taxById.get(String(t.tax_code_id));
      return { id: String(t.id), label: tc?.name ? String(tc.name) : String(t.tax_code_id), ratePct: tc ? taxRateToPercent(tc.rate) : null, base: { usd: n((t as any).base_usd), lbp: n((t as any).base_lbp) }, tax: { usd: n((t as any).tax_usd), lbp: n((t as any).tax_lbp) } };
    });
  }, [detail, taxById]);

  const taxPanelSummary = useMemo((): VatSummaryModel => {
    const nonZeroRates = taxPanelRateRows.filter((r) => Number(r.ratePct || 0) > 0);
    const singleRateNote = nonZeroRates.length === 1 && nonZeroRates[0]?.ratePct !== null ? `All taxable items use ${nonZeroRates[0].ratePct!.toFixed(2)}% VAT` : null;
    return { totalTax: { usd: n(activeTaxBreakdownTotals.tax_usd), lbp: n(activeTaxBreakdownTotals.tax_lbp) }, taxableBase: { usd: n(activeTaxBreakdownTotals.base_usd), lbp: n(activeTaxBreakdownTotals.base_lbp) }, taxCodesCount: taxPanelRateRows.length, singleRateNote };
  }, [activeTaxBreakdownTotals, taxPanelRateRows]);

  const taxPanelPreviewNote = detail?.invoice?.status === "draft" ? "Preview is calculated per item (item tax code or default VAT). Tax entries are recorded when you post." : null;
  const taxPanelEmptyText = detail?.invoice?.status === "draft" ? "No tax preview (missing VAT tax code, or items have no tax code and no default VAT)." : "No tax lines.";

  /* ---- Invoice line columns ---- */
  const invoiceLineColumns = useMemo((): Array<DataTableColumn<InvoiceLine>> => {
    const exchangeRate = n(detail?.invoice?.exchange_rate);
    const vatApplied = detail ? (detail.invoice.status === "draft" ? true : (detail.tax_lines || []).length > 0) : true;
    const lineTax = (l: InvoiceLine) => {
      if (!vatApplied) return { tax_code_id: null as string | null, label: "-", ratePct: null as number | null, tax_usd: 0, tax_lbp: 0 };
      const tcidRaw = String((l as any).item_tax_code_id || defaultVatTaxCodeId || "").trim();
      if (!tcidRaw) return { tax_code_id: null as string | null, label: "-", ratePct: null as number | null, tax_usd: 0, tax_lbp: 0 };
      const tc = taxById.get(tcidRaw);
      if (!tc || String(tc.tax_type || "").toLowerCase() !== "vat") return { tax_code_id: tcidRaw, label: tc?.name ? String(tc.name) : tcidRaw, ratePct: null as number | null, tax_usd: 0, tax_lbp: 0 };
      const rateFrac = taxRateToFraction(tc.rate);
      const ratePct = taxRateToPercent(tc.rate);
      const base_lbp = n((l as any).line_total_lbp);
      const tax_lbp = base_lbp * rateFrac;
      const tax_usd = exchangeRate ? tax_lbp / exchangeRate : n((l as any).line_total_usd) * rateFrac;
      return { tax_code_id: tcidRaw, label: tc?.name ? String(tc.name) : tcidRaw, ratePct, tax_usd, tax_lbp };
    };
    return [
      { id: "item", header: "Item", sortable: true, accessor: (l) => `${l.item_sku || ""} ${l.item_name || ""}`, cell: (l) => l.item_sku || l.item_name ? (<ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item" className="text-sm"><span className="font-mono text-xs">{l.item_sku || "-"}</span> <span className="text-muted-foreground">·</span> <span dir="auto">{l.item_name || "-"}</span></ShortcutLink>) : (<ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item" className="font-mono text-xs">{l.item_id}</ShortcutLink>) },
      { id: "qty", header: "Qty", sortable: true, align: "right" as const, mono: true, accessor: (l) => Number(l.qty_entered ?? l.qty ?? 0), cell: (l) => (<div className="text-right data-mono text-sm"><div className="text-foreground">{Number((l.qty_entered ?? l.qty) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })} <span className="text-xs text-muted-foreground">{String(l.uom || "").trim().toUpperCase() || "-"}</span></div>{Number(l.qty_factor || 1) !== 1 ? (<div className="mt-0.5 text-xs text-muted-foreground">base {Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}</div>) : null}</div>) },
      { id: "unit_price_usd", header: "Unit USD", sortable: true, align: "right" as const, mono: true, defaultHidden: true, accessor: (l) => Number((l as any).unit_price_usd || 0), cell: (l) => <span className="data-mono text-xs">{fmtUsd((l as any).unit_price_usd)}</span> },
      { id: "unit_price_lbp", header: "Unit LL", sortable: true, align: "right" as const, mono: true, defaultHidden: true, accessor: (l) => Number((l as any).unit_price_lbp || 0), cell: (l) => <span className="data-mono text-xs">{fmtLbp((l as any).unit_price_lbp)}</span> },
      { id: "discount_pct", header: "Discount %", sortable: true, align: "right" as const, mono: true, defaultHidden: true, accessor: (l) => Number((l as any).discount_pct || 0), cell: (l) => { const pct = Number((l as any).discount_pct || 0); return <span className="data-mono text-xs">{Number.isFinite(pct) ? `${(pct * 100).toFixed(2)}%` : "-"}</span>; } },
      { id: "discount_amount_usd", header: "Discount USD", sortable: true, align: "right" as const, mono: true, defaultHidden: true, accessor: (l) => Number((l as any).discount_amount_usd || 0), cell: (l) => <span className="data-mono text-xs">{fmtUsd((l as any).discount_amount_usd)}</span> },
      { id: "discount_amount_lbp", header: "Discount LL", sortable: true, align: "right" as const, mono: true, defaultHidden: true, accessor: (l) => Number((l as any).discount_amount_lbp || 0), cell: (l) => <span className="data-mono text-xs">{fmtLbp((l as any).discount_amount_lbp)}</span> },
      { id: "tax_code", header: "Tax Code", sortable: true, defaultHidden: true, accessor: (l) => lineTax(l).label, cell: (l) => { const tx = lineTax(l); return (<span className="data-mono text-xs">{tx.label}{tx.ratePct != null ? <span className="text-muted-foreground"> · {tx.ratePct.toFixed(2)}%</span> : null}</span>); } },
      { id: "tax_usd_calc", header: "Tax USD", sortable: true, align: "right" as const, mono: true, defaultHidden: true, accessor: (l) => lineTax(l).tax_usd, cell: (l) => <span className="data-mono text-xs">{fmtUsd(lineTax(l).tax_usd)}</span> },
      { id: "tax_lbp_calc", header: "Tax LL", sortable: true, align: "right" as const, mono: true, defaultHidden: true, accessor: (l) => lineTax(l).tax_lbp, cell: (l) => <span className="data-mono text-xs">{fmtLbp(lineTax(l).tax_lbp)}</span> },
      { id: "line_total_usd", header: "Total USD", sortable: true, align: "right" as const, mono: true, accessor: (l) => Number(l.line_total_usd || 0), cell: (l) => <span className="data-mono text-xs">{fmtUsd(l.line_total_usd)}</span> },
      { id: "line_total_lbp", header: "Total LL", sortable: true, align: "right" as const, mono: true, accessor: (l) => Number(l.line_total_lbp || 0), cell: (l) => <span className="data-mono text-xs">{fmtLbp(l.line_total_lbp)}</span> },
    ];
  }, [detail, defaultVatTaxCodeId, taxById]);

  /* ---- Data loading ---- */
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setCustomerAccount(null);
    try {
      const [det, pm, tc] = await Promise.all([
        apiGet<InvoiceDetail>(`/sales/invoices/${id}`),
        apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods").catch(() => ({ methods: [] as PaymentMethodMapping[] })),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes").catch(() => ({ tax_codes: [] as TaxCode[] })),
      ]);
      setDetail(det);
      setPaymentMethods(pm.methods || []);
      setTaxCodes(tc.tax_codes || []);
      setTaxPreview(null);
      const customerId = String(det?.invoice?.customer_id || "").trim();
      if (customerId) {
        const cust = await apiGet<{ customer: CustomerAccountSnapshot }>(`/customers/${encodeURIComponent(customerId)}`).catch(() => null);
        setCustomerAccount(cust?.customer || null);
      }
      if (det?.invoice?.status === "draft") {
        const prev = await apiGet<{
          base_usd: string | number; base_lbp: string | number; tax_code_id: string | null;
          tax_usd: string | number; tax_lbp: string | number;
          tax_rows?: Array<{ tax_code_id: string; base_usd: string | number; base_lbp: string | number; tax_usd: string | number; tax_lbp: string | number }>;
          total_usd: string | number; total_lbp: string | number;
        }>(`/sales/invoices/${encodeURIComponent(det.invoice.id)}/post-preview?apply_vat=1`).catch(() => null);
        if (prev) {
          setTaxPreview({
            base_usd: Number(prev.base_usd || 0), base_lbp: Number(prev.base_lbp || 0),
            tax_code_id: prev.tax_code_id ? String(prev.tax_code_id) : null,
            tax_usd: Number(prev.tax_usd || 0), tax_lbp: Number(prev.tax_lbp || 0),
            tax_rows: (prev.tax_rows || []).map((r) => ({ tax_code_id: String(r.tax_code_id), base_usd: Number(r.base_usd || 0), base_lbp: Number(r.base_lbp || 0), tax_usd: Number(r.tax_usd || 0), tax_lbp: Number(r.tax_lbp || 0) })),
            total_usd: Number(prev.total_usd || 0), total_lbp: Number(prev.total_lbp || 0),
          });
        }
      }
      setStatus("");
    } catch (err) {
      setDetail(null); setCustomerAccount(null);
      setStatus(err instanceof Error ? err.message : String(err));
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /* ---- Actions ---- */
  async function recomputePayment(paymentId: string) {
    if (!detail) return;
    setStatus("Fixing payment...");
    try { await apiPost(`/sales/payments/${encodeURIComponent(paymentId)}/recompute`, {}); await load(); setStatus(""); }
    catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
  }

  async function voidPayment(paymentId: string) {
    if (!detail) return;
    setStatus("Voiding payment...");
    try { await apiPost(`/sales/payments/${encodeURIComponent(paymentId)}/void`, {}); await load(); setStatus(""); }
    catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
  }

  /* ---- Keyboard shortcuts ---- */
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null) {
      if (!(t instanceof HTMLElement)) return false;
      const tag = (t.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if ((t as any).isContentEditable) return true;
      return false;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (!detail) return;
      if (isTypingTarget(e.target)) return;
      const key = (e.key || "").toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (key === "p" && !e.shiftKey) { e.preventDefault(); window.open(`/sales/invoices/${encodeURIComponent(detail.invoice.id)}/print`, "_blank", "noopener,noreferrer"); return; }
      if (key === "p" && e.shiftKey) { e.preventDefault(); window.open(`/sales/payments?invoice_id=${encodeURIComponent(detail.invoice.id)}&record=1`, "_blank", "noopener,noreferrer"); return; }
      if (key === "enter" && detail.invoice.status === "draft") { e.preventDefault(); setPostOpen(true); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detail]);

  /* ---- Tab change ---- */
  function onTabChange(tab: string) {
    router.replace(`?tab=${tab}`);
  }

  /* ---- Loading ---- */
  if (loading && !detail) {
    return <div className="min-h-[50vh] px-6 py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const inv = detail?.invoice;
  const isDraft = inv?.status === "draft";
  const isPosted = inv?.status === "posted";

  /* ---- Sales channel badge ---- */
  const channelBadge = inv ? (
    <Badge variant="outline" className="text-xs uppercase">
      {salesChannelLabel(inv.sales_channel)}
    </Badge>
  ) : null;

  return (
    <DetailPageLayout
      backHref="/sales/invoices"
      title={inv?.invoice_no || "Sales Invoice"}
      badge={
        <div className="flex items-center gap-2">
          {inv ? <StatusBadge status={inv.status} /> : null}
          {channelBadge}
        </div>
      }
      meta={
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono text-xs">{shortId(id)}</span>
          <CopyButton text={id} label="ID" />
          {inv?.invoice_date && (
            <>
              <span className="text-muted-foreground/50">|</span>
              <span className="text-xs">{formatDateLike(inv.invoice_date)}</span>
            </>
          )}
        </div>
      }
      actions={{
        primary: isDraft
          ? { label: "Post Draft", onClick: () => setPostOpen(true) }
          : isPosted
            ? { label: "Record Payment", onClick: () => { if (inv) window.open(`/sales/payments?invoice_id=${encodeURIComponent(inv.id)}&record=1`, "_blank", "noopener,noreferrer"); } }
            : undefined,
        secondary: [
          { label: "Preview", onClick: () => setPreviewOpen(true), visible: !!detail },
          { label: "Print / PDF", onClick: () => { if (inv) window.open(`/sales/invoices/${encodeURIComponent(inv.id)}/print`, "_blank", "noopener,noreferrer"); }, visible: !!detail },
          { label: "Download PDF", onClick: () => { if (inv) window.open(`/exports/sales-invoices/${encodeURIComponent(inv.id)}/pdf`, "_blank", "noopener,noreferrer"); }, visible: !!detail },
          { label: "Print Receipt", onClick: () => { if (inv) window.open(`/sales/invoices/${encodeURIComponent(inv.id)}/print?paper=receipt&doc=receipt`, "_blank", "noopener,noreferrer"); }, visible: isPosted },
          { label: "Receipt PDF", onClick: () => { if (inv) window.open(`/exports/sales-receipts/${encodeURIComponent(inv.id)}/pdf`, "_blank", "noopener,noreferrer"); }, visible: isPosted },
          { label: "Edit Draft", onClick: () => { if (inv) router.push(`/sales/invoices/${encodeURIComponent(inv.id)}/edit`); }, visible: isDraft },
        ],
        destructive: isDraft
          ? { label: "Cancel Draft", onClick: () => setCancelDraftOpen(true) }
          : isPosted
            ? { label: "Void Invoice", onClick: () => setCancelOpen(true) }
            : undefined,
        utilities: detail ? (
          <DocumentUtilitiesDrawer entityType="sales_invoice" entityId={detail.invoice.id} allowUploadAttachments={isDraft} />
        ) : undefined,
      }}
      error={status || undefined}
    >
      {detail && salesOverview ? (
        <>
          <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-6">
            <TabsList>
              <TabsTrigger value="overview" className="gap-2">
                <FileText className="h-4 w-4" /> Overview
              </TabsTrigger>
              <TabsTrigger value="items" className="gap-2">
                <Package className="h-4 w-4" /> Items
                {detail.lines.length > 0 && (
                  <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-medium">
                    {detail.lines.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="tax" className="gap-2">
                <Receipt className="h-4 w-4" /> Tax
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <InvoiceOverviewTab
                invoice={detail.invoice}
                payments={detail.payments}
                taxLines={detail.tax_lines}
                salesOverview={salesOverview}
                customerAccountOverview={customerAccountOverview}
                invoiceMathOpen={invoiceMathOpen}
                onInvoiceMathToggle={setInvoiceMathOpen}
                onRecomputePayment={recomputePayment}
                onVoidPayment={voidPayment}
                onError={setStatus}
              />
            </TabsContent>

            <TabsContent value="items">
              <InvoiceItemsTab lines={detail.lines} columns={invoiceLineColumns} />
            </TabsContent>

            <TabsContent value="tax">
              <InvoiceTaxTab
                summary={taxPanelSummary}
                rateRows={taxPanelRateRows}
                itemRows={taxPanelItemRows}
                rawTaxLines={taxPanelRawTaxLines}
                settlementCurrency={taxSettlementCurrency}
                previewNote={taxPanelPreviewNote}
                emptyText={taxPanelEmptyText}
              />
            </TabsContent>
          </Tabs>

          {/* Dialogs */}
          <PostInvoiceDialog
            open={postOpen}
            onOpenChange={setPostOpen}
            invoiceId={detail.invoice.id}
            invoiceStatus={detail.invoice.status}
            lineCount={detail.lines.length}
            exchangeRate={n(detail.invoice.exchange_rate)}
            customerId={detail.invoice.customer_id}
            methodChoices={methodChoices}
            hasPaymentMethodMappings={hasPaymentMethodMappings}
            onPosted={load}
            onError={setStatus}
          />

          <VoidInvoiceDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            invoiceId={detail.invoice.id}
            onVoided={load}
            onError={setStatus}
          />

          <CancelDraftDialog
            open={cancelDraftOpen}
            onOpenChange={setCancelDraftOpen}
            invoiceId={detail.invoice.id}
            onCanceled={load}
            onError={setStatus}
          />

          <PrintPreviewDialog
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            invoiceId={detail.invoice.id}
          />
        </>
      ) : null}
    </DetailPageLayout>
  );
}

export default function SalesInvoiceShowPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <SalesInvoiceShowInner />
    </Suspense>
  );
}
