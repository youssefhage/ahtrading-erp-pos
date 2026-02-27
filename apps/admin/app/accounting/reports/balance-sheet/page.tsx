"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Printer, Download } from "lucide-react";

import { apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/* ---------- types ---------- */

type BsRow = {
  account_code: string;
  name_en: string | null;
  normal_balance: string;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
  balance_usd: string | number;
  balance_lbp: string | number;
};

type BsRes = { as_of: string; rows: BsRow[] };

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

function splitBalanceByNormal(normalBalance: string | null | undefined, value: string | number) {
  const n = toNum(value);
  const isCredit = String(normalBalance || "").toLowerCase() === "credit";
  if (isCredit) return n >= 0 ? { debit: 0, credit: n } : { debit: Math.abs(n), credit: 0 };
  return n >= 0 ? { debit: n, credit: 0 } : { debit: 0, credit: Math.abs(n) };
}

function fmt(n: number, frac = 2) {
  return n.toLocaleString("en-US", { maximumFractionDigits: frac });
}

/* ---------- page ---------- */

export default function BalanceSheetPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<BsRes | null>(null);

  const [asOf, setAsOf] = useState(todayIso());

  const printQuery = useMemo(() => {
    const qs = new URLSearchParams();
    if (asOf) qs.set("as_of", asOf);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [asOf]);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (asOf) params.set("as_of", asOf);
      const res = await apiGet<BsRes>(`/reports/balance-sheet?${params.toString()}`);
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

  const columns = useMemo<ColumnDef<BsRow>[]>(() => [
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
      id: "normal_balance",
      accessorFn: (r) => r.normal_balance,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Normal" />,
      cell: ({ row }) => <span className="text-xs text-muted-foreground capitalize">{row.original.normal_balance}</span>,
    },
    {
      id: "debit_usd",
      accessorFn: (r) => splitBalanceByNormal(r.normal_balance, r.balance_usd).debit,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Debit USD" />,
      cell: ({ row }) => {
        const v = splitBalanceByNormal(row.original.normal_balance, row.original.balance_usd).debit;
        return <div className="text-right font-mono text-sm tabular-nums">{fmt(v)}</div>;
      },
    },
    {
      id: "credit_usd",
      accessorFn: (r) => splitBalanceByNormal(r.normal_balance, r.balance_usd).credit,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit USD" />,
      cell: ({ row }) => {
        const v = splitBalanceByNormal(row.original.normal_balance, row.original.balance_usd).credit;
        return <div className="text-right font-mono text-sm tabular-nums">{fmt(v)}</div>;
      },
    },
    {
      id: "debit_lbp",
      accessorFn: (r) => splitBalanceByNormal(r.normal_balance, r.balance_lbp).debit,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Debit LBP" />,
      cell: ({ row }) => {
        const v = splitBalanceByNormal(row.original.normal_balance, row.original.balance_lbp).debit;
        return <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(v, 0)}</div>;
      },
    },
    {
      id: "credit_lbp",
      accessorFn: (r) => splitBalanceByNormal(r.normal_balance, r.balance_lbp).credit,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit LBP" />,
      cell: ({ row }) => {
        const v = splitBalanceByNormal(row.original.normal_balance, row.original.balance_lbp).credit;
        return <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(v, 0)}</div>;
      },
    },
  ], []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Balance Sheet"
        description={`As of ${data?.as_of || asOf} -- ${data?.rows?.length || 0} accounts`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/accounting/reports/balance-sheet/print${printQuery}`} target="_blank" rel="noopener noreferrer">
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/exports/reports/balance-sheet/pdf${printQuery}`} target="_blank" rel="noopener noreferrer">
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
            <label className="text-sm font-medium text-muted-foreground">As Of</label>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-[180px]" />
          </div>
          <Button onClick={load} disabled={loading}>Apply</Button>
        </CardContent>
      </Card>

      {/* Data table */}
      <DataTable
        columns={columns}
        data={data?.rows || []}
        isLoading={loading}
        searchPlaceholder="Search code / account..."
      />
    </div>
  );
}
