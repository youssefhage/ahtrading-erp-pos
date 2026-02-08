"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type Supplier = { id: string; name: string };
type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };

type PurchaseOrderRow = {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
};

type PurchaseOrderLine = {
  id: string;
  item_id: string;
  qty: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

type OrderDetail = {
  order: PurchaseOrderRow & { exchange_rate: string | number };
  lines: PurchaseOrderLine[];
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

function PurchaseOrdersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qsOrderId = searchParams.get("id") || "";

  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [orderId, setOrderId] = useState("");
  const [detail, setDetail] = useState<OrderDetail | null>(null);

  const [draftOpen, setDraftOpen] = useState(false);
  const [draftEditId, setDraftEditId] = useState<string>("");
  const [draftSaving, setDraftSaving] = useState(false);

  const [draftSupplierId, setDraftSupplierId] = useState("");
  const [draftExchangeRate, setDraftExchangeRate] = useState("90000");
  const [draftLines, setDraftLines] = useState<LineDraft[]>([]);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveWarehouseId, setReceiveWarehouseId] = useState("");
  const [receiving, setReceiving] = useState(false);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const filteredOrders = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (orders || []).filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (!needle) return true;
      const no = (o.order_no || "").toLowerCase();
      const sup = o.supplier_id ? (supplierById.get(o.supplier_id)?.name || "").toLowerCase() : "";
      return no.includes(needle) || sup.includes(needle) || o.id.toLowerCase().includes(needle);
    });
  }, [orders, q, statusFilter, supplierById]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [o, s, i, w] = await Promise.all([
        apiGet<{ orders: PurchaseOrderRow[] }>("/purchases/orders"),
        apiGet<{ suppliers: Supplier[] }>("/suppliers"),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses")
      ]);
      setOrders(o.orders || []);
      setSuppliers(s.suppliers || []);
      setItems(i.items || []);
      setWarehouses(w.warehouses || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return;
    }
    setStatus("Loading order...");
    try {
      const res = await apiGet<OrderDetail>(`/purchases/orders/${id}`);
      setDetail(res);
      setStatus("");
    } catch (err) {
      setDetail(null);
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!qsOrderId) return;
    setOrderId((prev) => (prev === qsOrderId ? prev : qsOrderId));
  }, [qsOrderId]);

  useEffect(() => {
    loadDetail(orderId);
  }, [orderId, loadDetail]);

  function openNewDraft() {
    setDraftEditId("");
    setDraftSupplierId("");
    setDraftExchangeRate("90000");
    setDraftLines([]);
    setDraftOpen(true);
  }

  function openEditDraft() {
    if (!detail) return;
    if (detail.order.status !== "draft") return;
    setDraftEditId(detail.order.id);
    setDraftSupplierId(detail.order.supplier_id || "");
    setDraftExchangeRate(String(detail.order.exchange_rate || 0));
    setDraftLines(
      (detail.lines || []).map((l) => ({
        item_id: l.item_id,
        qty: String(l.qty || 0),
        unit_cost_usd: String(l.unit_cost_usd || 0),
        unit_cost_lbp: String(l.unit_cost_lbp || 0)
      }))
    );
    setDraftOpen(true);
  }

  function addLine() {
    setDraftLines((prev) => [...prev, { item_id: "", qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0" }]);
  }

  function removeLine(idx: number) {
    setDraftLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setDraftLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!draftSupplierId) return setStatus("supplier is required");
    const ex = toNum(draftExchangeRate);
    if (!ex) return setStatus("exchange_rate is required");

    const validLines = (draftLines || []).filter((l) => l.item_id && toNum(l.qty) > 0);

    setDraftSaving(true);
    setStatus(draftEditId ? "Saving draft..." : "Creating draft...");
    try {
      const payload = {
        supplier_id: draftSupplierId,
        exchange_rate: ex,
        lines: validLines.map((l) => ({
          item_id: l.item_id,
          qty: toNum(l.qty),
          unit_cost_usd: toNum(l.unit_cost_usd),
          unit_cost_lbp: toNum(l.unit_cost_lbp)
        }))
      };

      if (!draftEditId) {
        const res = await apiPost<{ id: string }>("/purchases/orders/drafts", payload);
        setDraftOpen(false);
        await load();
        setOrderId(res.id);
        setStatus("");
        return;
      }

      await apiPatch(`/purchases/orders/${draftEditId}/draft`, payload);
      setDraftOpen(false);
      await load();
      await loadDetail(draftEditId);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setDraftSaving(false);
    }
  }

  async function postSelected() {
    if (!detail) return;
    if (detail.order.status !== "draft") return;
    if (!(detail.lines || []).length) {
      setStatus("Cannot post: add at least one line to this draft first.");
      return;
    }
    setStatus("Posting...");
    try {
      await apiPost(`/purchases/orders/${detail.order.id}/post`, {});
      await load();
      await loadDetail(detail.order.id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function cancelSelected() {
    if (!detail) return;
    setStatus("Canceling...");
    try {
      await apiPost(`/purchases/orders/${detail.order.id}/cancel`, {});
      await load();
      await loadDetail(detail.order.id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  function openReceive() {
    if (!detail) return;
    if (!warehouses.length) {
      setStatus("Create at least one warehouse first (System → Warehouses).");
      return;
    }
    setReceiveWarehouseId(warehouses[0].id);
    setReceiveOpen(true);
  }

  async function createReceiptDraftFromOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (!receiveWarehouseId) return setStatus("warehouse is required");
    setReceiving(true);
    setStatus("Creating goods receipt draft...");
    try {
      const res = await apiPost<{ id: string }>(`/purchases/receipts/drafts/from-order/${detail.order.id}`, {
        warehouse_id: receiveWarehouseId
      });
      setReceiveOpen(false);
      setStatus("");
      router.push(`/purchasing/goods-receipts?id=${encodeURIComponent(res.id)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setReceiving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Errors and action results show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Purchase Orders</CardTitle>
                <CardDescription>{filteredOrders.length} orders</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={load}>
                  Refresh
                </Button>
                <Button onClick={openNewDraft}>New Draft</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-96">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order / supplier..." />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <select className="ui-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="canceled">Canceled</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead className="ui-thead">
                      <tr>
                        <th className="px-3 py-2">Order</th>
                        <th className="px-3 py-2">Supplier</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Total USD</th>
                        <th className="px-3 py-2 text-right">Total LL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map((o) => {
                        const selected = o.id === orderId;
                        return (
                          <tr
                            key={o.id}
                            className={selected ? "bg-bg-sunken/20" : "ui-tr-hover"}
                            style={{ cursor: "pointer" }}
                            onClick={() => setOrderId(o.id)}
                          >
                            <td className="px-3 py-2 font-medium">{o.order_no || "(draft)"}</td>
                            <td className="px-3 py-2">{supplierById.get(o.supplier_id || "")?.name || "-"}</td>
                            <td className="px-3 py-2">
                              <StatusChip value={o.status} />
                            </td>
                            <td className="px-3 py-2 text-right data-mono">{fmtUsd(o.total_usd)}</td>
                            <td className="px-3 py-2 text-right data-mono">{fmtLbp(o.total_lbp)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="md:col-span-1">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Order Detail</CardTitle>
                    <CardDescription>{detail ? `Status: ${detail.order.status}` : "Select an order"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail ? (
                      <>
                        <div className="space-y-1 text-sm">
                          <div>
                            <span className="text-fg-subtle">Order:</span> {detail.order.order_no || "(draft)"}
                          </div>
                          <div>
                            <span className="text-fg-subtle">Supplier:</span> {supplierById.get(detail.order.supplier_id || "")?.name || "-"}
                          </div>
                          <div>
                            <span className="text-fg-subtle">Exchange:</span> {Number(detail.order.exchange_rate || 0).toFixed(0)}
                          </div>
                          <div>
                            <span className="text-fg-subtle">Totals:</span>{" "}
                            <span className="data-mono">
                              {fmtUsd(detail.order.total_usd)} / {fmtLbp(detail.order.total_lbp)}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {detail.order.status === "draft" ? (
                            <>
                              <Button variant="outline" onClick={openEditDraft}>
                                Edit Draft
                              </Button>
                              <Button onClick={postSelected}>Post</Button>
                            </>
                          ) : null}
                          {detail.order.status === "posted" ? (
                            <Button variant="outline" onClick={openReceive}>
                              Create GR Draft
                            </Button>
                          ) : null}
                          {detail.order.status !== "canceled" ? (
                            <Button variant="outline" onClick={cancelSelected}>
                              Cancel
                            </Button>
                          ) : null}
                        </div>

                        <div className="ui-table-wrap">
                          <table className="ui-table">
                            <thead className="ui-thead">
                              <tr>
                                <th className="px-3 py-2">Item</th>
                                <th className="px-3 py-2 text-right">Qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(detail.lines || []).map((l) => (
                                <tr key={l.id} className="ui-tr-hover">
                                  <td className="px-3 py-2">{itemById.get(l.item_id)?.sku || l.item_id}</td>
                                  <td className="px-3 py-2 text-right">{Number(l.qty || 0).toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-fg-muted">Pick an order from the list to view it.</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Goods Receipt Draft</DialogTitle>
              <DialogDescription>Prefills remaining quantities from the selected Purchase Order.</DialogDescription>
            </DialogHeader>
            <form onSubmit={createReceiptDraftFromOrder} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1 md:col-span-6">
                <label className="text-xs font-medium text-fg-muted">Warehouse</label>
                <select className="ui-select" value={receiveWarehouseId} onChange={(e) => setReceiveWarehouseId(e.target.value)}>
                  <option value="">Select warehouse...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-6 flex justify-end">
                <Button type="submit" disabled={receiving}>
                  {receiving ? "..." : "Create Draft"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{draftEditId ? "Edit Purchase Order Draft" : "New Purchase Order Draft"}</DialogTitle>
              <DialogDescription>Keep it as a draft until you are ready to post.</DialogDescription>
            </DialogHeader>

            <form onSubmit={saveDraft} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">Supplier</label>
                  <select className="ui-select" value={draftSupplierId} onChange={(e) => setDraftSupplierId(e.target.value)}>
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD→LL)</label>
                  <Input value={draftExchangeRate} onChange={(e) => setDraftExchangeRate(e.target.value)} />
                </div>
              </div>

              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit USD</th>
                      <th className="px-3 py-2 text-right">Unit LL</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftLines.map((l, idx) => (
                      <tr key={idx} className="ui-tr-hover">
                        <td className="px-3 py-2">
                          <select
                            className="ui-select ui-control-sm"
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
                          <Button type="button" variant="outline" size="sm" onClick={() => removeLine(idx)}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {!draftLines.length ? (
                      <tr>
                        <td className="px-3 py-3 text-sm text-fg-muted" colSpan={5}>
                          No lines yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" onClick={addLine}>
                  Add Line
                </Button>
                <Button type="submit" disabled={draftSaving}>
                  {draftSaving ? "..." : draftEditId ? "Save Draft" : "Create Draft"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>);
}

export default function PurchaseOrdersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <PurchaseOrdersPageInner />
    </Suspense>
  );
}
