"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export default function ProfitLossPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<PlRes | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      const res = await apiGet<PlRes>(`/reports/profit-loss?${params.toString()}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
            <CardDescription>
              Period:{" "}
              <span className="font-mono text-xs">
                {data?.start_date || startDate} → {data?.end_date || endDate}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <div className="rounded-md border border-border bg-bg-elevated p-3">
                  <div className="text-xs text-fg-subtle">Revenue</div>
                  <div className="mt-1 data-mono text-sm">{fmtUsd(data?.revenue_usd || 0)}</div>
                  <div className="data-mono text-xs text-fg-muted">{fmtLbp(data?.revenue_lbp || 0)}</div>
                </div>
                <div className="rounded-md border border-border bg-bg-elevated p-3">
                  <div className="text-xs text-fg-subtle">Expenses</div>
                  <div className="mt-1 data-mono text-sm">{fmtUsd(data?.expense_usd || 0)}</div>
                  <div className="data-mono text-xs text-fg-muted">{fmtLbp(data?.expense_lbp || 0)}</div>
                </div>
                <div className="rounded-md border border-border bg-bg-elevated p-3">
                  <div className="text-xs text-fg-subtle">Net Profit</div>
                  <div className="mt-1 data-mono text-sm">{fmtUsd(data?.net_profit_usd || 0)}</div>
                  <div className="data-mono text-xs text-fg-muted">{fmtLbp(data?.net_profit_lbp || 0)}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={load}>
                  Refresh
                </Button>
                <Button asChild variant="outline">
                  <Link
                    href={`/accounting/reports/profit-loss/print?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Print / PDF
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <a
                    href={`/exports/reports/profit-loss/pdf?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download PDF
                  </a>
                </Button>
                <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline">Filters</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-xl">
                    <DialogHeader>
                      <DialogTitle>Report Filters</DialogTitle>
                      <DialogDescription>Select the P&L period.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Start Date</label>
                        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">End Date</label>
                        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                      </div>
                      <div className="flex justify-end md:col-span-2">
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
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>{data?.rows?.length || 0} accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2 text-right">USD</th>
                    <th className="px-3 py-2 text-right">LL</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r) => (
                    <tr key={`${r.kind}-${r.account_code}`} className="ui-tr-hover">
                      <td className="px-3 py-2 text-xs text-fg-muted">{r.kind}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.account_code}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{r.name_en || "-"}</td>
                      <td className="px-3 py-2 text-right data-mono text-xs">{fmtUsd(r.amount_usd)}</td>
                      <td className="px-3 py-2 text-right data-mono text-xs">{fmtLbp(r.amount_lbp)}</td>
                    </tr>
                  ))}
                  {(data?.rows || []).length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                        No rows.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>);
}
