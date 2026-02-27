"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtUsd, fmtLbp } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { EmptyState } from "@/components/business/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

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

function toNum(v: unknown, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "received", label: "Received" },
] as const;

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ orders: PurchaseOrderRow[] }>("/purchases/orders");
      setOrders(res.orders || []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => statusFilter === "all" ? orders : orders.filter((o) => o.status === statusFilter),
    [orders, statusFilter],
  );

  const columns = useMemo<ColumnDef<PurchaseOrderRow>[]>(() => [
    {
      accessorKey: "order_no",
      header: ({ column }) => <DataTableColumnHeader column={column} title="PO #" />,
      cell: ({ row }) => (
        <div>
          <span className="font-mono text-sm font-medium">{row.original.order_no || "(draft)"}</span>
          {row.original.supplier_ref && (
            <div className="font-mono text-xs text-muted-foreground">Ref: {row.original.supplier_ref}</div>
          )}
        </div>
      ),
    },
    {
      id: "supplier",
      accessorFn: (r) => r.supplier_name || r.supplier_id || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => row.original.supplier_name || row.original.supplier_id || "-",
    },
    {
      id: "date",
      accessorFn: (r) => r.created_at,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      id: "status",
      accessorFn: (r) => r.status,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "total_usd",
      accessorFn: (r) => toNum(r.total_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total USD" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.total_usd)} currency="USD" />,
    },
    {
      id: "total_lbp",
      accessorFn: (r) => toNum(r.total_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total LBP" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.total_lbp)} currency="LBP" />,
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Purchase Orders"
        description={loading ? "Loading..." : `${filtered.length} order(s)`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => router.push("/purchasing/purchase-orders/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New PO
            </Button>
          </>
        }
      />

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {STATUS_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            {!loading && filtered.length === 0 ? (
              <EmptyState
                title="No purchase orders"
                description="Create your first PO to start purchasing."
                action={{ label: "New PO", onClick: () => router.push("/purchasing/purchase-orders/new") }}
              />
            ) : (
              <DataTable
                columns={columns}
                data={filtered}
                isLoading={loading}
                searchPlaceholder="Search order, supplier, reference..."
                onRowClick={(row) => router.push(`/purchasing/purchase-orders/${row.id}`)}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
