"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type LandedCostRow = {
  id: string;
  landed_cost_no: string | null;
  goods_receipt_id: string | null;
  goods_receipt_no?: string | null;
  status: string;
  memo?: string | null;
  exchange_rate: string | number;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
  posted_at?: string | null;
};

function toNum(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function Inner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LandedCostRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => rows.filter((r) => !statusFilter || r.status === statusFilter), [rows, statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ landed_costs: LandedCostRow[] }>("/inventory/landed-costs");
      setRows(res.landed_costs || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo<ColumnDef<LandedCostRow>[]>(() => [
    {
      accessorKey: "landed_cost_no",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Landed Cost" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <Link className="font-medium text-primary hover:underline" href={`/inventory/landed-costs/${encodeURIComponent(row.original.id)}`}>
            {row.original.landed_cost_no || "(draft)"}
          </Link>
          {row.original.memo && <span className="mt-0.5 text-xs text-muted-foreground">{row.original.memo}</span>}
        </div>
      ),
    },
    {
      id: "goods_receipt",
      accessorFn: (r) => r.goods_receipt_no || r.goods_receipt_id || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Goods Receipt" />,
      cell: ({ row }) =>
        row.original.goods_receipt_id ? (
          <Link className="text-primary hover:underline" href={`/purchasing/goods-receipts/${encodeURIComponent(row.original.goods_receipt_id)}`}>
            {row.original.goods_receipt_no || row.original.goods_receipt_id.slice(0, 8)}
          </Link>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
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
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Landed Costs"
        description="Allocate freight, customs, and handling to posted goods receipts"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => router.push("/inventory/landed-costs/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Draft
            </Button>
          </>
        }
      >
        <Badge variant="outline">{filtered.length} documents</Badge>
      </PageHeader>

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={loading}
        searchPlaceholder="Search landed cost / GRN / memo..."
        toolbarActions={
          <select className="h-9 rounded-md border bg-background px-3 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="posted">Posted</option>
            <option value="canceled">Canceled</option>
          </select>
        }
      />
    </div>
  );
}

export default function LandedCostsListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
