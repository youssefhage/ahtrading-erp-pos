"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, Layers, RefreshCw, ShieldAlert } from "lucide-react";

import { apiGet, apiPatch } from "@/lib/api";
import { KpiCard } from "@/components/business/kpi-card";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { ItemTypeahead, type ItemTypeaheadItem } from "@/components/item-typeahead";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type BatchRow = {
  id: string; item_id: string; item_sku: string; item_name: string;
  batch_no: string | null; expiry_date: string | null;
  status: "available" | "quarantine" | "expired"; hold_reason: string | null; notes: string | null;
  received_at: string | null; received_source_type: string | null;
  received_source_id: string | null; received_supplier_name: string | null;
  created_at: string; updated_at: string;
};

type CostLayerRow = {
  id: string; batch_id: string; warehouse_id: string | null; warehouse_name: string | null;
  location_id: string | null; location_code: string | null; location_name: string | null;
  source_type: string; source_id: string; goods_receipt_no: string | null;
  source_line_type: string | null; source_line_id: string | null;
  qty: string | number; unit_cost_usd: string | number; unit_cost_lbp: string | number;
  line_total_usd: string | number; line_total_lbp: string | number;
  landed_cost_total_usd: string | number; landed_cost_total_lbp: string | number;
  notes: string | null; created_at: string;
};

function fmtIso(iso?: string | null) { return String(iso || "").slice(0, 10) || "-"; }
function toNum(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

const NEAR_EXPIRY_DAYS = 30;
function isNearExpiry(expiryDate: string | null) {
  if (!expiryDate) return false;
  const exp = new Date(expiryDate);
  const now = new Date();
  const diffMs = exp.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= NEAR_EXPIRY_DAYS;
}

export default function InventoryBatchesPage() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [filterItemId, setFilterItemId] = useState("");
  const [filterItemLabel, setFilterItemLabel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [expFrom, setExpFrom] = useState("");
  const [expTo, setExpTo] = useState("");

  // Edit batch dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editStatus, setEditStatus] = useState<"available" | "quarantine" | "expired">("available");
  const [editHoldReason, setEditHoldReason] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Cost layers dialog
  const [layersOpen, setLayersOpen] = useState(false);
  const [layersBatch, setLayersBatch] = useState<BatchRow | null>(null);
  const [layersRows, setLayersRows] = useState<CostLayerRow[]>([]);
  const [layersLoading, setLayersLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterItemId) qs.set("item_id", filterItemId);
      if (filterStatus) qs.set("status", filterStatus);
      if (expFrom) qs.set("exp_from", expFrom);
      if (expTo) qs.set("exp_to", expTo);
      qs.set("limit", "500");
      const res = await apiGet<{ batches: BatchRow[] }>(`/inventory/batches?${qs.toString()}`);
      setRows(res.batches || []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [filterItemId, filterStatus, expFrom, expTo]);

  useEffect(() => { load(); }, [load]);

  // Edit batch: track which batch is being edited for context display
  const [editBatch, setEditBatch] = useState<BatchRow | null>(null);

  const summary = useMemo(() => {
    let available = 0, quarantine = 0, expired = 0, nearExpiry = 0;
    for (const b of rows) {
      if (b.status === "available") available++;
      else if (b.status === "quarantine") quarantine++;
      else if (b.status === "expired") expired++;
      if (isNearExpiry(b.expiry_date)) nearExpiry++;
    }
    return { total: rows.length, available, quarantine, expired, nearExpiry };
  }, [rows]);

  const openLayers = useCallback(async (b: BatchRow) => {
    setLayersBatch(b); setLayersRows([]); setLayersOpen(true); setLayersLoading(true);
    try {
      const res = await apiGet<{ cost_layers: CostLayerRow[] }>(`/inventory/batches/${encodeURIComponent(b.id)}/cost-layers?limit=200`);
      setLayersRows(res.cost_layers || []);
    } catch { setLayersRows([]); }
    finally { setLayersLoading(false); }
  }, []);

  const openEdit = useCallback((b: BatchRow) => {
    setEditId(b.id); setEditBatch(b); setEditStatus(b.status); setEditHoldReason(b.hold_reason || "");
    setEditNotes(b.notes || ""); setEditOpen(true);
  }, []);

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setSaving(true);
    try {
      await apiPatch(`/inventory/batches/${encodeURIComponent(editId)}`, {
        status: editStatus, hold_reason: editHoldReason.trim() || undefined, notes: editNotes.trim() || undefined,
      });
      setEditOpen(false); await load();
    } catch (err) { setEditOpen(false); alert(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  }

  const batchColumns = useMemo<ColumnDef<BatchRow>[]>(() => [
    {
      id: "item", accessorFn: (b) => `${b.item_sku || ""} ${b.item_name || ""}`.trim(),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <Link href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`} className="hover:underline">
          <span className="font-mono text-xs">{row.original.item_sku || "-"}</span> {"\u00b7"} {row.original.item_name || "-"}
        </Link>
      ),
    },
    { accessorKey: "batch_no", header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />, cell: ({ row }) => <span className="font-mono text-xs">{row.original.batch_no || "-"}</span> },
    { id: "expiry_date", accessorFn: (b) => b.expiry_date || "", header: ({ column }) => <DataTableColumnHeader column={column} title="Expiry" />, cell: ({ row }) => {
      const near = isNearExpiry(row.original.expiry_date);
      return (
        <span className={`font-mono text-xs ${near ? "text-warning font-semibold" : ""}`}>
          {fmtIso(row.original.expiry_date)}
          {near && <AlertTriangle className="ml-1 inline h-3 w-3 text-warning" />}
        </span>
      );
    } },
    {
      id: "status", accessorFn: (b) => b.status,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={row.original.status} />
          {row.original.hold_reason && <span className="text-xs text-muted-foreground">{row.original.hold_reason}</span>}
        </div>
      ),
    },
    {
      id: "received_at", accessorFn: (b) => b.received_at || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Received" />,
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          <div className="font-mono">{fmtIso(row.original.received_at)}</div>
          <div>{(row.original.received_source_type || "-") + (row.original.received_supplier_name ? ` \u00b7 ${row.original.received_supplier_name}` : "")}</div>
        </div>
      ),
    },
    {
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => openLayers(row.original)}>Costs</Button>
          <Button variant="outline" size="sm" onClick={() => openEdit(row.original)}>Edit</Button>
        </div>
      ),
    },
  ], [openEdit, openLayers]);

  const layerColumns = useMemo<ColumnDef<CostLayerRow>[]>(() => [
    { id: "created_at", accessorFn: (r) => r.created_at, header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />, cell: ({ row }) => <span className="font-mono text-xs">{fmtIso(row.original.created_at)}</span> },
    {
      id: "source", accessorFn: (r) => `${r.source_type || ""} ${r.goods_receipt_no || ""}`.trim(),
      header: "Source",
      cell: ({ row }) => (
        <div className="text-xs">
          <div className="font-mono">{row.original.source_type}</div>
          <div className="text-muted-foreground">{row.original.goods_receipt_no ? `GR ${row.original.goods_receipt_no}` : row.original.source_id}</div>
        </div>
      ),
    },
    { id: "warehouse_name", accessorFn: (r) => r.warehouse_name || "-", header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" /> },
    { id: "qty", accessorFn: (r) => toNum(r.qty), header: ({ column }) => <DataTableColumnHeader column={column} title="Qty" />, cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.qty ?? "")}</span> },
    { id: "unit_cost_usd", accessorFn: (r) => toNum(r.unit_cost_usd), header: "Unit USD", cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.unit_cost_usd)} currency="USD" /> },
    { id: "unit_cost_lbp", accessorFn: (r) => toNum(r.unit_cost_lbp), header: "Unit LBP", cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.unit_cost_lbp)} currency="LBP" /> },
    { id: "landed_usd", accessorFn: (r) => toNum(r.landed_cost_total_usd), header: "Landed USD", cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.landed_cost_total_usd)} currency="USD" /> },
    { id: "landed_lbp", accessorFn: (r) => toNum(r.landed_cost_total_lbp), header: "Landed LBP", cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.landed_cost_total_lbp)} currency="LBP" /> },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Batch Tracking" description="Manage lot status and see receiving attribution">
        <Badge variant="outline">{rows.length} batches</Badge>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Total Batches" value={summary.total} icon={Layers} />
        <KpiCard title="Available" value={summary.available} icon={CheckCircle2} trend={summary.available > 0 ? "up" : "neutral"} />
        <KpiCard title="Quarantined" value={summary.quarantine} icon={ShieldAlert} trend={summary.quarantine > 0 ? "down" : "neutral"} />
        <KpiCard title="Expired" value={summary.expired} icon={AlertTriangle} trend={summary.expired > 0 ? "down" : "neutral"} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-5 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Item</label>
            <ItemTypeahead
              placeholder={filterItemLabel || "All items"}
              onSelect={(it: ItemTypeaheadItem) => { setFilterItemId(it.id); setFilterItemLabel(`${it.sku} \u00b7 ${it.name}`); }}
              onClear={() => { setFilterItemId(""); setFilterItemLabel(""); }}
            />
          </div>
          <div className="md:col-span-3 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              <option value="available">Available</option>
              <option value="quarantine">Quarantine</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Expiry From</label>
            <Input type="date" value={expFrom} onChange={(e) => setExpFrom(e.target.value)} />
          </div>
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Expiry To</label>
            <Input type="date" value={expTo} onChange={(e) => setExpTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <DataTable
        columns={batchColumns}
        data={rows}
        isLoading={loading}
        searchPlaceholder="Search item / batch..."
        toolbarActions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* Cost Layers Dialog */}
      <Dialog open={layersOpen} onOpenChange={setLayersOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Batch Cost Layers</DialogTitle>
            <DialogDescription>
              {layersBatch ? <span className="font-mono text-xs">{layersBatch.item_sku} {"\u00b7"} {layersBatch.batch_no || "-"} {"\u00b7"} exp {fmtIso(layersBatch.expiry_date)}</span> : "Per-batch cost trace"}
            </DialogDescription>
          </DialogHeader>
          <DataTable columns={layerColumns} data={layersRows} isLoading={layersLoading} searchPlaceholder="Search source / warehouse..." />
          <div className="flex justify-end"><Button variant="outline" onClick={() => setLayersOpen(false)}>Close</Button></div>
        </DialogContent>
      </Dialog>

      {/* Edit Batch Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Batch</DialogTitle>
            <DialogDescription>
              {editBatch ? (
                <span className="font-mono text-xs">{editBatch.item_sku || "-"} {"\u00b7"} {editBatch.batch_no || "(no batch #)"} {"\u00b7"} exp {fmtIso(editBatch.expiry_date)}</span>
              ) : "Use quarantine to block allocation; expired batches are never allocated."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)}>
                <option value="available">Available</option>
                <option value="quarantine">Quarantine</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Hold Reason</label>
              <Input value={editHoldReason} onChange={(e) => setEditHoldReason(e.target.value)} placeholder="Required when quarantined" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Optional notes" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
