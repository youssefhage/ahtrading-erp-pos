"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Supplier = { id: string; name: string };
type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };

type ReceiptRow = {
  id: string;
  receipt_no: string | null;
  supplier_id: string | null;
  warehouse_id: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
};

type LineDraft = {
  item_id: string;
  qty: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
};

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function GoodsReceiptsPage() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [status, setStatus] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("90000");
  const [lines, setLines] = useState<LineDraft[]>([{ item_id: "", qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0" }]);
  const [creating, setCreating] = useState(false);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function load() {
    setStatus("Loading...");
    try {
      const [r, s, i, w] = await Promise.all([
        apiGet<{ receipts: ReceiptRow[] }>("/purchases/receipts"),
        apiGet<{ suppliers: Supplier[] }>("/suppliers"),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses")
      ]);
      setReceipts(r.receipts || []);
      setSuppliers(s.suppliers || []);
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
  }, []);

  function addLine() {
    setLines((prev) => [...prev, { item_id: "", qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0" }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function createReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) {
      setStatus("supplier is required");
      return;
    }
    if (!warehouseId) {
      setStatus("warehouse is required");
      return;
    }
    const validLines = lines.filter((l) => l.item_id && toNum(l.qty) > 0);
    if (validLines.length === 0) {
      setStatus("at least one line is required");
      return;
    }
    setCreating(true);
    setStatus("Posting goods receipt...");
    try {
      const payload = {
        supplier_id: supplierId,
        exchange_rate: toNum(exchangeRate),
        warehouse_id: warehouseId,
        lines: validLines.map((l) => {
          const qty = toNum(l.qty);
          const unitUsd = toNum(l.unit_cost_usd);
          const unitLbp = toNum(l.unit_cost_lbp);
          return {
            item_id: l.item_id,
            qty,
            unit_cost_usd: unitUsd,
            unit_cost_lbp: unitLbp,
            line_total_usd: qty * unitUsd,
            line_total_lbp: qty * unitLbp
          };
        })
      };
      await apiPost("/purchases/receipts/direct", payload);
      setSupplierId("");
      setWarehouseId("");
      setLines([{ item_id: "", qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0" }]);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Goods Receipts">
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
            <CardTitle>Post Goods Receipt</CardTitle>
            <CardDescription>Creates stock moves + Inventory/GRNI journal.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createReceipt} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-slate-700">Supplier</label>
                  <select
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-slate-700">Warehouse</label>
                  <select
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                  >
                    <option value="">Select warehouse...</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-slate-700">Exchange Rate (USD→LBP)</label>
                  <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit USD</th>
                      <th className="px-3 py-2 text-right">Unit LBP</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <select
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                            value={l.item_id}
                            onChange={(e) => updateLine(idx, { item_id: e.target.value })}
                          >
                            <option value="">Select item...</option>
                            {items.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.sku} · {it.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input value={l.qty} onChange={(e) => updateLine(idx, { qty: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input value={l.unit_cost_usd} onChange={(e) => updateLine(idx, { unit_cost_usd: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input value={l.unit_cost_lbp} onChange={(e) => updateLine(idx, { unit_cost_lbp: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button type="button" variant="outline" size="sm" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={addLine}>
                  Add Line
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "..." : "Post Receipt"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Receipts</CardTitle>
            <CardDescription>{receipts.length} receipts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Receipt</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Warehouse</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Total USD</th>
                    <th className="px-3 py-2 text-right">Total LBP</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{r.receipt_no || r.id}</td>
                      <td className="px-3 py-2">{(r.supplier_id && supplierById.get(r.supplier_id)?.name) || r.supplier_id || "-"}</td>
                      <td className="px-3 py-2">{(r.warehouse_id && whById.get(r.warehouse_id)?.name) || r.warehouse_id || "-"}</td>
                      <td className="px-3 py-2">{r.status}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(r.total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(r.total_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {receipts.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                        No receipts.
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

