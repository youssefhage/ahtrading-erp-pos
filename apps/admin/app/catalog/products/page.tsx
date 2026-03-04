"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Package } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { EmptyState } from "@/components/business/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type CatalogRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit_of_measure: string;
  category_id?: string | null;
  brand: string | null;
  is_active?: boolean;
  tax_rate: number;
  price_usd: number;
  price_lbp: number;
  total_usd: number;
  total_lbp: number;
  barcodes: string;
};

type Category = { id: string; name: string; parent_id: string | null; is_active: boolean };
type PriceList = { id: string; code: string; name: string; currency: string; is_default: boolean };

function fmtUsd(v: number | null | undefined): string {
  if (v == null || v === 0) return "-";
  return `$ ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function ProductCatalogPage() {
  const router = useRouter();

  const [items, setItems] = useState<CatalogRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [selectedPriceList, setSelectedPriceList] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  /* ---- Load reference data once ---- */
  useEffect(() => {
    Promise.all([
      apiGet<{ categories: Category[] }>("/item-categories").catch(() => ({ categories: [] })),
      apiGet<{ lists: PriceList[] }>("/pricing/lists").catch(() => ({ lists: [] })),
    ]).then(([catRes, plRes]) => {
      setCategories(catRes.categories || []);
      const lists = plRes.lists || [];
      setPriceLists(lists);
      // Pre-select the default price list
      const def = lists.find((l) => l.is_default);
      if (def) setSelectedPriceList(def.id);
    });
  }, []);

  /* ---- Load catalog items ---- */
  const load = useCallback(async (search?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      const term = (search ?? q).trim();
      if (term) params.set("q", term);
      if (selectedPriceList) params.set("price_list_id", selectedPriceList);
      const res = await apiGet<{ items: CatalogRow[]; total?: number }>(
        `/items/catalog?${params}`,
      );
      setItems(res.items || []);
      setTotal(typeof res.total === "number" ? res.total : null);
    } catch {
      setItems([]);
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, [q, selectedPriceList]);

  useEffect(() => {
    const t = setTimeout(() => load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const handleSearchChange = useCallback((value: string) => setQ(value), []);

  /* ---- Columns ---- */
  const columns = useMemo<ColumnDef<CatalogRow>[]>(() => [
    {
      accessorKey: "sku",
      header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
      cell: ({ row }) => (
        <Link
          href={`/catalog/items/${encodeURIComponent(row.original.id)}`}
          className="font-mono text-xs text-primary hover:underline whitespace-nowrap"
        >
          {row.original.sku}
        </Link>
      ),
    },
    {
      accessorFn: (r) => r.barcodes || "",
      id: "barcodes",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Barcode" />,
      cell: ({ row }) => (
        <span
          className="font-mono text-xs max-w-[200px] truncate block"
          title={row.original.barcodes || ""}
        >
          {row.original.barcodes || "-"}
        </span>
      ),
    },
    {
      accessorFn: (r) => r.description || r.name,
      id: "description",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
      cell: ({ row }) => (
        <span
          className="max-w-[250px] truncate block"
          title={row.original.description || row.original.name}
        >
          {row.original.description || row.original.name}
        </span>
      ),
    },
    {
      accessorKey: "unit_of_measure",
      header: ({ column }) => <DataTableColumnHeader column={column} title="UOM" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{row.original.unit_of_measure || "-"}</span>
      ),
    },
    {
      accessorFn: (r) => r.total_usd,
      id: "total",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs whitespace-nowrap text-right block">
          {fmtUsd(row.original.total_usd)}
        </span>
      ),
    },
    {
      accessorFn: (r) => categoryNameById.get(String(r.category_id || "")) || "",
      id: "category",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
      cell: ({ row }) => {
        const name = categoryNameById.get(String(row.original.category_id || ""));
        return name
          ? <span className="max-w-[150px] truncate block" title={name}>{name}</span>
          : "-";
      },
    },
    {
      accessorFn: (r) => r.brand || "",
      id: "brand",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Brand" />,
      cell: ({ row }) =>
        row.original.brand ? (
          <Badge variant="outline" className="text-xs whitespace-nowrap">
            {row.original.brand}
          </Badge>
        ) : (
          "-"
        ),
    },
    {
      accessorFn: (r) => r.price_usd,
      id: "price",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Price" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs whitespace-nowrap text-right block">
          {fmtUsd(row.original.price_usd)}
        </span>
      ),
    },
  ], [categoryNameById]);

  /* ---- Selected price list label ---- */
  const plLabel = priceLists.find((l) => l.id === selectedPriceList)?.name || "Default";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Product Catalog"
        description={
          total != null
            ? `${total.toLocaleString("en-US")} products`
            : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            {priceLists.length > 0 && (
              <Select value={selectedPriceList} onValueChange={setSelectedPriceList}>
                <SelectTrigger className="w-[200px] h-9 text-xs">
                  <SelectValue placeholder="Price List" />
                </SelectTrigger>
                <SelectContent>
                  {priceLists.map((pl) => (
                    <SelectItem key={pl.id} value={pl.id}>
                      {pl.name}{pl.is_default ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {!loading && items.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products found"
          description={q ? "Try a different search term." : "No products in this catalog yet."}
          action={
            q
              ? { label: "Clear Search", onClick: () => setQ("") }
              : { label: "Add Item", onClick: () => router.push("/catalog/items/new") }
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          isLoading={loading}
          searchPlaceholder="Search by SKU, name, barcode, or brand..."
          onSearchChange={handleSearchChange}
          onRowClick={(r) => router.push(`/catalog/items/${encodeURIComponent(r.id)}`)}
          totalRows={total ?? undefined}
          filterableColumns={[
            {
              id: "category",
              title: "Category",
              options: categories.map((c) => ({ label: c.name, value: c.name })),
            },
          ]}
          toolbarActions={
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Prices: <span className="font-medium">{plLabel}</span>
            </span>
          }
        />
      )}
    </div>
  );
}
