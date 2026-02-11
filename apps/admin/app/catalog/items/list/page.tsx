"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";

type ItemRow = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  barcode_count?: number;
  unit_of_measure: string;
  category_id?: string | null;
  is_active?: boolean;
  updated_at?: string | null;
};

type Category = { id: string; name: string; parent_id: string | null; is_active: boolean };

export default function ItemsListPage() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const offset = page * pageSize;
  const query = useMemo(() => ({ q: q.trim(), limit: pageSize, offset }), [q, pageSize, offset]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(query.limit));
      params.set("offset", String(query.offset));
      if (query.q) params.set("q", query.q);
      const res = await apiGet<{ items: ItemRow[]; total?: number }>(`/items/list?${params.toString()}`);
      setItems(res.items || []);
      setTotal(typeof res.total === "number" ? res.total : null);
    } catch (e) {
      setItems([]);
      setTotal(null);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [query.limit, query.offset, query.q]);

  const loadCategories = useCallback(async () => {
    try {
      const cats = await apiGet<{ categories: Category[] }>("/item-categories");
      setCategories(cats.categories || []);
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    setPage(0);
  }, [q, pageSize]);

  useEffect(() => {
    const t = window.setTimeout(() => load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<ItemRow>> = [
      {
        id: "sku",
        header: "SKU",
        sortable: true,
        mono: true,
        accessor: (i) => i.sku,
        cell: (i) => (
          <Link href={`/catalog/items/${encodeURIComponent(i.id)}`} className="ui-link font-mono text-xs">
            {i.sku}
          </Link>
        ),
      },
      {
        id: "name",
        header: "Name",
        sortable: true,
        accessor: (i) => i.name,
        cell: (i) => (
          <Link href={`/catalog/items/${encodeURIComponent(i.id)}`} className="ui-link font-medium">
            {i.name}
          </Link>
        ),
      },
      { id: "uom", header: "UOM", sortable: true, accessor: (i) => i.unit_of_measure || "-", defaultHidden: true },
      {
        id: "category",
        header: "Category",
        sortable: true,
        accessor: (i) => categoryNameById.get(String(i.category_id || "")) || "",
        cell: (i) => categoryNameById.get(String(i.category_id || "")) || "-",
        defaultHidden: true,
      },
      { id: "barcode", header: "Primary Barcode", sortable: true, accessor: (i) => i.barcode || "-", defaultHidden: true },
      {
        id: "barcode_count",
        header: "Barcodes",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (i) => Number(i.barcode_count || 0),
        cell: (i) => String(i.barcode_count || 0),
      },
      {
        id: "active",
        header: "Active",
        sortable: true,
        accessor: (i) => (i.is_active === false ? "No" : "Yes"),
        cell: (i) => <Chip variant={i.is_active === false ? "default" : "success"}>{i.is_active === false ? "No" : "Yes"}</Chip>,
      },
      {
        id: "actions",
        header: "Actions",
        align: "right",
        cell: (i) => (
          <div className="text-right">
            <Button asChild size="sm" variant="outline">
              <Link href={`/catalog/items/${encodeURIComponent(i.id)}/edit`}>Edit</Link>
            </Button>
          </div>
        ),
      },
    ];
    return cols;
  }, [categoryNameById]);

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Items</h1>
            <p className="text-sm text-fg-muted">Catalog items</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild>
              <Link href="/catalog/items/new">New Item</Link>
            </Button>
          </div>
        </div>
        <ErrorBanner error={err} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Items</h1>
          <p className="text-sm text-fg-muted">
            {total != null ? `${total.toLocaleString("en-US")} total` : `${items.length} shown`}
            {loading ? " · refreshing..." : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button asChild>
            <Link href="/catalog/items/new">New Item</Link>
          </Button>
        </div>
      </div>

      {!loading && items.length === 0 ? (
        <EmptyState title="No items yet" description="Create your first item to start selling and stocking." actionLabel="New Item" onAction={() => (window.location.href = "/catalog/items/new")} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Catalog</CardTitle>
            <CardDescription>Search by SKU, name, or barcode.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DataTable<ItemRow>
              tableId="catalog.items.list"
              rows={items}
              columns={columns}
              getRowId={(r) => r.id}
              initialSort={{ columnId: "sku", dir: "asc" }}
              globalFilterPlaceholder="SKU / name / barcode"
              globalFilterValue={q}
              onGlobalFilterValueChange={setQ}
              isLoading={loading}
              serverPagination={{
                page,
                pageSize,
                total,
                onPageChange: setPage,
                onPageSizeChange: setPageSize,
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
