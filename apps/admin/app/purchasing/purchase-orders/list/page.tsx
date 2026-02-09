"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

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
  created_at: string;
};

export default function PurchaseOrdersListPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);

  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (orders || []).filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (!needle) return true;
      const parts = [
        o.order_no || "",
        o.supplier_ref || "",
        o.supplier_name || "",
        o.warehouse_name || "",
        o.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return parts.includes(needle);
    });
  }, [orders, q, statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ orders: PurchaseOrderRow[] }>("/purchases/orders");
      setOrders(res.orders || []);
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Purchase Orders</h1>
            <p className="text-sm text-fg-muted">List</p>
          </div>
          <Button asChild>
            <Link href="/purchasing/purchase-orders/new">New Draft</Link>
          </Button>
        </div>
        <ErrorBanner error={err} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Purchase Orders</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${filtered.length} order(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button asChild>
            <Link href="/purchasing/purchase-orders/new">New Draft</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Orders</CardTitle>
          <CardDescription>Search and open purchase orders.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="w-full md:w-96">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order / supplier / reference..." />
            </div>
            <select className="ui-select w-full md:w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>

          {!loading && filtered.length === 0 ? (
            <EmptyState
              title="No purchase orders"
              description="Create your first draft to start purchasing."
              actionLabel="New Draft"
              onAction={() => router.push("/purchasing/purchase-orders/new")}
            />
          ) : (
            <div className={loading ? "opacity-70" : ""}>
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Order</th>
                      <th className="px-3 py-2">Supplier</th>
                      <th className="px-3 py-2">Warehouse</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Total USD</th>
                      <th className="px-3 py-2 text-right">Total LL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((o) => (
                      <tr key={o.id} className="ui-tr ui-tr-hover">
                        <td className="px-3 py-2">
                          <Link className="focus-ring inline-flex flex-col" href={`/purchasing/purchase-orders/${encodeURIComponent(o.id)}`}>
                            <span className="font-medium text-foreground">{o.order_no || "(draft)"}</span>
                            {o.supplier_ref ? <span className="font-mono text-[11px] text-fg-muted">Ref: {o.supplier_ref}</span> : null}
                            {o.expected_delivery_date ? <span className="font-mono text-[11px] text-fg-muted">ETA: {o.expected_delivery_date}</span> : null}
                            <span className="font-mono text-[10px] text-fg-subtle">{o.id}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2">{o.supplier_name || o.supplier_id || "-"}</td>
                        <td className="px-3 py-2">{o.warehouse_name || o.warehouse_id || "-"}</td>
                        <td className="px-3 py-2">
                          <StatusChip value={o.status} />
                        </td>
                        <td className="px-3 py-2 text-right data-mono">{fmtUsd(o.total_usd)}</td>
                        <td className="px-3 py-2 text-right data-mono">{fmtLbp(o.total_lbp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
