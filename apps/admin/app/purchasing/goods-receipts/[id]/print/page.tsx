"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

type Supplier = { id: string; name: string };
type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };

type ReceiptRow = {
  id: string;
  receipt_no: string | null;
  supplier_id: string | null;
  supplier_ref?: string | null;
  warehouse_id: string | null;
  purchase_order_id?: string | null;
  purchase_order_no?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  received_at?: string | null;
  created_at: string;
  exchange_rate: string | number;
};

type ReceiptLine = {
  id: string;
  item_id: string;
  qty: string | number;
  batch_no: string | null;
  expiry_date: string | null;
};

type ReceiptDetail = { receipt: ReceiptRow; lines: ReceiptLine[] };

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function GoodsReceiptPrintPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [d, s, i, w] = await Promise.all([
        apiGet<ReceiptDetail>(`/purchases/receipts/${encodeURIComponent(id)}`),
        apiGet<{ suppliers: Supplier[] }>("/suppliers").catch(() => ({ suppliers: [] })),
        apiGet<{ items: Item[] }>("/items/min").catch(() => ({ items: [] })),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses").catch(() => ({ warehouses: [] }))
      ]);
      setDetail(d);
      setSuppliers(s.suppliers || []);
      setItems(i.items || []);
      setWarehouses(w.warehouses || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetail(null);
      setSuppliers([]);
      setItems([]);
      setWarehouses([]);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Optional: allow kiosk-style auto print via ?autoprint=1.
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("autoprint") === "1") setTimeout(() => window.print(), 250);
    } catch {
      // ignore
    }
  }, []);

  const receipt = detail?.receipt || null;
  const lines = detail?.lines || [];

  const supplierName = receipt?.supplier_id ? supplierById.get(receipt.supplier_id)?.name || receipt.supplier_id : "-";
  const whName = receipt?.warehouse_id ? whById.get(receipt.warehouse_id)?.name || receipt.warehouse_id : "-";
  const ex = receipt ? String(Math.round(toNum(receipt.exchange_rate))) : "-";

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/purchasing/goods-receipts/${encodeURIComponent(id)}`}>Back</Link>
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

        {!detail || !receipt ? (
          <div className="py-16 text-sm text-black/70">{loading ? "Loading..." : "No data."}</div>
        ) : (
          <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/15 pb-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Goods Receipt</h1>
                <p className="mt-1 font-mono text-xs text-black/70">
                  {receipt.receipt_no || "(draft)"} · {receipt.status}
                </p>
              </div>
              <div className="text-right text-xs text-black/70">
                <div className="font-mono">Received {fmtIso(receipt.received_at)}</div>
                <div className="font-mono">Exchange {ex}</div>
              </div>
            </header>

            <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Supplier</p>
                <p className="mt-1 text-sm font-medium">{supplierName}</p>
                {receipt.supplier_ref ? <p className="mt-1 font-mono text-[11px] text-black/70">Ref: {receipt.supplier_ref}</p> : null}
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Warehouse</p>
                <p className="mt-1 text-sm font-medium">{whName}</p>
                {receipt.purchase_order_id ? (
                  <p className="mt-1 font-mono text-[11px] text-black/70">
                    PO: {receipt.purchase_order_no || receipt.purchase_order_id}
                  </p>
                ) : null}
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Totals</p>
                <p className="mt-1 font-mono text-sm">{fmtUsd(receipt.total_usd)}</p>
                <p className="font-mono text-sm">{fmtLbp(receipt.total_lbp)}</p>
              </div>
            </section>

            <section className="rounded-md border border-black/15">
              <div className="border-b border-black/10 px-4 py-3">
                <h2 className="text-sm font-semibold">Lines</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                    <tr>
                      <th className="px-4 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-left">Batch</th>
                      <th className="px-4 py-2 text-left">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const it = itemById.get(l.item_id);
                      return (
                        <tr key={l.id} className="border-t border-black/10 align-top">
                          <td className="px-4 py-2">
                            <div className="font-mono text-[11px] text-black/70">{it?.sku || l.item_id}</div>
                            <div className="text-sm">{it?.name || "-"}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">
                            {toNum(l.qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px]">{l.batch_no || "-"}</td>
                          <td className="px-4 py-2 font-mono text-[11px]">{fmtIso(l.expiry_date)}</td>
                        </tr>
                      );
                    })}
                    {lines.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-black/60" colSpan={4}>
                          No lines.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <footer className="pt-2 text-[11px] text-black/60">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/15 pt-3">
                <span className="font-mono">GR ID: {receipt.id}</span>
                <span className="font-mono">Generated: {new Date().toISOString().slice(0, 19).replace("T", " ")}</span>
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
