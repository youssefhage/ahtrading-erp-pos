"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };

type ExpiryRow = {
  item_id: string;
  warehouse_id: string;
  batch_id: string;
  batch_no: string | null;
  expiry_date: string | null;
  status?: string | null;
  hold_reason?: string | null;
  qty_on_hand: string | number;
};

type ReorderRow = {
  item_id: string;
  sku: string;
  name: string;
  reorder_point: string | number;
  reorder_qty: string | number;
  warehouse_id: string;
  qty_on_hand: string | number;
};

type AiRecRow = {
  id: string;
  agent_code: string;
  status: string;
  recommendation_json: any;
  created_at: string;
};

export default function InventoryAlertsPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [aiExpiryOps, setAiExpiryOps] = useState<AiRecRow[]>([]);

  const [days, setDays] = useState("30");
  const [expiry, setExpiry] = useState<ExpiryRow[]>([]);
  const [reorder, setReorder] = useState<ReorderRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function loadBase() {
    const [i, w] = await Promise.all([apiGet<{ items: Item[] }>("/items/min"), apiGet<{ warehouses: Warehouse[] }>("/warehouses")]);
    setItems(i.items || []);
    setWarehouses(w.warehouses || []);
  }

  async function loadExpiry() {
    const n = Math.max(1, Math.min(3650, Number(days || 30)));
    const res = await apiGet<{ rows: ExpiryRow[] }>(`/inventory/expiry-alerts?days=${encodeURIComponent(String(n))}`);
    setExpiry(res.rows || []);
  }

  async function loadReorder() {
    const qs = new URLSearchParams();
    if (warehouseId) qs.set("warehouse_id", warehouseId);
    const res = await apiGet<{ rows: ReorderRow[] }>(`/inventory/reorder-alerts${qs.toString() ? `?${qs.toString()}` : ""}`);
    setReorder(res.rows || []);
  }

  async function loadAi() {
    // AI is optional: don't block the alerts page if ai:read is missing.
    try {
      const ai = await apiGet<{ recommendations: AiRecRow[] }>("/ai/recommendations?status=pending&agent_code=AI_EXPIRY_OPS&limit=12");
      setAiExpiryOps(ai.recommendations || []);
    } catch {
      setAiExpiryOps([]);
    }
  }

  async function loadAll() {
    setLoading(true);
    setStatus("Loading...");
    try {
      await loadBase();
      await Promise.all([loadExpiry(), loadReorder(), loadAi()]);
      setStatus("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadReorder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  const aiColumns = useMemo((): Array<DataTableColumn<AiRecRow>> => {
    return [
      {
        id: "expiry",
        header: "Expiry",
        sortable: true,
        accessor: (r) => String((r as any).recommendation_json?.expiry_date || ""),
        cell: (r) => (
          <span className="font-mono text-xs text-fg-muted">{String((r as any).recommendation_json?.expiry_date || "").slice(0, 10) || "-"}</span>
        ),
      },
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (r) => `${String((r as any).recommendation_json?.sku || "")} ${String((r as any).recommendation_json?.item_name || "")}`,
        cell: (r) => (
          <div>
            <div className="font-mono text-xs">{String((r as any).recommendation_json?.sku || "-")}</div>
            <div className="text-xs text-fg-muted">{String((r as any).recommendation_json?.item_name || "")}</div>
          </div>
        ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        sortable: true,
        accessor: (r) => String((r as any).recommendation_json?.warehouse_name || (r as any).recommendation_json?.warehouse_id || ""),
        cell: (r) => <span className="text-xs">{String((r as any).recommendation_json?.warehouse_name || (r as any).recommendation_json?.warehouse_id || "-")}</span>,
      },
      {
        id: "batch",
        header: "Batch",
        sortable: true,
        accessor: (r) => String((r as any).recommendation_json?.batch_no || ""),
        cell: (r) => <span className="font-mono text-xs">{String((r as any).recommendation_json?.batch_no || "-")}</span>,
      },
      {
        id: "qty",
        header: "Qty",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number((r as any).recommendation_json?.qty_on_hand || 0),
        cell: (r) => <span className="font-mono text-xs">{String((r as any).recommendation_json?.qty_on_hand || "0")}</span>,
      },
    ];
  }, []);

  const expiryColumns = useMemo((): Array<DataTableColumn<ExpiryRow>> => {
    return [
      {
        id: "expiry_date",
        header: "Expiry",
        sortable: true,
        accessor: (r) => String(r.expiry_date || ""),
        cell: (r) => <span className="font-mono text-xs">{(r.expiry_date || "").slice(0, 10) || "-"}</span>,
      },
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (r) => {
          const it = itemById.get(r.item_id);
          return `${it?.sku || ""} ${it?.name || ""} ${r.item_id || ""}`;
        },
        cell: (r) => {
          const it = itemById.get(r.item_id);
          return it ? (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(r.item_id)}`} title="Open item">
              <span className="font-mono text-xs">{it.sku}</span> · {it.name}
            </ShortcutLink>
          ) : (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(r.item_id)}`} title="Open item" className="font-mono text-xs">
              {r.item_id}
            </ShortcutLink>
          );
        },
      },
      {
        id: "warehouse",
        header: "Warehouse",
        sortable: true,
        accessor: (r) => whById.get(r.warehouse_id)?.name || r.warehouse_id,
        cell: (r) => <span className="text-sm">{whById.get(r.warehouse_id)?.name || r.warehouse_id}</span>,
      },
      {
        id: "batch",
        header: "Batch",
        sortable: true,
        accessor: (r) => r.batch_no || r.batch_id,
        cell: (r) => <span className="font-mono text-xs">{r.batch_no || "-"}</span>,
      },
      {
        id: "status",
        header: "Status",
        sortable: true,
        accessor: (r) => (r.status as any) || "available",
        cell: (r) => (
          <div className="text-xs">
            <span className="rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-[10px] text-fg-muted">
              {(r.status as any) || "available"}
            </span>
            {r.hold_reason ? <span className="ml-2 text-[10px] text-fg-subtle">{r.hold_reason}</span> : null}
          </div>
        ),
      },
      {
        id: "qty_on_hand",
        header: "Qty",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.qty_on_hand || 0),
        cell: (r) => (
          <span className="font-mono text-xs">{Number(r.qty_on_hand || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>
        ),
      },
    ];
  }, [itemById, whById]);

  const reorderColumns = useMemo((): Array<DataTableColumn<ReorderRow>> => {
    return [
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (r) => `${r.sku || ""} ${r.name || ""}`,
        cell: (r) => (
          <ShortcutLink href={`/catalog/items/${encodeURIComponent(r.item_id)}`} title="Open item">
            <span className="font-mono text-xs">{r.sku}</span> · {r.name}
          </ShortcutLink>
        ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        sortable: true,
        accessor: (r) => whById.get(r.warehouse_id)?.name || r.warehouse_id,
        cell: (r) => <span className="text-sm">{whById.get(r.warehouse_id)?.name || r.warehouse_id}</span>,
      },
      {
        id: "qty_on_hand",
        header: "On Hand",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.qty_on_hand || 0),
        cell: (r) => (
          <span className="font-mono text-xs">{Number(r.qty_on_hand || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>
        ),
      },
      {
        id: "reorder_point",
        header: "Reorder Point",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.reorder_point || 0),
        cell: (r) => (
          <span className="font-mono text-xs">{Number(r.reorder_point || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>
        ),
      },
      {
        id: "reorder_qty",
        header: "Reorder Qty",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.reorder_qty || 0),
        cell: (r) => (
          <span className="font-mono text-xs">{Number(r.reorder_qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>
        ),
      },
    ];
  }, [whById]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? <ErrorBanner error={status} onRetry={loadAll} /> : null}

        {aiExpiryOps.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI: Expiry Ops</CardTitle>
              <CardDescription>{aiExpiryOps.length} pending suggestions (batches expiring soon with stock on hand).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <DataTable<AiRecRow>
                tableId="inventory.alerts.ai_expiry_ops"
                rows={aiExpiryOps.slice(0, 8)}
                columns={aiColumns}
                getRowId={(r) => r.id}
                enableGlobalFilter={false}
                enablePagination={false}
              />
              <div className="flex justify-end">
                <Button asChild variant="outline" size="sm">
                  <a href="/automation/ai-hub">Open AI Hub</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={loadAll}>
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Expiry Alerts</CardTitle>
            <CardDescription>Batches expiring soon that still have stock.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="w-full md:w-64 space-y-1">
                <label className="text-xs font-medium text-fg-muted">Days Ahead</label>
                <Input value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
              <Button variant="outline" onClick={loadExpiry}>
                Apply
              </Button>
            </div>
            <DataTable<ExpiryRow>
              tableId="inventory.alerts.expiry"
              rows={expiry}
              columns={expiryColumns}
              getRowId={(r, idx) => `${r.batch_id}:${r.warehouse_id}:${idx}`}
              isLoading={loading}
              emptyText={loading ? "Loading..." : "No expiring batches found."}
              globalFilterPlaceholder="Search item / sku / batch / warehouse"
              initialSort={{ columnId: "expiry_date", dir: "asc" }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reorder Alerts</CardTitle>
            <CardDescription>Items below reorder point.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DataTable<ReorderRow>
              tableId="inventory.alerts.reorder"
              rows={reorder}
              columns={reorderColumns}
              getRowId={(r, idx) => `${r.item_id}:${r.warehouse_id}:${idx}`}
              isLoading={loading}
              emptyText={loading ? "Loading..." : "No reorder alerts."}
              globalFilterPlaceholder="Search item / sku / warehouse"
              toolbarLeft={
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-96">
                    <SearchableSelect
                      value={warehouseId}
                      onChange={setWarehouseId}
                      placeholder="All warehouses"
                      searchPlaceholder="Search warehouses..."
                      options={[{ value: "", label: "All warehouses" }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
                    />
                  </div>
                  <Button variant="outline" onClick={loadReorder}>
                    Refresh
                  </Button>
                </div>
              }
              initialSort={{ columnId: "qty_on_hand", dir: "asc" }}
            />
          </CardContent>
        </Card>
      </div>);
}
