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

type WarehouseRow = { id: string; name: string };
type BranchRow = { id: string; name: string };

type Row = {
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  revenue_usd: string | number;
  revenue_lbp: string | number;
  cogs_usd: string | number;
  cogs_lbp: string | number;
  margin_usd: string | number;
  margin_lbp: string | number;
  margin_pct_usd?: number | null;
  margin_pct_lbp?: number | null;
};

type Res = {
  start_date: string;
  end_date: string;
  warehouse_id: string | null;
  branch_id: string | null;
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

function fmtPct(p: unknown) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

export default function MarginByCustomerPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<Res | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [warehouseId, setWarehouseId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [limit, setLimit] = useState("500");

  const totals = useMemo(() => {
    let revUsd = 0;
    let revLbp = 0;
    let cogsUsd = 0;
    let cogsLbp = 0;
    for (const r of data?.rows || []) {
      revUsd += Number(r.revenue_usd || 0);
      revLbp += Number(r.revenue_lbp || 0);
      cogsUsd += Number(r.cogs_usd || 0);
      cogsLbp += Number(r.cogs_lbp || 0);
    }
    return { revUsd, revLbp, cogsUsd, cogsLbp, marUsd: revUsd - cogsUsd, marLbp: revLbp - cogsLbp };
  }, [data]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (warehouseId) params.set("warehouse_id", warehouseId);
      if (branchId) params.set("branch_id", branchId);
      const lim = Math.max(1, Math.min(2000, Math.floor(Number(limit || 500))));
      params.set("limit", String(lim));
      const [res, ws, bs] = await Promise.all([
        apiGet<Res>(`/reports/sales/margin-by-customer?${params.toString()}`),
        apiGet<{ warehouses: WarehouseRow[] }>("/warehouses").catch(() => ({ warehouses: [] as WarehouseRow[] })),
        apiGet<{ branches: BranchRow[] }>("/branches").catch(() => ({ branches: [] as BranchRow[] }))
      ]);
      setData(res);
      setWarehouses(ws.warehouses || []);
      setBranches(bs.branches || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [startDate, endDate, warehouseId, branchId, limit]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Margin by Customer</CardTitle>
          <CardDescription>Posted sales invoices, using stock moves for COGS.</CardDescription>
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
                <DialogDescription>Date range and optional dimensions.</DialogDescription>
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
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Warehouse</label>
                  <select className="ui-select w-full" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                    <option value="">All</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Branch</label>
                  <select className="ui-select w-full" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">All</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
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
          <CardTitle>Totals</CardTitle>
          <CardDescription>Sum across returned rows.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="text-xs text-fg-subtle">Revenue</div>
            <div className="mt-1 data-mono text-sm">{fmtUsd(totals.revUsd)}</div>
            <div className="data-mono text-xs text-fg-muted">{fmtLbp(totals.revLbp)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="text-xs text-fg-subtle">COGS</div>
            <div className="mt-1 data-mono text-sm">{fmtUsd(totals.cogsUsd)}</div>
            <div className="data-mono text-xs text-fg-muted">{fmtLbp(totals.cogsLbp)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="text-xs text-fg-subtle">Margin</div>
            <div className="mt-1 data-mono text-sm">{fmtUsd(totals.marUsd)}</div>
            <div className="data-mono text-xs text-fg-muted">{fmtLbp(totals.marLbp)}</div>
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
          <CardTitle>Customers</CardTitle>
          <CardDescription>Sorted by revenue (USD).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">COGS</th>
                  <th className="px-3 py-2 text-right">Margin</th>
                  <th className="px-3 py-2 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).map((r) => (
                  <tr key={r.customer_id} className="ui-tr-hover">
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-fg-muted">{r.customer_code || "-"}</span>
                        <ShortcutLink href={`/partners/customers/${encodeURIComponent(r.customer_id)}`} title="Open customer">
                          {r.customer_name || r.customer_id}
                        </ShortcutLink>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right data-mono text-xs">
                      {fmtUsd(r.revenue_usd)}
                      <div className="text-[11px] text-fg-muted">{fmtLbp(r.revenue_lbp)}</div>
                    </td>
                    <td className="px-3 py-2 text-right data-mono text-xs">
                      {fmtUsd(r.cogs_usd)}
                      <div className="text-[11px] text-fg-muted">{fmtLbp(r.cogs_lbp)}</div>
                    </td>
                    <td className="px-3 py-2 text-right data-mono text-xs">
                      {fmtUsd(r.margin_usd)}
                      <div className="text-[11px] text-fg-muted">{fmtLbp(r.margin_lbp)}</div>
                    </td>
                    <td className="px-3 py-2 text-right data-mono text-xs">{fmtPct(r.margin_pct_usd)}</td>
                  </tr>
                ))}
                {(data?.rows || []).length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                      No posted sales found for this range.
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

