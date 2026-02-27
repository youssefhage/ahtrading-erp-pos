"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { KpiCard } from "@/components/business/kpi-card";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/* ---------- types ---------- */

type Row = {
  item_id: string;
  sku: string | null;
  item_name: string | null;
  warehouse_id: string;
  warehouse_name: string | null;
  on_hand_qty: string | number;
  avg_cost_usd: string | number;
  avg_cost_lbp: string | number;
  est_value_usd: string | number;
  est_value_lbp: string | number;
};

type Res = { rows: Row[] };

/* ---------- helpers ---------- */

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- page ---------- */

export default function NegativeStockRiskPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Res | null>(null);
  const [limit, setLimit] = useState("2000");

  const totals = useMemo(() => {
    let valueUsd = 0, valueLbp = 0, qty = 0;
    for (const r of data?.rows || []) {
      valueUsd += toNum(r.est_value_usd);
      valueLbp += toNum(r.est_value_lbp);
      qty += toNum(r.on_hand_qty);
    }
    return { valueUsd, valueLbp, qty };
  }, [data]);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const lim = Math.max(1, Math.min(20000, Math.floor(Number(limit || 2000))));
      const res = await apiGet<Res>(`/reports/inventory/negative-stock-risk?limit=${lim}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    {
      id: "item",
      accessorFn: (r) => `${r.sku || ""} ${r.item_name || ""}`,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <div>
          <div className="font-mono text-xs text-muted-foreground">{row.original.sku || "-"}</div>
          <div className="text-sm">{row.original.item_name || "-"}</div>
        </div>
      ),
    },
    {
      id: "warehouse",
      accessorFn: (r) => r.warehouse_name || r.warehouse_id,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" />,
    },
    {
      id: "on_hand_qty",
      accessorFn: (r) => toNum(r.on_hand_qty),
      header: ({ column }) => <DataTableColumnHeader column={column} title="On Hand" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-red-600 dark:text-red-400">{toNum(row.original.on_hand_qty).toLocaleString("en-US")}</div>,
    },
    {
      id: "avg_cost_usd",
      accessorFn: (r) => toNum(r.avg_cost_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Avg Cost USD" />,
      cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={toNum(row.original.avg_cost_usd)} currency="USD" className="font-mono text-sm" /></div>,
    },
    {
      id: "avg_cost_lbp",
      accessorFn: (r) => toNum(r.avg_cost_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Avg Cost LBP" />,
      cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={toNum(row.original.avg_cost_lbp)} currency="LBP" className="font-mono text-sm" /></div>,
    },
    {
      id: "est_value_usd",
      accessorFn: (r) => toNum(r.est_value_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Est Value USD" />,
      cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={toNum(row.original.est_value_usd)} currency="USD" className="font-mono text-sm" /></div>,
    },
    {
      id: "est_value_lbp",
      accessorFn: (r) => toNum(r.est_value_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Est Value LBP" />,
      cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={toNum(row.original.est_value_lbp)} currency="LBP" className="font-mono text-sm" /></div>,
    },
  ], []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Negative Stock Risk"
        description={`Items where on-hand quantity is negative -- ${data?.rows?.length || 0} rows`}
        actions={
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
          <Button variant="link" size="sm" className="ml-2" onClick={load}>Retry</Button>
        </div>
      )}

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Row Limit</label>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" className="w-[120px]" />
          </div>
          <Button onClick={load} disabled={loading}>Apply</Button>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          title="On-hand Qty"
          value={totals.qty.toLocaleString("en-US")}
          trend={totals.qty < 0 ? "down" : "neutral"}
        />
        <KpiCard
          title="Est Value (USD)"
          value={fmtUsd(totals.valueUsd)}
          trend={totals.valueUsd > 0 ? "down" : "neutral"}
        />
        <KpiCard
          title="Est Value (LBP)"
          value={fmtLbp(totals.valueLbp)}
          trend={totals.valueLbp > 0 ? "down" : "neutral"}
        />
      </div>

      <DataTable
        columns={columns}
        data={data?.rows || []}
        isLoading={loading}
        searchPlaceholder="Search SKU / item / warehouse..."
      />
    </div>
  );
}
