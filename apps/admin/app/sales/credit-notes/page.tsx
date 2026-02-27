"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { fmtUsdLbp } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { EmptyState } from "@/components/business/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type ReturnRow = { id: string; return_no: string | null; invoice_id: string | null; warehouse_id: string | null; refund_method: string | null; status: string; total_usd: string | number; total_lbp: string | number; restocking_fee_usd?: string | number; restocking_fee_lbp?: string | number; created_at: string };
type InvoiceRow = { id: string; invoice_no: string | null; customer_id: string | null; customer_name?: string | null };
type ReturnDetail = { return: ReturnRow & { exchange_rate: string | number }; lines: Array<{ id: string; item_id: string; qty: string | number }>; tax_lines: Array<{ id: string; tax_code_id: string }>; refunds: Array<{ id: string; method: string; amount_usd: string | number; amount_lbp: string | number }> };

function lc(v: unknown) { return String(v || "").trim().toLowerCase(); }
function toNum(v: unknown) { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; }

export default function SalesCreditNotesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [creditNotes, setCreditNotes] = useState<ReturnRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, inv] = await Promise.all([
        apiGet<{ returns: ReturnRow[] }>("/sales/returns"),
        apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices"),
      ]);
      const allReturns = r.returns || [];
      const explicitCredit = allReturns.filter((row) => lc(row.refund_method) === "credit");
      const unknownMethod = allReturns.filter((row) => !lc(row.refund_method));
      let resolvedCreditUnknown: ReturnRow[] = [];
      if (unknownMethod.length) {
        const probes = await Promise.all(
          unknownMethod.map(async (row): Promise<ReturnRow | null> => {
            const det = await apiGet<ReturnDetail>(`/sales/returns/${encodeURIComponent(row.id)}`).catch(() => null);
            const hasCreditRefund = (det?.refunds || []).some((rf) => lc(rf.method) === "credit");
            return hasCreditRefund ? { ...row, refund_method: row.refund_method || "credit" } : null;
          })
        );
        resolvedCreditUnknown = probes.filter((r): r is ReturnRow => r !== null);
      }
      const merged = new Map<string, ReturnRow>();
      for (const row of [...explicitCredit, ...resolvedCreditUnknown]) merged.set(row.id, row);
      setCreditNotes(Array.from(merged.values()));
      setInvoices(inv.invoices || []);
    } catch {
      setCreditNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    let netUsd = 0, netLbp = 0;
    for (const r of creditNotes) {
      netUsd += toNum(r.total_usd) - toNum(r.restocking_fee_usd);
      netLbp += toNum(r.total_lbp) - toNum(r.restocking_fee_lbp);
    }
    return { netUsd, netLbp };
  }, [creditNotes]);

  const columns = useMemo<ColumnDef<ReturnRow>[]>(() => [
    {
      id: "credit_no",
      accessorFn: (r) => r.return_no || r.id,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit Note" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.return_no || row.original.id.slice(0, 8)}</span>,
    },
    {
      id: "invoice",
      accessorFn: (r) => (r.invoice_id ? invoiceById.get(r.invoice_id)?.invoice_no || r.invoice_id : ""),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
      cell: ({ row }) => {
        const r = row.original;
        if (!r.invoice_id) return "-";
        return <span className="font-mono text-sm">{invoiceById.get(r.invoice_id)?.invoice_no || r.invoice_id.slice(0, 8)}</span>;
      },
    },
    {
      id: "customer",
      accessorFn: (r) => {
        const inv = r.invoice_id ? invoiceById.get(r.invoice_id) : null;
        return inv?.customer_name || inv?.customer_id || "Walk-in";
      },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
      cell: ({ row }) => {
        const inv = row.original.invoice_id ? invoiceById.get(row.original.invoice_id) : null;
        return inv?.customer_name || "Walk-in";
      },
    },
    {
      id: "status",
      accessorFn: (r) => r.status,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "credit_usd",
      accessorFn: (r) => toNum(r.total_usd) - toNum(r.restocking_fee_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit USD" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.total_usd) - toNum(row.original.restocking_fee_usd)} currency="USD" />,
    },
    {
      id: "credit_lbp",
      accessorFn: (r) => toNum(r.total_lbp) - toNum(r.restocking_fee_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit LBP" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.total_lbp) - toNum(row.original.restocking_fee_lbp)} currency="LBP" />,
    },
    {
      id: "date",
      accessorFn: (r) => r.created_at,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{formatDateLike(row.original.created_at)}</span>,
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button asChild size="sm" variant="outline">
            <Link href={`/sales/credit-notes/${encodeURIComponent(row.original.id)}/print`} target="_blank">Print</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/exports/sales-credit-notes/${encodeURIComponent(row.original.id)}/pdf`} target="_blank" rel="noopener noreferrer">PDF</a>
          </Button>
        </div>
      ),
    },
  ], [invoiceById]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Credit Notes"
        description={`Customer credit notes from credit-method returns \u2014 ${creditNotes.length} notes`}
        actions={
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      {!loading && creditNotes.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Net Credit USD</CardTitle></CardHeader>
            <CardContent><CurrencyDisplay amount={totals.netUsd} currency="USD" className="text-2xl font-semibold" /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Net Credit LBP</CardTitle></CardHeader>
            <CardContent><CurrencyDisplay amount={totals.netLbp} currency="LBP" className="text-2xl font-semibold" /></CardContent>
          </Card>
        </div>
      )}

      {!loading && creditNotes.length === 0 ? (
        <EmptyState title="No credit notes" description="No credit-method returns found." action={{ label: "Refresh", onClick: load }} />
      ) : (
        <DataTable
          columns={columns}
          data={creditNotes}
          isLoading={loading}
          searchPlaceholder="Search credit note, invoice, customer..."
          onRowClick={(row) => router.push(`/sales/returns/${row.id}`)}
        />
      )}
    </div>
  );
}
