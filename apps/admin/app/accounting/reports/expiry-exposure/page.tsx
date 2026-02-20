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

type WarehouseRow = { id: string; name: string };

type Row = {
  batch_id: string;
  batch_no: string | null;
  expiry_date: string | null;
  batch_status: string | null;
  days_to_expiry: number | string | null;
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

type Res = { days: number; warehouse_id: string | null; rows: Row[] };

export default function ExpiryExposurePage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<Res | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [warehouseId, setWarehouseId] = useState("");
  const [limit, setLimit] = useState("1000");

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
  const qtyTone = totals.qty > 0 ? "warning" : "info";
  const valueTone = totals.valueUsd > 0 ? "warning" : "info";

  const load = useCallback(async () => {
    setStatus("");
    try {
      const params = new URLSearchParams();
      const dd = Math.max(0, Math.min(3650, Math.floor(Number(days || 30))));
      const lim = Math.max(1, Math.min(5000, Math.floor(Number(limit || 1000))));
      params.set("days", String(dd));
      params.set("limit", String(lim));
      if (warehouseId) params.set("warehouse_id", warehouseId);
      const [res, ws] = await Promise.all([
        apiGet<Res>(`/reports/inventory/expiry-exposure?${params.toString()}`),
        apiGet<{ warehouses: WarehouseRow[] }>("/warehouses").catch(() => ({ warehouses: [] as WarehouseRow[] }))
      ]);
      setData(res);
      setWarehouses(ws.warehouses || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [days, warehouseId, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo((): Array<DataTableColumn<Row>> => {
    return [
      {
        id: "expiry",
        header: "Expiry",
        accessor: (r) => `${r.expiry_date || ""} ${r.days_to_expiry ?? ""}`,
        mono: true,
        sortable: true,
        globalSearch: false,
        cell: (r) => (
          <span className="data-mono text-xs">
            {r.expiry_date || "-"}
            <div className="text-xs text-fg-muted">{String(r.days_to_expiry ?? "-")}d</div>
          </span>
        ),
      },
      {
        id: "batch",
        header: "Batch",
        accessor: (r) => `${r.batch_no || ""} ${r.batch_status || ""}`,
        sortable: true,
        cell: (r) => (
          <div className="text-xs">
            <div className="data-mono text-xs">{r.batch_no || "-"}</div>
            <div className="text-xs text-fg-muted">{r.batch_status || ""}</div>
          </div>
        ),
      },
      {
        id: "item",
        header: "Item",
        accessor: (r) => `${r.sku || ""} ${r.item_name || ""}`,
        sortable: true,
        cell: (r) => (
          <div className="text-xs">
            <div className="data-mono text-xs text-fg-muted">{r.sku || "-"}</div>
            <div>{r.item_name || "-"}</div>
          </div>
        ),
      },
      { id: "warehouse", header: "Warehouse", accessor: (r) => r.warehouse_name || r.warehouse_id, sortable: true },
      {
        id: "on_hand_qty",
        header: "On hand",
        accessor: (r) => Number(r.on_hand_qty || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-qty">{Number(r.on_hand_qty || 0).toLocaleString("en-US")}</span>,
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
          <CardTitle>Expiry Exposure</CardTitle>
          <CardDescription>Batches expiring within N days with on-hand stock.</CardDescription>
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
                <DialogDescription>Days-to-expiry horizon and optional warehouse filter.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Days</label>
                  <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
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
          <CardDescription>
            {data?.rows?.length || 0} rows. Estimated value uses item warehouse average cost (v1).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="ui-kpi-card" data-tone={qtyTone}>
            <div className="ui-kpi-label">On-hand Qty</div>
            <div className="ui-kpi-value">{totals.qty.toLocaleString("en-US")}</div>
          </div>
          <div className="ui-kpi-card" data-tone={valueTone}>
            <div className="ui-kpi-label">Est Value (USD)</div>
            <div className="ui-kpi-value">{fmtUsd(totals.valueUsd)}</div>
          </div>
          <div className="ui-kpi-card" data-tone={valueTone}>
            <div className="ui-kpi-label">Est Value (LL)</div>
            <div className="ui-kpi-value">{fmtLbp(totals.valueLbp)}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rows</CardTitle>
          <CardDescription>
            Expiring within {data?.days ?? Number(days || 30)} days{warehouseId ? " (warehouse filtered)" : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<Row>
            tableId="accounting.reports.expiry_exposure"
            rows={data?.rows || []}
            columns={columns}
            initialSort={{ columnId: "expiry", dir: "asc" }}
            globalFilterPlaceholder="Search batch / SKU / item / warehouse..."
            emptyText="No expiring batches with on-hand stock found."
          />
        </CardContent>
      </Card>
    </div>
  );
}
