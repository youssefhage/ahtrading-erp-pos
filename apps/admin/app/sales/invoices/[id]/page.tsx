"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { parseNumberInput } from "@/lib/numbers";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { ConfirmButton } from "@/components/confirm-button";
import { MoneyInput } from "@/components/money-input";
import { ShortcutLink } from "@/components/shortcut-link";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type PaymentMethodMapping = { method: string; role_code: string; created_at: string };

type TaxCode = { id: string; name: string; rate: string | number; tax_type: string; reporting_currency: string };

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
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
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtIso(iso?: string | null) {
  return formatDateLike(iso);
}

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

function SalesInvoiceShowInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [taxPreview, setTaxPreview] = useState<{
    base_usd: number;
    base_lbp: number;
    tax_usd: number;
    tax_lbp: number;
    total_usd: number;
    total_lbp: number;
    tax_code_id: string | null;
    tax_rows: Array<{ tax_code_id: string; base_usd: number; base_lbp: number; tax_usd: number; tax_lbp: number }>;
  } | null>(null);

  const [postOpen, setPostOpen] = useState(false);
  const [postApplyingVat, setPostApplyingVat] = useState(true);
  const [postRecordPayment, setPostRecordPayment] = useState(false);
  const [postMethod, setPostMethod] = useState("cash");
  const [postUsd, setPostUsd] = useState("0");
  const [postLbp, setPostLbp] = useState("0");
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postPreview, setPostPreview] = useState<{ total_usd: number; total_lbp: number; tax_usd: number; tax_lbp: number } | null>(
    null
  );

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState(() => todayIso());
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);

  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelDraftReason, setCancelDraftReason] = useState("");
  const [cancelDrafting, setCancelDrafting] = useState(false);
  const searchParams = useSearchParams();

  const methodChoices = useMemo(() => {
    const base = ["cash", "bank", "card", "transfer", "other"];
    const fromConfig = paymentMethods.map((m) => m.method);
    const merged = Array.from(new Set([...base, ...fromConfig])).filter(Boolean);
    merged.sort();
    return merged;
  }, [paymentMethods]);

  const activeTab = (() => {
    const t = String(searchParams.get("tab") || "overview").toLowerCase();
    if (t === "lines" || t === "items") return "items";
    if (t === "tax") return "tax";
    return "overview";
  })();

  // Canonicalize legacy tab names so the TabBar stays highlighted on old deep links.
  useEffect(() => {
    const t = String(searchParams.get("tab") || "overview").toLowerCase();
    if (t === "payments") router.replace("?tab=overview");
    if (t === "lines") router.replace("?tab=items");
  }, [router, searchParams]);

  const salesInvoiceTabs = useMemo(
    () => [
      { label: "Overview", href: "?tab=overview", activeQuery: { key: "tab", value: "overview" } },
      { label: "Items", href: "?tab=items", activeQuery: { key: "tab", value: "items" } },
      { label: "Tax", href: "?tab=tax", activeQuery: { key: "tab", value: "tax" } }
    ],
    []
  );

  const salesOverview = useMemo(() => {
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
    const primaryTone = settle === "LBP" ? "ui-tone-lbp" : "ui-tone-usd";

    return {
      paidUsd,
      paidLbp,
      tenderUsd,
      tenderLbp,
      hasAnyTender,
      vatUsd,
      vatLbp,
      totalUsd,
      totalLbp,
      settle,
      balUsd,
      balLbp,
      subUsd,
      subLbp,
      discUsd,
      discLbp,
      rate,
      primaryTotal,
      primaryPaid,
      primaryBal,
      secondaryTotal,
      secondaryPaid,
      secondaryBal,
      primaryFmt,
      secondaryFmt,
      primaryTone
    };
  }, [detail]);

  const taxById = useMemo(() => {
    return new Map((taxCodes || []).map((t) => [String(t.id), t]));
  }, [taxCodes]);

  const defaultVatTaxCodeId = useMemo(() => {
    const vats = (taxCodes || []).filter((t) => String(t.tax_type || "").toLowerCase() === "vat");
    vats.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    const id = vats[0]?.id;
    return id ? String(id) : null;
  }, [taxCodes]);

  const taxBreakdown = useMemo(() => {
    const lines = detail?.tax_lines || [];
    const acc = new Map<
      string,
      {
        tax_code_id: string;
        label: string;
        ratePct: number | null;
        base_usd: number;
        base_lbp: number;
        tax_usd: number;
        tax_lbp: number;
      }
    >();

    for (const t of lines) {
      const id = String((t as any)?.tax_code_id || "").trim();
      if (!id) continue;
      const tc = taxById.get(id);
      const label = tc?.name ? String(tc.name) : id;
      const ratePct = tc ? taxRateToPercent(tc.rate) : null;

      const prev = acc.get(id) || {
        tax_code_id: id,
        label,
        ratePct,
        base_usd: 0,
        base_lbp: 0,
        tax_usd: 0,
        tax_lbp: 0,
      };

      prev.base_usd += n((t as any)?.base_usd);
      prev.base_lbp += n((t as any)?.base_lbp);
      prev.tax_usd += n((t as any)?.tax_usd);
      prev.tax_lbp += n((t as any)?.tax_lbp);
      // Keep the most-informative label/rate if tax codes loaded after initial render.
      prev.label = label;
      prev.ratePct = ratePct;

      acc.set(id, prev);
    }

    const out = Array.from(acc.values());
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [detail?.tax_lines, taxById]);

  const draftTaxBreakdown = useMemo(() => {
    const lines = taxPreview?.tax_rows || [];
    const acc = new Map<
      string,
      {
        tax_code_id: string;
        label: string;
        ratePct: number | null;
        base_usd: number;
        base_lbp: number;
        tax_usd: number;
        tax_lbp: number;
      }
    >();

    for (const t of lines) {
      const id = String((t as any)?.tax_code_id || "").trim();
      if (!id) continue;
      const tc = taxById.get(id);
      const label = tc?.name ? String(tc.name) : id;
      const ratePct = tc ? taxRateToPercent(tc.rate) : null;

      const prev = acc.get(id) || {
        tax_code_id: id,
        label,
        ratePct,
        base_usd: 0,
        base_lbp: 0,
        tax_usd: 0,
        tax_lbp: 0,
      };

      prev.base_usd += n((t as any)?.base_usd);
      prev.base_lbp += n((t as any)?.base_lbp);
      prev.tax_usd += n((t as any)?.tax_usd);
      prev.tax_lbp += n((t as any)?.tax_lbp);
      prev.label = label;
      prev.ratePct = ratePct;

      acc.set(id, prev);
    }

    const out = Array.from(acc.values());
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [taxPreview?.tax_rows, taxById]);

  const taxBreakdownTotals = useMemo(() => {
    let base_usd = 0;
    let base_lbp = 0;
    let tax_usd = 0;
    let tax_lbp = 0;
    for (const r of taxBreakdown) {
      base_usd += n(r.base_usd);
      base_lbp += n(r.base_lbp);
      tax_usd += n(r.tax_usd);
      tax_lbp += n(r.tax_lbp);
    }
    return { base_usd, base_lbp, tax_usd, tax_lbp };
  }, [taxBreakdown]);

  const draftTaxBreakdownTotals = useMemo(() => {
    let base_usd = 0;
    let base_lbp = 0;
    let tax_usd = 0;
    let tax_lbp = 0;
    for (const r of draftTaxBreakdown) {
      base_usd += n(r.base_usd);
      base_lbp += n(r.base_lbp);
      tax_usd += n(r.tax_usd);
      tax_lbp += n(r.tax_lbp);
    }
    return { base_usd, base_lbp, tax_usd, tax_lbp };
  }, [draftTaxBreakdown]);

  const invoiceLineColumns = useMemo((): Array<DataTableColumn<InvoiceLine>> => {
    const exchangeRate = n(detail?.invoice?.exchange_rate);
    const vatApplied = detail ? (detail.invoice.status === "draft" ? true : (detail.tax_lines || []).length > 0) : true;

    const lineTax = (l: InvoiceLine) => {
      if (!vatApplied) return { tax_code_id: null as string | null, label: "-", ratePct: null as number | null, tax_usd: 0, tax_lbp: 0 };
      const tcidRaw = String((l as any).item_tax_code_id || defaultVatTaxCodeId || "").trim();
      if (!tcidRaw) return { tax_code_id: null as string | null, label: "-", ratePct: null as number | null, tax_usd: 0, tax_lbp: 0 };
      const tc = taxById.get(tcidRaw);
      if (!tc || String(tc.tax_type || "").toLowerCase() !== "vat") {
        return { tax_code_id: tcidRaw, label: tc?.name ? String(tc.name) : tcidRaw, ratePct: null as number | null, tax_usd: 0, tax_lbp: 0 };
      }
      const rateFrac = taxRateToFraction(tc.rate);
      const ratePct = taxRateToPercent(tc.rate);
      const base_lbp = n((l as any).line_total_lbp);
      const tax_lbp = base_lbp * rateFrac;
      const tax_usd = exchangeRate ? tax_lbp / exchangeRate : n((l as any).line_total_usd) * rateFrac;
      return { tax_code_id: tcidRaw, label: tc?.name ? String(tc.name) : tcidRaw, ratePct, tax_usd, tax_lbp };
    };

    return [
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (l) => `${l.item_sku || ""} ${l.item_name || ""}`,
        cell: (l) =>
          l.item_sku || l.item_name ? (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item" className="text-sm">
              <span className="font-mono text-xs">{l.item_sku || "-"}</span>{" "}
              <span className="text-fg-subtle">·</span>{" "}
              <span dir="auto">{l.item_name || "-"}</span>
            </ShortcutLink>
          ) : (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item" className="font-mono text-xs">
              {l.item_id}
            </ShortcutLink>
        ),
      },
      {
        id: "qty",
        header: "Qty",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (l) => Number(l.qty_entered ?? l.qty ?? 0),
        cell: (l) => (
          <div className="text-right data-mono text-sm">
            <div className="text-foreground">
              {Number((l.qty_entered ?? l.qty) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}{" "}
              <span className="text-xs text-fg-subtle">{String(l.uom || "").trim().toUpperCase() || "-"}</span>
            </div>
            {Number(l.qty_factor || 1) !== 1 ? (
              <div className="mt-0.5 text-xs text-fg-subtle">
                base {Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "unit_price_usd",
        header: "Unit USD",
        sortable: true,
        align: "right",
        mono: true,
        defaultHidden: true,
        accessor: (l) => Number((l as any).unit_price_usd || 0),
        cell: (l) => <span className="data-mono text-xs">{fmtUsd((l as any).unit_price_usd)}</span>,
      },
      {
        id: "unit_price_lbp",
        header: "Unit LL",
        sortable: true,
        align: "right",
        mono: true,
        defaultHidden: true,
        accessor: (l) => Number((l as any).unit_price_lbp || 0),
        cell: (l) => <span className="data-mono text-xs">{fmtLbp((l as any).unit_price_lbp)}</span>,
      },
      {
        id: "discount_pct",
        header: "Discount %",
        sortable: true,
        align: "right",
        mono: true,
        defaultHidden: true,
        accessor: (l) => Number((l as any).discount_pct || 0),
        cell: (l) => {
          const pct = Number((l as any).discount_pct || 0);
          return <span className="data-mono text-xs">{Number.isFinite(pct) ? `${(pct * 100).toFixed(2)}%` : "-"}</span>;
        },
      },
      {
        id: "discount_amount_usd",
        header: "Discount USD",
        sortable: true,
        align: "right",
        mono: true,
        defaultHidden: true,
        accessor: (l) => Number((l as any).discount_amount_usd || 0),
        cell: (l) => <span className="data-mono text-xs">{fmtUsd((l as any).discount_amount_usd)}</span>,
      },
      {
        id: "discount_amount_lbp",
        header: "Discount LL",
        sortable: true,
        align: "right",
        mono: true,
        defaultHidden: true,
        accessor: (l) => Number((l as any).discount_amount_lbp || 0),
        cell: (l) => <span className="data-mono text-xs">{fmtLbp((l as any).discount_amount_lbp)}</span>,
      },
      {
        id: "tax_code",
        header: "Tax Code",
        sortable: true,
        defaultHidden: true,
        accessor: (l) => lineTax(l).label,
        cell: (l) => {
          const tx = lineTax(l);
          return (
            <span className="data-mono text-xs">
              {tx.label}
              {tx.ratePct != null ? <span className="text-fg-subtle"> · {tx.ratePct.toFixed(2)}%</span> : null}
            </span>
          );
        },
      },
      {
        id: "tax_usd_calc",
        header: "Tax USD",
        sortable: true,
        align: "right",
        mono: true,
        defaultHidden: true,
        accessor: (l) => lineTax(l).tax_usd,
        cell: (l) => <span className="data-mono text-xs">{fmtUsd(lineTax(l).tax_usd)}</span>,
      },
      {
        id: "tax_lbp_calc",
        header: "Tax LL",
        sortable: true,
        align: "right",
        mono: true,
        defaultHidden: true,
        accessor: (l) => lineTax(l).tax_lbp,
        cell: (l) => <span className="data-mono text-xs">{fmtLbp(lineTax(l).tax_lbp)}</span>,
      },
      {
        id: "line_total_usd",
        header: "Total USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (l) => Number(l.line_total_usd || 0),
        cell: (l) => <span className="data-mono text-xs">{fmtUsd(l.line_total_usd)}</span>,
      },
      {
        id: "line_total_lbp",
        header: "Total LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (l) => Number(l.line_total_lbp || 0),
        cell: (l) => <span className="data-mono text-xs">{fmtLbp(l.line_total_lbp)}</span>,
      },
    ];
  }, [detail, defaultVatTaxCodeId, taxById]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [det, pm, tc] = await Promise.all([
        apiGet<InvoiceDetail>(`/sales/invoices/${id}`),
        apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods").catch(() => ({ methods: [] as PaymentMethodMapping[] })),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes").catch(() => ({ tax_codes: [] as TaxCode[] }))
      ]);
      setDetail(det);
      setPaymentMethods(pm.methods || []);
      setTaxCodes(tc.tax_codes || []);
      setTaxPreview(null);
      if (det?.invoice?.status === "draft") {
        const prev = await apiGet<{
          base_usd: string | number;
          base_lbp: string | number;
          tax_code_id: string | null;
          tax_usd: string | number;
          tax_lbp: string | number;
          tax_rows?: Array<{ tax_code_id: string; base_usd: string | number; base_lbp: string | number; tax_usd: string | number; tax_lbp: string | number }>;
          total_usd: string | number;
          total_lbp: string | number;
        }>(
          `/sales/invoices/${encodeURIComponent(det.invoice.id)}/post-preview?apply_vat=1`
        ).catch(() => null);
        if (prev) {
          setTaxPreview({
            base_usd: Number(prev.base_usd || 0),
            base_lbp: Number(prev.base_lbp || 0),
            tax_code_id: prev.tax_code_id ? String(prev.tax_code_id) : null,
            tax_usd: Number(prev.tax_usd || 0),
            tax_lbp: Number(prev.tax_lbp || 0),
            tax_rows: (prev.tax_rows || []).map((r) => ({
              tax_code_id: String(r.tax_code_id),
              base_usd: Number(r.base_usd || 0),
              base_lbp: Number(r.base_lbp || 0),
              tax_usd: Number(r.tax_usd || 0),
              tax_lbp: Number(r.tax_lbp || 0),
            })),
            total_usd: Number(prev.total_usd || 0),
            total_lbp: Number(prev.total_lbp || 0),
          });
        }
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetail(null);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function recomputePayment(paymentId: string) {
    if (!detail) return;
    setStatus("Fixing payment...");
    try {
      await apiPost(`/sales/payments/${encodeURIComponent(paymentId)}/recompute`, {});
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function voidPayment(paymentId: string) {
    if (!detail) return;
    setStatus("Voiding payment...");
    try {
      await apiPost(`/sales/payments/${encodeURIComponent(paymentId)}/void`, {});
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  const openPostDialog = useCallback(async () => {
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;
    if (!(detail.lines || []).length) {
      setStatus("Cannot post: add at least one line to this draft first.");
      return;
    }
    setPostApplyingVat(true);
    setPostRecordPayment(false);
    setPostMethod("cash");
    setPostUsd("0");
    setPostLbp("0");
    setPostPreview(null);
    try {
      const prev = await apiGet<{
        total_usd: string | number;
        total_lbp: string | number;
        tax_usd: string | number;
        tax_lbp: string | number;
      }>(`/sales/invoices/${detail.invoice.id}/post-preview?apply_vat=1`);
      setPostPreview({
        total_usd: Number(prev.total_usd || 0),
        total_lbp: Number(prev.total_lbp || 0),
        tax_usd: Number(prev.tax_usd || 0),
        tax_lbp: Number(prev.tax_lbp || 0)
      });
    } catch {
      setPostPreview(null);
    }
    setPostOpen(true);
  }, [detail]);

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

      // Cmd/Ctrl+P: open the printable page (instead of browser print).
      if (key === "p" && !e.shiftKey) {
        e.preventDefault();
        window.open(`/sales/invoices/${encodeURIComponent(detail.invoice.id)}/print`, "_blank", "noopener,noreferrer");
        return;
      }

      // Cmd/Ctrl+Shift+P: jump to "Record Payment" for this invoice.
      if (key === "p" && e.shiftKey) {
        e.preventDefault();
        window.open(
          `/sales/payments?invoice_id=${encodeURIComponent(detail.invoice.id)}&record=1`,
          "_blank",
          "noopener,noreferrer"
        );
        return;
      }

      // Cmd/Ctrl+Enter: post draft quickly.
      if (key === "enter") {
        if (detail.invoice.status === "draft") {
          e.preventDefault();
          void openPostDialog();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detail, openPostDialog]);

  const postChecklist = useMemo(() => {
    const inv = detail?.invoice;
    const lines = detail?.lines || [];
    const rate = Number(inv?.exchange_rate || 0);
    const missingUom = lines.filter((l) => !String(l.uom || "").trim()).length;
    const zeroPrice = lines.filter((l) => Number(l.unit_price_usd || 0) === 0 && Number(l.unit_price_lbp || 0) === 0).length;
    const blocking: string[] = [];
    const warnings: string[] = [];

    if (!lines.length) blocking.push("Add at least one line.");
    if (rate <= 0) blocking.push("Exchange rate is missing (USD→LL).");
    if (missingUom) blocking.push(`${missingUom} line(s) are missing UOM.`);

    if (zeroPrice) warnings.push(`${zeroPrice} line(s) have zero unit price.`);
    if (postRecordPayment) {
      const usd = parseNumberInput(postUsd);
      const lbp = parseNumberInput(postLbp);
      if ((!usd.ok && usd.reason === "invalid") || (!lbp.ok && lbp.reason === "invalid")) {
        blocking.push("Payment amount is invalid.");
      }
      const paid = (usd.ok ? usd.value : 0) + (lbp.ok ? lbp.value : 0);
      if (paid > 0 && !inv?.customer_id) {
        warnings.push("Walk-in + payment is ok, but credit/partial settlements are safer with a customer.");
      }
    }

    return { blocking, warnings };
  }, [detail, postRecordPayment, postUsd, postLbp]);

  async function refreshPostPreview(applyVat: boolean) {
    if (!detail) return;
    try {
      const prev = await apiGet<{
        total_usd: string | number;
        total_lbp: string | number;
        tax_usd: string | number;
        tax_lbp: string | number;
      }>(`/sales/invoices/${detail.invoice.id}/post-preview?apply_vat=${applyVat ? "1" : "0"}`);
      setPostPreview({
        total_usd: Number(prev.total_usd || 0),
        total_lbp: Number(prev.total_lbp || 0),
        tax_usd: Number(prev.tax_usd || 0),
        tax_lbp: Number(prev.tax_lbp || 0)
      });
    } catch {
      setPostPreview(null);
    }
  }

  async function postDraftInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;

    let usd = 0;
    let lbp = 0;
    if (postRecordPayment) {
      const usdRes = parseNumberInput(postUsd);
      const lbpRes = parseNumberInput(postLbp);
      if (!usdRes.ok && usdRes.reason === "invalid") return setStatus("Invalid payment USD amount.");
      if (!lbpRes.ok && lbpRes.reason === "invalid") return setStatus("Invalid payment LL amount.");
      usd = usdRes.ok ? usdRes.value : 0;
      lbp = lbpRes.ok ? lbpRes.value : 0;
    }
    const pay = !postRecordPayment || (usd === 0 && lbp === 0) ? [] : [{ method: postMethod, amount_usd: usd, amount_lbp: lbp }];

    setPostSubmitting(true);
    setStatus("Posting invoice...");
    try {
      await apiPost(`/sales/invoices/${detail.invoice.id}/post`, { apply_vat: postApplyingVat, payments: pay });
      setPostOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setPostSubmitting(false);
    }
  }

  async function cancelPostedInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "posted") return;
    setCanceling(true);
    setStatus("Voiding invoice...");
    try {
      await apiPost(`/sales/invoices/${detail.invoice.id}/cancel`, {
        cancel_date: cancelDate || undefined,
        reason: cancelReason || undefined
      });
      setCancelOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCanceling(false);
    }
  }

  async function cancelDraftInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;
    setCancelDrafting(true);
    setStatus("Canceling draft...");
    try {
      await apiPost(`/sales/invoices/${detail.invoice.id}/cancel-draft`, { reason: cancelDraftReason || undefined });
      setCancelDraftOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCancelDrafting(false);
    }
  }

  if (loading && !detail) {
    return <div className="min-h-[50vh] px-2 py-10 text-sm text-fg-muted">Loading...</div>;
  }

  return (
    <div className="ui-detail-shell">
      <div className="ui-detail-header">
        <div className="ui-detail-header-row">
          <div>
            <h1 className="ui-detail-title">{detail?.invoice?.invoice_no || "Sales Invoice"}</h1>
            <div className="ui-detail-meta">
              <span className="ui-detail-meta-id">{id}</span>
              {detail ? <StatusChip value={detail.invoice.status} /> : null}
            </div>
          </div>
          <div className="ui-detail-actions">
            <Button variant="outline" onClick={() => router.push("/sales/invoices")}>
              Back to List
            </Button>
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </Button>
            <Button onClick={() => router.push("/sales/invoices/new")}>New Draft</Button>
          </div>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      {detail ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-lg">Sales Invoice Overview</CardTitle>
                    <StatusChip value={detail.invoice.status} className="translate-y-[1px]" />
                  </div>
                  <CardDescription className="mt-1 text-sm">
                    <span className="font-mono">{detail.invoice.invoice_no || "(draft)"}</span>
                    {detail.invoice.invoice_date ? (
                      <>
                        {" "}
                        · <span className="data-mono">Inv {fmtIso(detail.invoice.invoice_date)}</span>
                      </>
                    ) : null}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button asChild variant="outline">
                    <Link
                      href={`/sales/invoices/${encodeURIComponent(detail.invoice.id)}/print`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Print / PDF
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <a
                      href={`/exports/sales-invoices/${encodeURIComponent(detail.invoice.id)}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download PDF
                    </a>
                  </Button>
                  {detail.invoice.status === "draft" ? (
                    <>
                      <Button asChild variant="outline">
                        <Link href={`/sales/invoices/${encodeURIComponent(detail.invoice.id)}/edit`}>Edit Draft</Link>
                      </Button>
                      <Button variant="outline" onClick={openPostDialog}>
                        Post Draft
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          setCancelDraftReason("");
                          setCancelDraftOpen(true);
                        }}
                      >
                        Cancel Draft
                      </Button>
                    </>
                  ) : null}
                  {detail.invoice.status === "posted" ? (
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setCancelDate(todayIso());
                        setCancelReason("");
                        setCancelOpen(true);
                      }}
                    >
                      Void Invoice
                    </Button>
                  ) : null}
                  <DocumentUtilitiesDrawer
                    entityType="sales_invoice"
                    entityId={detail.invoice.id}
                    allowUploadAttachments={detail.invoice.status === "draft"}
                    className="ml-1"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <TabBar tabs={salesInvoiceTabs} />

              {activeTab === "overview" && salesOverview ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                  <div className="ui-panel p-5 md:col-span-8">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[220px]">
                        <p className="ui-panel-title">Customer</p>
                        <p className="mt-1 text-lg font-semibold text-foreground leading-tight">
                          {detail.invoice.customer_id ? (
                            <ShortcutLink href={`/partners/customers/${encodeURIComponent(detail.invoice.customer_id)}`} title="Open customer">
                              {detail.invoice.customer_name || detail.invoice.customer_id}
                            </ShortcutLink>
                          ) : (
                            "Walk-in"
                          )}
                        </p>
                        <p className="mt-1 text-sm text-fg-muted">
                          Created{" "}
                          <span className="data-mono">
                            {formatDateLike(detail.invoice.created_at)}
                          </span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="ui-chip ui-chip-default">
                          <span className="text-fg-subtle">Warehouse</span>
                          <span className="data-mono text-foreground">{detail.invoice.warehouse_name || detail.invoice.warehouse_id || "-"}</span>
                        </span>
                        <span className="ui-chip ui-chip-default">
                          <span className="text-fg-subtle">Settle</span>
                          <span className="data-mono text-foreground">{salesOverview.settle}</span>
                        </span>
                        <span className="ui-chip ui-chip-default">
                          <span className="text-fg-subtle">Rate</span>
                          <span className="data-mono text-foreground">{salesOverview.rate ? salesOverview.rate.toLocaleString("en-US") : "-"}</span>
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
                        <p className="ui-panel-title">Dates</p>
                        <div className="mt-2 space-y-1">
                          <div className="ui-kv">
                            <span className="ui-kv-label">Invoice</span>
                            <span className="ui-kv-value">{fmtIso(detail.invoice.invoice_date)}</span>
                          </div>
                          <div className="ui-kv">
                            <span className="ui-kv-label">Due</span>
                            <span className="ui-kv-value">{fmtIso(detail.invoice.due_date)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
                        <p className="ui-panel-title">Document</p>
                        <div className="mt-2 space-y-1">
                          <div className="ui-kv">
                            <span className="ui-kv-label">Invoice No</span>
                            <span className="ui-kv-value">{detail.invoice.invoice_no || "(draft)"}</span>
                          </div>
                          <div className="ui-kv">
                            <span className="ui-kv-label">Receipt</span>
                            <span className="ui-kv-value">{detail.invoice.receipt_no || "-"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="ui-panel p-5 md:col-span-4">
                    <p className="ui-panel-title">Totals</p>
                    <div className="mt-3">
                      <div className="text-sm text-fg-muted">Balance</div>
                      <div className={`data-mono mt-1 text-3xl font-semibold leading-none ${salesOverview.primaryTone}`}>{salesOverview.primaryFmt(salesOverview.primaryBal)}</div>
                      <div className="data-mono mt-1 text-sm text-fg-muted">{salesOverview.secondaryFmt(salesOverview.secondaryBal)}</div>
                    </div>
                    <div className="mt-4 space-y-2">
                      <div className="ui-kv ui-kv-strong">
                        <span className="ui-kv-label">Total</span>
                        <span className="ui-kv-value">{salesOverview.primaryFmt(salesOverview.primaryTotal)}</span>
                      </div>
                      <div className="ui-kv ui-kv-sub">
                        <span className="ui-kv-label">Total (other)</span>
                        <span className="ui-kv-value">{salesOverview.secondaryFmt(salesOverview.secondaryTotal)}</span>
                      </div>

                      <div className="section-divider my-3" />
                      <div className="ui-kv">
                        <span className="ui-kv-label">Applied (settles)</span>
                        <span className="ui-kv-value">{salesOverview.primaryFmt(salesOverview.primaryPaid)}</span>
                      </div>
                      <div className="ui-kv ui-kv-sub">
                        <span className="ui-kv-label">Applied (other)</span>
                        <span className="ui-kv-value">{salesOverview.secondaryFmt(salesOverview.secondaryPaid)}</span>
                      </div>

                      {salesOverview.hasAnyTender ? (
                        <>
                          <div className="section-divider my-3" />
                          <div className="ui-kv">
                            <span className="ui-kv-label">Tender received</span>
                            <span className="ui-kv-value">{fmtUsdLbp(salesOverview.tenderUsd, salesOverview.tenderLbp)}</span>
                          </div>
                        </>
                      ) : null}

                      {(detail.tax_lines || []).length ? (
                        <>
                          <div className="section-divider my-3" />
                          <div className="ui-kv">
                            <span className="ui-kv-label">VAT</span>
                            <span className="ui-kv-value">{fmtUsdLbp(salesOverview.vatUsd, salesOverview.vatLbp)}</span>
                          </div>
                        </>
                      ) : null}

                      <div className="section-divider my-3" />
                      <details className="mt-3 rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
                        <summary className="cursor-pointer text-sm font-medium text-fg-muted">Breakdown</summary>
                        <div className="mt-2 space-y-2">
                          <div className="ui-kv">
                            <span className="ui-kv-label">Subtotal</span>
                            <span className="ui-kv-value">{fmtUsdLbp(salesOverview.subUsd, salesOverview.subLbp)}</span>
                          </div>
                          <div className="ui-kv">
                            <span className="ui-kv-label">Discount</span>
                            <span className="ui-kv-value">{fmtUsdLbp(salesOverview.discUsd, salesOverview.discLbp)}</span>
                          </div>
                        </div>
                      </details>
                    </div>
                  </div>

                  <div className="ui-panel p-5 md:col-span-12">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="ui-panel-title">Payments</p>
                        <p className="mt-1 text-sm text-fg-subtle">Applied and tender amounts (if any).</p>
                      </div>
                      {detail.invoice.status === "posted" ? (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/sales/payments?invoice_id=${encodeURIComponent(detail.invoice.id)}&record=1`}>Record Payment</Link>
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" disabled>
                          Record Payment
                        </Button>
                      )}
                    </div>

                    {detail.invoice.status !== "posted" ? (
                      <p className="mt-2 text-sm text-fg-subtle">Payments are recorded after posting.</p>
                    ) : null}

                    <div className="mt-3 space-y-1 text-sm text-fg-muted">
                      {detail.payments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2">
                          <span className="data-mono">{p.method}</span>
                          <div className="flex items-center gap-2">
                            <span className="data-mono text-right">
                              {hasTender(p) ? (
                                <>
                                  <span className="text-foreground">Tender {fmtUsdLbp(n(p.tender_usd), n(p.tender_lbp))}</span>
                                  <span className="text-fg-subtle"> · </span>
                                  <span className="text-fg-muted">Applied {fmtUsdLbp(n(p.amount_usd), n(p.amount_lbp))}</span>
                                </>
                              ) : (
                                <span className="text-foreground">Applied {fmtUsdLbp(n(p.amount_usd), n(p.amount_lbp))}</span>
                              )}
                            </span>
                            <Button variant="outline" size="sm" onClick={() => recomputePayment(p.id)}>
                              Fix
                            </Button>
                            <ConfirmButton
                              variant="destructive"
                              size="sm"
                              title="Void Payment?"
                              description="This will create a reversing GL entry."
                              confirmText="Void"
                              confirmVariant="destructive"
                              onError={(err) => setStatus(err instanceof Error ? err.message : String(err))}
                              onConfirm={() => voidPayment(p.id)}
                            >
                              Void
                            </ConfirmButton>
                          </div>
                        </div>
                      ))}
                      {detail.payments.length === 0 ? <p className="text-fg-subtle">No payments.</p> : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === "items" ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Items</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable<InvoiceLine>
                      tableId="sales.invoice.lines"
                      rows={detail.lines}
                      columns={invoiceLineColumns}
                      getRowId={(l) => l.id}
                      emptyText="No lines."
                      enableGlobalFilter={false}
                      initialSort={{ columnId: "item", dir: "asc" }}
                    />
                  </CardContent>
                </Card>
              ) : null}

              {activeTab === "tax" ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Tax</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-xs text-fg-muted">
                      {detail.invoice.status === "draft" && draftTaxBreakdown.length ? (
                        <div className="rounded-md border border-border-subtle bg-bg-sunken/25 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Tax breakdown (preview)</span>
                            <span className="text-xs text-fg-subtle">{draftTaxBreakdown.length} code(s)</span>
                          </div>
                          <div className="mt-2 space-y-1">
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs text-fg-subtle">
                              <span>Code</span>
                              <span className="text-right">Tax</span>
                            </div>
                            {draftTaxBreakdown.map((r) => {
                              const effectivePctUsd = r.base_usd > 0 ? (r.tax_usd / r.base_usd) * 100 : null;
                              const effectivePctLbp = r.base_lbp > 0 ? (r.tax_lbp / r.base_lbp) * 100 : null;
                              const effectivePct = Number.isFinite(Number(effectivePctUsd))
                                ? effectivePctUsd
                                : Number.isFinite(Number(effectivePctLbp))
                                  ? effectivePctLbp
                                  : null;

                              return (
                                <div key={r.tax_code_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border-subtle bg-bg-elevated/40 p-2">
                                  <div className="min-w-0">
                                    <div className="truncate data-mono text-foreground">
                                      {r.label}
                                      {r.ratePct !== null ? <span className="text-fg-subtle"> · {r.ratePct.toFixed(2)}%</span> : null}
                                      {effectivePct !== null ? <span className="text-fg-subtle"> · eff {effectivePct.toFixed(2)}%</span> : null}
                                    </div>
                                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-fg-muted">
                                      <span className="text-fg-subtle">Base</span>
                                      <span className="data-mono">{fmtUsdLbp(r.base_usd, r.base_lbp)}</span>
                                    </div>
                                  </div>
                                  <div className="text-right data-mono text-foreground">{fmtUsdLbp(r.tax_usd, r.tax_lbp)}</div>
                                </div>
                              );
                            })}

                            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-1 pt-1 text-xs">
                              <span className="text-fg-subtle">Total</span>
                              <span className="text-right data-mono text-foreground">{fmtUsdLbp(draftTaxBreakdownTotals.tax_usd, draftTaxBreakdownTotals.tax_lbp)}</span>
                            </div>
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-1 text-xs text-fg-muted">
                              <span className="text-fg-subtle">Taxable base</span>
                              <span className="text-right data-mono">{fmtUsdLbp(draftTaxBreakdownTotals.base_usd, draftTaxBreakdownTotals.base_lbp)}</span>
                            </div>
                          </div>

                          <div className="mt-2 text-xs text-fg-subtle">
                            Preview is calculated per item (item tax code or default VAT). Tax entries are recorded when you post.
                          </div>
                        </div>
                      ) : null}

                      {detail.invoice.status !== "draft" && taxBreakdown.length ? (
                        <div className="rounded-md border border-border-subtle bg-bg-sunken/25 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Tax breakdown</span>
                            <span className="text-xs text-fg-subtle">{taxBreakdown.length} code(s)</span>
                          </div>
                          <div className="mt-2 space-y-1">
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs text-fg-subtle">
                              <span>Code</span>
                              <span className="text-right">Tax</span>
                            </div>
                            {taxBreakdown.map((r) => {
                              const effectivePctUsd = r.base_usd > 0 ? (r.tax_usd / r.base_usd) * 100 : null;
                              const effectivePctLbp = r.base_lbp > 0 ? (r.tax_lbp / r.base_lbp) * 100 : null;
                              const effectivePct = Number.isFinite(Number(effectivePctUsd))
                                ? effectivePctUsd
                                : Number.isFinite(Number(effectivePctLbp))
                                  ? effectivePctLbp
                                  : null;

                              return (
                                <div key={r.tax_code_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border-subtle bg-bg-elevated/40 p-2">
                                  <div className="min-w-0">
                                    <div className="truncate data-mono text-foreground">
                                      {r.label}
                                      {r.ratePct !== null ? <span className="text-fg-subtle"> · {r.ratePct.toFixed(2)}%</span> : null}
                                      {effectivePct !== null ? <span className="text-fg-subtle"> · eff {effectivePct.toFixed(2)}%</span> : null}
                                    </div>
                                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-fg-muted">
                                      <span className="text-fg-subtle">Base</span>
                                      <span className="data-mono">{fmtUsdLbp(r.base_usd, r.base_lbp)}</span>
                                    </div>
                                  </div>
                                  <div className="text-right data-mono text-foreground">{fmtUsdLbp(r.tax_usd, r.tax_lbp)}</div>
                                </div>
                              );
                            })}

                            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-1 pt-1 text-xs">
                              <span className="text-fg-subtle">Total</span>
                              <span className="text-right data-mono text-foreground">{fmtUsdLbp(taxBreakdownTotals.tax_usd, taxBreakdownTotals.tax_lbp)}</span>
                            </div>
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-1 text-xs text-fg-muted">
                              <span className="text-fg-subtle">Taxable base</span>
                              <span className="text-right data-mono">{fmtUsdLbp(taxBreakdownTotals.base_usd, taxBreakdownTotals.base_lbp)}</span>
                            </div>
                          </div>

                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-medium text-fg-subtle">Raw tax lines</summary>
                            <div className="mt-2 space-y-1">
                              {detail.tax_lines.map((t) => {
                                const tc = taxById.get(String(t.tax_code_id));
                                const label = tc?.name ? `${tc.name}` : t.tax_code_id;
                                const ratePct = tc ? taxRateToPercent(tc.rate) : null;
                                return (
                                  <div key={t.id} className="rounded-md border border-border-subtle bg-bg-sunken/25 p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="data-mono">
                                        {label}
                                        {ratePct !== null ? <span className="text-fg-subtle"> · {ratePct.toFixed(2)}%</span> : null}
                                      </span>
                                      <span className="data-mono text-foreground">{fmtUsdLbp(t.tax_usd, t.tax_lbp)}</span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between gap-2">
                                      <span className="text-xs text-fg-subtle">Base</span>
                                      <span className="data-mono text-xs text-fg-muted">{fmtUsdLbp(t.base_usd, t.base_lbp)}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        </div>
                      ) : null}

                      {detail.invoice.status === "draft" && draftTaxBreakdown.length === 0 ? (
                        <p className="text-fg-subtle">No tax preview (missing VAT tax code, or items have no tax code and no default VAT).</p>
                      ) : null}

                      {detail.invoice.status === "posted" && detail.tax_lines.length === 0 ? <p className="text-fg-subtle">No tax lines.</p> : null}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </CardContent>
          </Card>

          <Dialog open={postOpen} onOpenChange={setPostOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Post Draft Invoice</DialogTitle>
                <DialogDescription>Posting writes stock moves + GL. You can optionally record a payment now.</DialogDescription>
              </DialogHeader>
              <form onSubmit={postDraftInvoice} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="md:col-span-6 rounded-md border border-border-subtle bg-bg-sunken/25 p-3 text-xs text-fg-muted">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-foreground">Posting checklist</div>
                    <div className="text-xs text-fg-subtle">
                      Hotkeys: <span className="ui-kbd">⌘</span>+<span className="ui-kbd">Enter</span> post,{" "}
                      <span className="ui-kbd">⌘</span>+<span className="ui-kbd">P</span> print
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    {postChecklist.blocking.length ? (
                      <div className="rounded-md border border-danger/30 bg-danger/10 p-2 text-danger">
                        <div className="font-medium">Blocking</div>
                        <ul className="mt-1 list-disc pl-4">
                          {postChecklist.blocking.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-2 text-fg-muted">
                        Ready to post.
                      </div>
                    )}
                    {postChecklist.warnings.length ? (
                      <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-2">
                        <div className="font-medium text-foreground">Warnings</div>
                        <ul className="mt-1 list-disc pl-4">
                          {postChecklist.warnings.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
                <label className="md:col-span-6 flex items-center gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    className="ui-checkbox"
                    checked={postApplyingVat}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setPostApplyingVat(next);
                      refreshPostPreview(next);
                    }}
                  />
                  Apply VAT from company tax codes
                </label>
                <label className="md:col-span-6 flex items-center gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    className="ui-checkbox"
                    checked={postRecordPayment}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setPostRecordPayment(next);
                      if (!next) {
                        setPostUsd("0");
                        setPostLbp("0");
                        setPostMethod("cash");
                      }
                    }}
                  />
                  Record a payment now (otherwise invoice remains unpaid/credit)
                </label>
                {postPreview ? (
                  <div className="md:col-span-6 rounded-md border border-border-subtle bg-bg-elevated/60 p-3 text-xs text-fg-muted">
                    <div className="flex items-center justify-between gap-2">
                      <span>VAT</span>
                      <span className="data-mono">
                        {fmtUsdLbp(postPreview.tax_usd, postPreview.tax_lbp)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span>Total</span>
                      <span className="data-mono">
                        {fmtUsdLbp(postPreview.total_usd, postPreview.total_lbp)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="md:col-span-6 text-xs text-fg-muted">
                    Tip: If you post without paying the full amount, the remaining balance becomes credit and requires a customer.
                  </div>
                )}
                {postRecordPayment ? (
                  <>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Payment Method</label>
                      <select className="ui-select" value={postMethod} onChange={(e) => setPostMethod(e.target.value)}>
                        {methodChoices.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <MoneyInput label="Amount" currency="USD" value={postUsd} onChange={setPostUsd} quick={[0, 1, 10, 100]} className="md:col-span-3" />
                    <MoneyInput label="Amount" currency="LBP" value={postLbp} onChange={setPostLbp} quick={[0, 100000, 500000, 1000000]} className="md:col-span-3" />
                  </>
                ) : null}
                <div className="md:col-span-6 flex justify-end">
                  <Button type="submit" disabled={postSubmitting || postChecklist.blocking.length > 0}>
                    {postSubmitting ? "..." : "Post Invoice"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Void Sales Invoice</DialogTitle>
                <DialogDescription>
                  This will reverse stock moves, VAT tax lines, and GL entries. It is blocked if payments or posted returns exist.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={cancelPostedInvoice} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Void Date</label>
                  <Input type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-6">
                  <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
                  <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="customer error / duplicate / correction" />
                </div>
                <div className="md:col-span-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
                    Close
                  </Button>
                  <Button type="submit" variant="destructive" disabled={canceling}>
                    {canceling ? "..." : "Void Invoice"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={cancelDraftOpen} onOpenChange={setCancelDraftOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Cancel Draft Invoice</DialogTitle>
                <DialogDescription>This will mark the draft as canceled. No stock or GL will be posted.</DialogDescription>
              </DialogHeader>
              <form onSubmit={cancelDraftInvoice} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
                  <Input value={cancelDraftReason} onChange={(e) => setCancelDraftReason(e.target.value)} placeholder="Optional" />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCancelDraftOpen(false)}>
                    Close
                  </Button>
                  <Button type="submit" variant="destructive" disabled={cancelDrafting}>
                    {cancelDrafting ? "..." : "Cancel Draft"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

export default function SalesInvoiceShowPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <SalesInvoiceShowInner />
    </Suspense>
  );
}
