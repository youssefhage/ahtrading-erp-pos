"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Printer, FileText, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { EmptyState } from "@/components/business/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function SalesReceiptsInner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
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
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    let usd = 0, lbp = 0;
    for (const r of rows) { usd += toNum(r.total_usd); lbp += toNum(r.total_lbp); }
    return { usd, lbp };
  }, [rows]);

  const columns = useMemo<ColumnDef<InvoiceRow>[]>(() => [
    {
      id: "receipt",
      accessorFn: (r) => r.receipt_no || String(r.receipt_seq || "") || r.id,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Receipt" />,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div>
            <div className="font-mono text-sm">{r.receipt_no || (r.receipt_seq != null ? `#${r.receipt_seq}` : "-")}</div>
            <div className="font-mono text-xs text-muted-foreground">{formatDateLike(r.receipt_printed_at || r.created_at)}</div>
          </div>
        );
      },
    },
    {
      id: "invoice",
      accessorFn: (r) => r.invoice_no || r.id,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.invoice_no || row.original.id.slice(0, 8)}</span>
      ),
    },
    {
      id: "customer",
      accessorFn: (r) => r.customer_name || r.customer_id || "Walk-in",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
      cell: ({ row }) => row.original.customer_name || "Walk-in",
    },
    {
      id: "printer",
      accessorFn: (r) => r.receipt_printer || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Printer" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.receipt_printer || "-"}</span>
      ),
    },
    {
      id: "total_usd",
      accessorFn: (r) => toNum(r.total_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total USD" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.total_usd)} currency="USD" />,
    },
    {
      id: "total_lbp",
      accessorFn: (r) => toNum(r.total_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total LBP" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.total_lbp)} currency="LBP" />,
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button asChild size="sm" variant="outline">
            <a href={`/sales/invoices/${encodeURIComponent(row.original.id)}/print?paper=receipt&doc=receipt`} target="_blank" rel="noopener noreferrer">
              <Printer className="mr-1 h-3 w-3" /> Print
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/exports/sales-receipts/${encodeURIComponent(row.original.id)}/pdf`} target="_blank" rel="noopener noreferrer">
              <FileText className="mr-1 h-3 w-3" /> PDF
            </a>
          </Button>
        </div>
      ),
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Sales Receipts"
        description={`Receipt prints from posted sales invoices \u2014 ${rows.length} receipts`}
        actions={
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {!loading && rows.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total USD</CardTitle></CardHeader>
            <CardContent><CurrencyDisplay amount={totals.usd} currency="USD" className="text-2xl font-semibold" /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total LBP</CardTitle></CardHeader>
            <CardContent><CurrencyDisplay amount={totals.lbp} currency="LBP" className="text-2xl font-semibold" /></CardContent>
          </Card>
        </div>
      )}

      {!loading && rows.length === 0 ? (
        <EmptyState title="No receipts" description="No receipt prints captured from posted sales invoices." action={{ label: "Refresh", onClick: load }} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={loading}
          searchPlaceholder="Search receipt, invoice, customer, printer..."
          onRowClick={(row) => router.push(`/sales/invoices/${row.id}`)}
        />
      )}
    </div>
  );
}

export default function SalesReceiptsPage() {
  return (
    <Suspense fallback={<div className="px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <SalesReceiptsInner />
    </Suspense>
  );
}
