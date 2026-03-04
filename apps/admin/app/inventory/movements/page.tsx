"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDownRight, ArrowUpRight, GitCompare, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { KpiCard } from "@/components/business/kpi-card";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { ItemTypeahead, type ItemTypeaheadItem } from "@/components/item-typeahead";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Warehouse = { id: string; name: string };

type MoveRow = {
  id: string;
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  warehouse_id: string;
  warehouse_name?: string | null;
  location_id?: string | null;
  batch_id: string | null;
  qty_in: string | number;
  qty_out: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
};

function toNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function InventoryMovementsPage() {
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  const [itemId, setItemId] = useState("");
  const [itemFilterLabel, setItemFilterLabel] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [limit, setLimit] = useState("200");

  const SOURCE_TYPES = [
    { value: "", label: "All sources" },
    { value: "sale", label: "Sale" },
    { value: "pos_sale", label: "POS Sale" },
    { value: "goods_receipt", label: "Goods Receipt" },
    { value: "stock_transfer", label: "Stock Transfer" },
    { value: "cycle_count", label: "Cycle Count" },
    { value: "adjustment", label: "Adjustment" },
  ];

  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (itemId) qs.set("item_id", itemId);
      if (warehouseId) qs.set("warehouse_id", warehouseId);
      if (sourceType.trim()) qs.set("source_type", sourceType.trim());
      if (dateFrom) qs.set("from", dateFrom);
      if (dateTo) qs.set("to", dateTo);
      const n = Number(limit || 200);
      qs.set("limit", Number.isFinite(n) ? String(n) : "200");

      const [m, w] = await Promise.all([
        apiGet<{ moves: MoveRow[] }>(`/inventory/moves?${qs.toString()}`),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
      ]);
      setMoves(m.moves || []);
      setWarehouses(w.warehouses || []);
    } catch {
      setMoves([]);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const summary = useMemo(() => {
    let totalIn = 0, totalOut = 0;
    for (const m of moves) {
      totalIn += toNum(m.qty_in);
      totalOut += toNum(m.qty_out);
    }
    return { total: moves.length, totalIn, totalOut };
  }, [moves]);

  const columns = useMemo<ColumnDef<MoveRow>[]>(() => [
    {
      id: "created_at",
      accessorFn: (m) => m.created_at,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.created_at}</span>,
    },
    {
      id: "item",
      accessorFn: (m) => `${m.item_sku || ""} ${m.item_name || ""} ${m.item_id}`.trim(),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => {
        const m = row.original;
        return (
          <Link href={`/catalog/items/${encodeURIComponent(m.item_id)}`} className="hover:underline">
            <span className="font-mono text-xs">{m.item_sku || m.item_id}</span>
            {m.item_name ? ` \u00b7 ${m.item_name}` : ""}
          </Link>
        );
      },
    },
    {
      id: "warehouse",
      accessorFn: (m) => m.warehouse_name || whById.get(m.warehouse_id)?.name || m.warehouse_id,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" />,
    },
    {
      id: "location_id",
      accessorFn: (m) => m.location_id || "-",
      header: "Location",
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.location_id ? String(row.original.location_id).slice(0, 8) : "-"}</span>,
    },
    {
      id: "qty_in",
      accessorFn: (m) => toNum(m.qty_in),
      header: ({ column }) => <DataTableColumnHeader column={column} title="In" />,
      cell: ({ row }) => {
        const v = toNum(row.original.qty_in);
        return <span className={`font-mono text-sm ${v > 0 ? "text-success" : "text-muted-foreground"}`}>{v.toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>;
      },
    },
    {
      id: "qty_out",
      accessorFn: (m) => toNum(m.qty_out),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Out" />,
      cell: ({ row }) => {
        const v = toNum(row.original.qty_out);
        return <span className={`font-mono text-sm ${v > 0 ? "text-destructive" : "text-muted-foreground"}`}>{v.toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>;
      },
    },
    {
      id: "unit_cost_usd",
      accessorFn: (m) => toNum(m.unit_cost_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Unit USD" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.unit_cost_usd)} currency="USD" />,
    },
    {
      id: "unit_cost_lbp",
      accessorFn: (m) => toNum(m.unit_cost_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Unit LBP" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.unit_cost_lbp)} currency="LBP" />,
    },
    {
      id: "source",
      accessorFn: (m) => `${m.source_type || ""} ${m.source_id || ""}`.trim(),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
      cell: ({ row }) => (
        <div>
          <span className="font-mono text-xs">{row.original.source_type || "-"}</span>
          {row.original.source_id ? <div className="text-xs text-muted-foreground">{row.original.source_id}</div> : null}
        </div>
      ),
    },
  ], [whById]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Movements"
        description="Stock movement history"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      >
        <Badge variant="outline">{moves.length} moves</Badge>
      </PageHeader>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard title="Total Movements" value={summary.total} icon={GitCompare} />
        <KpiCard title="Total Qty In" value={summary.totalIn.toLocaleString("en-US", { maximumFractionDigits: 0 })} icon={ArrowDownRight} trend="up" />
        <KpiCard title="Total Qty Out" value={summary.totalOut.toLocaleString("en-US", { maximumFractionDigits: 0 })} icon={ArrowUpRight} trend="down" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-3 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Item</label>
            <ItemTypeahead
              placeholder={itemFilterLabel || "All items"}
              onSelect={(it: ItemTypeaheadItem) => { setItemId(it.id); setItemFilterLabel(`${it.sku} \u00b7 ${it.name}`); }}
              onClear={() => { setItemId(""); setItemFilterLabel(""); }}
            />
          </div>
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Warehouse</label>
            <SearchableSelect
              value={warehouseId}
              onChange={setWarehouseId}
              placeholder="All warehouses"
              searchPlaceholder="Search warehouses..."
              options={[{ value: "", label: "All warehouses" }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
            />
          </div>
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Source Type</label>
            <SearchableSelect
              value={sourceType}
              onChange={setSourceType}
              placeholder="All sources"
              searchPlaceholder="Search..."
              options={SOURCE_TYPES}
            />
          </div>
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="md:col-span-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Limit</label>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <DataTable columns={columns} data={moves} isLoading={loading} searchPlaceholder="Search item / warehouse / source..." />
    </div>
  );
}
