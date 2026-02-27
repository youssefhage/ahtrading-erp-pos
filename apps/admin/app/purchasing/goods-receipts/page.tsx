"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtUsd } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

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

function toNum(v: unknown, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "canceled", label: "Canceled" },
] as const;

function GoodsReceiptsInner() {
  const router = useRouter();
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s, w] = await Promise.all([
        apiGet<{ receipts: ReceiptRow[] }>("/purchases/receipts"),
        apiGet<{ suppliers: Supplier[] }>("/suppliers"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
      ]);
      setReceipts(r.receipts || []);
      setSuppliers(s.suppliers || []);
      setWarehouses(w.warehouses || []);
    } catch {
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => statusFilter === "all" ? receipts : receipts.filter((r) => r.status === statusFilter),
    [receipts, statusFilter],
  );

  const columns = useMemo<ColumnDef<ReceiptRow>[]>(() => [
    {
      accessorKey: "receipt_no",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Receipt #" />,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div>
            <span className="font-mono text-sm font-medium">{r.receipt_no || "(draft)"}</span>
            {r.supplier_ref && (
              <div className="font-mono text-xs text-muted-foreground">Ref: {r.supplier_ref}</div>
            )}
            {r.received_at && (
              <div className="text-xs text-muted-foreground">Received: {formatDate(r.received_at)}</div>
            )}
          </div>
        );
      },
    },
    {
      id: "supplier",
      accessorFn: (r) => (r.supplier_id ? supplierById.get(r.supplier_id)?.name || "" : ""),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => {
        const r = row.original;
        return r.supplier_id ? supplierById.get(r.supplier_id)?.name || r.supplier_id : "-";
      },
    },
    {
      id: "warehouse",
      accessorFn: (r) => (r.warehouse_id ? whById.get(r.warehouse_id)?.name || "" : ""),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" />,
      cell: ({ row }) => whById.get(row.original.warehouse_id || "")?.name || "-",
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
  ], [supplierById, whById]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Goods Receipts"
        description={loading ? "Loading..." : `${filtered.length} receipt(s)`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => router.push("/purchasing/goods-receipts/new")}>
              New Draft
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
            <DataTable
              columns={columns}
              data={filtered}
              isLoading={loading}
              searchPlaceholder="Search receipt, supplier, warehouse..."
              onRowClick={(row) => router.push(`/purchasing/goods-receipts/${row.id}`)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default function GoodsReceiptsPage() {
  return (
    <Suspense fallback={<div className="px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <GoodsReceiptsInner />
    </Suspense>
  );
}
