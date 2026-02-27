"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtUsdLbp } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { EmptyState } from "@/components/business/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ReturnRow = {
  id: string;
  return_no: string | null;
  invoice_id: string | null;
  warehouse_id: string | null;
  device_id: string | null;
  shift_id: string | null;
  refund_method: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  restocking_fee_usd?: string | number;
  restocking_fee_lbp?: string | number;
  restocking_fee_reason?: string | null;
  created_at: string;
};

type InvoiceRow = { id: string; invoice_no: string };
type Warehouse = { id: string; name: string };

type ReturnDetail = {
  return: ReturnRow & { exchange_rate: string | number };
  lines: Array<{ id: string; item_id: string; qty: string | number; line_total_usd: string | number; line_total_lbp: string | number }>;
  tax_lines: Array<{ id: string; tax_code_id: string; base_usd: string | number; base_lbp: string | number; tax_usd: string | number; tax_lbp: string | number }>;
  refunds: Array<{ id: string; method: string; amount_usd: string | number; amount_lbp: string | number; created_at: string }>;
};

function toNum(v: unknown) { const x = Number(v || 0); return Number.isFinite(x) ? x : 0; }

export default function SalesReturnsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ReturnDetail | null>(null);

  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, inv, wh] = await Promise.all([
        apiGet<{ returns: ReturnRow[] }>("/sales/returns"),
        apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
      ]);
      setReturns(r.returns || []);
      setInvoices(inv.invoices || []);
      setWarehouses(wh.warehouses || []);
    } catch {
      setReturns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setDetail(null); return; }
    try {
      const res = await apiGet<ReturnDetail>(`/sales/returns/${id}`);
      setDetail(res);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);

  const columns = useMemo<ColumnDef<ReturnRow>[]>(() => [
    {
      id: "return",
      accessorFn: (r) => r.return_no || r.id,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Return" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.return_no || row.original.id.slice(0, 8)}</span>,
    },
    {
      id: "invoice",
      accessorFn: (r) => (r.invoice_id ? invoiceById.get(r.invoice_id)?.invoice_no || r.invoice_id : ""),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
      cell: ({ row }) => {
        const r = row.original;
        if (!r.invoice_id) return <span className="text-muted-foreground">-</span>;
        return <span className="font-mono text-sm">{invoiceById.get(r.invoice_id)?.invoice_no || r.invoice_id.slice(0, 8)}</span>;
      },
    },
    {
      id: "warehouse",
      accessorFn: (r) => (r.warehouse_id ? whById.get(r.warehouse_id)?.name || r.warehouse_id : ""),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" />,
      cell: ({ row }) => row.original.warehouse_id ? whById.get(row.original.warehouse_id)?.name || row.original.warehouse_id : "-",
    },
    {
      id: "refund_method",
      accessorFn: (r) => r.refund_method || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Refund" />,
      cell: ({ row }) => row.original.refund_method ? <Badge variant="outline">{row.original.refund_method}</Badge> : <span className="text-muted-foreground">-</span>,
    },
    {
      id: "status",
      accessorFn: (r) => r.status,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
  ], [invoiceById, whById]);

  const netRefund = useMemo(() => {
    if (!detail) return { usd: 0, lbp: 0 };
    return { usd: toNum(detail.return.total_usd) - toNum((detail.return as any).restocking_fee_usd), lbp: toNum(detail.return.total_lbp) - toNum((detail.return as any).restocking_fee_lbp) };
  }, [detail]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Sales Returns"
        description={`Review returns, refund impact, and tax detail \u2014 ${returns.length} returns`}
        actions={
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {!loading && returns.length === 0 ? (
            <EmptyState title="No returns" description="No sales returns found." action={{ label: "Refresh", onClick: load }} />
          ) : (
            <DataTable
              columns={columns}
              data={returns}
              isLoading={loading}
              searchPlaceholder="Search return, invoice, warehouse..."
              onRowClick={(row) => setSelectedId(row.id)}
            />
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Return Detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {detail ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold">{detail.return.return_no || detail.return.id.slice(0, 8)}</span>
                    <StatusBadge status={detail.return.status} />
                  </div>
                  <div className="text-sm"><span className="text-muted-foreground">Net refund:</span> <span className="font-semibold">{fmtUsdLbp(netRefund.usd, netRefund.lbp)}</span></div>
                  {detail.return.invoice_id && <div className="text-sm"><span className="text-muted-foreground">Invoice:</span> <span className="font-mono">{invoiceById.get(detail.return.invoice_id)?.invoice_no || detail.return.invoice_id.slice(0, 8)}</span></div>}
                  {detail.return.warehouse_id && <div className="text-sm"><span className="text-muted-foreground">Warehouse:</span> {whById.get(detail.return.warehouse_id)?.name || detail.return.warehouse_id}</div>}
                  <div className="text-sm"><span className="text-muted-foreground">Refund method:</span> {detail.return.refund_method || "-"}</div>
                  <div className="text-sm"><span className="text-muted-foreground">Rate:</span> <span className="font-mono">{Number(detail.return.exchange_rate || 0).toLocaleString("en-US")}</span></div>
                  <div className="text-sm"><span className="text-muted-foreground">Total:</span> {fmtUsdLbp(detail.return.total_usd, detail.return.total_lbp)}</div>
                </div>
                {(detail.refunds || []).length > 0 && (
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-xs font-medium">Refund Transactions</p>
                    {detail.refunds.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs">{r.method}</span>
                        <span className="font-mono text-xs">{fmtUsdLbp(r.amount_usd, r.amount_lbp)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">{detail.lines.length} line(s), {detail.tax_lines.length} tax line(s)</div>
                <Button variant="outline" size="sm" className="w-full" onClick={() => router.push(`/sales/invoices/${detail.return.invoice_id}`)}>View Invoice</Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a return from the list to view details.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
