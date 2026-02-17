"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { recommendationView, type RecommendationView } from "@/lib/ai-recommendations";
import { formatDateLike } from "@/lib/datetime";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { parseNumberInput } from "@/lib/numbers";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { MoneyInput } from "@/components/money-input";
import { ShortcutLink } from "@/components/shortcut-link";
import { ViewRaw } from "@/components/view-raw";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PaymentMethodMapping = { method: string; role_code: string; created_at: string };

type InvoiceRow = {
  id: string;
  invoice_no: string;
  supplier_ref?: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  goods_receipt_id?: string | null;
  goods_receipt_no?: string | null;
  is_on_hold?: boolean;
  hold_reason?: string | null;
  hold_details?: unknown;
  held_at?: string | null;
  released_at?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate: string | number;
  settlement_currency?: string | null;
  subtotal_usd?: string | number | null;
  subtotal_lbp?: string | number | null;
  discount_total_usd?: string | number | null;
  discount_total_lbp?: string | number | null;
  tax_code_id?: string | null;
  invoice_date: string;
  due_date: string;
  created_at: string;
};

type InvoiceLine = {
  id: string;
  goods_receipt_line_id?: string | null;
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  supplier_item_code?: string | null;
  supplier_item_name?: string | null;
  qty: string | number;
  uom?: string | null;
  qty_factor?: string | number | null;
  qty_entered?: string | number | null;
  unit_of_measure?: string | null;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
  batch_id: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  batch_status?: string | null;
};

type AttachmentRow = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256?: string | null;
  uploaded_at: string;
  uploaded_by_user_id?: string | null;
};

type AiRecRow = {
  id: string;
  agent_code: string;
  status: string;
  recommendation_json: any;
  recommendation_view?: RecommendationView;
  created_at: string;
};

type SupplierPayment = {
  id: string;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  tender_usd?: string | number | null;
  tender_lbp?: string | number | null;
  reference?: string | null;
  auth_code?: string | null;
  provider?: string | null;
  settlement_currency?: string | null;
  captured_at?: string | null;
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
  payments: SupplierPayment[];
  tax_lines: TaxLine[];
};

type PaymentDraft = { method: string; amount_usd: string; amount_lbp: string };

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

function hasTender(p: SupplierPayment) {
  return n((p as any).tender_usd) !== 0 || n((p as any).tender_lbp) !== 0;
}

function SupplierInvoiceShowInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [aiInsight, setAiInsight] = useState<AiRecRow | null>(null);

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);

  const openPostHotkeyRef = useRef<() => void>(() => {});

  const [postOpen, setPostOpen] = useState(false);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postPostingDate, setPostPostingDate] = useState(() => todayIso());
  const [postPayments, setPostPayments] = useState<PaymentDraft[]>([{ method: "bank", amount_usd: "0", amount_lbp: "0" }]);
  const [postPreview, setPostPreview] = useState<{ base_usd: number; base_lbp: number; tax_usd: number; tax_lbp: number; total_usd: number; total_lbp: number } | null>(
    null
  );

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState(() => todayIso());
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);
  const searchParams = useSearchParams();

  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelDraftReason, setCancelDraftReason] = useState("");
  const [cancelDrafting, setCancelDrafting] = useState(false);

  const [holdBusy, setHoldBusy] = useState(false);

  const methodChoices = useMemo(() => {
    const base = ["cash", "bank", "card", "transfer", "other"];
    const fromConfig = paymentMethods.map((m) => m.method);
    const merged = Array.from(new Set([...base, ...fromConfig])).filter(Boolean);
    merged.sort();
    return merged;
  }, [paymentMethods]);
  const invoiceLineColumns = useMemo((): Array<DataTableColumn<InvoiceLine>> => {
    return [
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (l) => `${l.item_sku || ""} ${l.item_name || ""}`,
        cell: (l) =>
          l.item_sku || l.item_name ? (
            <div>
              <div>
                <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item">
                  <span className="font-mono text-xs">{l.item_sku || "-"}</span> · {l.item_name || "-"}
                </ShortcutLink>
              </div>
              {l.supplier_item_code || l.supplier_item_name ? (
                <div className="mt-1 text-[10px] text-fg-subtle">
                  Supplier: <span className="font-mono">{l.supplier_item_code || "-"}</span>
                  {l.supplier_item_name ? <span> · {l.supplier_item_name}</span> : null}
                </div>
              ) : null}
            </div>
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
          <div className="text-right font-mono text-xs">
            <div className="text-foreground">
              {Number((l.qty_entered ?? l.qty) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}{" "}
              <span className="text-[10px] text-fg-subtle">{String(l.uom || l.unit_of_measure || "").trim().toUpperCase() || "-"}</span>
            </div>
            {Number(l.qty_factor || 1) !== 1 ? (
              <div className="mt-0.5 text-[10px] text-fg-subtle">
                base {Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "batch_no",
        header: "Batch",
        sortable: true,
        mono: true,
        accessor: (l) => l.batch_no || "",
        cell: (l) => (
          <span className="font-mono text-xs">
            {l.batch_no || "-"}
            {l.batch_status && l.batch_status !== "available" ? (
              <span className="ml-2 rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-[10px] text-fg-muted">
                {l.batch_status}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "expiry_date",
        header: "Expiry",
        sortable: true,
        mono: true,
        accessor: (l) => l.expiry_date || "",
        cell: (l) => <span className="font-mono text-xs">{fmtIso(l.expiry_date)}</span>,
      },
      {
        id: "line_total_usd",
        header: "Total USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (l) => Number(l.line_total_usd || 0),
        cell: (l) => <span className="font-mono text-xs">{fmtUsd(l.line_total_usd)}</span>,
      },
      {
        id: "line_total_lbp",
        header: "Total LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (l) => Number(l.line_total_lbp || 0),
        cell: (l) => <span className="font-mono text-xs">{fmtLbp(l.line_total_lbp)}</span>,
      },
    ];
  }, []);

  const taxBreakdown = useMemo(() => {
    const lines = detail?.tax_lines || [];
    const byId = new Map<
      string,
      { tax_code_id: string; base_usd: number; base_lbp: number; tax_usd: number; tax_lbp: number; count: number }
    >();
    for (const t of lines) {
      const id = String(t.tax_code_id || "");
      if (!id) continue;
      const row =
        byId.get(id) || { tax_code_id: id, base_usd: 0, base_lbp: 0, tax_usd: 0, tax_lbp: 0, count: 0 };
      row.base_usd += Number(t.base_usd || 0) || 0;
      row.base_lbp += Number(t.base_lbp || 0) || 0;
      row.tax_usd += Number(t.tax_usd || 0) || 0;
      row.tax_lbp += Number(t.tax_lbp || 0) || 0;
      row.count += 1;
      byId.set(id, row);
    }
    const out = Array.from(byId.values());
    out.sort((a, b) => a.tax_code_id.localeCompare(b.tax_code_id));
    return out;
  }, [detail?.tax_lines]);

  const taxBreakdownTotals = useMemo(() => {
    let base_usd = 0;
    let base_lbp = 0;
    let tax_usd = 0;
    let tax_lbp = 0;
    for (const r of taxBreakdown) {
      base_usd += Number(r.base_usd || 0) || 0;
      base_lbp += Number(r.base_lbp || 0) || 0;
      tax_usd += Number(r.tax_usd || 0) || 0;
      tax_lbp += Number(r.tax_lbp || 0) || 0;
    }
    return { base_usd, base_lbp, tax_usd, tax_lbp };
  }, [taxBreakdown]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [det, pm] = await Promise.all([
        apiGet<InvoiceDetail>(`/purchases/invoices/${id}`),
        apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods").catch(() => ({ methods: [] as PaymentMethodMapping[] })),
      ]);
      setDetail(det);
      setPaymentMethods(pm.methods || []);

      // AI insights are optional; don't block if ai:read is missing.
      try {
        const ai = await apiGet<{ recommendations: AiRecRow[] }>(
          "/ai/recommendations?status=pending&agent_code=AI_PURCHASE_INVOICE_INSIGHTS&limit=200"
        );
        const hit = (ai.recommendations || []).find((r) => {
          const viewEntity = String((r.recommendation_view as any)?.entity_id || "");
          const jsonEntity = String((r as any)?.recommendation_json?.invoice_id || "");
          return viewEntity === String(id) || jsonEntity === String(id);
        });
        setAiInsight(hit || null);
      } catch {
        setAiInsight(null);
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

      if (key === "p" && !e.shiftKey) {
        e.preventDefault();
        window.open(`/purchasing/supplier-invoices/${encodeURIComponent(detail.invoice.id)}/print`, "_blank", "noopener,noreferrer");
        return;
      }

      if (key === "p" && e.shiftKey) {
        e.preventDefault();
        window.open(
          `/purchasing/payments?supplier_invoice_id=${encodeURIComponent(detail.invoice.id)}&record=1`,
          "_blank",
          "noopener,noreferrer"
        );
        return;
      }

      if (key === "enter") {
        if (detail.invoice.status === "draft") {
          e.preventDefault();
          openPostHotkeyRef.current?.();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detail]);

  const postChecklist = useMemo(() => {
    const inv = detail?.invoice;
    const lines = detail?.lines || [];
    const rate = Number(inv?.exchange_rate || 0);
    const missingUom = lines.filter((l) => !String(l.uom || l.unit_of_measure || "").trim()).length;
    const zeroCost = lines.filter((l) => Number(l.unit_cost_usd || 0) === 0 && Number(l.unit_cost_lbp || 0) === 0).length;
    const blocking: string[] = [];
    const warnings: string[] = [];

    if (!lines.length) blocking.push("Add at least one item.");
    if (rate <= 0) blocking.push("Exchange rate is missing (USD→LL).");
    if (missingUom) blocking.push(`${missingUom} item(s) are missing UOM.`);

    if (zeroCost) warnings.push(`${zeroCost} item(s) have zero unit cost.`);
    if (!String(inv?.tax_code_id || "").trim()) warnings.push("Tax code is empty (ok if this supplier invoice has no tax).");

    return { blocking, warnings };
  }, [detail]);

  const activeTab = (() => {
    const t = String(searchParams.get("tab") || "overview").toLowerCase();
    if (t === "lines" || t === "items") return "items";
    if (t === "tax") return "tax";
    if (t === "ai") return "ai";
    return "overview";
  })();

  const aiInsightRows = useMemo(() => {
    const rec = (aiInsight as any)?.recommendation_json || {};
    const changes = Array.isArray(rec?.price_changes) ? rec.price_changes : Array.isArray(rec?.changes) ? rec.changes : [];
    return changes.slice(0, 10);
  }, [aiInsight]);

  // Canonicalize legacy tab names so the TabBar stays highlighted on old deep links.
  useEffect(() => {
    const t = String(searchParams.get("tab") || "overview").toLowerCase();
    if (t === "payments") router.replace("?tab=overview");
    if (t === "lines") router.replace("?tab=items");
  }, [router, searchParams]);

  const supplierInvoiceTabs = useMemo(
    () => [
      { label: "Overview", href: "?tab=overview", activeQuery: { key: "tab", value: "overview" } },
      { label: "Items", href: "?tab=items", activeQuery: { key: "tab", value: "items" } },
      { label: "Tax", href: "?tab=tax", activeQuery: { key: "tab", value: "tax" } },
      { label: "AI", href: "?tab=ai", activeQuery: { key: "tab", value: "ai" } }
    ],
    []
  );

  const supplierOverview = useMemo(() => {
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

  async function openPostDialog() {
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;
    if (detail.invoice.is_on_hold) {
      setStatus("Invoice is on hold. Unhold it before posting.");
      return;
    }
    if (!(detail.lines || []).length) {
      setStatus("Cannot post: add at least one item to this draft first.");
      return;
    }
    setPostPostingDate(todayIso());
    setPostPayments([{ method: "bank", amount_usd: "0", amount_lbp: "0" }]);
    setPostPreview(null);
    try {
      const prev = await apiGet<{
        base_usd: number;
        base_lbp: number;
        tax_usd: number;
        tax_lbp: number;
        total_usd: number;
        total_lbp: number;
      }>(`/purchases/invoices/${detail.invoice.id}/post-preview`);
      setPostPreview(prev);
    } catch {
      setPostPreview(null);
    }
    setPostOpen(true);
  }

  openPostHotkeyRef.current = () => void openPostDialog();

  async function postDraftInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;

    const paymentsOut: Array<{ method: string; amount_usd: number; amount_lbp: number }> = [];
    for (let i = 0; i < (postPayments || []).length; i++) {
      const p = postPayments[i];
      const usdRes = parseNumberInput(p.amount_usd);
      const lbpRes = parseNumberInput(p.amount_lbp);
      if (!usdRes.ok && usdRes.reason === "invalid") return setStatus(`Invalid USD amount on payment row ${i + 1}.`);
      if (!lbpRes.ok && lbpRes.reason === "invalid") return setStatus(`Invalid LL amount on payment row ${i + 1}.`);
      const usd = usdRes.ok ? usdRes.value : 0;
      const lbp = lbpRes.ok ? lbpRes.value : 0;
      if (usd !== 0 || lbp !== 0) paymentsOut.push({ method: p.method, amount_usd: usd, amount_lbp: lbp });
    }

    setPostSubmitting(true);
    setStatus("Posting invoice...");
    try {
      await apiPost(`/purchases/invoices/${detail.invoice.id}/post`, {
        posting_date: postPostingDate || undefined,
        payments: paymentsOut
      });
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

  async function unholdInvoice() {
    if (!detail) return;
    setHoldBusy(true);
    setStatus("Unholding...");
    try {
      const hd: any = detail.invoice.hold_details || {};
      const needsReason = String(detail.invoice.hold_reason || "").toLowerCase().includes("variance") || String(hd?.kind || "").includes("variance");
      const reason = needsReason ? (window.prompt("Why are you unholding this invoice? (optional but recommended)") || "").trim() : "";
      await apiPost(`/purchases/invoices/${detail.invoice.id}/unhold`, { reason: reason || undefined });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setHoldBusy(false);
    }
  }

  async function holdInvoice() {
    if (!detail) return;
    setHoldBusy(true);
    setStatus("Holding...");
    try {
      await apiPost(`/purchases/invoices/${detail.invoice.id}/hold`, { reason: "Manual hold" });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setHoldBusy(false);
    }
  }

  async function cancelPostedInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "posted") return;
    setCanceling(true);
    setStatus("Voiding invoice...");
    try {
      await apiPost(`/purchases/invoices/${detail.invoice.id}/cancel`, {
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
      await apiPost(`/purchases/invoices/${detail.invoice.id}/cancel-draft`, { reason: cancelDraftReason || undefined });
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
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/purchasing/supplier-invoices")}>
            Back to List
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
          <Button onClick={() => router.push("/purchasing/supplier-invoices/new")}>New Draft</Button>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      {detail ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Supplier Invoice</CardTitle>
                  <CardDescription>
                    <span className="font-mono text-xs">{detail.invoice.invoice_no || "(draft)"}</span> ·{" "}
                    <span className="text-xs">{detail.invoice.status}</span>
                    {detail.invoice.is_on_hold ? (
                      <>
                        {" "}
                        ·{" "}
                        <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                          HOLD{detail.invoice.hold_reason ? `: ${detail.invoice.hold_reason}` : ""}
                        </span>
                      </>
                    ) : null}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button asChild variant="outline">
                    <Link
                      href={`/purchasing/supplier-invoices/${encodeURIComponent(detail.invoice.id)}/print`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Print / PDF
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <a
                      href={`/exports/supplier-invoices/${encodeURIComponent(detail.invoice.id)}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download PDF
                    </a>
                  </Button>
                  {detail.invoice.status === "draft" ? (
                    <>
                      <Button asChild variant="outline">
                        <Link href={`/purchasing/supplier-invoices/${encodeURIComponent(detail.invoice.id)}/edit`}>Edit Draft</Link>
                      </Button>
                      {detail.invoice.is_on_hold ? (
                        <Button variant="outline" onClick={unholdInvoice} disabled={holdBusy}>
                          {holdBusy ? "..." : "Unhold"}
                        </Button>
                      ) : (
                        <Button variant="outline" onClick={holdInvoice} disabled={holdBusy}>
                          {holdBusy ? "..." : "Hold"}
                        </Button>
                      )}
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
                    entityType="supplier_invoice"
                    entityId={detail.invoice.id}
                    allowUploadAttachments={detail.invoice.status === "draft"}
                    className="ml-1"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <TabBar tabs={supplierInvoiceTabs} />

              {activeTab === "overview" ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                    <div className="ui-panel p-5 md:col-span-8">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-[220px]">
                          <p className="ui-panel-title">Supplier</p>
                          <p className="mt-1 text-lg font-semibold leading-tight text-foreground">
                            {detail.invoice.supplier_id ? (
                              <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(detail.invoice.supplier_id)}`} title="Open supplier">
                                {detail.invoice.supplier_name || detail.invoice.supplier_id}
                              </ShortcutLink>
                            ) : (
                              "-"
                            )}
                          </p>
                          <p className="mt-1 text-xs text-fg-muted">
                            Created{" "}
                            <span className="data-mono">
                              {formatDateLike(detail.invoice.created_at)}
                            </span>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <span className="ui-chip ui-chip-default">
                            <span className="text-fg-subtle">Exchange</span>
                            <span className="data-mono text-foreground">{supplierOverview?.rate || "-"}</span>
                          </span>
                          <span className="ui-chip ui-chip-default">
                            <span className="text-fg-subtle">Status</span>
                            <span className="data-mono text-foreground">{detail.invoice.status}</span>
                          </span>
                          {detail.invoice.is_on_hold ? (
                            <span className="ui-chip ui-chip-default">
                              <span className="text-fg-subtle">Hold</span>
                              <span className="data-mono text-foreground">{detail.invoice.hold_reason || "on hold"}</span>
                            </span>
                          ) : null}
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
                              <span className="ui-kv-label">Supplier Ref</span>
                              <span className="ui-kv-value">{(detail.invoice.supplier_ref as any) || "-"}</span>
                            </div>
                            <div className="ui-kv">
                              <span className="ui-kv-label">Goods Receipt</span>
                              <span className="ui-kv-value">
                                {detail.invoice.goods_receipt_id ? (
                                  <ShortcutLink
                                    href={`/purchasing/goods-receipts/${encodeURIComponent(detail.invoice.goods_receipt_id)}`}
                                    title="Open goods receipt"
                                    className="data-mono"
                                  >
                                    {detail.invoice.goods_receipt_no || detail.invoice.goods_receipt_id.slice(0, 8)}
                                  </ShortcutLink>
                                ) : (
                                  detail.invoice.goods_receipt_no || "-"
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="ui-panel p-5 md:col-span-4">
                      <p className="ui-panel-title">Totals</p>
                      <div className="mt-3">
                        <div className="text-xs text-fg-muted">Total</div>
                        <div className={`data-mono mt-1 text-3xl font-semibold leading-none ${supplierOverview?.primaryTone || "ui-tone-usd"}`}>
                          {supplierOverview ? supplierOverview.primaryFmt(supplierOverview.primaryTotal) : fmtUsd(0)}
                        </div>
                        <div className="data-mono mt-1 text-sm text-fg-muted">
                          {supplierOverview ? supplierOverview.secondaryFmt(supplierOverview.secondaryTotal) : fmtLbp(0)}
                        </div>
                      </div>
                      <div className="mt-4 space-y-2">
                        <div className="ui-kv ui-kv-strong">
                          <span className="ui-kv-label">Balance</span>
                          <span className="ui-kv-value">
                            {supplierOverview ? supplierOverview.primaryFmt(supplierOverview.primaryBal) : fmtUsd(0)}
                          </span>
                        </div>
                        <div className="ui-kv ui-kv-sub">
                          <span className="ui-kv-label">Balance (other)</span>
                          <span className="ui-kv-value">
                            {supplierOverview ? supplierOverview.secondaryFmt(supplierOverview.secondaryBal) : fmtLbp(0)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="ui-panel p-5 md:col-span-12">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="ui-panel-title">Payments</p>
                          <p className="mt-1 text-xs text-fg-subtle">Payments belong to Overview for quick review.</p>
                        </div>
                        {detail.invoice.status === "posted" ? (
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/purchasing/payments?supplier_invoice_id=${encodeURIComponent(detail.invoice.id)}&record=1`}>Record Payment</Link>
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" disabled>
                            Record Payment
                          </Button>
                        )}
                      </div>

                      <div className="mt-3 space-y-1 text-xs text-fg-muted">
                        {detail.payments.map((p) => (
                          <div key={p.id} className="flex items-center justify-between gap-2">
                            <span className="data-mono">
                              {p.method}
                              {p.reference ? <span className="text-fg-subtle"> · {p.reference}</span> : null}
                            </span>
                            <span className="data-mono">{fmtUsdLbp(p.amount_usd, p.amount_lbp)}</span>
                          </div>
                        ))}
                        {detail.payments.length === 0 ? <p className="text-fg-subtle">No payments.</p> : null}
                      </div>
                    </div>
                  </div>

                  {detail.invoice.is_on_hold ? (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Hold Details</CardTitle>
                        <CardDescription>Posting and paying are blocked until you unhold.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="text-xs text-fg-muted">
                          Reason: <span className="font-mono">{detail.invoice.hold_reason || "-"}</span>
                        </div>
                        {(() => {
                          const hd: any = detail.invoice.hold_details || {};
                          const flags: any[] = Array.isArray(hd?.flags) ? hd.flags : [];
                          if (!flags.length) {
                            return (
                              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3 text-xs text-fg-muted">
                                No structured hold details available.
                              </div>
                            );
                          }
                          return (
                            <DataTable<any>
                              tableId="purchasing.supplier_invoice.hold_flags"
                              rows={flags.slice(0, 20)}
                              columns={[
                                {
                                  id: "kind",
                                  header: "Kind",
                                  sortable: true,
                                  mono: true,
                                  accessor: (f) => String(f?.kind || "unknown"),
                                  cell: (f) => <span className="text-xs font-mono text-fg-muted">{String(f?.kind || "unknown")}</span>,
                                },
                                {
                                  id: "details",
                                  header: "Details",
                                  accessor: (f) => JSON.stringify(f || {}),
                                  cell: (f) => {
                                    const kind = String(f?.kind || "unknown");
                                    if (kind === "unit_cost_variance") {
                                      return (
                                        <div className="text-xs">
                                          <div className="font-medium text-foreground">
                                            {f.item_id ? (
                                              <ShortcutLink href={`/catalog/items/${encodeURIComponent(String(f.item_id))}`} title="Open item">
                                                <span className="font-mono">{f.item_sku || String(f.item_id).slice(0, 8)}</span>
                                                {f.item_name ? <span> · {f.item_name}</span> : null}
                                              </ShortcutLink>
                                            ) : "-"}
                                          </div>
                                          <div className="mt-1 text-[11px] text-fg-muted">
                                            Expected: <span className="font-mono">{String(f.expected_unit_cost_usd || "0")}</span> USD{" · "}
                                            Actual: <span className="font-mono">{String(f.actual_unit_cost_usd || "0")}</span> USD
                                          </div>
                                        </div>
                                      );
                                    }
                                    if (kind === "qty_exceeds_received") {
                                      return (
                                        <div className="text-xs">
                                          <div className="text-foreground">Invoiced qty exceeds received qty.</div>
                                        <div className="mt-1 text-[11px] text-fg-muted font-mono">
                                            receipt line {String(f.goods_receipt_line_id || "").slice(0, 8)} · received {String(f.received_qty || "0")} · prev{" "}
                                            {String(f.previously_invoiced_qty || "0")} · this {String(f.this_invoice_qty || "0")}
                                        </div>
                                      </div>
                                    );
                                    }
                                    if (kind === "tax_variance") {
                                      return (
                                        <div className="text-xs">
                                          <div className="text-foreground">Invoice tax does not match item-level expected tax.</div>
                                          <div className="mt-1 text-[11px] text-fg-muted font-mono">
                                            invoice_tax {String(f.invoice_tax_lbp || "0")} · expected {String(f.expected_tax_lbp || "0")} · diff{" "}
                                            {String(f.diff_lbp || "0")} · items {String(f.mismatch_count || 0)}
                                          </div>
                                        </div>
                                      );
                                    }
                                    return <ViewRaw value={f} label="Raw hold details" />;
                                  },
                                },
                                {
                                  id: "variance",
                                  header: "Variance",
                                  align: "right",
                                  mono: true,
                                  accessor: (f) => Number(f?.pct_variance_usd || f?.diff_pct_of_base || 0),
                                  cell: (f) => (
                                    <span className="text-xs font-mono text-fg-muted">
                                      {f?.pct_variance_usd
                                        ? `${(Number(f.pct_variance_usd) * 100).toFixed(1)}%`
                                        : f?.diff_pct_of_base
                                          ? `${(Number(f.diff_pct_of_base) * 100).toFixed(2)}%`
                                          : f?.total_after
                                            ? `+${String(f.total_after)}`
                                            : "-"}
                                    </span>
                                  ),
                                },
                              ]}
                              getRowId={(_, idx) => String(idx)}
                              enableGlobalFilter={false}
                              emptyText="No hold flags."
                            />
                          );
                        })()}
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              ) : null}

	              {activeTab === "ai" ? (
	                <Card>
	                  <CardHeader>
	                    <CardTitle className="text-base">AI: Price Impact</CardTitle>
	                    <CardDescription>{aiInsight ? recommendationView(aiInsight).summary : "Signals detected from this invoice (review recommended)."}</CardDescription>
	                  </CardHeader>
	                  <CardContent className="space-y-2">
	                    {aiInsight ? (
	                      <>
	                        <div className="rounded-md border border-border-subtle bg-bg-elevated/40 p-2 text-xs text-fg-muted">
	                          {recommendationView(aiInsight).nextStep}
	                        </div>
	                        <DataTable<any>
	                          tableId="purchasing.supplier_invoice.ai_price_impact"
	                          rows={aiInsightRows}
	                          columns={[
                            {
                              id: "item",
                              header: "Item",
                              accessor: (c) => `${c.item_id || ""} ${c.supplier_item_name || ""}`,
                              cell: (c) => (
                                <div className="text-xs">
                                  {c.item_id ? (
                                    <ShortcutLink
                                      href={`/catalog/items/${encodeURIComponent(String(c.item_id))}`}
                                      title="Open item"
                                      className="font-mono text-[10px] text-fg-subtle"
                                    >
                                      {String(c.item_id)}
                                    </ShortcutLink>
                                  ) : (
                                    <div className="font-mono text-[10px] text-fg-subtle">-</div>
                                  )}
                                  <div className="text-xs text-foreground">
                                    {c.supplier_item_code ? <span className="font-mono">{c.supplier_item_code}</span> : null}
                                    {c.supplier_item_name ? <span>{c.supplier_item_code ? " · " : ""}{c.supplier_item_name}</span> : null}
                                  </div>
                                </div>
                              ),
                            },
                            { id: "prev", header: "Prev", sortable: true, align: "right", mono: true, accessor: (c) => c.prev_unit_cost_usd || c.prev_unit_cost_lbp || 0, cell: (c) => <span className="font-mono text-xs text-fg-muted">{c.prev_unit_cost_usd || c.prev_unit_cost_lbp || "-"}</span> },
                            { id: "new", header: "New", sortable: true, align: "right", mono: true, accessor: (c) => c.new_unit_cost_usd || c.new_unit_cost_lbp || 0, cell: (c) => <span className="font-mono text-xs text-fg-muted">{c.new_unit_cost_usd || c.new_unit_cost_lbp || "-"}</span> },
                            { id: "pct", header: "% +", sortable: true, align: "right", mono: true, accessor: (c) => Number(c.pct_increase || 0), cell: (c) => <span className="font-mono text-xs text-fg-muted">{typeof c.pct_increase === "number" ? `${(c.pct_increase * 100).toFixed(1)}%` : "-"}</span> },
                            { id: "sell", header: "Sell USD", sortable: true, align: "right", mono: true, accessor: (c) => c.sell_price_usd || 0, cell: (c) => <span className="font-mono text-xs text-fg-muted">{c.sell_price_usd || "-"}</span> },
                            { id: "margin", header: "Margin", align: "right", mono: true, accessor: (c) => `${c.margin_before || ""}${c.margin_after || ""}`, cell: (c) => <span className="font-mono text-xs text-fg-muted">{typeof c.margin_before === "number" && typeof c.margin_after === "number" ? `${(c.margin_before * 100).toFixed(1)}% → ${(c.margin_after * 100).toFixed(1)}%` : "-"}</span> },
                          ]}
	                          getRowId={(c, idx) => String(c.item_id || idx)}
	                          emptyText="No AI price-change rows."
	                          enableGlobalFilter={false}
	                        />
                        <div className="flex justify-end">
                          <Button asChild variant="outline" size="sm">
                            <a href="/automation/ai-hub">Open AI Hub</a>
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-fg-subtle">No AI insight available.</p>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              {activeTab === "items" ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Items</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable<InvoiceLine>
                      tableId="purchasing.supplier_invoice.lines"
                      rows={detail.lines}
                      columns={invoiceLineColumns}
                      getRowId={(l) => l.id}
                      emptyText="No items."
                      enableGlobalFilter={false}
                      initialSort={{ columnId: "item", dir: "asc" }}
                    />
                  </CardContent>
                </Card>
              ) : null}

              {activeTab === "tax" ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Tax Lines</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-xs text-fg-muted">
                      {taxBreakdown.map((r) => (
                        <div key={r.tax_code_id} className="rounded-md border border-border-subtle bg-bg-elevated/40 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="data-mono">{r.tax_code_id}</span>
                            <span className="data-mono text-foreground">
                              {fmtUsdLbp(r.tax_usd, r.tax_lbp)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-fg-muted">
                            <span className="text-fg-subtle">Base</span>
                            <span className="data-mono">
                              {fmtUsdLbp(r.base_usd, r.base_lbp)}
                            </span>
                          </div>
                        </div>
                      ))}
                      {taxBreakdown.length ? (
                        <div className="mt-2 rounded-md border border-border-subtle bg-bg-sunken/25 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">Total</span>
                            <span className="data-mono text-foreground">
                              {fmtUsdLbp(taxBreakdownTotals.tax_usd, taxBreakdownTotals.tax_lbp)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-fg-muted">
                            <span className="text-fg-subtle">Taxable base</span>
                            <span className="data-mono">
                              {fmtUsdLbp(taxBreakdownTotals.base_usd, taxBreakdownTotals.base_lbp)}
                            </span>
                          </div>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[11px] font-medium text-fg-subtle">Raw tax lines</summary>
                            <div className="mt-2 space-y-1">
                              {(detail.tax_lines || []).map((t) => (
                                <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-elevated/30 p-2">
                                  <span className="data-mono">
                                    {t.tax_code_id}
                                    {t.tax_date ? <span className="text-fg-subtle"> · {String(t.tax_date).slice(0, 10)}</span> : null}
                                  </span>
                                  <span className="data-mono">
                                    {fmtUsdLbp(t.tax_usd, t.tax_lbp)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      ) : null}
                      {detail.tax_lines.length === 0 ? <p className="text-fg-subtle">No tax lines.</p> : null}
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
                <DialogDescription>Posting writes stock moves + GL. You can optionally record payments now.</DialogDescription>
              </DialogHeader>
              <form onSubmit={postDraftInvoice} className="space-y-4">
                <div className="rounded-md border border-border-subtle bg-bg-sunken/25 p-3 text-xs text-fg-muted">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-foreground">Posting checklist</div>
                    <div className="text-[10px] text-fg-subtle">
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
                      <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-2 text-fg-muted">Ready to post.</div>
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-fg-muted">Posting Date</label>
                    <Input type="date" value={postPostingDate} onChange={(e) => setPostPostingDate(e.target.value)} />
                  </div>
                </div>

                {postPreview ? (
                  <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3 text-xs text-fg-muted">
                    <div className="flex items-center justify-between gap-2">
                      <span>Base</span>
                      <span className="data-mono">
                        {fmtUsdLbp(postPreview.base_usd, postPreview.base_lbp)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span>Tax</span>
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
                ) : null}

                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">Payments (optional)</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPostPayments((prev) => [...prev, { method: "bank", amount_usd: "0", amount_lbp: "0" }])}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {postPayments.map((p, idx) => (
                      <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                        <div className="md:col-span-4">
                          <select
                            className="ui-select"
                            value={p.method}
                            onChange={(e) =>
                              setPostPayments((prev) => prev.map((x, i) => (i === idx ? { ...x, method: e.target.value } : x)))
                            }
                          >
                            {methodChoices.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>
                        <MoneyInput
                          label="Amount"
                          currency="USD"
                          value={p.amount_usd}
                          onChange={(next) => setPostPayments((prev) => prev.map((x, i) => (i === idx ? { ...x, amount_usd: next } : x)))}
                          quick={[0]}
                          className="md:col-span-3"
                        />
                        <MoneyInput
                          label="Amount"
                          currency="LBP"
                          value={p.amount_lbp}
                          onChange={(next) => setPostPayments((prev) => prev.map((x, i) => (i === idx ? { ...x, amount_lbp: next } : x)))}
                          quick={[0]}
                          className="md:col-span-3"
                        />
                        <div className="md:col-span-2 flex justify-end">
                          <Button type="button" variant="outline" size="sm" onClick={() => setPostPayments((prev) => prev.filter((_, i) => i !== idx))}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
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
                <DialogTitle>Void Supplier Invoice</DialogTitle>
                <DialogDescription>This will reverse VAT tax lines and GL entries. It is blocked if payments exist.</DialogDescription>
              </DialogHeader>
              <form onSubmit={cancelPostedInvoice} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Void Date</label>
                  <Input type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-6">
                  <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
                  <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="duplicate / correction / vendor dispute" />
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
                <DialogDescription>This will mark the draft as canceled. No tax or GL will be posted.</DialogDescription>
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

export default function SupplierInvoiceShowPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <SupplierInvoiceShowInner />
    </Suspense>
  );
}
