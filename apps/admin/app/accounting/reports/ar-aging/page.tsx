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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/* ---------- types ---------- */

type AgingRow = {
  invoice_id: string;
  invoice_no: string;
  customer_id: string | null;
  customer_name: string | null;
  invoice_date: string;
  due_date: string;
  total_usd: string | number;
  total_lbp: string | number;
  paid_usd: string | number;
  paid_lbp: string | number;
  balance_usd: string | number;
  balance_lbp: string | number;
  days_past_due: string | number;
  bucket: string;
};

type AgingRes = { as_of: string; rows: AgingRow[] };

/* ---------- helpers ---------- */

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function bucketVariant(bucket: string): "success" | "info" | "warning" | "destructive" {
  switch (bucket) {
    case "current": return "success";
    case "1-30": return "info";
    case "31-60": return "warning";
    case "61-90":
    case "90+": return "destructive";
    default: return "info";
  }
}

/* ---------- page ---------- */

export default function ArAgingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<AgingRes | null>(null);

  const [asOf, setAsOf] = useState(todayIso());

  const bucketTotals = useMemo(() => {
    const totals = new Map<string, { usd: number; lbp: number }>();
    for (const r of data?.rows || []) {
      const b = r.bucket || "unknown";
      const t = totals.get(b) || { usd: 0, lbp: 0 };
      t.usd += toNum(r.balance_usd);
      t.lbp += toNum(r.balance_lbp);
      totals.set(b, t);
    }
    const order: Record<string, number> = { current: 0, "1-30": 1, "31-60": 2, "61-90": 3, "90+": 4 };
    return Array.from(totals.entries()).sort((a, b) => (order[a[0]] ?? 99) - (order[b[0]] ?? 99));
  }, [data]);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (asOf) params.set("as_of", asOf);
      const res = await apiGet<AgingRes>(`/reports/ar-aging?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo<ColumnDef<AgingRow>[]>(() => [
    {
      id: "bucket",
      accessorFn: (r) => r.bucket,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Bucket" />,
      cell: ({ row }) => <Badge variant={bucketVariant(row.original.bucket)}>{row.original.bucket}</Badge>,
      filterFn: "equals",
    },
    {
      id: "invoice_no",
      accessorFn: (r) => r.invoice_no,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
      cell: ({ row }) => (
        <Link href={`/sales/invoices/${encodeURIComponent(row.original.invoice_id)}`} className="font-mono text-sm text-primary underline-offset-4 hover:underline">
          {row.original.invoice_no}
        </Link>
      ),
    },
    {
      id: "customer",
      accessorFn: (r) => r.customer_name || r.customer_id || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
      cell: ({ row }) =>
        row.original.customer_id ? (
          <Link href={`/partners/customers/${encodeURIComponent(row.original.customer_id)}`} className="text-sm text-primary underline-offset-4 hover:underline">
            {row.original.customer_name || row.original.customer_id}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">{row.original.customer_name || "-"}</span>
        ),
    },
    {
      id: "due",
      accessorFn: (r) => r.due_date,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
      cell: ({ row }) => (
        <div className="font-mono text-sm">
          {row.original.due_date}{" "}
          <span className="text-muted-foreground">({toNum(row.original.days_past_due)}d)</span>
        </div>
      ),
    },
    {
      id: "balance_usd",
      accessorFn: (r) => toNum(r.balance_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Balance USD" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.balance_usd)} currency="USD" className="font-mono text-sm" />
        </div>
      ),
    },
    {
      id: "balance_lbp",
      accessorFn: (r) => toNum(r.balance_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Balance LBP" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.balance_lbp)} currency="LBP" className="font-mono text-sm" />
        </div>
      ),
    },
  ], []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="AR Aging"
        description={`Outstanding receivables as of ${data?.as_of || asOf} -- ${data?.rows?.length || 0} invoices`}
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
            <label className="text-sm font-medium text-muted-foreground">As Of</label>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-[180px]" />
          </div>
          <Button onClick={load} disabled={loading}>Apply</Button>
        </CardContent>
      </Card>

      {/* Bucket KPI cards */}
      {bucketTotals.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-5">
          {bucketTotals.map(([bucket, t]) => (
            <KpiCard
              key={bucket}
              title={bucket}
              value={fmtUsd(t.usd)}
              description={fmtLbp(t.lbp)}
            />
          ))}
        </div>
      )}

      {/* Data table */}
      <DataTable
        columns={columns}
        data={data?.rows || []}
        isLoading={loading}
        searchPlaceholder="Search invoice / customer..."
      />
    </div>
  );
}
