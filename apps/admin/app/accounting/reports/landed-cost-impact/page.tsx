"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";

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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function LandedCostImpactPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<Res | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [limit, setLimit] = useState("500");

  const totals = useMemo(() => {
    let receiptUsd = 0;
    let receiptLbp = 0;
    let landedUsd = 0;
    let landedLbp = 0;
    for (const r of data?.rows || []) {
      receiptUsd += Number(r.receipt_total_usd || 0);
      receiptLbp += Number(r.receipt_total_lbp || 0);
      landedUsd += Number(r.landed_cost_usd || 0);
      landedLbp += Number(r.landed_cost_lbp || 0);
    }
    return { receiptUsd, receiptLbp, landedUsd, landedLbp };
  }, [data]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      const lim = Math.max(1, Math.min(5000, Math.floor(Number(limit || 500))));
      params.set("limit", String(lim));
      const res = await apiGet<Res>(`/reports/purchases/landed-cost-impact?${params.toString()}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [startDate, endDate, limit]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Landed Cost Impact</CardTitle>
          <CardDescription>Posted landed cost documents grouped by goods receipt.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
          <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Filters</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Report Filters</DialogTitle>
                <DialogDescription>Date range and row limit.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Start Date</label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">End Date</label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Limit</label>
                  <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" />
                </div>
                <div className="flex justify-end md:col-span-3">
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
          <CardTitle>Totals</CardTitle>
          <CardDescription>{data?.rows?.length || 0} receipts.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="text-xs text-fg-subtle">Receipt total</div>
            <div className="mt-1 data-mono text-sm">{fmtUsd(totals.receiptUsd)}</div>
            <div className="data-mono text-xs text-fg-muted">{fmtLbp(totals.receiptLbp)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="text-xs text-fg-subtle">Landed cost</div>
            <div className="mt-1 data-mono text-sm">{fmtUsd(totals.landedUsd)}</div>
            <div className="data-mono text-xs text-fg-muted">{fmtLbp(totals.landedLbp)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="text-xs text-fg-subtle">Period</div>
            <div className="mt-1 font-mono text-xs">{data?.start_date || startDate}</div>
            <div className="font-mono text-xs text-fg-muted">{data?.end_date || endDate}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Goods Receipts</CardTitle>
          <CardDescription>Sorted by landed cost (USD).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Receipt</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2 text-right">Receipt total</th>
                  <th className="px-3 py-2 text-right">Landed cost</th>
                  <th className="px-3 py-2 text-right">Docs</th>
                  <th className="px-3 py-2">First/Last Posted</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).map((r) => (
                  <tr key={r.goods_receipt_id} className="ui-tr-hover">
                    <td className="px-3 py-2 font-mono text-xs">
                      <ShortcutLink href={`/purchasing/goods-receipts/${encodeURIComponent(r.goods_receipt_id)}`} title="Open goods receipt">
                        {r.goods_receipt_no || r.goods_receipt_id.slice(0, 8)}
                      </ShortcutLink>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.supplier_name || "-"}</td>
                    <td className="px-3 py-2 text-right data-mono text-xs">
                      {fmtUsd(r.receipt_total_usd)}
                      <div className="text-[11px] text-fg-muted">{fmtLbp(r.receipt_total_lbp)}</div>
                    </td>
                    <td className="px-3 py-2 text-right data-mono text-xs">
                      {fmtUsd(r.landed_cost_usd)}
                      <div className="text-[11px] text-fg-muted">{fmtLbp(r.landed_cost_lbp)}</div>
                    </td>
                    <td className="px-3 py-2 text-right data-mono text-xs">{Number(r.landed_cost_docs || 0)}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-mono text-[11px]">{r.first_posted_at || "-"}</div>
                      <div className="font-mono text-[11px] text-fg-muted">{r.last_posted_at || "-"}</div>
                    </td>
                  </tr>
                ))}
                {(data?.rows || []).length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
                      No landed cost documents found for this period.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

