"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ItemRow = {
  id: string; sku: string; name: string; barcode: string | null;
  barcode_count?: number; unit_of_measure: string;
  category_id?: string | null; is_active?: boolean; updated_at?: string | null;
  item_type?: "stocked" | "service" | "bundle" | null;
  brand?: string | null;
};
type Category = { id: string; name: string; parent_id: string | null; is_active: boolean };

function itemTypeLabel(t?: string | null) {
  if (t === "service") return "Service";
  if (t === "bundle") return "Bundle";
  return "Stocked";
}

function itemTypeBadgeVariant(t?: string | null): "default" | "outline" | "secondary" {
  if (t === "service") return "outline";
  if (t === "bundle") return "secondary";
  return "default";
}

export default function ItemsListPage() {
  const router = useRouter();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const load = useCallback(async (search?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      const term = (search ?? q).trim();
      if (term) params.set("q", term);
      const res = await apiGet<{ items: ItemRow[]; total?: number }>(`/items/list?${params}`);
      setItems(res.items || []);
      setTotal(typeof res.total === "number" ? res.total : null);
    } catch {
      setItems([]);
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    apiGet<{ categories: Category[] }>("/item-categories")
      .then((res) => setCategories(res.categories || []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const handleSearchChange = useCallback((value: string) => {
    setQ(value);
  }, []);

  const columns = useMemo<ColumnDef<ItemRow>[]>(() => [
    {
      accessorKey: "sku",
      header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span>,
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{row.original.name}</span>
          {row.original.brand ? (
            <span className="ml-2 text-xs text-muted-foreground">{row.original.brand}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "item_type",
      accessorFn: (row) => row.item_type || "stocked",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
      cell: ({ row }) => {
        const t = row.original.item_type || "stocked";
        return <Badge variant={itemTypeBadgeVariant(t)} className="text-xs">{itemTypeLabel(t)}</Badge>;
      },
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      id: "category",
      accessorFn: (row) => categoryNameById.get(String(row.category_id || "")) || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
      cell: ({ row }) => categoryNameById.get(String(row.original.category_id || "")) || "-",
    },
    {
      accessorKey: "unit_of_measure",
      header: ({ column }) => <DataTableColumnHeader column={column} title="UOM" />,
      cell: ({ row }) => row.original.unit_of_measure || "-",
    },
    {
      id: "barcodes",
      accessorFn: (row) => Number(row.barcode_count || 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Barcodes" />,
      cell: ({ row }) => <Badge variant="secondary">{row.original.barcode_count || 0}</Badge>,
    },
    {
      id: "status",
      accessorFn: (row) => (row.is_active === false ? "inactive" : "active"),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.is_active === false ? "inactive" : "active"} />,
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => (
        <Button size="sm" variant="outline" onClick={(e) => {
          e.stopPropagation();
          router.push(`/catalog/items/${row.original.id}/edit`);
        }}>
          Edit
        </Button>
      ),
    },
  ], [categoryNameById, router]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Items"
        description="Manage your product catalog"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => router.push("/catalog/items/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Item
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={loading}
        searchPlaceholder="Search by SKU, name, barcode, or brand..."
        onRowClick={(row) => router.push(`/catalog/items/${row.id}`)}
        onSearchChange={handleSearchChange}
        totalRows={total ?? undefined}
        filterableColumns={[
          {
            id: "status",
            title: "Status",
            options: [
              { label: "Active", value: "active" },
              { label: "Inactive", value: "inactive" },
            ],
          },
          {
            id: "item_type",
            title: "Type",
            options: [
              { label: "Stocked", value: "stocked" },
              { label: "Service", value: "service" },
              { label: "Bundle", value: "bundle" },
            ],
          },
        ]}
      />
    </div>
  );
}
