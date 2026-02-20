"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

function fmt(n: string | number, frac = 2) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

function splitBalanceByNormal(normalBalance: string | null | undefined, value: string | number) {
  const n = Number(value || 0);
  const isCredit = String(normalBalance || "").toLowerCase() === "credit";
  if (isCredit) return n >= 0 ? { debit: 0, credit: n } : { debit: Math.abs(n), credit: 0 };
  return n >= 0 ? { debit: n, credit: 0 } : { debit: 0, credit: Math.abs(n) };
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function BalanceSheetPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<BsRes | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [asOf, setAsOf] = useState(todayIso());
  const printQuery = useMemo(() => {
    const qs = new URLSearchParams();
    if (asOf) qs.set("as_of", asOf);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [asOf]);

  const load = useCallback(async () => {
    setStatus("");
    try {
      const params = new URLSearchParams();
      if (asOf) params.set("as_of", asOf);
      const res = await apiGet<BsRes>(`/reports/balance-sheet?${params.toString()}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [asOf]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo((): Array<DataTableColumn<BsRow>> => {
    return [
      { id: "account_code", header: "Code", accessor: (r) => r.account_code, mono: true, sortable: true, globalSearch: false },
      { id: "name_en", header: "Account", accessor: (r) => r.name_en || "-", sortable: true },
      { id: "normal_balance", header: "Normal", accessor: (r) => r.normal_balance, sortable: true, globalSearch: false },
      {
        id: "debit_usd",
        header: "Debit USD",
        accessor: (r) => splitBalanceByNormal(r.normal_balance, r.balance_usd).debit,
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmt(splitBalanceByNormal(r.normal_balance, r.balance_usd).debit, 2)}</span>,
      },
      {
        id: "credit_usd",
        header: "Credit USD",
        accessor: (r) => splitBalanceByNormal(r.normal_balance, r.balance_usd).credit,
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmt(splitBalanceByNormal(r.normal_balance, r.balance_usd).credit, 2)}</span>,
      },
      {
        id: "debit_lbp",
        header: "Debit LL",
        accessor: (r) => splitBalanceByNormal(r.normal_balance, r.balance_lbp).debit,
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmt(splitBalanceByNormal(r.normal_balance, r.balance_lbp).debit, 0)}</span>,
      },
      {
        id: "credit_lbp",
        header: "Credit LL",
        accessor: (r) => splitBalanceByNormal(r.normal_balance, r.balance_lbp).credit,
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmt(splitBalanceByNormal(r.normal_balance, r.balance_lbp).credit, 0)}</span>,
      },
    ];
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>As Of</CardTitle>
            <CardDescription>
              <span className="font-mono text-xs">{data?.as_of || asOf}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Button asChild variant="outline">
                <Link
                  href={`/accounting/reports/balance-sheet/print${printQuery}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Print / PDF
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a
                  href={`/exports/reports/balance-sheet/pdf${printQuery}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download PDF
                </a>
              </Button>
            </div>
            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Filters</Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Report Filters</DialogTitle>
                  <DialogDescription>Select an as-of date.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">As Of</label>
                    <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                  </div>
                  <div className="flex items-end justify-end">
                    <Button
                      onClick={async () => {
                        setFiltersOpen(false);
                        await load();
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>{data?.rows?.length || 0} accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<BsRow>
              tableId="accounting.reports.balance_sheet.v2"
              rows={data?.rows || []}
              columns={columns}
              initialSort={{ columnId: "account_code", dir: "asc" }}
              globalFilterPlaceholder="Search code / account..."
              emptyText="No rows."
            />
          </CardContent>
        </Card>
      </div>);
}
