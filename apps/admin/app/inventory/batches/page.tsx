"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { SearchableSelect } from "@/components/searchable-select";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Item = { id: string; sku: string; name: string };

type BatchRow = {
  id: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  batch_no: string | null;
  expiry_date: string | null;
  status: "available" | "quarantine" | "expired";
  hold_reason: string | null;
  notes: string | null;
  received_at: string | null;
  received_source_type: string | null;
  received_source_id: string | null;
  received_supplier_name: string | null;
  created_at: string;
  updated_at: string;
};

type CostLayerRow = {
  id: string;
  batch_id: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  location_id: string | null;
  location_code: string | null;
  location_name: string | null;
  source_type: string;
  source_id: string;
  goods_receipt_no: string | null;
  source_line_type: string | null;
  source_line_id: string | null;
  qty: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
  landed_cost_total_usd: string | number;
  landed_cost_total_lbp: string | number;
  notes: string | null;
  created_at: string;
};

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

export default function InventoryBatchesPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [rows, setRows] = useState<BatchRow[]>([]);

  const [filterItemId, setFilterItemId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [expFrom, setExpFrom] = useState("");
  const [expTo, setExpTo] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editStatus, setEditStatus] = useState<"available" | "quarantine" | "expired">("available");
  const [editHoldReason, setEditHoldReason] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [layersOpen, setLayersOpen] = useState(false);
  const [layersBatch, setLayersBatch] = useState<BatchRow | null>(null);
  const [layersRows, setLayersRows] = useState<CostLayerRow[]>([]);
  const [layersLoading, setLayersLoading] = useState(false);

  const openEdit = useCallback((b: BatchRow) => {
    setEditId(b.id);
    setEditStatus(b.status);
    setEditHoldReason(b.hold_reason || "");
    setEditNotes(b.notes || "");
    setEditOpen(true);
  }, []);

  const openLayers = useCallback(async (b: BatchRow) => {
    setLayersBatch(b);
    setLayersRows([]);
    setLayersOpen(true);
    setLayersLoading(true);
    try {
      const res = await apiGet<{ cost_layers: CostLayerRow[] }>(`/inventory/batches/${encodeURIComponent(b.id)}/cost-layers?limit=200`);
      setLayersRows(res.cost_layers || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg);
      setLayersRows([]);
    } finally {
      setLayersLoading(false);
    }
  }, []);

  const batchColumns = useMemo((): Array<DataTableColumn<BatchRow>> => {
    return [
      {
        id: "item",
        header: "Item",
        accessor: (b) => {
          const it = itemById.get(b.item_id);
          return `${it?.sku || b.item_sku || ""} ${it?.name || b.item_name || ""}`.trim();
        },
        cell: (b) => {
          const it = itemById.get(b.item_id);
          return (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(b.item_id)}`} title="Open item">
              <span className="font-mono text-xs">{it?.sku || b.item_sku || "-"}</span> · {it?.name || b.item_name || "-"}
            </ShortcutLink>
          );
        },
      },
      { id: "batch_no", header: "Batch", accessor: (b) => b.batch_no || "", mono: true, sortable: true },
      { id: "expiry_date", header: "Expiry", accessor: (b) => b.expiry_date || "", mono: true, sortable: true, cell: (b) => fmtIso(b.expiry_date) },
      {
        id: "status",
        header: "Status",
        accessor: (b) => b.status,
        sortable: true,
        globalSearch: false,
        cell: (b) => (
          <div className="text-xs">
            <span className="rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-xs text-fg-muted">{b.status}</span>
            {b.hold_reason ? <span className="ml-2 text-xs text-fg-subtle">{b.hold_reason}</span> : null}
          </div>
        ),
      },
      {
        id: "received_at",
        header: "Received",
        accessor: (b) => b.received_at || "",
        sortable: true,
        globalSearch: false,
        cell: (b) => (
          <div className="text-xs text-fg-muted">
            <div className="data-mono">{fmtIso(b.received_at)}</div>
            <div className="text-fg-subtle">{(b.received_source_type || "-") + (b.received_supplier_name ? ` · ${b.received_supplier_name}` : "")}</div>
          </div>
        ),
      },
      {
        id: "actions",
        header: "",
        accessor: () => "",
        align: "right",
        globalSearch: false,
        cell: (b) => (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => openLayers(b)}>
              Costs
            </Button>
            <Button variant="outline" size="sm" onClick={() => openEdit(b)}>
              Edit
            </Button>
          </div>
        ),
      },
    ];
  }, [itemById, openEdit, openLayers]);

  const layerColumns = useMemo((): Array<DataTableColumn<CostLayerRow>> => {
    return [
      { id: "created_at", header: "Created", accessor: (r) => r.created_at || "", mono: true, sortable: true, cell: (r) => fmtIso(r.created_at) },
      {
        id: "source",
        header: "Source",
        accessor: (r) => `${r.source_type || ""} ${r.goods_receipt_no || ""} ${r.source_id || ""}`.trim(),
        cell: (r) => (
          <div className="text-xs">
            <div className="font-mono text-xs text-fg-muted">{r.source_type}</div>
            <div className="text-fg-subtle">{r.goods_receipt_no ? `GR ${r.goods_receipt_no}` : r.source_id}</div>
          </div>
        ),
      },
      { id: "warehouse_name", header: "Warehouse", accessor: (r) => r.warehouse_name || "-", sortable: true },
      {
        id: "location",
        header: "Location",
        accessor: (r) => `${r.location_code || ""} ${r.location_name || ""}`.trim(),
        cell: (r) => (
          <div className="text-xs">
            <div className="font-mono text-xs">{r.location_code || "-"}</div>
            {r.location_name ? <div className="text-xs text-fg-subtle">{r.location_name}</div> : null}
          </div>
        ),
      },
      { id: "qty", header: "Qty", accessor: (r) => Number(r.qty || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (r) => String(r.qty ?? "") },
      { id: "unit_cost_usd", header: "Unit USD", accessor: (r) => Number(r.unit_cost_usd || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (r) => String(r.unit_cost_usd ?? "") },
      { id: "unit_cost_lbp", header: "Unit LL", accessor: (r) => Number(r.unit_cost_lbp || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (r) => String(r.unit_cost_lbp ?? "") },
      { id: "landed_cost_total_usd", header: "Landed USD", accessor: (r) => Number(r.landed_cost_total_usd || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (r) => String(r.landed_cost_total_usd ?? "") },
      { id: "landed_cost_total_lbp", header: "Landed LL", accessor: (r) => Number(r.landed_cost_total_lbp || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (r) => String(r.landed_cost_total_lbp ?? "") },
    ];
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [it, batches] = await Promise.all([
        apiGet<{ items: Item[] }>("/items/min"),
        (async () => {
          const qs = new URLSearchParams();
          if (filterItemId) qs.set("item_id", filterItemId);
          if (filterStatus) qs.set("status", filterStatus);
          if (expFrom) qs.set("exp_from", expFrom);
          if (expTo) qs.set("exp_to", expTo);
          qs.set("limit", "500");
          return await apiGet<{ batches: BatchRow[] }>(`/inventory/batches?${qs.toString()}`);
        })()
      ]);
      setItems(it.items || []);
      setRows(batches.batches || []);
      setStatus("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg);
    } finally {
      setLoading(false);
    }
  }, [filterItemId, filterStatus, expFrom, expTo]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    if (editStatus === "quarantine" && !editHoldReason.trim()) return setStatus("hold_reason is required when status=quarantine");
    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/inventory/batches/${encodeURIComponent(editId)}`, {
        status: editStatus,
        hold_reason: editHoldReason.trim() || undefined,
        notes: editNotes.trim() || undefined
      });
      setEditOpen(false);
      setStatus("");
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-12">
          <div className="md:col-span-5">
            <label className="text-xs font-medium text-fg-muted">Item (optional)</label>
            <SearchableSelect
              value={filterItemId}
              onChange={setFilterItemId}
              placeholder="All items"
              searchPlaceholder="Search items..."
              maxOptions={120}
              options={[
                { value: "", label: "All items" },
                ...items.map((i) => ({ value: i.id, label: `${i.sku} · ${i.name}`, keywords: `${i.sku} ${i.name}` })),
              ]}
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs font-medium text-fg-muted">Status (optional)</label>
            <select className="ui-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              <option value="available">available</option>
              <option value="quarantine">quarantine</option>
              <option value="expired">expired</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-fg-muted">Expiry From</label>
            <Input type="date" value={expFrom} onChange={(e) => setExpFrom(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-fg-muted">Expiry To</label>
            <Input type="date" value={expTo} onChange={(e) => setExpTo(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Batches</CardTitle>
          <CardDescription>Manage lot status (available/quarantine/expired) and see receiving attribution.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<BatchRow>
            tableId="inventory.batches"
            rows={rows}
            columns={batchColumns}
            isLoading={loading}
            initialSort={{ columnId: "expiry_date", dir: "asc" }}
            globalFilterPlaceholder="Search item / batch..."
            emptyText="No batches."
          />
        </CardContent>
      </Card>

      <Dialog open={layersOpen} onOpenChange={setLayersOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Batch Cost Layers</DialogTitle>
            <DialogDescription>
              {layersBatch ? (
                <span className="font-mono text-xs">
                  {layersBatch.item_sku} · {layersBatch.batch_no || "-"} · exp {fmtIso(layersBatch.expiry_date)}
                </span>
              ) : (
                "Per-batch cost trace (goods receipt layers)."
              )}
            </DialogDescription>
          </DialogHeader>

          <DataTable<CostLayerRow>
            tableId="inventory.batches.costLayers"
            rows={layersRows}
            columns={layerColumns}
            isLoading={layersLoading}
            initialSort={{ columnId: "created_at", dir: "desc" }}
            globalFilterPlaceholder="Search source / warehouse / location..."
            emptyText="No cost layers recorded for this batch."
          />

          <div className="flex items-center justify-end">
            <Button variant="outline" onClick={() => setLayersOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Batch</DialogTitle>
            <DialogDescription>Use quarantine to block allocation; expired batches are never allocated.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Status</label>
              <select className="ui-select" value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)}>
                <option value="available">available</option>
                <option value="quarantine">quarantine</option>
                <option value="expired">expired</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Hold Reason</label>
              <Input value={editHoldReason} onChange={(e) => setEditHoldReason(e.target.value)} placeholder="Required when quarantined" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Notes</label>
              <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Optional notes" />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
