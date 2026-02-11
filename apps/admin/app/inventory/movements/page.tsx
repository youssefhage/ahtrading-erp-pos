"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ShortcutLink } from "@/components/shortcut-link";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };

type MoveRow = {
  id: string;
  item_id: string;
  warehouse_id: string;
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

export default function InventoryMovementsPage() {
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [status, setStatus] = useState("");

  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [limit, setLimit] = useState("200");

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const columns = useMemo((): Array<DataTableColumn<MoveRow>> => {
    return [
      { id: "created_at", header: "Created", accessor: (m) => m.created_at, mono: true, sortable: true, globalSearch: false },
      {
        id: "item",
        header: "Item",
        accessor: (m) => {
          const it = itemById.get(m.item_id);
          return `${it?.sku || ""} ${it?.name || ""} ${m.item_id}`.trim();
        },
        sortable: true,
        cell: (m) => {
          const it = itemById.get(m.item_id);
          return it ? (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(m.item_id)}`} title="Open item">
              <span className="font-mono text-xs">{it.sku}</span> · {it.name}
            </ShortcutLink>
          ) : (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(m.item_id)}`} title="Open item" className="font-mono text-xs">
              {m.item_id}
            </ShortcutLink>
          );
        },
      },
      {
        id: "warehouse",
        header: "Warehouse",
        accessor: (m) => whById.get(m.warehouse_id)?.name || m.warehouse_id,
        sortable: true,
        cell: (m) => whById.get(m.warehouse_id)?.name || m.warehouse_id,
      },
      { id: "location_id", header: "Location", accessor: (m) => (m.location_id ? String(m.location_id).slice(0, 8) : "-"), mono: true, sortable: true, globalSearch: false, cell: (m) => <span className="font-mono text-xs text-fg-muted">{m.location_id ? String(m.location_id).slice(0, 8) : "-"}</span> },
      { id: "qty_in", header: "In", accessor: (m) => Number(m.qty_in || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (m) => Number(m.qty_in || 0).toLocaleString("en-US", { maximumFractionDigits: 3 }) },
      { id: "qty_out", header: "Out", accessor: (m) => Number(m.qty_out || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (m) => Number(m.qty_out || 0).toLocaleString("en-US", { maximumFractionDigits: 3 }) },
      { id: "unit_cost_usd", header: "Unit USD", accessor: (m) => Number(m.unit_cost_usd || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (m) => Number(m.unit_cost_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 4 }) },
      { id: "unit_cost_lbp", header: "Unit LL", accessor: (m) => Number(m.unit_cost_lbp || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (m) => Number(m.unit_cost_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) },
      {
        id: "source",
        header: "Source",
        accessor: (m) => `${m.source_type || ""} ${m.source_id || ""}`.trim(),
        sortable: true,
        cell: (m) => (
          <div>
            <span className="font-mono text-xs">{m.source_type || "-"}</span>
            {m.source_id ? <div className="text-[10px] text-fg-subtle">{m.source_id}</div> : null}
          </div>
        ),
      },
    ];
  }, [itemById, whById]);

  async function load() {
    setStatus("Loading...");
    try {
      const qs = new URLSearchParams();
      if (itemId) qs.set("item_id", itemId);
      if (warehouseId) qs.set("warehouse_id", warehouseId);
      if (sourceType.trim()) qs.set("source_type", sourceType.trim());
      const n = Number(limit || 200);
      qs.set("limit", Number.isFinite(n) ? String(n) : "200");

      const [m, i, w] = await Promise.all([
        apiGet<{ moves: MoveRow[] }>(`/inventory/moves?${qs.toString()}`),
        apiGet<{ items: Item[] }>("/items/min"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses")
      ]);
      setMoves(m.moves || []);
      setItems(i.items || []);
      setWarehouses(w.warehouses || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>List the latest stock moves (most recent first).</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-fg-muted">Item</label>
            <SearchableSelect
              value={itemId}
              onChange={setItemId}
              placeholder="All items"
              searchPlaceholder="Search items..."
              maxOptions={120}
              options={[
                { value: "", label: "All items" },
                ...items.map((it) => ({ value: it.id, label: `${it.sku} · ${it.name}`, keywords: `${it.sku} ${it.name}` })),
              ]}
            />
          </div>
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-fg-muted">Warehouse</label>
            <SearchableSelect
              value={warehouseId}
              onChange={setWarehouseId}
              placeholder="All warehouses"
              searchPlaceholder="Search warehouses..."
              options={[
                { value: "", label: "All warehouses" },
                ...warehouses.map((w) => ({ value: w.id, label: w.name })),
              ]}
            />
          </div>
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-fg-muted">Source Type</label>
            <Input value={sourceType} onChange={(e) => setSourceType(e.target.value)} placeholder="sale / goods_receipt / cycle_count" />
          </div>
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-fg-muted">Limit</label>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
          <div className="md:col-span-4 flex items-center justify-end">
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Moves</CardTitle>
          <CardDescription>{moves.length} moves</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<MoveRow>
            tableId="inventory.movements"
            rows={moves}
            columns={columns}
            initialSort={{ columnId: "created_at", dir: "desc" }}
            globalFilterPlaceholder="Search item / warehouse / source..."
            emptyText="No moves."
          />
        </CardContent>
      </Card>
    </div>
  );
}
