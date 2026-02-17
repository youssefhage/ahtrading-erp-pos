"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { recommendationKind, recommendationView, type RecommendationView } from "@/lib/ai-recommendations";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DataTableTabs } from "@/components/data-table-tabs";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";

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
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  tax_code_id?: string | null;
  invoice_date: string;
  due_date: string;
  created_at: string;
  attachment_count?: number;
};

type AiRecRow = {
  id: string;
  agent_code: string;
  status: string;
  recommendation_json: any;
  recommendation_view?: RecommendationView;
  created_at: string;
};

function fmtIso(iso?: string | null) {
  return formatDateLike(iso);
}

function SupplierInvoicesListInner() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiApGuard, setAiApGuard] = useState<AiRecRow[]>([]);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  const offset = page * pageSize;

  const query = useMemo(() => ({ q: q.trim(), status: statusFilter, limit: pageSize, offset }), [q, statusFilter, pageSize, offset]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(query.limit));
      params.set("offset", String(query.offset));
      if (query.q) params.set("q", query.q);
      if (query.status) params.set("status", query.status);

      const res = await apiGet<{ invoices: InvoiceRow[]; total?: number }>(`/purchases/invoices?${params.toString()}`);
      setInvoices(res.invoices || []);
      setTotal(typeof res.total === "number" ? res.total : null);

      // AI is optional: don't block the list if the user lacks ai:read.
      try {
        const ai = await apiGet<{ recommendations: AiRecRow[] }>("/ai/recommendations?status=pending&agent_code=AI_AP_GUARD&limit=12");
        setAiApGuard(ai.recommendations || []);
      } catch {
        setAiApGuard([]);
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [query.limit, query.offset, query.q, query.status]);

  useEffect(() => {
    setPage(0);
  }, [q, statusFilter, pageSize]);

  useEffect(() => {
    const t = window.setTimeout(() => load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const canPrev = page > 0;
  const canNext = total == null ? invoices.length === pageSize : offset + invoices.length < total;

  const aiHold = aiApGuard.filter((r) => recommendationKind(r) === "supplier_invoice_hold");
  const aiDue = aiApGuard.filter((r) => recommendationKind(r) === "supplier_invoice_due_soon");

  const aiRows = useMemo(() => aiApGuard.slice(0, 8), [aiApGuard]);

  const aiCols = useMemo((): Array<DataTableColumn<AiRecRow>> => {
    return [
      {
        id: "type",
        header: "Type",
        accessor: (r) => recommendationView(r).kindLabel,
        cell: (r) => <span className="font-mono text-xs text-fg-muted">{recommendationView(r).kindLabel}</span>,
        mono: true,
      },
      {
        id: "recommendation",
        header: "Recommendation",
        accessor: (r) => recommendationView(r).summary,
        cell: (r) => {
          const view = recommendationView(r);
          return (
            <div className="space-y-1">
              <div className="text-xs font-medium text-foreground">{view.title}</div>
              <div className="text-xs text-fg-muted">{view.summary}</div>
              {view.linkHref ? (
                <a className="ui-link text-xs" href={view.linkHref}>
                  {view.linkLabel || "Open related document"}
                </a>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "next_step",
        header: "Next Step",
        accessor: (r) => recommendationView(r).nextStep,
        cell: (r) => <span className="text-xs text-fg-muted">{recommendationView(r).nextStep}</span>,
      },
      {
        id: "created",
        header: "Created",
        accessor: (r) => r.created_at,
        cell: (r) => <span className="font-mono text-xs text-fg-muted">{formatDateLike(r.created_at)}</span>,
        mono: true,
      },
    ];
  }, []);

  const cols = useMemo((): Array<DataTableColumn<InvoiceRow>> => {
    return [
      {
        id: "invoice",
        header: "Invoice",
        accessor: (inv) => inv.invoice_no || "",
        cell: (inv) => (
          <div>
            <div className="flex items-center gap-2">
              <div className="data-mono text-sm text-foreground">
                <ShortcutLink href={`/purchasing/supplier-invoices/${encodeURIComponent(inv.id)}`} title="Open supplier invoice">
                  {inv.invoice_no || "(draft)"}
                </ShortcutLink>
              </div>
              {Number(inv.attachment_count || 0) > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-muted px-2 py-0.5 text-xs text-fg-muted">
                  <Paperclip className="h-3 w-3" />
                  {Number(inv.attachment_count || 0)}
                </span>
              ) : null}
            </div>
            {inv.supplier_ref ? <div className="data-mono text-xs text-fg-subtle">Ref: {inv.supplier_ref}</div> : null}
          </div>
        ),
      },
      {
        id: "supplier",
        header: "Supplier",
        accessor: (inv) => inv.supplier_name || inv.supplier_id || "",
        cell: (inv) =>
          inv.supplier_id ? (
            <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(inv.supplier_id)}`} title="Open supplier">
              {inv.supplier_name || inv.supplier_id}
            </ShortcutLink>
          ) : (
            "-"
          ),
      },
      {
        id: "gr",
        header: "GR",
        accessor: (inv) => inv.goods_receipt_no || inv.goods_receipt_id || "",
        cell: (inv) =>
          inv.goods_receipt_id ? (
            <ShortcutLink href={`/purchasing/goods-receipts/${encodeURIComponent(inv.goods_receipt_id)}`} title="Open goods receipt" className="font-mono text-xs">
              {inv.goods_receipt_no || inv.goods_receipt_id.slice(0, 8)}
            </ShortcutLink>
          ) : (
            <span className="text-xs text-fg-muted">{inv.goods_receipt_no || "-"}</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        accessor: (inv) => inv.status,
        cell: (inv) => (
          <div>
            <StatusChip value={inv.status} />
            {inv.is_on_hold ? (
              <div className="mt-1">
                <span className="ui-chip ui-chip-warning">
                  HOLD{inv.hold_reason ? `: ${inv.hold_reason}` : ""}
                </span>
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "dates",
        header: "Dates",
        accessor: (inv) => `${inv.invoice_date || ""} ${inv.due_date || ""}`,
        cell: (inv) => (
          <div className="text-sm text-fg-muted">
            <div>
              Inv: <span className="data-mono">{fmtIso(inv.invoice_date)}</span>
            </div>
            <div className="text-fg-subtle">
              Due: <span className="data-mono">{fmtIso(inv.due_date)}</span>
            </div>
          </div>
        ),
      },
      {
        id: "total_usd",
        header: "Total USD",
        accessor: (inv) => inv.total_usd,
        sortable: true,
        align: "right",
        mono: true,
        cellClassName: "ui-tone-usd",
        cell: (inv) => fmtUsd(inv.total_usd),
      },
      {
        id: "total_lbp",
        header: "Total LL",
        accessor: (inv) => inv.total_lbp,
        sortable: true,
        align: "right",
        mono: true,
        cellClassName: "ui-tone-lbp",
        cell: (inv) => fmtLbp(inv.total_lbp),
      },
    ];
  }, []);

  return (
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Purchasing</p>
            <h1 className="ui-module-title">Supplier Invoices</h1>
            <p className="ui-module-subtitle">
              {total != null ? `${total.toLocaleString("en-US")} total invoices` : `${invoices.length} invoices shown`}
              {loading ? " · refreshing..." : ""}
            </p>
          </div>
          <div className="ui-module-actions">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </Button>
            <Button size="sm" onClick={() => router.push("/purchasing/supplier-invoices/new")}>
              New Draft
            </Button>
          </div>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      {aiApGuard.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI: AP Guard</CardTitle>
            <CardDescription>
              {aiHold.length ? `${aiHold.length} on hold` : "0 on hold"} · {aiDue.length ? `${aiDue.length} due soon` : "0 due soon"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <DataTable
              tableId="purchasing.supplierInvoices.aiApGuard"
              rows={aiRows}
              columns={aiCols}
              enableGlobalFilter={false}
              enablePagination={false}
              emptyText="No AI recommendations."
            />
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <a href="/automation/ai-hub">Open AI Hub</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>
            {total != null ? `${total.toLocaleString("en-US")} total` : `${invoices.length} shown`}
            {loading ? " · refreshing..." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable
            tableId="purchasing.supplierInvoices"
            rows={invoices}
            columns={cols}
            onRowClick={(inv) => router.push(`/purchasing/supplier-invoices/${inv.id}`)}
            emptyText="No invoices."
            isLoading={loading}
            headerSlot={
              <DataTableTabs
                value={statusFilter || "all"}
                onChange={(v) => setStatusFilter(v === "all" ? "" : v)}
                tabs={[
                  { value: "all", label: "All" },
                  { value: "draft", label: "Draft" },
                  { value: "posted", label: "Posted" },
                  { value: "canceled", label: "Canceled" },
                ]}
              />
            }
            globalFilterPlaceholder="Search doc no / supplier ref / supplier / GR..."
            globalFilterValue={q}
            onGlobalFilterValueChange={setQ}
            serverPagination={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: setPageSize,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function SupplierInvoicesListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <SupplierInvoicesListInner />
    </Suspense>
  );
}
