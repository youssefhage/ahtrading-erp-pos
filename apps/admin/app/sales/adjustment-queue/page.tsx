"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  invoice_date?: string;
  due_date?: string | null;
  created_at: string;
};

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

function AdjustmentQueueInner() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  const offset = page * pageSize;

  const query = useMemo(
    () => ({ q: q.trim(), limit: pageSize, offset }),
    [q, pageSize, offset]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(query.limit));
      params.set("offset", String(query.offset));
      params.set("flagged_for_adjustment", "true");
      if (query.q) params.set("q", query.q);

      const res = await apiGet<{ invoices: InvoiceRow[]; total?: number }>(
        `/sales/invoices?${params.toString()}`
      );
      setInvoices(res.invoices || []);
      setTotal(typeof res.total === "number" ? res.total : null);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [query.limit, query.offset, query.q]);

  useEffect(() => {
    setPage(0);
  }, [q, pageSize]);

  useEffect(() => {
    const t = window.setTimeout(() => load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const canPrev = page > 0;
  const canNext =
    total == null ? invoices.length === pageSize : offset + invoices.length < total;

  const columns = useMemo((): Array<DataTableColumn<InvoiceRow>> => {
    return [
      {
        id: "invoice",
        header: "Invoice",
        globalSearch: true,
        cell: (inv) => (
          <div>
            <div className="data-mono text-xs text-foreground">
              <ShortcutLink href={`/sales/invoices/${encodeURIComponent(inv.id)}`} title="Open invoice">
                {inv.invoice_no || "(draft)"}
              </ShortcutLink>
            </div>
            <div className="data-mono text-[10px] text-fg-subtle">{inv.id}</div>
          </div>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        accessor: (inv) => inv.customer_name || inv.customer_id || "",
        cell: (inv) =>
          inv.customer_id ? (
            <ShortcutLink href={`/partners/customers/${encodeURIComponent(inv.customer_id)}`} title="Open customer">
              {inv.customer_name || inv.customer_id}
            </ShortcutLink>
          ) : (
            "Walk-in"
          ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        accessor: (inv) => inv.warehouse_name || inv.warehouse_id || "",
        cell: (inv) => inv.warehouse_name || inv.warehouse_id || "-",
      },
      {
        id: "status",
        header: "Status",
        accessor: (inv) => inv.status,
        cell: (inv) => <StatusChip value={inv.status} />,
      },
      {
        id: "dates",
        header: "Dates",
        accessor: (inv) => `${inv.invoice_date || ""} ${inv.due_date || ""}`,
        cell: (inv) => (
          <div className="text-xs text-fg-muted">
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
        cellClassName: "ui-tone-usd text-xs",
        cell: (inv) => fmtUsd(inv.total_usd),
      },
      {
        id: "total_lbp",
        header: "Total LL",
        accessor: (inv) => inv.total_lbp,
        sortable: true,
        align: "right",
        mono: true,
        cellClassName: "ui-tone-lbp text-xs",
        cell: (inv) => fmtLbp(inv.total_lbp),
      },
    ];
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Adjustment Queue</CardTitle>
          <CardDescription>
            Sales invoices flagged for later adjustment (pilot multi-company / cross-company).
            {total != null ? ` · ${total.toLocaleString("en-US")} total` : ` · ${invoices.length} shown`}
            {loading ? " · refreshing..." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable
            tableId="sales.adjustmentQueue"
            rows={invoices}
            columns={columns}
            onRowClick={(inv) => router.push(`/sales/invoices/${inv.id}`)}
            emptyText="No flagged invoices."
            isLoading={loading}
            globalFilterPlaceholder="Search invoice / customer / warehouse..."
            globalFilterValue={q}
            onGlobalFilterValueChange={setQ}
            serverPagination={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: setPageSize,
            }}
            actions={
              <>
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                  {loading ? "..." : "Refresh"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => router.push("/sales/invoices")}>
                  All Invoices
                </Button>
              </>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdjustmentQueuePage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <AdjustmentQueueInner />
    </Suspense>
  );
}
