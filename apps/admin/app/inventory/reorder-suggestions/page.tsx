"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Warehouse = { id: string; name: string };

type SuggestRow = {
  item_id: string;
  sku: string;
  name: string;
  supplier_id: string;
  supplier_name: string | null;
  warehouse_id: string;

  lead_time_days: number | string;
  min_order_qty: number | string;
  last_cost_usd: number | string;

  on_hand_qty: number | string;
  reserved_qty: number | string;
  available_qty: number | string;
  incoming_qty: number | string;

  avg_daily_qty: number | string;
  horizon_days: number | string;
  forecast_qty: number | string;
  safety_qty: number | string;
  needed_qty: number | string;
  reorder_qty: number | string;
  est_amount_usd: number | string;
};

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim() || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: unknown, digits = 3) {
  const v = toNum(n);
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export default function ReorderSuggestionsPage() {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<SuggestRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [q, setQ] = useState("");

  const [windowDays, setWindowDays] = useState("28");
  const [reviewDays, setReviewDays] = useState("7");
  const [safetyDays, setSafetyDays] = useState("3");
  const [exchangeRate, setExchangeRate] = useState("90000");

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedRows = useMemo(() => rows.filter((r) => selected[r.item_id]), [rows, selected]);

  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const loadBase = useCallback(async () => {
    const w = await apiGet<{ warehouses: Warehouse[] }>("/warehouses");
    setWarehouses(w.warehouses || []);
  }, []);

  const primeExchangeRate = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const r = await getFxRateUsdToLbp({ rateDate: today, rateType: "market" });
      const rate = Number(r?.usd_to_lbp || 0);
      if (Number.isFinite(rate) && rate > 0) setExchangeRate(String(rate));
    } catch {
      // ignore
    }
  }, []);

  const loadSuggestions = useCallback(
    async (opts?: { refresh?: boolean }) => {
      const wd = Math.max(7, Math.min(365, Number(windowDays || 28)));
      const rd = Math.max(1, Math.min(90, Number(reviewDays || 7)));
      const sd = Math.max(0, Math.min(90, Number(safetyDays || 3)));
      const qs = new URLSearchParams();
      if (warehouseId) qs.set("warehouse_id", warehouseId);
      qs.set("window_days", String(wd));
      qs.set("review_days", String(rd));
      qs.set("safety_days", String(sd));
      if (opts?.refresh) qs.set("refresh", "true");
      const res = await apiGet<{ rows: SuggestRow[] }>(`/inventory/reorder-suggestions?${qs.toString()}`);
      setRows(res.rows || []);
      setSelected({});
    },
    [reviewDays, safetyDays, warehouseId, windowDays]
  );

  const loadAll = useCallback(async () => {
    setStatus("Loading...");
    try {
      await Promise.all([loadBase(), primeExchangeRate()]);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [loadBase, primeExchangeRate]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!warehouses.length) return;
    if (!warehouseId) setWarehouseId(warehouses[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses.length]);

  useEffect(() => {
    if (!warehouseId) return;
    loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  const createDraftPOs = useCallback(async () => {
    if (!warehouseId) {
      setStatus("Pick a warehouse first.");
      return;
    }
    if (!selectedRows.length) {
      setStatus("Select at least one row.");
      return;
    }
    setStatus("Creating draft purchase orders...");
    try {
      const ex = Math.max(1, Number(exchangeRate || 90000));

      const bySupplier = new Map<string, SuggestRow[]>();
      for (const r of selectedRows) {
        const sid = String(r.supplier_id || "").trim();
        if (!sid) continue;
        const list = bySupplier.get(sid) || [];
        list.push(r);
        bySupplier.set(sid, list);
      }

      const created: string[] = [];
      for (const [supplierId, lines] of bySupplier.entries()) {
        const payload = {
          supplier_id: supplierId,
          warehouse_id: warehouseId,
          exchange_rate: ex,
          lines: lines
            .filter((l) => toNum(l.reorder_qty) > 0)
            .map((l) => {
              const unitUsd = toNum(l.last_cost_usd);
              return {
                item_id: l.item_id,
                qty: toNum(l.reorder_qty),
                unit_cost_usd: unitUsd,
                unit_cost_lbp: unitUsd * ex,
              };
            }),
        };
        const res = await apiPost<{ id: string }>("/purchases/orders/drafts", payload);
        if (res?.id) created.push(res.id);
      }

      setStatus(created.length ? `Created ${created.length} draft PO(s).` : "No draft POs created (missing supplier links?).");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [exchangeRate, selectedRows, warehouseId]);

  const columns = useMemo((): Array<DataTableColumn<SuggestRow>> => {
    return [
      {
        id: "pick",
        header: "Pick",
        sortable: false,
        accessor: (r) => (selected[r.item_id] ? 1 : 0),
        cell: (r) => (
          <input
            type="checkbox"
            checked={!!selected[r.item_id]}
            onChange={(e) => setSelected((prev) => ({ ...prev, [r.item_id]: e.target.checked }))}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (r) => `${r.sku || ""} ${r.name || ""}`,
        cell: (r) => {
          const wh = whById.get(r.warehouse_id);
          return (
            <div>
              <ShortcutLink href={`/catalog/items/${encodeURIComponent(r.item_id)}`} title="Open item">
                <span className="font-mono text-xs">{r.sku}</span> · {r.name}
              </ShortcutLink>
              <div className="mt-1 text-[11px] text-fg-muted">
                {wh?.name || r.warehouse_id}
                {toNum(r.reserved_qty) > 0 ? (
                  <span className="ml-2">
                    <span className="ui-chip ui-chip-warning px-2 py-0.5 text-[10px]">reserved {fmt(r.reserved_qty)}</span>
                  </span>
                ) : null}
              </div>
            </div>
          );
        },
      },
      {
        id: "supplier",
        header: "Supplier",
        sortable: true,
        accessor: (r) => `${r.supplier_name || ""} ${r.supplier_id || ""}`,
        cell: (r) => (
          <div className="text-xs">
            <div>{r.supplier_name || r.supplier_id}</div>
            <div className="mt-1 text-[11px] text-fg-muted">
              lead {String(r.lead_time_days || 0)}d · MOQ {fmt(r.min_order_qty, 2)}
            </div>
          </div>
        ),
      },
      {
        id: "avg_daily_qty",
        header: "Avg/Day",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => toNum(r.avg_daily_qty),
        cell: (r) => <span className="font-mono text-xs text-fg-muted">{fmt(r.avg_daily_qty, 4)}</span>,
      },
      {
        id: "horizon_days",
        header: "Horizon",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => toNum(r.horizon_days),
        cell: (r) => <span className="font-mono text-xs text-fg-muted">{String(r.horizon_days || "-")}</span>,
      },
      {
        id: "available_qty",
        header: "Available",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => toNum(r.available_qty),
        cell: (r) => {
          const avail = toNum(r.available_qty);
          const reorder = toNum(r.reorder_qty);
          return (
            <span
              className={cn("font-mono text-xs", avail <= 0 ? "text-danger" : avail < reorder ? "text-warning" : "text-fg-muted")}
              title={`On hand: ${fmt(r.on_hand_qty)} · Reserved: ${fmt(r.reserved_qty)}`}
            >
              {fmt(r.available_qty)}
            </span>
          );
        },
      },
      {
        id: "incoming_qty",
        header: "Incoming",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => toNum(r.incoming_qty),
        cell: (r) => (
          <span className={cn("font-mono text-xs", toNum(r.incoming_qty) > 0 ? "text-success" : "text-fg-muted")}>{fmt(r.incoming_qty)}</span>
        ),
      },
      {
        id: "reorder_qty",
        header: "Reorder",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => toNum(r.reorder_qty),
        cell: (r) => (
          <span className={cn("font-mono text-xs", toNum(r.reorder_qty) > 0 ? "text-primary" : "text-fg-muted")}>{fmt(r.reorder_qty)}</span>
        ),
      },
      {
        id: "est_amount_usd",
        header: "Est USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => toNum(r.est_amount_usd),
        cell: (r) => <span className="font-mono text-xs text-fg-muted">{fmt(r.est_amount_usd, 2)}</span>,
      },
    ];
  }, [selected, whById]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={() => loadSuggestions()} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Reorder Suggestions</CardTitle>
          <CardDescription>Forecast-driven draft PO builder, based on sales history + lead time (no AI model required).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Warehouse</label>
              <select
                className="h-9 w-full rounded-md border border-border bg-bg-elevated px-3 text-sm"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Window (days)</label>
              <Input value={windowDays} onChange={(e) => setWindowDays(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Review (days)</label>
              <Input value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Safety (days)</label>
              <Input value={safetyDays} onChange={(e) => setSafetyDays(e.target.value)} inputMode="numeric" />
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full md:w-64 space-y-1">
              <label className="text-xs font-medium text-fg-muted">USD to LBP (for draft PO unit_cost_lbp)</label>
              <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} inputMode="decimal" />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => loadSuggestions()} disabled={!warehouseId}>
                Apply
              </Button>
              <Button variant="outline" onClick={() => loadSuggestions({ refresh: true })} disabled={!warehouseId}>
                Refresh (recompute)
              </Button>
              <Button onClick={createDraftPOs} disabled={!selectedRows.length}>
                Create Draft PO(s)
              </Button>
            </div>
          </div>

          <DataTable<SuggestRow>
            tableId="inventory.reorder_suggestions"
            rows={rows}
            columns={columns}
            getRowId={(r) => r.item_id}
            emptyText="No suggestions. Try a longer window, or click Refresh (recompute)."
            globalFilterValue={q}
            onGlobalFilterValueChange={setQ}
            globalFilterPlaceholder="Search item / supplier"
            initialSort={{ columnId: "est_amount_usd", dir: "desc" }}
            actions={
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    for (const r of rows) next[r.item_id] = true;
                    setSelected(next);
                  }}
                  disabled={!rows.length}
                >
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelected({})} disabled={!selectedRows.length}>
                  Clear
                </Button>
              </div>
            }
          />

          <div className="text-xs text-fg-muted">Tip: selections are grouped by supplier to create one draft PO per supplier. Quantities are suggestions only.</div>
        </CardContent>
      </Card>
    </div>
  );
}
