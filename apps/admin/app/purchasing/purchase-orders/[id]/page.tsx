"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { ViewRaw } from "@/components/view-raw";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusChip } from "@/components/ui/status-chip";

type Warehouse = { id: string; name: string };
type Item = { id: string; sku: string; name: string; unit_of_measure?: string | null };

type PurchaseOrderRow = {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  supplier_ref?: string | null;
  expected_delivery_date?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate: string | number;
  created_at: string;
};

type PurchaseOrderLine = {
  id: string;
  item_id: string;
  qty: string | number;
  received_qty?: string | number;
  invoiced_qty?: string | number;
  open_to_receive_qty?: string | number;
  open_to_invoice_qty?: string | number;
  received_unit_cost_usd?: string | number;
  received_unit_cost_lbp?: string | number;
  invoiced_unit_cost_usd?: string | number;
  invoiced_unit_cost_lbp?: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

type OrderDetail = { order: PurchaseOrderRow; lines: PurchaseOrderLine[] };

export default function PurchaseOrderViewPage() {
  const router = useRouter();
  const params = useParams();
  const idParam = (params as Record<string, string | string[] | undefined>)?.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? (idParam[0] || "") : "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);

  const [itemsById, setItemsById] = useState<Map<string, Item>>(new Map());
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [busy, setBusy] = useState(false);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveWarehouseId, setReceiveWarehouseId] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [d, w] = await Promise.all([
        apiGet<OrderDetail>(`/purchases/orders/${encodeURIComponent(id)}`),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
      ]);
      setDetail(d);
      setWarehouses(w.warehouses || []);

      // Hydrate item labels for the lines (best-effort).
      const ids = Array.from(new Set((d.lines || []).map((l) => l.item_id).filter(Boolean)));
      if (ids.length) {
        const results = await Promise.all(
          ids.map(async (itemId) => {
            try {
              const r = await apiGet<{ item: Item }>(`/items/${encodeURIComponent(itemId)}`);
              return r.item || null;
            } catch {
              return null;
            }
          })
        );
        setItemsById(new Map(results.filter(Boolean).map((it) => [(it as any).id, it as Item])));
      } else {
        setItemsById(new Map());
      }
    } catch (e) {
      setDetail(null);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    load();
  }, [load, id]);

  const order = detail?.order || null;
  const lines = detail?.lines || [];

  const canEditDraft = order?.status === "draft";
  const canPost = order?.status === "draft" && lines.length > 0;
  const canCancel = order && order.status !== "canceled";
  const canCreateReceipt = order?.status === "posted";

  const totals = useMemo(() => {
    return {
      usd: order ? fmtUsd(order.total_usd) : "-",
      lbp: order ? fmtLbp(order.total_lbp) : "-",
    };
  }, [order]);

  async function post() {
    if (!order) return;
    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/purchases/orders/${encodeURIComponent(order.id)}/post`, {});
      await load();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!order) return;
    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/purchases/orders/${encodeURIComponent(order.id)}/cancel`, {});
      await load();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  function openReceive() {
    if (!order) return;
    const defaultWh = order.warehouse_id || warehouses[0]?.id || "";
    setReceiveWarehouseId(defaultWh);
    setReceiveOpen(true);
  }

  async function createReceiptDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    if (!receiveWarehouseId) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiPost<{ id: string }>(`/purchases/receipts/drafts/from-order/${encodeURIComponent(order.id)}`, {
        warehouse_id: receiveWarehouseId,
      });
      setReceiveOpen(false);
      router.push(`/purchasing/goods-receipts/${encodeURIComponent(res.id)}`);
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  }

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Purchase Order</h1>
            <p className="text-sm text-fg-muted">{id}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => router.push("/purchasing/purchase-orders/list")}>
            Back
          </Button>
        </div>
        <ErrorBanner error={err} onRetry={load} />
      </div>
    );
  }

  if (!loading && !detail) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <EmptyState title="Purchase order not found" description="This order may have been deleted or you may not have access." actionLabel="Back" onAction={() => router.push("/purchasing/purchase-orders/list")} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{order?.order_no || (loading ? "Loading..." : "Purchase Order")}</h1>
          <p className="text-sm text-fg-muted">
            <span className="font-mono text-xs">{id}</span>
            {order ? (
              <>
                {" "}
                · <StatusChip value={order.status} />
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/purchasing/purchase-orders/list")} disabled={busy}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={load} disabled={busy || loading}>
            Refresh
          </Button>
          <Button asChild disabled={busy}>
            <Link href="/purchasing/purchase-orders/new">New Draft</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Summary</CardTitle>
              <CardDescription>Supplier, warehouse, and totals.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" disabled={busy}>
                <Link
                  href={`/purchasing/purchase-orders/${encodeURIComponent(id)}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Print / PDF
                </Link>
              </Button>
              <Button asChild variant="outline" disabled={busy}>
                <a
                  href={`/exports/purchase-orders/${encodeURIComponent(id)}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download PDF
                </a>
              </Button>
              {canEditDraft ? (
                <Button asChild variant="outline" disabled={busy}>
                  <Link href={`/purchasing/purchase-orders/${encodeURIComponent(id)}/edit`}>Edit Draft</Link>
                </Button>
              ) : null}
              {canPost ? (
                <Button type="button" onClick={post} disabled={busy}>
                  Post
                </Button>
              ) : null}
              {canCreateReceipt ? (
                <Button type="button" variant="outline" onClick={openReceive} disabled={busy}>
                  Create GR Draft
                </Button>
              ) : null}
              {canCancel ? (
                <Button type="button" variant="outline" onClick={cancel} disabled={busy}>
                  Cancel
                </Button>
              ) : null}
              {order ? (
                <DocumentUtilitiesDrawer
                  entityType="purchase_order"
                  entityId={order.id}
                  allowUploadAttachments={order.status === "draft"}
                  className="ml-1"
                />
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-fg-subtle">Supplier:</span>{" "}
            {order?.supplier_id ? (
              <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(order.supplier_id)}`} title="Open supplier">
                {order.supplier_name || order.supplier_id}
              </ShortcutLink>
            ) : (
              "-"
            )}
          </div>
          <div>
            <span className="text-fg-subtle">Warehouse:</span> {order?.warehouse_name || order?.warehouse_id || "-"}
          </div>
          <div>
            <span className="text-fg-subtle">Supplier Ref:</span> {order?.supplier_ref || "-"}
          </div>
          <div>
            <span className="text-fg-subtle">Expected Delivery:</span> {order?.expected_delivery_date || "-"}
          </div>
          <div>
            <span className="text-fg-subtle">Exchange:</span> {order ? Number(order.exchange_rate || 0).toFixed(0) : "-"}
          </div>
          <div>
            <span className="text-fg-subtle">Totals:</span>{" "}
            <span className="data-mono">
              {totals.usd} / {totals.lbp}
            </span>
          </div>
          {!canPost && order?.status === "draft" && lines.length === 0 ? (
            <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              Add at least one line before posting.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>Ordered vs received vs invoiced.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Received</th>
                  <th className="px-3 py-2 text-right">Invoiced</th>
                  <th className="px-3 py-2 text-right">To Receive</th>
                  <th className="px-3 py-2 text-right">To Invoice</th>
                  <th className="px-3 py-2 text-right">Unit USD</th>
                  <th className="px-3 py-2 text-right">Recv USD</th>
                  <th className="px-3 py-2 text-right">Inv USD</th>
                </tr>
              </thead>
              <tbody className={loading ? "opacity-70" : ""}>
                {lines.map((l) => {
                  const it = itemsById.get(l.item_id);
                  return (
                    <tr key={l.id} className="ui-tr">
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <div className="font-medium text-foreground">
                            {it ? (
                              <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item">
                                <span className="font-mono text-xs text-fg-muted">{it.sku}</span> · {it.name}
                              </ShortcutLink>
                            ) : (
                              <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item" className="font-mono text-xs">
                                {l.item_id}
                              </ShortcutLink>
                            )}
                          </div>
                          {it?.unit_of_measure ? <div className="font-mono text-[10px] text-fg-subtle">UOM: {String(it.unit_of_measure)}</div> : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.qty || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.received_qty || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.invoiced_qty || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.open_to_receive_qty || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.open_to_invoice_qty || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.unit_cost_usd || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.received_unit_cost_usd || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.invoiced_unit_cost_usd || 0).toFixed(2)}</td>
                    </tr>
                  );
                })}
                {!loading && lines.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-fg-subtle">
                      No lines.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Attachments + audit trail are available via the right-rail utilities drawer. */}

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Goods Receipt Draft</DialogTitle>
            <DialogDescription>Prefills remaining quantities from this Purchase Order.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createReceiptDraft} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="space-y-1 md:col-span-6">
              <label className="text-xs font-medium text-fg-muted">Warehouse</label>
              <select className="ui-select" value={receiveWarehouseId} onChange={(e) => setReceiveWarehouseId(e.target.value)} disabled={busy}>
                <option value="">Select warehouse...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-6 flex items-center justify-between gap-2">
              <ViewRaw value={{ order_id: order?.id, warehouse_id: receiveWarehouseId }} label="View payload (raw)" />
              <Button type="submit" disabled={busy || !receiveWarehouseId}>
                {busy ? "..." : "Create Draft"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
