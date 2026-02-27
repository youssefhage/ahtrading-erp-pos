"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { fmtUsd } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Row = {
  id: string;
  changed_at: string;
  item_id: string;
  sku: string;
  name: string;
  warehouse_id: string;
  warehouse_name: string;
  on_hand_qty: string | number;
  old_avg_cost_usd: string | number;
  new_avg_cost_usd: string | number;
  pct_change_usd: string | number | null;
  source: string | null;
};

function toNum(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function pct(v: unknown) {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function Inner() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ changes: Row[] }>("/pricing/cost-changes?limit=200");
      setRows(res.changes || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    {
      id: "changed_at",
      accessorFn: (r) => r.changed_at,
      header: ({ column }) => <DataTableColumnHeader column={column} title="When" />,
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{formatDateLike(row.original.changed_at)}</span>,
    },
    {
      id: "item",
      accessorFn: (r) => `${r.sku || ""} ${r.name || ""}`.trim(),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <Link className="hover:underline" href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`}>
          <div className="font-medium">{row.original.sku}</div>
          <div className="text-xs text-muted-foreground">{row.original.name}</div>
        </Link>
      ),
    },
    {
      id: "warehouse_name",
      accessorFn: (r) => r.warehouse_name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" />,
    },
    {
      id: "old_cost",
      accessorFn: (r) => toNum(r.old_avg_cost_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Old USD" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.old_avg_cost_usd)} currency="USD" />,
    },
    {
      id: "new_cost",
      accessorFn: (r) => toNum(r.new_avg_cost_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="New USD" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.new_avg_cost_usd)} currency="USD" />,
    },
    {
      id: "pct_change",
      accessorFn: (r) => toNum(r.pct_change_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Change" />,
      cell: ({ row }) => {
        const v = toNum(row.original.pct_change_usd);
        return (
          <span className={`font-mono text-sm ${v > 0 ? "text-destructive" : v < 0 ? "text-green-600" : ""}`}>
            {pct(row.original.pct_change_usd)}
          </span>
        );
      },
    },
    {
      id: "on_hand",
      accessorFn: (r) => toNum(r.on_hand_qty),
      header: ({ column }) => <DataTableColumnHeader column={column} title="On Hand" />,
      cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.on_hand_qty || 0)}</span>,
    },
    {
      id: "source",
      accessorFn: (r) => r.source || "-",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.source || "-"}</span>,
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Cost Changes"
        description="Recent average cost changes used by the AI price-impact agent"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      >
        <Badge variant="outline">{rows.length} changes</Badge>
      </PageHeader>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={loading}
        searchPlaceholder="Search SKU / item / warehouse / source..."
      />
    </div>
  );
}

export default function CostChangesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
