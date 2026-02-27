"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  goods_receipt_id: string;
  goods_receipt_no: string | null;
  supplier_name: string | null;
  receipt_total_usd: string | number;
  receipt_total_lbp: string | number;
  landed_cost_usd: string | number;
  landed_cost_lbp: string | number;
  landed_cost_docs: number | string;
  first_posted_at: string | null;
  last_posted_at: string | null;
};

type Res = {
  start_date: string;
  end_date: string;
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

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- page ---------- */

export default function LandedCostImpactPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Res | null>(null);

  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [limit, setLimit] = useState("500");

  const totals = useMemo(() => {
    let receiptUsd = 0, receiptLbp = 0, landedUsd = 0, landedLbp = 0;
    for (const r of data?.rows || []) {
      receiptUsd += toNum(r.receipt_total_usd);
      receiptLbp += toNum(r.receipt_total_lbp);
      landedUsd += toNum(r.landed_cost_usd);
      landedLbp += toNum(r.landed_cost_lbp);
    }
    return { receiptUsd, receiptLbp, landedUsd, landedLbp };
  }, [data]);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      const lim = Math.max(1, Math.min(5000, Math.floor(Number(limit || 500))));
      params.set("limit", String(lim));
      const res = await apiGet<Res>(`/reports/purchases/landed-cost-impact?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    {
      id: "receipt",
      accessorFn: (r) => r.goods_receipt_no || r.goods_receipt_id,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Receipt" />,
      cell: ({ row }) => (
        <Link
          href={`/purchasing/goods-receipts/${encodeURIComponent(row.original.goods_receipt_id)}`}
          className="font-mono text-sm text-primary underline-offset-4 hover:underline"
        >
          {row.original.goods_receipt_no || row.original.goods_receipt_id.slice(0, 8)}
        </Link>
      ),
    },
    {
      id: "supplier_name",
      accessorFn: (r) => r.supplier_name || "-",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
    },
    {
      id: "receipt_total_usd",
      accessorFn: (r) => toNum(r.receipt_total_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Receipt Total" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.receipt_total_usd)} currency="USD" className="font-mono text-sm" />
          <div className="text-xs text-muted-foreground">{fmtLbp(row.original.receipt_total_lbp)}</div>
        </div>
      ),
    },
    {
      id: "landed_cost_usd",
      accessorFn: (r) => toNum(r.landed_cost_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Landed Cost" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.landed_cost_usd)} currency="USD" className="font-mono text-sm" />
          <div className="text-xs text-muted-foreground">{fmtLbp(row.original.landed_cost_lbp)}</div>
        </div>
      ),
    },
    {
      id: "landed_cost_docs",
      accessorFn: (r) => toNum(r.landed_cost_docs),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Docs" />,
      cell: ({ row }) => (
        <div className="text-right font-mono text-sm tabular-nums">
          {toNum(row.original.landed_cost_docs).toLocaleString("en-US")}
        </div>
      ),
    },
    {
      id: "posted",
      accessorFn: (r) => `${r.first_posted_at || ""} ${r.last_posted_at || ""}`,
      header: ({ column }) => <DataTableColumnHeader column={column} title="First / Last Posted" />,
      cell: ({ row }) => (
        <div>
          <div className="font-mono text-sm">{row.original.first_posted_at || "-"}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.original.last_posted_at || "-"}</div>
        </div>
      ),
    },
  ], []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Landed Cost Impact"
        description={`Posted landed cost documents grouped by goods receipt -- ${data?.rows?.length || 0} receipts`}
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
            <label className="text-sm font-medium text-muted-foreground">Limit</label>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" className="w-[120px]" />
          </div>
          <Button onClick={load} disabled={loading}>Apply</Button>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          title="Receipt Total"
          value={fmtUsd(totals.receiptUsd)}
          description={fmtLbp(totals.receiptLbp)}
          trend="up"
        />
        <KpiCard
          title="Landed Cost"
          value={fmtUsd(totals.landedUsd)}
          description={fmtLbp(totals.landedLbp)}
          trend="neutral"
        />
        <KpiCard
          title="Period"
          value={`${data?.start_date || startDate}`}
          description={`to ${data?.end_date || endDate}`}
          trend="neutral"
        />
      </div>

      <DataTable
        columns={columns}
        data={data?.rows || []}
        isLoading={loading}
        searchPlaceholder="Search receipt / supplier..."
      />
    </div>
  );
}
