"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { ShortcutLink } from "@/components/shortcut-link";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => {
    return (orders || []).filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      return true;
    });
  }, [orders, statusFilter]);

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

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<PurchaseOrderRow>> = [
      {
        id: "order",
        header: "Order",
        sortable: true,
        accessor: (o) => o.order_no || "",
        cell: (o) => (
          <Link className="ui-link inline-flex flex-col items-start" href={`/purchasing/purchase-orders/${encodeURIComponent(o.id)}`}>
            <span className="font-medium text-foreground">{o.order_no || "(draft)"}</span>
            {o.supplier_ref ? <span className="font-mono text-xs text-fg-muted">Ref: {o.supplier_ref}</span> : null}
            {o.expected_delivery_date ? <span className="font-mono text-xs text-fg-muted">ETA: {o.expected_delivery_date}</span> : null}
            <span className="font-mono text-xs text-fg-subtle">{o.id}</span>
          </Link>
        ),
      },
      {
        id: "supplier",
        header: "Supplier",
        sortable: true,
        accessor: (o) => o.supplier_name || o.supplier_id || "",
        cell: (o) =>
          o.supplier_id ? (
            <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(o.supplier_id)}`} title="Open supplier">
              {o.supplier_name || o.supplier_id}
            </ShortcutLink>
          ) : (
            "-"
          ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        sortable: true,
        accessor: (o) => o.warehouse_name || o.warehouse_id || "",
        cell: (o) => o.warehouse_name || o.warehouse_id || "-",
      },
      {
        id: "status",
        header: "Status",
        sortable: true,
        accessor: (o) => o.status,
        cell: (o) => <StatusChip value={o.status} />,
      },
      {
        id: "total_usd",
        header: "Total USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (o) => Number(o.total_usd || 0),
        cell: (o) => <span className="ui-tone-usd">{fmtUsd(o.total_usd)}</span>,
      },
      {
        id: "total_lbp",
        header: "Total LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (o) => Number(o.total_lbp || 0),
        cell: (o) => <span className="ui-tone-lbp">{fmtLbp(o.total_lbp)}</span>,
      },
    ];
    return cols;
  }, []);

  if (err) {
    return (
      <div className="ui-module-shell-narrow">
        <div className="ui-module-head">
          <div className="ui-module-head-row">
            <div>
              <p className="ui-module-kicker">Purchasing</p>
              <h1 className="ui-module-title">Purchase Orders</h1>
              <p className="ui-module-subtitle">List</p>
            </div>
            <div className="ui-module-actions">
              <Button asChild>
                <Link href="/purchasing/purchase-orders/new">New Draft</Link>
              </Button>
            </div>
          </div>
        </div>
        <ErrorBanner error={err} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Purchasing</p>
            <h1 className="ui-module-title">Purchase Orders</h1>
            <p className="ui-module-subtitle">{loading ? "Loading..." : `${filtered.length} order(s)`}</p>
          </div>
          <div className="ui-module-actions">
            <Button type="button" variant="outline" onClick={load} disabled={loading}>
              Refresh
            </Button>
            <Button asChild>
              <Link href="/purchasing/purchase-orders/new">New Draft</Link>
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Orders</CardTitle>
          <CardDescription>Search and open purchase orders.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!loading && filtered.length === 0 ? (
            <EmptyState
              title="No purchase orders"
              description="Create your first draft to start purchasing."
              actionLabel="New Draft"
              onAction={() => router.push("/purchasing/purchase-orders/new")}
            />
          ) : (
            <DataTable<PurchaseOrderRow>
              tableId="purchasing.purchase_orders.list"
              rows={filtered}
              columns={columns}
              getRowId={(r) => r.id}
              initialSort={{ columnId: "order", dir: "desc" }}
              globalFilterPlaceholder="Search order / supplier / reference / warehouse"
              toolbarLeft={
                <select className="ui-select h-9 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="canceled">Canceled</option>
                </select>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
