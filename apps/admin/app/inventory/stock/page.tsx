"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type StockRow = {
  item_id: string;
  warehouse_id: string;
  qty_on_hand: string | number;
};

type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };

export default function StockPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

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
    const needle = q.trim().toLowerCase();
    const out = rows.map((r) => {
      const it = itemById.get(r.item_id);
      const wh = whById.get(r.warehouse_id);
      return {
        ...r,
        sku: it?.sku || r.item_id,
        name: it?.name || "",
        warehouse_name: wh?.name || r.warehouse_id
      };
    });
    if (!needle) return out;
    return out.filter((r) => {
      return (
        r.sku.toLowerCase().includes(needle) ||
        r.name.toLowerCase().includes(needle) ||
        r.warehouse_name.toLowerCase().includes(needle)
      );
    });
  }, [rows, itemById, whById, q]);

  async function load() {
    setStatus("Loading...");
    try {
      const [stock, itemsRes, whRes] = await Promise.all([
        apiGet<{ stock: StockRow[] }>("/inventory/stock"),
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
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <AppShell title="Stock">
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
            <CardTitle>On Hand</CardTitle>
            <CardDescription>
              Aggregated from stock moves. {enriched.length} rows
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-96">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item or warehouse..." />
              </div>
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Warehouse</th>
                    <th className="px-3 py-2 text-right">Qty On Hand</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.map((r) => (
                    <tr key={`${r.item_id}:${r.warehouse_id}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                      <td className="px-3 py-2">{r.name || <span className="text-slate-500">Unknown</span>}</td>
                      <td className="px-3 py-2">{r.warehouse_name}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(r.qty_on_hand || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                      </td>
                    </tr>
                  ))}
                  {enriched.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                        No stock rows yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

