"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type TrialRow = {
  account_code: string;
  name_en: string | null;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
};

function fmt(n: string | number) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function TrialBalancePage() {
  const [rows, setRows] = useState<TrialRow[]>([]);
  const [status, setStatus] = useState("");

  const columns = useMemo((): Array<DataTableColumn<TrialRow>> => {
    return [
      { id: "account_code", header: "Code", accessor: (r) => r.account_code, mono: true, sortable: true, globalSearch: false },
      { id: "name_en", header: "Account", accessor: (r) => r.name_en || "", sortable: true },
      {
        id: "debit_usd",
        header: "Dr USD",
        accessor: (r) => Number(r.debit_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmt(r.debit_usd)}</span>,
      },
      {
        id: "credit_usd",
        header: "Cr USD",
        accessor: (r) => Number(r.credit_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmt(r.credit_usd)}</span>,
      },
      {
        id: "debit_lbp",
        header: "Dr LL",
        accessor: (r) => Number(r.debit_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmt(r.debit_lbp)}</span>,
      },
      {
        id: "credit_lbp",
        header: "Cr LL",
        accessor: (r) => Number(r.credit_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmt(r.credit_lbp)}</span>,
      },
    ];
  }, []);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ trial_balance: TrialRow[] }>("/reports/trial-balance");
      setRows(res.trial_balance || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Balances (USD + LL)</CardTitle>
            <CardDescription>Aggregated from GL entries. {rows.length} accounts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Button asChild variant="outline">
                <Link href="/accounting/reports/trial-balance/print" target="_blank" rel="noopener noreferrer">
                  Print / PDF
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href="/exports/reports/trial-balance/pdf" target="_blank" rel="noopener noreferrer">
                  Download PDF
                </a>
              </Button>
            </div>

            <DataTable<TrialRow>
              tableId="accounting.reports.trial_balance"
              rows={rows}
              columns={columns}
              initialSort={{ columnId: "account_code", dir: "asc" }}
              globalFilterPlaceholder="Search code / account..."
              emptyText="No GL entries yet."
            />
          </CardContent>
        </Card>
      </div>);
}
