"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";

type ProductRow = {
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

const SEARCH_DEBOUNCE_MS = 150;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = String(target.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export default function ProductCatalogPage() {
  const router = useRouter();

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const offset = page * pageSize;
  const trimmedQ = q.trim();
  const query = useMemo(
    () => ({ q: trimmedQ, includeInactive, pageSize, offset }),
    [trimmedQ, includeInactive, pageSize, offset]
  );

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const rankedProducts = useMemo(() => {
    if (!trimmedQ) return products;
    return filterAndRankByFuzzy(products, trimmedQ, (p) => {
      const category = categoryNameById.get(String(p.category_id || "")) || "";
      return `${p.sku} ${p.name} ${p.barcode || ""} ${category}`;
    });
  }, [products, trimmedQ, categoryNameById]);

  const topMatch = rankedProducts.length ? rankedProducts[0] : null;

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(query.pageSize));
      params.set("offset", String(query.offset));
      if (query.q) params.set("q", query.q);
      if (query.includeInactive) params.set("include_inactive", "true");
      const res = await apiGet<{ items: ProductRow[]; total?: number }>(`/items/list?${params.toString()}`);
      setProducts(res.items || []);
      setTotal(typeof res.total === "number" ? res.total : null);
    } catch (e) {
      setProducts([]);
      setTotal(null);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [query.pageSize, query.offset, query.q, query.includeInactive]);

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
    const t = window.setTimeout(() => load(), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [trimmedQ, includeInactive]);

  useEffect(() => {
    const t = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<ProductRow>> = [
      {
        id: "sku",
        header: "SKU",
        sortable: true,
        mono: true,
        accessor: (p) => p.sku,
        cell: (p) => (
          <Link href={`/catalog/items/${encodeURIComponent(p.id)}`} className="ui-link font-mono text-xs">
            {p.sku}
          </Link>
        ),
      },
      {
        id: "name",
        header: "Product",
        sortable: true,
        accessor: (p) => p.name,
        cell: (p) => (
          <Link href={`/catalog/items/${encodeURIComponent(p.id)}`} className="ui-link font-medium">
            {p.name}
          </Link>
        ),
      },
      {
        id: "barcode",
        header: "Barcode",
        sortable: true,
        accessor: (p) => p.barcode || "",
        cell: (p) => p.barcode || "-",
      },
      {
        id: "barcode_count",
        header: "Codes",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (p) => Number(p.barcode_count || 0),
        cell: (p) => String(p.barcode_count || 0),
      },
      {
        id: "uom",
        header: "UOM",
        sortable: true,
        accessor: (p) => p.unit_of_measure || "-",
      },
      {
        id: "category",
        header: "Category",
        sortable: true,
        accessor: (p) => categoryNameById.get(String(p.category_id || "")) || "",
        cell: (p) => categoryNameById.get(String(p.category_id || "")) || "-",
        defaultHidden: true,
      },
      {
        id: "active",
        header: "Active",
        sortable: true,
        accessor: (p) => (p.is_active === false ? "No" : "Yes"),
        cell: (p) => <Chip variant={p.is_active === false ? "default" : "success"}>{p.is_active === false ? "No" : "Yes"}</Chip>,
      },
      {
        id: "updated_at",
        header: "Updated",
        sortable: true,
        accessor: (p) => p.updated_at || "",
        cell: (p) => formatDateLike(p.updated_at, "-"),
        defaultHidden: true,
      },
      {
        id: "actions",
        header: "Actions",
        align: "right",
        cell: (p) => (
          <div className="text-right">
            <Button asChild size="sm" variant="outline">
              <Link href={`/catalog/items/${encodeURIComponent(p.id)}/edit`}>Edit</Link>
            </Button>
          </div>
        ),
      },
    ];
    return cols;
  }, [categoryNameById]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Master Data</p>
            <h1 className="ui-module-title">Product Catalog</h1>
            <p className="ui-module-subtitle">
              Search products by SKU, name, or barcode. Press <span className="font-mono text-xs">/</span> anywhere to focus search.
            </p>
          </div>
          <div className="ui-module-actions">
            <Button variant="outline" onClick={load} disabled={loading}>
              Refresh
            </Button>
            <Button asChild variant="outline">
              <Link href="/catalog/items/list">Advanced List</Link>
            </Button>
            <Button asChild>
              <Link href="/catalog/items/new">New Item</Link>
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Search</CardTitle>
          <CardDescription>
            {total != null ? `${total.toLocaleString("en-US")} matching products` : `${rankedProducts.length} shown`}
            {loading ? " · searching..." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[280px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
              <Input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && topMatch) {
                    e.preventDefault();
                    router.push(`/catalog/items/${encodeURIComponent(topMatch.id)}`);
                  }
                }}
                placeholder="Start typing SKU, product name, or barcode..."
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              variant={includeInactive ? "default" : "outline"}
              onClick={() => setIncludeInactive((v) => !v)}
            >
              {includeInactive ? "Showing Active + Inactive" : "Active Only"}
            </Button>
            {q ? (
              <Button type="button" variant="ghost" onClick={() => setQ("")}>
                Clear
              </Button>
            ) : null}
          </div>

          {topMatch && trimmedQ ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <span className="font-medium text-foreground">Top match:</span>{" "}
              <Link href={`/catalog/items/${encodeURIComponent(topMatch.id)}`} className="ui-link font-medium">
                {topMatch.sku} · {topMatch.name}
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      {!loading && rankedProducts.length === 0 ? (
        <EmptyState
          title="No products found"
          description={trimmedQ ? "Try another SKU, barcode, or product keyword." : "No products are available yet."}
          actionLabel={trimmedQ ? "Clear Search" : "Create Product"}
          onAction={() => {
            if (trimmedQ) {
              setQ("");
              return;
            }
            router.push("/catalog/items/new");
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>Hit Enter in search to open the top result instantly.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<ProductRow>
              tableId="catalog.products.search"
              rows={rankedProducts}
              columns={columns}
              getRowId={(r) => r.id}
              enableGlobalFilter={false}
              onRowClick={(r) => router.push(`/catalog/items/${encodeURIComponent(r.id)}`)}
              isLoading={loading}
              serverPagination={{
                page,
                pageSize,
                total,
                onPageChange: setPage,
                onPageSizeChange: setPageSize,
              }}
              actions={
                <div className="text-xs text-fg-subtle">
                  Click a row to open details.
                </div>
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
