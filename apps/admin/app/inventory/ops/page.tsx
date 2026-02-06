"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };

type AdjustDraft = {
  item_id: string;
  warehouse_id: string;
  qty_in: string;
  qty_out: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
  reason: string;
};

type TransferDraft = {
  item_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  qty: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
  reason: string;
};

type CycleCountLineDraft = { item_id: string; counted_qty: string };

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function InventoryOpsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [status, setStatus] = useState("");

  const [adjust, setAdjust] = useState<AdjustDraft>({
    item_id: "",
    warehouse_id: "",
    qty_in: "0",
    qty_out: "0",
    unit_cost_usd: "0",
    unit_cost_lbp: "0",
    reason: ""
  });

  const [transfer, setTransfer] = useState<TransferDraft>({
    item_id: "",
    from_warehouse_id: "",
    to_warehouse_id: "",
    qty: "1",
    unit_cost_usd: "0",
    unit_cost_lbp: "0",
    reason: ""
  });

  const [cycleWarehouseId, setCycleWarehouseId] = useState("");
  const [cycleReason, setCycleReason] = useState("");
  const [cycleLines, setCycleLines] = useState<CycleCountLineDraft[]>([{ item_id: "", counted_qty: "0" }]);

  const [submitting, setSubmitting] = useState<string>("");

  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function load() {
    setStatus("Loading...");
    try {
      const [i, w] = await Promise.all([
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses")
      ]);
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

  function addCycleLine() {
    setCycleLines((prev) => [...prev, { item_id: "", counted_qty: "0" }]);
  }

  function removeCycleLine(idx: number) {
    setCycleLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateCycleLine(idx: number, patch: Partial<CycleCountLineDraft>) {
    setCycleLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function submitAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!adjust.item_id) return setStatus("item is required");
    if (!adjust.warehouse_id) return setStatus("warehouse is required");
    const qtyIn = toNum(adjust.qty_in);
    const qtyOut = toNum(adjust.qty_out);
    if (qtyIn <= 0 && qtyOut <= 0) return setStatus("qty_in or qty_out must be > 0");
    if (qtyIn > 0 && qtyOut > 0) return setStatus("qty_in and qty_out cannot both be > 0");

    setSubmitting("adjust");
    setStatus("Posting adjustment...");
    try {
      await apiPost("/inventory/adjust", {
        item_id: adjust.item_id,
        warehouse_id: adjust.warehouse_id,
        qty_in: qtyIn,
        qty_out: qtyOut,
        unit_cost_usd: toNum(adjust.unit_cost_usd),
        unit_cost_lbp: toNum(adjust.unit_cost_lbp),
        reason: adjust.reason || undefined
      });
      setAdjust((prev) => ({ ...prev, qty_in: "0", qty_out: "0", unit_cost_usd: "0", unit_cost_lbp: "0", reason: "" }));
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSubmitting("");
    }
  }

  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!transfer.item_id) return setStatus("item is required");
    if (!transfer.from_warehouse_id) return setStatus("from warehouse is required");
    if (!transfer.to_warehouse_id) return setStatus("to warehouse is required");
    if (transfer.from_warehouse_id === transfer.to_warehouse_id) return setStatus("warehouses must differ");
    const qty = toNum(transfer.qty);
    if (qty <= 0) return setStatus("qty must be > 0");

    setSubmitting("transfer");
    setStatus("Posting transfer...");
    try {
      await apiPost("/inventory/transfer", {
        item_id: transfer.item_id,
        from_warehouse_id: transfer.from_warehouse_id,
        to_warehouse_id: transfer.to_warehouse_id,
        qty,
        unit_cost_usd: toNum(transfer.unit_cost_usd),
        unit_cost_lbp: toNum(transfer.unit_cost_lbp),
        reason: transfer.reason || undefined
      });
      setTransfer((prev) => ({ ...prev, qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0", reason: "" }));
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSubmitting("");
    }
  }

  async function submitCycleCount(e: React.FormEvent) {
    e.preventDefault();
    if (!cycleWarehouseId) return setStatus("warehouse is required");
    const validLines = cycleLines.filter((l) => l.item_id);
    if (validLines.length === 0) return setStatus("at least one line is required");

    setSubmitting("cycle");
    setStatus("Posting cycle count...");
    try {
      await apiPost("/inventory/cycle-count", {
        warehouse_id: cycleWarehouseId,
        reason: cycleReason || undefined,
        lines: validLines.map((l) => ({
          item_id: l.item_id,
          counted_qty: toNum(l.counted_qty)
        }))
      });
      setCycleReason("");
      setCycleLines([{ item_id: "", counted_qty: "0" }]);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSubmitting("");
    }
  }

  return (
    <AppShell title="Inventory Ops">
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

        <div className="flex items-center justify-end">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Inventory Adjustment</CardTitle>
            <CardDescription>
              Creates a stock move + GL posting (Inventory vs INV_ADJ). If unit cost is 0, server uses current moving-average cost.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitAdjust} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Item</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={adjust.item_id}
                  onChange={(e) => setAdjust((p) => ({ ...p, item_id: e.target.value }))}
                >
                  <option value="">Select item...</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.sku} · {it.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Warehouse</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={adjust.warehouse_id}
                  onChange={(e) => setAdjust((p) => ({ ...p, warehouse_id: e.target.value }))}
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
                <label className="text-xs font-medium text-slate-700">Qty In</label>
                <Input value={adjust.qty_in} onChange={(e) => setAdjust((p) => ({ ...p, qty_in: e.target.value }))} />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Qty Out</label>
                <Input value={adjust.qty_out} onChange={(e) => setAdjust((p) => ({ ...p, qty_out: e.target.value }))} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Unit Cost USD</label>
                <Input value={adjust.unit_cost_usd} onChange={(e) => setAdjust((p) => ({ ...p, unit_cost_usd: e.target.value }))} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Unit Cost LBP</label>
                <Input value={adjust.unit_cost_lbp} onChange={(e) => setAdjust((p) => ({ ...p, unit_cost_lbp: e.target.value }))} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Reason (optional)</label>
                <Input value={adjust.reason} onChange={(e) => setAdjust((p) => ({ ...p, reason: e.target.value }))} placeholder="shrinkage / damaged / correction" />
              </div>
              <div className="md:col-span-6">
                <Button type="submit" disabled={submitting === "adjust"}>
                  {submitting === "adjust" ? "..." : "Post Adjustment"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Warehouse Transfer</CardTitle>
            <CardDescription>
              Moves stock between warehouses (no GL impact). If cost is 0, server uses current moving-average cost from the source warehouse.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitTransfer} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Item</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={transfer.item_id}
                  onChange={(e) => setTransfer((p) => ({ ...p, item_id: e.target.value }))}
                >
                  <option value="">Select item...</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.sku} · {it.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">From Warehouse</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={transfer.from_warehouse_id}
                  onChange={(e) => setTransfer((p) => ({ ...p, from_warehouse_id: e.target.value }))}
                >
                  <option value="">Select warehouse...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">To Warehouse</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={transfer.to_warehouse_id}
                  onChange={(e) => setTransfer((p) => ({ ...p, to_warehouse_id: e.target.value }))}
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
                <label className="text-xs font-medium text-slate-700">Qty</label>
                <Input value={transfer.qty} onChange={(e) => setTransfer((p) => ({ ...p, qty: e.target.value }))} />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Reason (optional)</label>
                <Input value={transfer.reason} onChange={(e) => setTransfer((p) => ({ ...p, reason: e.target.value }))} placeholder="putaway / rebalancing" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Unit Cost USD (optional)</label>
                <Input value={transfer.unit_cost_usd} onChange={(e) => setTransfer((p) => ({ ...p, unit_cost_usd: e.target.value }))} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Unit Cost LBP (optional)</label>
                <Input value={transfer.unit_cost_lbp} onChange={(e) => setTransfer((p) => ({ ...p, unit_cost_lbp: e.target.value }))} />
              </div>
              <div className="md:col-span-6">
                <Button type="submit" disabled={submitting === "transfer"}>
                  {submitting === "transfer" ? "..." : "Post Transfer"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cycle Count</CardTitle>
            <CardDescription>
              Adjusts on-hand quantities to counted values for a warehouse and posts Inventory vs INV_ADJ.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitCycleCount} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-slate-700">Warehouse</label>
                  <select
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={cycleWarehouseId}
                    onChange={(e) => setCycleWarehouseId(e.target.value)}
                  >
                    <option value="">Select warehouse...</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Reason (optional)</label>
                  <Input value={cycleReason} onChange={(e) => setCycleReason(e.target.value)} placeholder="month-end count / spot check" />
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Counted Qty</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleLines.map((l, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <select
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                            value={l.item_id}
                            onChange={(e) => updateCycleLine(idx, { item_id: e.target.value })}
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
                          <Input value={l.counted_qty} onChange={(e) => updateCycleLine(idx, { counted_qty: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removeCycleLine(idx)}
                            disabled={cycleLines.length <= 1}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={addCycleLine}>
                  Add Line
                </Button>
                <Button type="submit" disabled={submitting === "cycle"}>
                  {submitting === "cycle" ? "..." : "Post Cycle Count"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

