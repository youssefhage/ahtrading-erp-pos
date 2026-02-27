"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Printer, Download } from "lucide-react";

import { apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";

/* ---------- types ---------- */

type TrialRow = {
  account_code: string;
  name_en: string | null;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
};

/* ---------- helpers ---------- */

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/* ---------- page ---------- */

export default function TrialBalancePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<TrialRow[]>([]);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await apiGet<{ trial_balance: TrialRow[] }>("/reports/trial-balance");
      setRows(res.trial_balance || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo<ColumnDef<TrialRow>[]>(() => [
    {
      id: "account_code",
      accessorFn: (r) => r.account_code,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.account_code}</span>,
    },
    {
      id: "name_en",
      accessorFn: (r) => r.name_en || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
    },
    {
      id: "debit_usd",
      accessorFn: (r) => toNum(r.debit_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Debit USD" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums">{fmt(toNum(row.original.debit_usd))}</div>,
    },
    {
      id: "credit_usd",
      accessorFn: (r) => toNum(r.credit_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit USD" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums">{fmt(toNum(row.original.credit_usd))}</div>,
    },
    {
      id: "debit_lbp",
      accessorFn: (r) => toNum(r.debit_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Debit LBP" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(toNum(row.original.debit_lbp))}</div>,
    },
    {
      id: "credit_lbp",
      accessorFn: (r) => toNum(r.credit_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit LBP" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(toNum(row.original.credit_lbp))}</div>,
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Trial Balance"
        description={`Aggregated from GL entries -- ${rows.length} accounts`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/accounting/reports/trial-balance/print" target="_blank" rel="noopener noreferrer">
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/exports/reports/trial-balance/pdf" target="_blank" rel="noopener noreferrer">
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

      <DataTable
        columns={columns}
        data={rows}
        isLoading={loading}
        searchPlaceholder="Search code / account..."
      />
    </div>
  );
}
