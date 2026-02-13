"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

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

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

export default function PurchaseOrderPrintPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [itemsById, setItemsById] = useState<Map<string, Item>>(new Map());

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const d = await apiGet<OrderDetail>(`/purchases/orders/${encodeURIComponent(id)}`);
      setDetail(d);

      // Best-effort hydrate item labels (keeps PO prints readable even if
      // the order API doesn't embed item metadata yet).
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

      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetail(null);
      setItemsById(new Map());
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    applyPrintSettingsFromQuery();
    // Optional: allow kiosk-style auto print via ?autoprint=1.
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("autoprint") === "1") setTimeout(() => window.print(), 250);
    } catch {
      // ignore
    }
  }, []);

  const order = detail?.order || null;
  const lines = detail?.lines || [];

  const totals = useMemo(() => {
    return {
      usd: order ? fmtUsd(order.total_usd) : "-",
      lbp: order ? fmtLbp(order.total_lbp) : "-",
      ex: order ? String(Math.round(toNum(order.exchange_rate))) : "-"
    };
  }, [order]);

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/purchasing/purchase-orders/${encodeURIComponent(id)}`}>Back</Link>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </Button>
            <Button onClick={() => window.print()}>Print / Save PDF</Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        {!detail || !order ? (
          <div className="py-16 text-sm text-black/70">{loading ? "Loading..." : "No data."}</div>
        ) : (
          <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/15 pb-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Purchase Order</h1>
                <p className="mt-1 font-mono text-xs text-black/70">
                  {order.order_no || "(draft)"} · {order.status}
                </p>
              </div>
              <div className="text-right text-xs text-black/70">
                <div className="font-mono">Expected {fmtIso(order.expected_delivery_date)}</div>
                <div className="font-mono">Exchange {totals.ex}</div>
              </div>
            </header>

            <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Supplier</p>
                <p className="mt-1 text-sm font-medium">{order.supplier_name || order.supplier_id || "-"}</p>
                {order.supplier_ref ? <p className="mt-1 font-mono text-[11px] text-black/70">Ref: {order.supplier_ref}</p> : null}
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Warehouse</p>
                <p className="mt-1 text-sm font-medium">{order.warehouse_name || order.warehouse_id || "-"}</p>
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Totals</p>
                <p className="mt-1 font-mono text-sm">{totals.usd}</p>
                <p className="font-mono text-sm">{totals.lbp}</p>
              </div>
            </section>

            <section className="rounded-md border border-black/15">
              <div className="border-b border-black/10 px-4 py-3">
                <h2 className="text-sm font-semibold">Items</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                    <tr>
                      <th className="px-4 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Ordered</th>
                      <th className="px-3 py-2 text-right">Received</th>
                      <th className="px-3 py-2 text-right">Invoiced</th>
                      <th className="px-3 py-2 text-right">To Receive</th>
                      <th className="px-3 py-2 text-right">To Invoice</th>
	                      <th className="px-3 py-2 text-right">Unit USD</th>
	                      <th className="px-3 py-2 text-right">Unit LL</th>
	                      <th className="px-3 py-2 text-right">Total USD</th>
	                      <th className="px-4 py-2 text-right">Total LL</th>
	                    </tr>
	                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const it = itemsById.get(l.item_id);
                      return (
                        <tr key={l.id} className="border-t border-black/10 align-top">
                          <td className="px-4 py-2">
                            <div className="font-mono text-[11px] text-black/70">{it?.sku || l.item_id}</div>
                            <div className="text-sm">{it?.name || "-"}</div>
                            {it?.unit_of_measure ? <div className="mt-1 font-mono text-[11px] text-black/60">UOM {String(it.unit_of_measure)}</div> : null}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{toNum(l.qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{toNum(l.received_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{toNum(l.invoiced_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{toNum(l.open_to_receive_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{toNum(l.open_to_invoice_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(l.unit_cost_usd)}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtLbp(l.unit_cost_lbp)}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(l.line_total_usd)}</td>
                          <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtLbp(l.line_total_lbp)}</td>
                        </tr>
                      );
                    })}
                    {lines.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-black/60" colSpan={10}>
                          No items.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <footer className="pt-2 text-[11px] text-black/60">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/15 pt-3">
                <span className="font-mono">PO ID: {order.id}</span>
                <span className="font-mono">Generated: {new Date().toISOString().slice(0, 19).replace("T", " ")}</span>
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
