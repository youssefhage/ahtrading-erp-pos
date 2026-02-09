"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type Supplier = { id: string; name: string };
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
  received_at?: string | null;
  created_at: string;
};

function Inner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);

  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (receipts || []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!needle) return true;
      const no = (r.receipt_no || "").toLowerCase();
      const supRef = ((r.supplier_ref as string) || "").toLowerCase();
      const sup = r.supplier_id ? (supplierById.get(r.supplier_id)?.name || "").toLowerCase() : "";
      const wh = r.warehouse_id ? (whById.get(r.warehouse_id)?.name || "").toLowerCase() : "";
      const po = (r.purchase_order_no || "").toLowerCase();
      return (
        no.includes(needle) ||
        supRef.includes(needle) ||
        sup.includes(needle) ||
        wh.includes(needle) ||
        po.includes(needle) ||
        r.id.toLowerCase().includes(needle)
      );
    });
  }, [receipts, q, statusFilter, supplierById, whById]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [r, s, w] = await Promise.all([
        apiGet<{ receipts: ReceiptRow[] }>("/purchases/receipts"),
        apiGet<{ suppliers: Supplier[] }>("/suppliers"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
      ]);
      setReceipts(r.receipts || []);
      setSuppliers(s.suppliers || []);
      setWarehouses(w.warehouses || []);
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Goods Receipts</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${filtered.length} receipt(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button type="button" onClick={() => router.push("/purchasing/goods-receipts/new")}>
            New Draft
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Receipts</CardTitle>
          <CardDescription>Open a receipt to view or post.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="w-full md:w-96">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt / supplier / ref / warehouse / PO..." />
            </div>
            <div className="flex items-center gap-2">
              <select className="ui-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="posted">Posted</option>
                <option value="canceled">Canceled</option>
              </select>
            </div>
          </div>

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Receipt</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Warehouse</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Total USD</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="ui-tr-hover">
                    <td className="px-3 py-2 font-medium">
                      <Link
                        className="ui-link inline-flex flex-col items-start"
                        href={`/purchasing/goods-receipts/${encodeURIComponent(r.id)}`}
                      >
                        <div className="flex flex-col gap-0.5">
                          <div>{r.receipt_no || "(draft)"}</div>
                          {r.supplier_ref ? <div className="font-mono text-[11px] text-fg-muted">Ref: {r.supplier_ref}</div> : null}
                          {r.received_at ? <div className="font-mono text-[11px] text-fg-muted">Received: {r.received_at}</div> : null}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {r.supplier_id ? (
                        <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(r.supplier_id)}`} title="Open supplier">
                          {supplierById.get(r.supplier_id)?.name || r.supplier_id}
                        </ShortcutLink>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2">{whById.get(r.warehouse_id || "")?.name || "-"}</td>
                    <td className="px-3 py-2">
                      <StatusChip value={r.status} />
                    </td>
                    <td className="px-3 py-2 text-right data-mono">{fmtUsd(r.total_usd)}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
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
  );
}

export default function GoodsReceiptsListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
