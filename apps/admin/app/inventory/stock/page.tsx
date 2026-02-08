"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";

type StockRow = {
  item_id: string;
  warehouse_id: string;
  batch_id?: string | null;
  batch_no?: string | null;
  expiry_date?: string | null;
  qty_on_hand: string | number;
};

type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };
type EnrichedRow = StockRow & { sku: string; name: string; warehouse_name: string };

export default function StockPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [status, setStatus] = useState("");
  const [byBatch, setByBatch] = useState(false);

  const itemById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of items) m.set(i.id, i);
    return m;
  }, [items]);

  const whById = useMemo(() => {
    const m = new Map<string, Warehouse>();
    for (const w of warehouses) m.set(w.id, w);
    return m;
  }, [warehouses]);

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const it = itemById.get(r.item_id);
      const wh = whById.get(r.warehouse_id);
      return {
        ...r,
        sku: it?.sku || r.item_id,
        name: it?.name || "",
        warehouse_name: wh?.name || r.warehouse_id
      };
    });
  }, [rows, itemById, whById]);

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<EnrichedRow>> = [
      { id: "sku", header: "SKU", sortable: true, mono: true },
      { id: "name", header: "Item", sortable: true },
      { id: "warehouse_name", header: "Warehouse", sortable: true },
    ];
    if (byBatch) {
      cols.push({
        id: "batch",
        header: "Batch",
        sortable: true,
        mono: true,
        accessor: (r) => r.batch_no || "",
        cell: (r) => (
          <>
            {(r.batch_no as any) || "-"}
            {r.expiry_date ? ` · ${String(r.expiry_date).slice(0, 10)}` : ""}
          </>
        ),
      });
    }
    cols.push({
      id: "qty_on_hand",
      header: "Qty On Hand",
      sortable: true,
      align: "right",
      mono: true,
      accessor: (r) => Number((r as any).qty_on_hand || 0),
      cell: (r) => Number((r as any).qty_on_hand || 0).toLocaleString("en-US", { maximumFractionDigits: 3 }),
      cellClassName: (r) => {
        const n = Number((r as any).qty_on_hand || 0);
        if (n < 0) return "text-red-600";
        if (n === 0) return "text-fg-subtle";
        return "text-foreground";
      },
    });
    return cols;
  }, [byBatch]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [stock, itemsRes, whRes] = await Promise.all([
        apiGet<{ stock: StockRow[] }>(`/inventory/stock?by_batch=${byBatch ? "true" : "false"}`),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses")
      ]);
      setRows(stock.stock || []);
      setItems(itemsRes.items || []);
      setWarehouses(whRes.warehouses || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [byBatch]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>On Hand</CardTitle>
            <CardDescription>
              Aggregated from stock moves. {enriched.length} rows
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DataTable
              tableId={byBatch ? "inventory.stock.byBatch" : "inventory.stock"}
              rows={enriched}
              columns={columns}
              getRowId={(r) => `${(r as any).item_id}:${(r as any).warehouse_id}:${(r as any).batch_id || ""}`}
              emptyText="No stock rows yet."
              globalFilterPlaceholder="Search item, SKU, warehouse..."
              actions={
                <>
                  <label className="flex items-center gap-2 text-xs text-fg-muted">
                    <input type="checkbox" checked={byBatch} onChange={(e) => setByBatch(e.target.checked)} />
                    By batch
                  </label>
                  <Button variant="outline" size="sm" onClick={load}>
                    Refresh
                  </Button>
                </>
              }
            />
          </CardContent>
        </Card>
      </div>);
}
