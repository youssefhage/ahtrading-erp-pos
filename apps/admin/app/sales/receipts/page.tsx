"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  receipt_no?: string | null;
  receipt_seq?: number | null;
  receipt_printer?: string | null;
  receipt_printed_at?: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
};

function SalesReceiptsInner() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<InvoiceRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices?status=posted");
      const receipts = (res.invoices || []).filter((r) => {
        const receiptNo = String(r.receipt_no || "").trim();
        const printedAt = String(r.receipt_printed_at || "").trim();
        return Boolean(receiptNo) || Boolean(printedAt) || r.receipt_seq != null;
      });
      setRows(receipts);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    let usd = 0;
    let lbp = 0;
    for (const r of rows) {
      usd += Number(r.total_usd || 0) || 0;
      lbp += Number(r.total_lbp || 0) || 0;
    }
    return { usd, lbp };
  }, [rows]);

  const columns = useMemo((): Array<DataTableColumn<InvoiceRow>> => {
    return [
      {
        id: "receipt",
        header: "Receipt",
        sortable: true,
        mono: true,
        accessor: (r) => r.receipt_no || String(r.receipt_seq || "") || r.id,
        cell: (r) => (
          <div>
            <div className="font-mono text-xs text-foreground">{r.receipt_no || (r.receipt_seq != null ? `#${r.receipt_seq}` : "-")}</div>
            <div className="font-mono text-[11px] text-fg-subtle">{formatDateLike(r.receipt_printed_at || r.created_at)}</div>
          </div>
        ),
      },
      {
        id: "invoice",
        header: "Invoice",
        sortable: true,
        accessor: (r) => r.invoice_no || r.id,
        cell: (r) => (
          <ShortcutLink href={`/sales/invoices/${encodeURIComponent(r.id)}`} title="Open invoice" className="font-mono text-xs">
            {r.invoice_no || r.id.slice(0, 8)}
          </ShortcutLink>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        sortable: true,
        accessor: (r) => r.customer_name || r.customer_id || "",
        cell: (r) => (r.customer_id ? (
          <ShortcutLink href={`/partners/customers/${encodeURIComponent(r.customer_id)}`} title="Open customer" className="text-sm">
            {r.customer_name || r.customer_id}
          </ShortcutLink>
        ) : "Walk-in"),
      },
      {
        id: "printer",
        header: "Printer",
        sortable: true,
        accessor: (r) => r.receipt_printer || "",
        cell: (r) => <span className="font-mono text-xs text-fg-muted">{r.receipt_printer || "-"}</span>,
      },
      {
        id: "total_usd",
        header: "Total USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_usd || 0),
        cell: (r) => <span className="ui-tone-usd">{fmtUsd(r.total_usd)}</span>,
      },
      {
        id: "total_lbp",
        header: "Total LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_lbp || 0),
        cell: (r) => <span className="ui-tone-lbp">{fmtLbp(r.total_lbp)}</span>,
      },
      {
        id: "actions",
        header: "Actions",
        accessor: () => "",
        cell: (r) => (
          <div className="flex items-center justify-end gap-1">
            <Button asChild size="sm" variant="outline">
              <a href={`/sales/invoices/${encodeURIComponent(r.id)}/print?paper=receipt&doc=receipt`} target="_blank" rel="noopener noreferrer">
                Print
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`/exports/sales-receipts/${encodeURIComponent(r.id)}/pdf`} target="_blank" rel="noopener noreferrer">
                PDF
              </a>
            </Button>
          </div>
        ),
      },
    ];
  }, []);

  return (
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Sales</p>
            <h1 className="ui-module-title">Receipts</h1>
            <p className="ui-module-subtitle">Receipt prints captured from posted sales invoices.</p>
          </div>
          <div className="ui-module-actions">
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </Button>
          </div>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Receipt Totals</CardTitle>
          <CardDescription>{rows.length} receipt(s)</CardDescription>
        </CardHeader>
        <CardContent className="ui-metric-grid">
          <div className="ui-metric">
            <div className="ui-metric-label">USD</div>
            <div className="ui-metric-value">{fmtUsd(totals.usd)}</div>
          </div>
          <div className="ui-metric">
            <div className="ui-metric-label">LL</div>
            <div className="ui-metric-value">{fmtLbp(totals.lbp)}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Receipts</CardTitle>
          <CardDescription>Use Print/PDF to issue receipt copies.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<InvoiceRow>
            tableId="sales.receipts.list"
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "receipt", dir: "desc" }}
            globalFilterPlaceholder="Search receipt / invoice / customer / printer"
            emptyText="No receipts."
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function SalesReceiptsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <SalesReceiptsInner />
    </Suspense>
  );
}
