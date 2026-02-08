"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

function fmt(n: string | number, frac = 2) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function ArAgingPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<AgingRes | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [asOf, setAsOf] = useState(todayIso());

  const bucketTotals = useMemo(() => {
    const totals = new Map<string, { usd: number; lbp: number }>();
    for (const r of data?.rows || []) {
      const b = r.bucket || "unknown";
      const t = totals.get(b) || { usd: 0, lbp: 0 };
      t.usd += Number(r.balance_usd || 0);
      t.lbp += Number(r.balance_lbp || 0);
      totals.set(b, t);
    }
    const order: Record<string, number> = { current: 0, "1-30": 1, "31-60": 2, "61-90": 3, "90+": 4 };
    return Array.from(totals.entries()).sort((a, b) => (order[a[0]] ?? 99) - (order[b[0]] ?? 99));
  }, [data]);

  async function load() {
    setStatus("Loading...");
    try {
      const params = new URLSearchParams();
      if (asOf) params.set("as_of", asOf);
      const res = await apiGet<AgingRes>(`/reports/ar-aging?${params.toString()}`);
      setData(res);
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
            <CardTitle>Bucket Totals</CardTitle>
            <CardDescription>Outstanding receivables by bucket.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-4">
            {bucketTotals.map(([bucket, t]) => (
              <div key={bucket} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">{bucket}</div>
                <div className="mt-1 font-mono text-sm">{fmt(t.usd, 2)} USD</div>
                <div className="font-mono text-xs text-slate-600">{fmt(t.lbp, 0)} LBP</div>
              </div>
            ))}
            {bucketTotals.length === 0 ? (
              <div className="text-sm text-slate-600">No outstanding invoices.</div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>{data?.rows?.length || 0} outstanding invoices</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Bucket</th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Due</th>
                    <th className="px-3 py-2 text-right">Balance USD</th>
                    <th className="px-3 py-2 text-right">Balance LBP</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows || []).map((r) => (
                    <tr key={r.invoice_id} className="ui-tr-hover">
                      <td className="px-3 py-2 text-xs">{r.bucket}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.invoice_no}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{r.customer_name || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.due_date}{" "}
                        <span className="text-slate-500">
                          ({Number(r.days_past_due || 0)}d)
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.balance_usd, 2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.balance_lbp, 0)}</td>
                    </tr>
                  ))}
                  {(data?.rows || []).length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                        No outstanding invoices.
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
