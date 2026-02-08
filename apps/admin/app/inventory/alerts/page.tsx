"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };

type ExpiryRow = {
  item_id: string;
  warehouse_id: string;
  batch_id: string;
  batch_no: string | null;
  expiry_date: string | null;
  status?: string | null;
  hold_reason?: string | null;
  qty_on_hand: string | number;
};

type ReorderRow = {
  item_id: string;
  sku: string;
  name: string;
  reorder_point: string | number;
  reorder_qty: string | number;
  warehouse_id: string;
  qty_on_hand: string | number;
};

type AiRecRow = {
  id: string;
  agent_code: string;
  status: string;
  recommendation_json: any;
  created_at: string;
};

export default function InventoryAlertsPage() {
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [aiExpiryOps, setAiExpiryOps] = useState<AiRecRow[]>([]);

  const [days, setDays] = useState("30");
  const [expiry, setExpiry] = useState<ExpiryRow[]>([]);
  const [reorder, setReorder] = useState<ReorderRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function loadBase() {
    const [i, w] = await Promise.all([apiGet<{ items: Item[] }>("/items"), apiGet<{ warehouses: Warehouse[] }>("/warehouses")]);
    setItems(i.items || []);
    setWarehouses(w.warehouses || []);
  }

  async function loadExpiry() {
    const n = Math.max(1, Math.min(3650, Number(days || 30)));
    const res = await apiGet<{ rows: ExpiryRow[] }>(`/inventory/expiry-alerts?days=${encodeURIComponent(String(n))}`);
    setExpiry(res.rows || []);
  }

  async function loadReorder() {
    const qs = new URLSearchParams();
    if (warehouseId) qs.set("warehouse_id", warehouseId);
    const res = await apiGet<{ rows: ReorderRow[] }>(`/inventory/reorder-alerts${qs.toString() ? `?${qs.toString()}` : ""}`);
    setReorder(res.rows || []);
  }

  async function loadAi() {
    // AI is optional: don't block the alerts page if ai:read is missing.
    try {
      const ai = await apiGet<{ recommendations: AiRecRow[] }>("/ai/recommendations?status=pending&agent_code=AI_EXPIRY_OPS&limit=12");
      setAiExpiryOps(ai.recommendations || []);
    } catch {
      setAiExpiryOps([]);
    }
  }

  async function loadAll() {
    setStatus("Loading...");
    try {
      await loadBase();
      await Promise.all([loadExpiry(), loadReorder(), loadAi()]);
      setStatus("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadReorder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

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

        {aiExpiryOps.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI: Expiry Ops</CardTitle>
              <CardDescription>{aiExpiryOps.length} pending suggestions (batches expiring soon with stock on hand).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Expiry</th>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Warehouse</th>
                      <th className="px-3 py-2">Batch</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiExpiryOps.slice(0, 8).map((r) => {
                      const j = (r as any).recommendation_json || {};
                      return (
                        <tr key={r.id} className="border-t border-border-subtle align-top">
                          <td className="px-3 py-2 font-mono text-xs text-fg-muted">{String(j.expiry_date || "").slice(0, 10) || "-"}</td>
                          <td className="px-3 py-2">
                            <div className="font-mono text-xs">{j.sku || "-"}</div>
                            <div className="text-xs text-fg-muted">{j.item_name || ""}</div>
                          </td>
                          <td className="px-3 py-2 text-xs">{j.warehouse_name || j.warehouse_id || "-"}</td>
                          <td className="px-3 py-2 font-mono text-xs">{j.batch_no || "-"}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{String(j.qty_on_hand || "0")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <Button asChild variant="outline" size="sm">
                  <a href="/automation/ai-hub">Open AI Hub</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={loadAll}>
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Expiry Alerts</CardTitle>
            <CardDescription>Batches expiring soon that still have stock.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="w-full md:w-64 space-y-1">
                <label className="text-xs font-medium text-fg-muted">Days Ahead</label>
                <Input value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
              <Button variant="outline" onClick={loadExpiry}>
                Apply
              </Button>
            </div>
            <div className="ui-table-wrap">
              <table className="ui-table">
	                <thead className="ui-thead">
	                  <tr>
	                    <th className="px-3 py-2">Expiry</th>
	                    <th className="px-3 py-2">Item</th>
	                    <th className="px-3 py-2">Warehouse</th>
	                    <th className="px-3 py-2">Batch</th>
	                    <th className="px-3 py-2">Status</th>
	                    <th className="px-3 py-2 text-right">Qty</th>
	                  </tr>
	                </thead>
                <tbody>
                  {expiry.map((r) => {
                    const it = itemById.get(r.item_id);
                    const wh = whById.get(r.warehouse_id);
                    return (
                      <tr key={`${r.batch_id}:${r.warehouse_id}`} className="ui-tr-hover">
                        <td className="px-3 py-2 font-mono text-xs">{(r.expiry_date || "").slice(0, 10) || "-"}</td>
                        <td className="px-3 py-2">
                          {it ? (
                            <span>
                              <span className="font-mono text-xs">{it.sku}</span> · {it.name}
                            </span>
                          ) : (
                            <span className="font-mono text-xs">{r.item_id}</span>
                          )}
                        </td>
	                        <td className="px-3 py-2">{wh?.name || r.warehouse_id}</td>
	                        <td className="px-3 py-2 font-mono text-xs">{r.batch_no || "-"}</td>
	                        <td className="px-3 py-2 text-xs">
	                          <span className="rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-[10px] text-fg-muted">
	                            {(r.status as any) || "available"}
	                          </span>
	                          {r.hold_reason ? <span className="ml-2 text-[10px] text-fg-subtle">{r.hold_reason}</span> : null}
	                        </td>
	                        <td className="px-3 py-2 text-right font-mono text-xs">
	                          {Number(r.qty_on_hand || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
	                        </td>
	                      </tr>
                    );
                  })}
	                  {expiry.length === 0 ? (
	                    <tr>
	                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
	                        No expiring batches found.
	                      </td>
	                    </tr>
	                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reorder Alerts</CardTitle>
            <CardDescription>Items below reorder point.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="w-full md:w-96 space-y-1">
                <label className="text-xs font-medium text-fg-muted">Warehouse (optional)</label>
                <select className="ui-select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">All warehouses</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button variant="outline" onClick={loadReorder}>
                Refresh
              </Button>
            </div>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Warehouse</th>
                    <th className="px-3 py-2 text-right">On Hand</th>
                    <th className="px-3 py-2 text-right">Reorder Point</th>
                    <th className="px-3 py-2 text-right">Reorder Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {reorder.map((r) => (
                    <tr key={`${r.item_id}:${r.warehouse_id}`} className="ui-tr-hover">
                      <td className="px-3 py-2">
                        <span>
                          <span className="font-mono text-xs">{r.sku}</span> · {r.name}
                        </span>
                      </td>
                      <td className="px-3 py-2">{whById.get(r.warehouse_id)?.name || r.warehouse_id}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(r.qty_on_hand || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(r.reorder_point || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(r.reorder_qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                      </td>
                    </tr>
                  ))}
                  {reorder.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                        No reorder alerts.
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
