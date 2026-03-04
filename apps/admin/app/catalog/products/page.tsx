"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, RefreshCw, Package } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { apiGet } from "@/lib/api";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
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

type CatalogRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit_of_measure: string;
  category_id?: string | null;
  brand: string | null;
  is_active?: boolean;
  tax_template: string;
  tax_rate: number;
  selling_price_usd: number;
  selling_price_lbp: number;
  total_usd: number;
  total_lbp: number;
  barcodes: string;
};

type Category = { id: string; name: string; parent_id: string | null; is_active: boolean };

const SEARCH_DEBOUNCE_MS = 150;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = String(target.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

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
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [pageSize] = useState(50);
  const [page, setPage] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const offset = page * pageSize;
  const trimmedQ = q.trim();
  const query = useMemo(() => ({ q: trimmedQ, includeInactive, pageSize, offset }), [trimmedQ, includeInactive, pageSize, offset]);
  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const rankedItems = useMemo(() => {
    if (!trimmedQ) return items;
    return filterAndRankByFuzzy(items, trimmedQ, (p) => {
      const category = categoryNameById.get(String(p.category_id || "")) || "";
      return `${p.sku} ${p.name} ${p.barcodes || ""} ${p.brand || ""} ${category} ${p.description || ""}`;
    });
  }, [items, trimmedQ, categoryNameById]);

  const topMatch = rankedItems.length ? rankedItems[0] : null;

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams();
      params.set("limit", String(query.pageSize));
      params.set("offset", String(query.offset));
      if (query.q) params.set("q", query.q);
      if (query.includeInactive) params.set("include_inactive", "true");
      const res = await apiGet<{ items: CatalogRow[]; total?: number }>(`/items/catalog?${params.toString()}`);
      setItems(res.items || []);
      setTotal(typeof res.total === "number" ? res.total : null);
    } catch (e) {
      setItems([]);
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

  const columns = useMemo<ColumnDef<CatalogRow>[]>(() => [
    {
      accessorKey: "sku",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item Code" />,
      cell: ({ row }) => (
        <Link href={`/catalog/items/${encodeURIComponent(row.original.id)}`} className="font-mono text-xs text-primary hover:underline whitespace-nowrap">
          {row.original.sku}
        </Link>
      ),
    },
    {
      accessorFn: (r) => r.barcodes || "",
      id: "barcodes",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Barcode" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs max-w-[200px] truncate block" title={row.original.barcodes || ""}>
          {row.original.barcodes || "-"}
        </span>
      ),
    },
    {
      accessorFn: (r) => r.description || r.name,
      id: "description",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
      cell: ({ row }) => (
        <span className="max-w-[250px] truncate block" title={row.original.description || row.original.name}>
          {row.original.description || row.original.name}
        </span>
      ),
    },
    {
      accessorKey: "unit_of_measure",
      header: ({ column }) => <DataTableColumnHeader column={column} title="UOM" />,
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.unit_of_measure || "-"}</span>,
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
      id: "item_group",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item Group" />,
      cell: ({ row }) => {
        const name = categoryNameById.get(String(row.original.category_id || ""));
        return name ? <span className="max-w-[150px] truncate block" title={name}>{name}</span> : "-";
      },
    },
    {
      accessorFn: (r) => r.brand || "",
      id: "brand",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Brand" />,
      cell: ({ row }) => row.original.brand ? (
        <Badge variant="outline" className="text-xs whitespace-nowrap">{row.original.brand}</Badge>
      ) : "-",
    },
    {
      accessorFn: (r) => r.selling_price_usd,
      id: "selling_price",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Standard Selling" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs whitespace-nowrap text-right block">
          {fmtUsd(row.original.selling_price_usd)}
        </span>
      ),
    },
  ], [categoryNameById]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title="Product Catalog"
        description="Quick price lookup and item information. Press / to focus search."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
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
        <CardHeader className="pb-3">
          <CardTitle>Quick Search</CardTitle>
          <CardDescription>
            {total != null ? `${total.toLocaleString("en-US")} matching products` : `${rankedItems.length} shown`}
            {loading ? " — searching..." : ""}
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
                placeholder="Start typing SKU, product name, barcode, or brand..."
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
                {topMatch.sku} — {topMatch.name}
                {topMatch.total_usd ? ` — ${fmtUsd(topMatch.total_usd)}` : ""}
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {err ? <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert> : null}

      {!loading && rankedItems.length === 0 ? (
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
          <CardHeader className="pb-3">
            <CardTitle>Results</CardTitle>
            <CardDescription>Hit Enter in search to open the top result. For comparison, use &gt;5, &lt;10 or =324.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={rankedItems}
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
