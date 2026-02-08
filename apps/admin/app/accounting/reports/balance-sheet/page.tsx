"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function BalanceSheetPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<BsRes | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [asOf, setAsOf] = useState(todayIso());

  const load = useCallback(async () => {
    setStatus("Loading...");
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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>As Of</CardTitle>
            <CardDescription>
              <span className="font-mono text-xs">{data?.as_of || asOf}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
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
                    <label className="text-xs font-medium text-slate-700">As Of</label>
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
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Normal</th>
                    <th className="px-3 py-2 text-right">Balance USD</th>
                    <th className="px-3 py-2 text-right">Balance LBP</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r) => (
                    <tr key={r.account_code} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{r.account_code}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{r.name_en || "-"}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{r.normal_balance}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.balance_usd, 2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.balance_lbp, 0)}</td>
                    </tr>
                  ))}
                  {(data?.rows || []).length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
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
