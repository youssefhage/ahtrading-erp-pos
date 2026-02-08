"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };

type MoveRow = {
  id: string;
  item_id: string;
  warehouse_id: string;
  batch_id: string | null;
  qty_in: string | number;
  qty_out: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
};

export default function InventoryMovementsPage() {
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [status, setStatus] = useState("");

  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [limit, setLimit] = useState("200");

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function load() {
    setStatus("Loading...");
    try {
      const qs = new URLSearchParams();
      if (itemId) qs.set("item_id", itemId);
      if (warehouseId) qs.set("warehouse_id", warehouseId);
      if (sourceType.trim()) qs.set("source_type", sourceType.trim());
      const n = Number(limit || 200);
      qs.set("limit", Number.isFinite(n) ? String(n) : "200");

      const [m, i, w] = await Promise.all([
        apiGet<{ moves: MoveRow[] }>(`/inventory/moves?${qs.toString()}`),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses")
      ]);
      setMoves(m.moves || []);
      setItems(i.items || []);
      setWarehouses(w.warehouses || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
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
            <CardTitle>Filters</CardTitle>
            <CardDescription>List the latest stock moves (most recent first).</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-slate-700">Item</label>
              <select
                className="ui-select"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                <option value="">All items</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.sku} · {it.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-slate-700">Warehouse</label>
              <select
                className="ui-select"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">All warehouses</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-slate-700">Source Type</label>
              <Input value={sourceType} onChange={(e) => setSourceType(e.target.value)} placeholder="sale / goods_receipt / cycle_count" />
            </div>
            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-slate-700">Limit</label>
              <Input value={limit} onChange={(e) => setLimit(e.target.value)} />
            </div>
            <div className="md:col-span-4 flex items-center justify-end">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Moves</CardTitle>
            <CardDescription>{moves.length} moves</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Warehouse</th>
                    <th className="px-3 py-2 text-right">In</th>
                    <th className="px-3 py-2 text-right">Out</th>
                    <th className="px-3 py-2 text-right">Unit USD</th>
                    <th className="px-3 py-2 text-right">Unit LBP</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m) => {
                    const it = itemById.get(m.item_id);
                    const wh = whById.get(m.warehouse_id);
                    return (
                      <tr key={m.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2 font-mono text-xs">{m.created_at}</td>
                        <td className="px-3 py-2">
                          {it ? (
                            <span>
                              <span className="font-mono text-xs">{it.sku}</span> · {it.name}
                            </span>
                          ) : (
                            <span className="font-mono text-xs">{m.item_id}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{wh?.name || m.warehouse_id}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {Number(m.qty_in || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {Number(m.qty_out || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {Number(m.unit_cost_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {Number(m.unit_cost_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs">{m.source_type || "-"}</span>
                          {m.source_id ? <div className="text-[10px] text-slate-500">{m.source_id}</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                  {moves.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                        No moves.
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
