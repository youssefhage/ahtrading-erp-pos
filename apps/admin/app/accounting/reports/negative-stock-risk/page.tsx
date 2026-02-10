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

type Row = {
  item_id: string;
  sku: string | null;
  item_name: string | null;
  warehouse_id: string;
  warehouse_name: string | null;
  on_hand_qty: string | number;
  avg_cost_usd: string | number;
  avg_cost_lbp: string | number;
  est_value_usd: string | number;
  est_value_lbp: string | number;
};

type Res = { rows: Row[] };

export default function NegativeStockRiskPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<Res | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState("2000");

  const totals = useMemo(() => {
    let valueUsd = 0;
    let valueLbp = 0;
    let qty = 0;
    for (const r of data?.rows || []) {
      valueUsd += Number(r.est_value_usd || 0);
      valueLbp += Number(r.est_value_lbp || 0);
      qty += Number(r.on_hand_qty || 0);
    }
    return { valueUsd, valueLbp, qty };
  }, [data]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const lim = Math.max(1, Math.min(20000, Math.floor(Number(limit || 2000))));
      const res = await apiGet<Res>(`/reports/inventory/negative-stock-risk?limit=${lim}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo((): Array<DataTableColumn<Row>> => {
    return [
      {
        id: "item",
        header: "Item",
        accessor: (r) => `${r.sku || ""} ${r.item_name || ""}`,
        cell: (r) => (
          <div className="text-xs">
            <div className="data-mono text-xs text-fg-muted">{r.sku || "-"}</div>
            <div>{r.item_name || "-"}</div>
          </div>
        ),
        sortable: true,
      },
      { id: "warehouse", header: "Warehouse", accessor: (r) => r.warehouse_name || r.warehouse_id, sortable: true },
      {
        id: "on_hand_qty",
        header: "On hand",
        accessor: (r) => Number(r.on_hand_qty || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-negative">{Number(r.on_hand_qty || 0).toLocaleString("en-US")}</span>,
      },
      {
        id: "avg_cost_usd",
        header: "Avg cost USD",
        accessor: (r) => Number(r.avg_cost_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.avg_cost_usd)}</span>,
      },
      {
        id: "avg_cost_lbp",
        header: "Avg cost LL",
        accessor: (r) => Number(r.avg_cost_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.avg_cost_lbp)}</span>,
      },
      {
        id: "est_value_usd",
        header: "Est value USD",
        accessor: (r) => Number(r.est_value_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.est_value_usd)}</span>,
      },
      {
        id: "est_value_lbp",
        header: "Est value LL",
        accessor: (r) => Number(r.est_value_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.est_value_lbp)}</span>,
      },
    ];
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Negative Stock Risk</CardTitle>
          <CardDescription>Detailed rows where on-hand quantity is negative.</CardDescription>
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
                <DialogDescription>Adjust the maximum rows returned.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Limit</label>
                  <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" />
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
          <CardDescription>{data?.rows?.length || 0} rows.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="text-xs text-fg-subtle">On-hand qty</div>
            <div className="mt-1 data-mono text-sm">{totals.qty.toLocaleString("en-US")}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="text-xs text-fg-subtle">Est value (USD)</div>
            <div className="mt-1 data-mono text-sm">{fmtUsd(totals.valueUsd)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="text-xs text-fg-subtle">Est value (LL)</div>
            <div className="mt-1 data-mono text-sm">{fmtLbp(totals.valueLbp)}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rows</CardTitle>
          <CardDescription>Investigate root causes before period close.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<Row>
            tableId="accounting.reports.negative_stock_risk"
            rows={data?.rows || []}
            columns={columns}
            initialSort={{ columnId: "on_hand_qty", dir: "asc" }}
            globalFilterPlaceholder="Search SKU / item / warehouse..."
            emptyText="No negative stock positions found."
          />
        </CardContent>
      </Card>
    </div>
  );
}
