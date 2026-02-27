"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, ShoppingCart } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { FALLBACK_FX_RATE_USD_LBP } from "@/lib/constants";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Warehouse = { id: string; name: string };
type SuggestRow = {
  item_id: string; sku: string; name: string;
  supplier_id: string; supplier_name: string | null; warehouse_id: string;
  lead_time_days: number | string; min_order_qty: number | string; last_cost_usd: number | string;
  on_hand_qty: number | string; reserved_qty: number | string; available_qty: number | string; incoming_qty: number | string;
  avg_daily_qty: number | string; horizon_days: number | string; forecast_qty: number | string;
  safety_qty: number | string; needed_qty: number | string; reorder_qty: number | string; est_amount_usd: number | string;
};

function toNum(v: unknown) { const n = typeof v === "number" ? v : Number(String(v ?? "").trim() || 0); return Number.isFinite(n) ? n : 0; }
function fmt(n: unknown, digits = 3) { return toNum(n).toLocaleString("en-US", { maximumFractionDigits: digits }); }

export default function ReorderSuggestionsPage() {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<SuggestRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [windowDays, setWindowDays] = useState("28");
  const [reviewDays, setReviewDays] = useState("7");
  const [safetyDays, setSafetyDays] = useState("3");
  const [exchangeRate, setExchangeRate] = useState(String(FALLBACK_FX_RATE_USD_LBP));
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedRows = useMemo(() => rows.filter((r) => selected[r.item_id]), [rows, selected]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const loadBase = useCallback(async () => { const w = await apiGet<{ warehouses: Warehouse[] }>("/warehouses"); setWarehouses(w.warehouses || []); }, []);
  const primeExchangeRate = useCallback(async () => {
    try { const today = new Date().toISOString().slice(0, 10); const r = await getFxRateUsdToLbp({ rateDate: today, rateType: "market" }); const rate = Number(r?.usd_to_lbp || 0); if (Number.isFinite(rate) && rate > 0) setExchangeRate(String(rate)); } catch {}
  }, []);

  const loadSuggestions = useCallback(async (opts?: { refresh?: boolean }) => {
    const qs = new URLSearchParams();
    if (warehouseId) qs.set("warehouse_id", warehouseId);
    qs.set("window_days", String(Math.max(7, Math.min(365, Number(windowDays || 28)))));
    qs.set("review_days", String(Math.max(1, Math.min(90, Number(reviewDays || 7)))));
    qs.set("safety_days", String(Math.max(0, Math.min(90, Number(safetyDays || 3)))));
    if (opts?.refresh) qs.set("refresh", "true");
    const res = await apiGet<{ rows: SuggestRow[] }>(`/inventory/reorder-suggestions?${qs}`);
    setRows(res.rows || []); setSelected({});
  }, [reviewDays, safetyDays, warehouseId, windowDays]);

  useEffect(() => { Promise.all([loadBase(), primeExchangeRate()]).catch(() => {}); }, [loadBase, primeExchangeRate]);
  useEffect(() => { if (!warehouses.length || warehouseId) return; setWarehouseId(warehouses[0].id); }, [warehouses, warehouseId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (warehouseId) loadSuggestions().catch(() => {}); }, [warehouseId]);

  const createDraftPOs = useCallback(async () => {
    if (!warehouseId || !selectedRows.length) { setStatus("Select at least one row."); return; }
    setStatus("Creating draft POs...");
    try {
      const ex = Math.max(1, Number(exchangeRate || FALLBACK_FX_RATE_USD_LBP));
      const bySupplier = new Map<string, SuggestRow[]>();
      for (const r of selectedRows) { const sid = String(r.supplier_id || "").trim(); if (!sid) continue; bySupplier.set(sid, [...(bySupplier.get(sid) || []), r]); }
      const created: string[] = [];
      for (const [supplierId, lines] of bySupplier.entries()) {
        const res = await apiPost<{ id: string }>("/purchases/orders/drafts", {
          supplier_id: supplierId, warehouse_id: warehouseId, exchange_rate: ex,
          lines: lines.filter((l) => toNum(l.reorder_qty) > 0).map((l) => ({ item_id: l.item_id, qty: toNum(l.reorder_qty), unit_cost_usd: toNum(l.last_cost_usd), unit_cost_lbp: toNum(l.last_cost_usd) * ex })),
        });
        if (res?.id) created.push(res.id);
      }
      setStatus(created.length ? `Created ${created.length} draft PO(s).` : "No draft POs created.");
    } catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
  }, [exchangeRate, selectedRows, warehouseId]);

  const columns = useMemo<ColumnDef<SuggestRow>[]>(() => [
    {
      id: "pick", enableSorting: false, header: () => (
        <input type="checkbox" checked={rows.length > 0 && selectedRows.length === rows.length} onChange={(e) => { if (e.target.checked) { const n: Record<string, boolean> = {}; for (const r of rows) n[r.item_id] = true; setSelected(n); } else setSelected({}); }} />
      ),
      cell: ({ row }) => <input type="checkbox" checked={!!selected[row.original.item_id]} onChange={(e) => setSelected((p) => ({ ...p, [row.original.item_id]: e.target.checked }))} onClick={(e) => e.stopPropagation()} />,
    },
    {
      id: "item", accessorFn: (r) => `${r.sku || ""} ${r.name || ""}`,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => {
        const r = row.original; const wh = whById.get(r.warehouse_id);
        return (
          <div>
            <Link href={`/catalog/items/${encodeURIComponent(r.item_id)}`} className="hover:underline">
              <span className="font-mono text-xs">{r.sku}</span> {"\u00b7"} {r.name}
            </Link>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {wh?.name || r.warehouse_id}
              {toNum(r.reserved_qty) > 0 && <Badge variant="warning" className="text-xs">reserved {fmt(r.reserved_qty)}</Badge>}
            </div>
          </div>
        );
      },
    },
    {
      id: "supplier", accessorFn: (r) => r.supplier_name || r.supplier_id,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => (<div className="text-xs"><div>{row.original.supplier_name || row.original.supplier_id}</div><div className="text-muted-foreground">lead {row.original.lead_time_days}d {"\u00b7"} MOQ {fmt(row.original.min_order_qty, 2)}</div></div>),
    },
    { id: "avg", accessorFn: (r) => toNum(r.avg_daily_qty), header: ({ column }) => <DataTableColumnHeader column={column} title="Avg/Day" />, cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{fmt(row.original.avg_daily_qty, 4)}</span> },
    {
      id: "available", accessorFn: (r) => toNum(r.available_qty),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Available" />,
      cell: ({ row }) => { const a = toNum(row.original.available_qty); const ro = toNum(row.original.reorder_qty); return <span className={cn("font-mono text-sm", a <= 0 ? "text-destructive" : a < ro ? "text-warning" : "text-muted-foreground")}>{fmt(row.original.available_qty)}</span>; },
    },
    { id: "incoming", accessorFn: (r) => toNum(r.incoming_qty), header: ({ column }) => <DataTableColumnHeader column={column} title="Incoming" />, cell: ({ row }) => <span className={cn("font-mono text-sm", toNum(row.original.incoming_qty) > 0 ? "text-success" : "text-muted-foreground")}>{fmt(row.original.incoming_qty)}</span> },
    { id: "reorder", accessorFn: (r) => toNum(r.reorder_qty), header: ({ column }) => <DataTableColumnHeader column={column} title="Reorder" />, cell: ({ row }) => <span className={cn("font-mono text-sm", toNum(row.original.reorder_qty) > 0 ? "text-primary" : "text-muted-foreground")}>{fmt(row.original.reorder_qty)}</span> },
    { id: "est_usd", accessorFn: (r) => toNum(r.est_amount_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="Est USD" />, cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.est_amount_usd)} currency="USD" /> },
  ], [selected, selectedRows.length, rows, whById]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Reorder Suggestions"
        description="Forecast-driven draft PO builder based on sales history and lead time"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => loadSuggestions()} disabled={!warehouseId}>Apply</Button>
            <Button variant="outline" size="sm" onClick={() => loadSuggestions({ refresh: true })} disabled={!warehouseId}><RefreshCw className="mr-2 h-4 w-4" />Recompute</Button>
            <Button size="sm" onClick={createDraftPOs} disabled={!selectedRows.length}><ShoppingCart className="mr-2 h-4 w-4" />Create Draft PO(s)</Button>
          </>
        }
      />
      {status && <p className="text-sm text-destructive">{status}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Parameters</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Warehouse</label>
            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Window (days)</label><Input value={windowDays} onChange={(e) => setWindowDays(e.target.value)} inputMode="numeric" /></div>
          <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Review (days)</label><Input value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} inputMode="numeric" /></div>
          <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Safety (days)</label><Input value={safetyDays} onChange={(e) => setSafetyDays(e.target.value)} inputMode="numeric" /></div>
          <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">USD to LBP</label><Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} inputMode="decimal" /></div>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search item / supplier..."
        toolbarActions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { const n: Record<string, boolean> = {}; for (const r of rows) n[r.item_id] = true; setSelected(n); }} disabled={!rows.length}>Select All</Button>
            <Button variant="outline" size="sm" onClick={() => setSelected({})} disabled={!selectedRows.length}>Clear</Button>
            <Badge variant="outline">{selectedRows.length} selected</Badge>
          </div>
        }
      />

      <p className="text-xs text-muted-foreground">Tip: selections are grouped by supplier to create one draft PO per supplier.</p>
    </div>
  );
}
