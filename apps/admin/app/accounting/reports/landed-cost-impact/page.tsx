"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { DataTable, type DataTableColumn } from "@/components/data-table";
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
    const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthStartIso() {
  const d = new Date();
  d.setDate(1);
    const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
    setStatus("");
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

  const columns = useMemo((): Array<DataTableColumn<Row>> => {
    return [
      {
        id: "receipt",
        header: "Receipt",
        accessor: (r) => r.goods_receipt_no || r.goods_receipt_id,
        mono: true,
        sortable: true,
        cell: (r) => (
          <ShortcutLink href={`/purchasing/goods-receipts/${encodeURIComponent(r.goods_receipt_id)}`} title="Open goods receipt" className="data-mono text-xs">
            {r.goods_receipt_no || r.goods_receipt_id.slice(0, 8)}
          </ShortcutLink>
        ),
      },
      { id: "supplier_name", header: "Supplier", accessor: (r) => r.supplier_name || "-", sortable: true },
      {
        id: "receipt_total_usd",
        header: "Receipt total",
        accessor: (r) => Number(r.receipt_total_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => (
          <span className="data-mono ui-tone-usd">
            {fmtUsd(r.receipt_total_usd)}
            <div className="text-xs text-fg-muted">{fmtLbp(r.receipt_total_lbp)}</div>
          </span>
        ),
      },
      {
        id: "landed_cost_usd",
        header: "Landed cost",
        accessor: (r) => Number(r.landed_cost_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => (
          <span className="data-mono ui-tone-usd">
            {fmtUsd(r.landed_cost_usd)}
            <div className="text-xs text-fg-muted">{fmtLbp(r.landed_cost_lbp)}</div>
          </span>
        ),
      },
      {
        id: "landed_cost_docs",
        header: "Docs",
        accessor: (r) => Number(r.landed_cost_docs || 0),
        align: "right",
        mono: true,
        sortable: true,
      },
      {
        id: "posted",
        header: "First/Last Posted",
        accessor: (r) => `${r.first_posted_at || ""} ${r.last_posted_at || ""}`,
        sortable: true,
        globalSearch: false,
        cell: (r) => (
          <div className="text-xs">
            <div className="data-mono text-xs">{r.first_posted_at || "-"}</div>
            <div className="data-mono text-xs text-fg-muted">{r.last_posted_at || "-"}</div>
          </div>
        ),
      },
    ];
  }, []);

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
        <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="ui-kpi-card" data-tone="success">
            <div className="ui-kpi-label">Receipt Total</div>
            <div className="ui-kpi-value">{fmtUsd(totals.receiptUsd)}</div>
            <div className="ui-kpi-subvalue">{fmtLbp(totals.receiptLbp)}</div>
          </div>
          <div className="ui-kpi-card" data-tone="warning">
            <div className="ui-kpi-label">Landed Cost</div>
            <div className="ui-kpi-value">{fmtUsd(totals.landedUsd)}</div>
            <div className="ui-kpi-subvalue">{fmtLbp(totals.landedLbp)}</div>
          </div>
          <div className="ui-kpi-card" data-tone="info">
            <div className="ui-kpi-label">Period</div>
            <div className="mt-2 data-mono text-base font-semibold text-foreground">{data?.start_date || startDate}</div>
            <div className="data-mono text-sm font-medium text-fg-muted">{data?.end_date || endDate}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Goods Receipts</CardTitle>
          <CardDescription>Sorted by landed cost (USD).</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<Row>
            tableId="accounting.reports.landed_cost_impact"
            rows={data?.rows || []}
            columns={columns}
            initialSort={{ columnId: "landed_cost_usd", dir: "desc" }}
            globalFilterPlaceholder="Search receipt / supplier..."
            emptyText="No landed cost documents found for this period."
          />
        </CardContent>
      </Card>
    </div>
  );
}
