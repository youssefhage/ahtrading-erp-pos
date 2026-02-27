"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Printer, Download } from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtLbpMaybe, fmtUsd, fmtUsdMaybe } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { KpiCard } from "@/components/business/kpi-card";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

/* ---------- types ---------- */

type PlRow = {
  account_code: string;
  name_en: string | null;
  kind: "revenue" | "expense";
  amount_usd: string | number;
  amount_lbp: string | number;
};

type PlRes = {
  start_date: string;
  end_date: string;
  revenue_usd: string | number;
  revenue_lbp: string | number;
  expense_usd: string | number;
  expense_lbp: string | number;
  net_profit_usd: string | number;
  net_profit_lbp: string | number;
  rows: PlRow[];
};

/* ---------- helpers ---------- */

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthStartIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- page ---------- */

export default function ProfitLossPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<PlRes | null>(null);

  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      const res = await apiGet<PlRes>(`/reports/profit-loss?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const printQuery = useMemo(() => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("start_date", startDate);
    if (endDate) qs.set("end_date", endDate);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [startDate, endDate]);

  const netProfitUsd = toNum(data?.net_profit_usd);
  const netTrend = netProfitUsd > 0 ? "up" as const : netProfitUsd < 0 ? "down" as const : "neutral" as const;

  const columns = useMemo<ColumnDef<PlRow>[]>(() => [
    {
      id: "kind",
      accessorFn: (r) => r.kind,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Kind" />,
      cell: ({ row }) => (
        <Badge variant={row.original.kind === "revenue" ? "success" : "warning"}>
          {row.original.kind === "revenue" ? "Revenue" : "Expense"}
        </Badge>
      ),
      filterFn: "equals",
    },
    {
      id: "account_code",
      accessorFn: (r) => r.account_code,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.account_code}</span>,
    },
    {
      id: "name_en",
      accessorFn: (r) => r.name_en || "-",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
    },
    {
      id: "amount_usd",
      accessorFn: (r) => toNum(r.amount_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="USD" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.amount_usd)} currency="USD" className="font-mono text-sm" />
        </div>
      ),
    },
    {
      id: "amount_lbp",
      accessorFn: (r) => toNum(r.amount_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="LBP" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.amount_lbp)} currency="LBP" className="font-mono text-sm" />
        </div>
      ),
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Profit & Loss"
        description={`Period: ${data?.start_date || startDate} to ${data?.end_date || endDate}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/accounting/reports/profit-loss/print${printQuery}`} target="_blank" rel="noopener noreferrer">
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/exports/reports/profit-loss/pdf${printQuery}`} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                PDF
              </a>
            </Button>
          </div>
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
          <Button onClick={load} disabled={loading}>Apply</Button>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          title="Revenue"
          value={fmtUsdMaybe(data?.revenue_usd)}
          description={fmtLbpMaybe(data?.revenue_lbp, { dashIfZero: toNum(data?.revenue_usd) !== 0 })}
          trend="up"
        />
        <KpiCard
          title="Expenses"
          value={fmtUsdMaybe(data?.expense_usd)}
          description={fmtLbpMaybe(data?.expense_lbp, { dashIfZero: toNum(data?.expense_usd) !== 0 })}
          trend="down"
        />
        <KpiCard
          title="Net Profit"
          value={fmtUsdMaybe(data?.net_profit_usd)}
          description={fmtLbpMaybe(data?.net_profit_lbp, { dashIfZero: toNum(data?.net_profit_usd) !== 0 })}
          trend={netTrend}
        />
      </div>

      {/* Data table */}
      <DataTable
        columns={columns}
        data={data?.rows || []}
        isLoading={loading}
        searchPlaceholder="Search account..."
        filterableColumns={[
          {
            id: "kind",
            title: "Kind",
            options: [
              { label: "Revenue", value: "revenue" },
              { label: "Expense", value: "expense" },
            ],
          },
        ]}
      />
    </div>
  );
}
