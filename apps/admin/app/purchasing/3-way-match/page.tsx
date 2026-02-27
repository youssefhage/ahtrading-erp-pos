"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { fmtUsd, fmtLbp } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { EmptyState } from "@/components/business/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ExceptionSummary = {
  flags_total: number;
  unit_cost_flags: number;
  qty_flags: number;
  tax_flags: number;
};

type ExceptionRow = {
  id: string;
  invoice_no: string | null;
  supplier_ref: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  goods_receipt_id: string | null;
  goods_receipt_no: string | null;
  hold_reason: string | null;
  held_at: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  invoice_date: string | null;
  due_date: string | null;
  summary?: ExceptionSummary;
};

function toNum(v: unknown, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export default function ThreeWayMatchPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [unholdOpen, setUnholdOpen] = useState(false);
  const [unholdReason, setUnholdReason] = useState("");
  const [unholdId, setUnholdId] = useState("");
  const [unholding, setUnholding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ exceptions: ExceptionRow[] }>("/purchases/invoices/exceptions?limit=200");
      setRows(res.exceptions || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const doUnhold = useCallback(async () => {
    if (!unholdId) return;
    setUnholding(true);
    try {
      await apiPost(`/purchases/invoices/${encodeURIComponent(unholdId)}/unhold`, {
        reason: unholdReason.trim() || null,
      });
      setUnholdOpen(false);
      setUnholdReason("");
      setUnholdId("");
      await load();
    } catch { /* noop */ } finally {
      setUnholding(false);
    }
  }, [load, unholdId, unholdReason]);

  const columns = useMemo<ColumnDef<ExceptionRow>[]>(() => [
    {
      accessorKey: "invoice_no",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div>
            <span className="font-mono text-sm font-medium">{r.invoice_no || "(draft)"}</span>
            <div className="mt-0.5">
              <Badge variant="warning" className="text-xs">
                HOLD{r.hold_reason ? `: ${r.hold_reason}` : ""}
              </Badge>
            </div>
            {r.supplier_ref && (
              <div className="font-mono text-xs text-muted-foreground">Ref: {r.supplier_ref}</div>
            )}
          </div>
        );
      },
    },
    {
      id: "supplier",
      accessorFn: (r) => r.supplier_name || r.supplier_id || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => row.original.supplier_name || row.original.supplier_id || "-",
    },
    {
      id: "receipt",
      accessorFn: (r) => r.goods_receipt_no || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Receipt" />,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="font-mono text-sm">
            {r.goods_receipt_no || r.goods_receipt_id?.slice(0, 8) || "-"}
          </span>
        );
      },
    },
    {
      id: "dates",
      accessorFn: (r) => r.invoice_date || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Dates" />,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="text-xs text-muted-foreground">
            <div>Inv: {formatDate(r.invoice_date)}</div>
            <div>Due: {formatDate(r.due_date)}</div>
            <div>Held: {formatDate(r.held_at)}</div>
          </div>
        );
      },
    },
    {
      id: "variance",
      accessorFn: (r) => r.summary?.flags_total || 0,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Variance" />,
      cell: ({ row }) => {
        const s = row.original.summary;
        if (!s) return <span className="text-muted-foreground">-</span>;
        return (
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="text-xs">Total: {s.flags_total}</Badge>
            {s.unit_cost_flags > 0 && <Badge variant="warning" className="text-xs">Cost: {s.unit_cost_flags}</Badge>}
            {s.qty_flags > 0 && <Badge variant="warning" className="text-xs">Qty: {s.qty_flags}</Badge>}
            {s.tax_flags > 0 && <Badge variant="warning" className="text-xs">Tax: {s.tax_flags}</Badge>}
          </div>
        );
      },
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
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={(e) => {
              e.stopPropagation();
              router.push(`/purchasing/supplier-invoices/${r.id}`);
            }}>
              View
            </Button>
            <Dialog
              open={unholdOpen && unholdId === r.id}
              onOpenChange={(v) => {
                setUnholdOpen(v);
                if (v) setUnholdId(r.id);
                else { setUnholdId(""); setUnholdReason(""); }
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" onClick={(e) => e.stopPropagation()}>Unhold</Button>
              </DialogTrigger>
              <DialogContent onClick={(e) => e.stopPropagation()}>
                <DialogHeader>
                  <DialogTitle>Unhold Supplier Invoice</DialogTitle>
                  <DialogDescription>
                    This will allow the invoice to be posted. Add an optional note for audit trail.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
                  <Input value={unholdReason} onChange={(e) => setUnholdReason(e.target.value)}
                    placeholder="Approved variance / verified receipt..." />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { setUnholdOpen(false); setUnholdId(""); setUnholdReason(""); }}>
                    Cancel
                  </Button>
                  <Button onClick={doUnhold} disabled={unholding}>
                    {unholding ? "Unholding..." : "Unhold"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        );
      },
    },
  ], [doUnhold, router, unholdId, unholdOpen, unholdReason, unholding]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="3-Way Match Exceptions"
        description="Held supplier invoices with quantity, cost, or tax variance signals"
        actions={
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {!loading && rows.length === 0 ? (
        <EmptyState
          title="No hold exceptions"
          description="All supplier invoices passed 3-way match validation."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={loading}
          searchPlaceholder="Search invoice, supplier, receipt..."
          onRowClick={(row) => router.push(`/purchasing/supplier-invoices/${row.id}`)}
        />
      )}
    </div>
  );
}
