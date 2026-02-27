"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, ArrowRight } from "lucide-react";

import { apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { EmptyState } from "@/components/business/empty-state";
import { Button } from "@/components/ui/button";

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

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function AdjustmentQueueInner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const offset = page * pageSize;
  const query = useMemo(() => ({ q: q.trim(), limit: pageSize, offset }), [q, pageSize, offset]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(query.limit));
      params.set("offset", String(query.offset));
      params.set("flagged_for_adjustment", "true");
      if (query.q) params.set("q", query.q);
      const res = await apiGet<{ invoices: InvoiceRow[]; total?: number }>(`/sales/invoices?${params.toString()}`);
      setInvoices(res.invoices || []);
      setTotal(typeof res.total === "number" ? res.total : null);
    } catch {
      setInvoices([]);
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, [query.limit, query.offset, query.q]);

  useEffect(() => { setPage(0); }, [q, pageSize]);
  useEffect(() => {
    const t = window.setTimeout(() => load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const subtitle = total != null
    ? `${total.toLocaleString("en-US")} flagged invoices`
    : `${invoices.length} shown`;

  const columns = useMemo<ColumnDef<InvoiceRow>[]>(() => [
    {
      id: "invoice",
      accessorFn: (inv) => inv.invoice_no || inv.id,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.invoice_no || "(draft)"}</span>,
    },
    {
      id: "customer",
      accessorFn: (inv) => inv.customer_name || inv.customer_id || "Walk-in",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
      cell: ({ row }) => row.original.customer_name || "Walk-in",
    },
    {
      id: "warehouse",
      accessorFn: (inv) => inv.warehouse_name || inv.warehouse_id || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" />,
      cell: ({ row }) => row.original.warehouse_name || row.original.warehouse_id || "-",
    },
    {
      id: "status",
      accessorFn: (inv) => inv.status,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "dates",
      accessorFn: (inv) => `${inv.invoice_date || ""} ${inv.due_date || ""}`,
      header: "Dates",
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          <div>Inv: <span className="font-mono">{fmtIso(row.original.invoice_date)}</span></div>
          <div>Due: <span className="font-mono">{fmtIso(row.original.due_date)}</span></div>
        </div>
      ),
    },
    {
      id: "total_usd",
      accessorFn: (inv) => toNum(inv.total_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total USD" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.total_usd)} currency="USD" />,
    },
    {
      id: "total_lbp",
      accessorFn: (inv) => toNum(inv.total_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total LBP" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.total_lbp)} currency="LBP" />,
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Adjustment Queue"
        description={`Flagged sales invoices awaiting follow-up adjustment \u2014 ${subtitle}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/sales/invoices")}>
              <ArrowRight className="mr-2 h-4 w-4" /> All Invoices
            </Button>
          </>
        }
      />

      {!loading && invoices.length === 0 ? (
        <EmptyState title="No flagged invoices" description="No sales invoices are currently flagged for adjustment." action={{ label: "Refresh", onClick: load }} />
      ) : (
        <DataTable
          columns={columns}
          data={invoices}
          isLoading={loading}
          searchPlaceholder="Search invoice, customer, warehouse..."
          onRowClick={(inv) => router.push(`/sales/invoices/${inv.id}`)}
          totalRows={total ?? undefined}
          manualPagination
          pageCount={total != null ? Math.ceil(total / pageSize) : undefined}
          onPaginationChange={(p) => { setPage(p.pageIndex); setPageSize(p.pageSize); }}
        />
      )}
    </div>
  );
}

export default function AdjustmentQueuePage() {
  return (
    <Suspense fallback={<div className="px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <AdjustmentQueueInner />
    </Suspense>
  );
}
