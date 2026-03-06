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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/* ---------- types ---------- */

type WarehouseRow = { id: string; name: string };
type BranchRow = { id: string; name: string };

type Row = {
  category_id: string;
  name: string | null;
  revenue_usd: string | number;
  revenue_lbp: string | number;
  cogs_usd: string | number;
  cogs_lbp: string | number;
  margin_usd: string | number;
  margin_lbp: string | number;
  margin_pct_usd?: number | null;
  margin_pct_lbp?: number | null;
  replacement_cogs_usd?: string | number;
  replacement_cogs_lbp?: string | number;
  replacement_margin_usd?: string | number;
  replacement_margin_lbp?: string | number;
  replacement_margin_pct_usd?: number | null;
  replacement_margin_pct_lbp?: number | null;
};

type Res = {
  start_date: string;
  end_date: string;
  warehouse_id: string | null;
  branch_id: string | null;
  rows: Row[];
};

/* ---------- helpers ---------- */

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthStartIso() {
  const d = new Date();
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toNum(v: unknown) { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; }

function fmtPct(p: unknown) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

/* ---------- page ---------- */

export default function MarginByCategoryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Res | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);

  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [warehouseId, setWarehouseId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [limit, setLimit] = useState("500");

  const totals = useMemo(() => {
    let revUsd = 0, revLbp = 0, cogsUsd = 0, cogsLbp = 0;
    let replCogsUsd = 0, replCogsLbp = 0;
    for (const r of data?.rows || []) {
      revUsd += toNum(r.revenue_usd); revLbp += toNum(r.revenue_lbp);
      cogsUsd += toNum(r.cogs_usd); cogsLbp += toNum(r.cogs_lbp);
      replCogsUsd += toNum(r.replacement_cogs_usd);
      replCogsLbp += toNum(r.replacement_cogs_lbp);
    }
    return {
      revUsd, revLbp, cogsUsd, cogsLbp,
      marUsd: revUsd - cogsUsd, marLbp: revLbp - cogsLbp,
      replCogsUsd, replCogsLbp,
      replMarUsd: replCogsUsd > 0 ? revUsd - replCogsUsd : 0,
      replMarLbp: replCogsLbp > 0 ? revLbp - replCogsLbp : 0,
    };
  }, [data]);

  const marginTrend = totals.marUsd > 0 ? "up" as const : totals.marUsd < 0 ? "down" as const : "neutral" as const;
  const replMarginTrend = totals.replMarUsd > 0 ? "up" as const : totals.replMarUsd < 0 ? "down" as const : "neutral" as const;

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (warehouseId) params.set("warehouse_id", warehouseId);
      if (branchId) params.set("branch_id", branchId);
      const lim = Math.max(1, Math.min(2000, Math.floor(Number(limit || 500))));
      params.set("limit", String(lim));
      const [res, ws, bs] = await Promise.all([
        apiGet<Res>(`/reports/sales/margin-by-category?${params.toString()}`),
        apiGet<{ warehouses: WarehouseRow[] }>("/warehouses").catch(() => ({ warehouses: [] as WarehouseRow[] })),
        apiGet<{ branches: BranchRow[] }>("/branches").catch(() => ({ branches: [] as BranchRow[] })),
      ]);
      setData(res);
      setWarehouses(ws.warehouses || []);
      setBranches(bs.branches || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, warehouseId, branchId, limit]);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { id: "name", accessorFn: (r) => r.name || "-", header: ({ column }) => <DataTableColumnHeader column={column} title="Category" /> },
    {
      id: "revenue_usd", accessorFn: (r) => toNum(r.revenue_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="Revenue" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.revenue_usd)} currency="USD" className="font-mono text-sm" />
          <div className="text-xs text-muted-foreground">{fmtLbp(row.original.revenue_lbp)}</div>
        </div>
      ),
    },
    {
      id: "cogs_usd", accessorFn: (r) => toNum(r.cogs_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="Actual COGS" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.cogs_usd)} currency="USD" className="font-mono text-sm" />
          <div className="text-xs text-muted-foreground">{fmtLbp(row.original.cogs_lbp)}</div>
        </div>
      ),
    },
    {
      id: "margin_usd", accessorFn: (r) => toNum(r.margin_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="Actual Margin" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.margin_usd)} currency="USD" className="font-mono text-sm" />
          <div className="text-xs text-muted-foreground">{fmtLbp(row.original.margin_lbp)}</div>
        </div>
      ),
    },
    { id: "margin_pct_usd", accessorFn: (r) => toNum(r.margin_pct_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="Actual %" />, cell: ({ row }) => <div className="text-right font-mono text-sm">{fmtPct(row.original.margin_pct_usd)}</div> },
    {
      id: "repl_cogs_usd", accessorFn: (r) => toNum(r.replacement_cogs_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="Repl. COGS" />,
      cell: ({ row }) => {
        const v = toNum(row.original.replacement_cogs_usd);
        if (v === 0) return <div className="text-right text-sm text-muted-foreground">-</div>;
        return (
          <div className="text-right">
            <CurrencyDisplay amount={v} currency="USD" className="font-mono text-sm" />
            <div className="text-xs text-muted-foreground">{fmtLbp(row.original.replacement_cogs_lbp)}</div>
          </div>
        );
      },
    },
    {
      id: "repl_margin_usd", accessorFn: (r) => toNum(r.replacement_margin_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="Repl. Margin" />,
      cell: ({ row }) => {
        const v = toNum(row.original.replacement_margin_usd);
        const hasData = toNum(row.original.replacement_cogs_usd) > 0;
        if (!hasData) return <div className="text-right text-sm text-muted-foreground">-</div>;
        return (
          <div className="text-right">
            <CurrencyDisplay amount={v} currency="USD" className="font-mono text-sm" />
            <div className="text-xs text-muted-foreground">{fmtLbp(row.original.replacement_margin_lbp)}</div>
          </div>
        );
      },
    },
    {
      id: "repl_margin_pct", accessorFn: (r) => toNum(r.replacement_margin_pct_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Repl. %" />,
      cell: ({ row }) => {
        const pct = row.original.replacement_margin_pct_usd;
        if (pct == null) return <div className="text-right text-sm text-muted-foreground">-</div>;
        const n = Number(pct);
        const color = n >= 0.30 ? "text-emerald-600" : n >= 0.15 ? "text-amber-600" : "text-red-600";
        return <div className={`text-right font-mono text-sm font-medium ${color}`}>{fmtPct(pct)}</div>;
      },
    },
  ], []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Margin by Category"
        description={`Posted sales invoices — ${data?.rows?.length || 0} categories. Actual COGS from stock moves, Repl. COGS from supplier price at time of sale.`}
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
            <label className="text-sm font-medium text-muted-foreground">Start Date</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[180px]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">End Date</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[180px]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Warehouse</label>
            <Select value={warehouseId || "all"} onValueChange={(v) => setWarehouseId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Branch</label>
            <Select value={branchId || "all"} onValueChange={(v) => setBranchId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Limit</label>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" className="w-[100px]" />
          </div>
          <Button onClick={load} disabled={loading}>Apply</Button>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard title="Revenue" value={fmtUsd(totals.revUsd)} description={fmtLbp(totals.revLbp)} trend="up" />
        <KpiCard title="Actual COGS" value={fmtUsd(totals.cogsUsd)} description={fmtLbp(totals.cogsLbp)} trend="down" />
        <KpiCard title="Actual Margin" value={fmtUsd(totals.marUsd)} description={fmtLbp(totals.marLbp)} trend={marginTrend} />
        <KpiCard title="Repl. Margin" value={totals.replCogsUsd > 0 ? fmtUsd(totals.replMarUsd) : "-"} description={totals.replCogsLbp > 0 ? fmtLbp(totals.replMarLbp) : "No replacement cost data"} trend={totals.replCogsUsd > 0 ? replMarginTrend : "neutral"} />
      </div>

      <DataTable columns={columns} data={data?.rows || []} isLoading={loading} searchPlaceholder="Search category..." />
    </div>
  );
}
