"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type StockRow = {
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  warehouse_id: string;
  warehouse_name?: string | null;
  batch_id?: string | null;
  batch_no?: string | null;
  expiry_date?: string | null;
  qty_in?: string | number;
  qty_out?: string | number;
  qty_on_hand: string | number;
  reserved_qty?: string | number;
  qty_available?: string | number;
  incoming_qty?: string | number;
};

function toNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v: unknown) {
  return toNum(v).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export default function StockPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [byBatch, setByBatch] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ stock: StockRow[] }>(`/inventory/stock?by_batch=${byBatch ? "true" : "false"}`);
      setRows(res.stock || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [byBatch]);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo<ColumnDef<StockRow>[]>(() => {
    const cols: ColumnDef<StockRow>[] = [
      {
        accessorKey: "item_sku",
        header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
        accessorFn: (r) => r.item_sku || r.item_id,
        cell: ({ row }) => (
          <Link href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`} className="font-mono text-xs text-primary hover:underline">
            {row.original.item_sku || row.original.item_id}
          </Link>
        ),
      },
      {
        id: "item_name",
        accessorFn: (r) => r.item_name || "-",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
        cell: ({ row }) => (
          <Link href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`} className="hover:underline">
            {row.original.item_name || "-"}
          </Link>
        ),
      },
      {
        id: "warehouse",
        accessorFn: (r) => r.warehouse_name || r.warehouse_id,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" />,
      },
    ];

    if (byBatch) {
      cols.push({
        id: "batch",
        accessorFn: (r) => r.batch_no || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.batch_no || "-"}
            {row.original.expiry_date ? ` \u00b7 ${String(row.original.expiry_date).slice(0, 10)}` : ""}
          </span>
        ),
      });
    }

    cols.push({
      id: "qty_on_hand",
      accessorFn: (r) => toNum(r.qty_on_hand),
      header: ({ column }) => <DataTableColumnHeader column={column} title="On Hand" />,
      cell: ({ row }) => {
        const n = toNum(row.original.qty_on_hand);
        return (
          <span className={`font-mono text-sm ${n < 0 ? "text-destructive" : n === 0 ? "text-muted-foreground" : ""}`}>
            {fmt(row.original.qty_on_hand)}
          </span>
        );
      },
    });

    if (!byBatch) {
      cols.push(
        {
          id: "reserved_qty",
          accessorFn: (r) => toNum(r.reserved_qty),
          header: ({ column }) => <DataTableColumnHeader column={column} title="Reserved" />,
          cell: ({ row }) => {
            const n = toNum(row.original.reserved_qty);
            return <span className={`font-mono text-sm ${n > 0 ? "text-warning" : "text-muted-foreground"}`}>{fmt(row.original.reserved_qty)}</span>;
          },
        },
        {
          id: "qty_available",
          accessorFn: (r) => toNum(r.qty_available ?? (toNum(r.qty_on_hand) - toNum(r.reserved_qty))),
          header: ({ column }) => <DataTableColumnHeader column={column} title="Available" />,
          cell: ({ row }) => {
            const v = toNum(row.original.qty_available ?? (toNum(row.original.qty_on_hand) - toNum(row.original.reserved_qty)));
            return <span className={`font-mono text-sm ${v < 0 ? "text-destructive" : v === 0 ? "text-muted-foreground" : ""}`}>{fmt(v)}</span>;
          },
        },
        {
          id: "incoming_qty",
          accessorFn: (r) => toNum(r.incoming_qty),
          header: ({ column }) => <DataTableColumnHeader column={column} title="Incoming" />,
          cell: ({ row }) => {
            const n = toNum(row.original.incoming_qty);
            return <span className={`font-mono text-sm ${n > 0 ? "text-success" : "text-muted-foreground"}`}>{fmt(row.original.incoming_qty)}</span>;
          },
        },
      );
    }

    return cols;
  }, [byBatch]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Stock"
        description="Real-time inventory levels"
        actions={
          <>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={byBatch} onChange={(e) => setByBatch(e.target.checked)} />
              By batch
            </label>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-2">
          <Badge variant="outline">{rows.length} rows</Badge>
        </div>
      </PageHeader>

      <DataTable columns={columns} data={rows} isLoading={loading} searchPlaceholder="Search item, SKU, warehouse..." />
    </div>
  );
}
