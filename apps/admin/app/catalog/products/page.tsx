"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, RefreshCw, Package } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function ProductCatalogPage() {
  const router = useRouter();

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const offset = page * pageSize;
  const trimmedQ = q.trim();
  const query = useMemo(() => ({ q: trimmedQ, includeInactive, pageSize, offset }), [trimmedQ, includeInactive, pageSize, offset]);
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
    setErr("");
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
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query.pageSize, query.offset, query.q, query.includeInactive]);

  const loadCategories = useCallback(async () => {
    try {
      const cats = await apiGet<{ categories: Category[] }>("/item-categories");
      setCategories(cats.categories || []);
    } catch { setCategories([]); }
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { const t = window.setTimeout(() => load(), SEARCH_DEBOUNCE_MS); return () => window.clearTimeout(t); }, [load]);
  useEffect(() => { setPage(0); }, [trimmedQ, includeInactive]);
  useEffect(() => { const t = window.setTimeout(() => searchRef.current?.focus(), 40); return () => window.clearTimeout(t); }, []);

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

  const columns = useMemo<ColumnDef<ProductRow>[]>(() => [
    {
      accessorKey: "sku",
      header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
      cell: ({ row }) => (
        <Link href={`/catalog/items/${encodeURIComponent(row.original.id)}`} className="font-mono text-xs text-primary hover:underline">
          {row.original.sku}
        </Link>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Product" />,
      cell: ({ row }) => (
        <Link href={`/catalog/items/${encodeURIComponent(row.original.id)}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorFn: (p) => p.barcode || "",
      id: "barcode",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Barcode" />,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.barcode || "-"}</span>,
    },
    {
      accessorFn: (p) => Number(p.barcode_count || 0),
      id: "barcode_count",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Codes" />,
      cell: ({ row }) => <Badge variant="secondary">{row.original.barcode_count || 0}</Badge>,
    },
    {
      accessorKey: "unit_of_measure",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Unit" />,
      cell: ({ row }) => row.original.unit_of_measure || "-",
    },
    {
      accessorFn: (p) => categoryNameById.get(String(p.category_id || "")) || "",
      id: "category",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
      cell: ({ row }) => categoryNameById.get(String(row.original.category_id || "")) || "-",
    },
    {
      accessorFn: (p) => (p.is_active === false ? "inactive" : "active"),
      id: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.is_active === false ? "inactive" : "active"} />,
    },
    {
      accessorFn: (p) => p.updated_at || "",
      id: "updated_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateLike(row.original.updated_at, "-")}</span>,
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/catalog/items/${encodeURIComponent(row.original.id)}/edit`}>Edit</Link>
          </Button>
        </div>
      ),
    },
  ], [categoryNameById]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title="Product Catalog"
        description="Search products by SKU, name, or barcode. Press / anywhere to focus search."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" asChild>
              <Link href="/catalog/items/list">Advanced List</Link>
            </Button>
            <Button asChild>
              <Link href="/catalog/items/new"><Plus className="mr-2 h-4 w-4" /> New Item</Link>
            </Button>
          </>
        }
      />

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Search</CardTitle>
          <CardDescription>
            {total != null ? `${total.toLocaleString("en-US")} matching products` : `${rankedProducts.length} shown`}
            {loading ? " -- searching..." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[280px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
              {includeInactive ? "Active + Inactive" : "Active Only"}
            </Button>
            {q ? <Button type="button" variant="ghost" onClick={() => setQ("")}>Clear</Button> : null}
          </div>

          {topMatch && trimmedQ ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <span className="font-medium">Top match:</span>{" "}
              <Link href={`/catalog/items/${encodeURIComponent(topMatch.id)}`} className="font-medium text-primary hover:underline">
                {topMatch.sku} -- {topMatch.name}
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {err ? <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert> : null}

      {!loading && rankedProducts.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={Package}
              title="No products found"
              description={trimmedQ ? "Try another SKU, barcode, or product keyword." : "No products are available yet."}
              action={{
                label: trimmedQ ? "Clear Search" : "Create Product",
                onClick: () => { if (trimmedQ) { setQ(""); return; } router.push("/catalog/items/new"); },
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>Hit Enter in search to open the top result instantly.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={rankedProducts}
              isLoading={loading}
              searchPlaceholder="Filter results..."
              onRowClick={(r) => router.push(`/catalog/items/${encodeURIComponent(r.id)}`)}
              pageSize={pageSize}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
