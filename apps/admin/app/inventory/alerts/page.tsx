"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { recommendationView, type RecommendationView } from "@/lib/ai-recommendations";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Warehouse = { id: string; name: string };
type ExpiryRow = {
  item_id: string; item_sku?: string | null; item_name?: string | null;
  warehouse_id: string; warehouse_name?: string | null;
  batch_id: string; batch_no: string | null; expiry_date: string | null;
  status?: string | null; hold_reason?: string | null; qty_on_hand: string | number;
};
type ReorderRow = {
  item_id: string; sku: string; name: string;
  reorder_point: string | number; reorder_qty: string | number;
  warehouse_id: string; qty_on_hand: string | number;
};
type AiRecRow = {
  id: string; agent_code: string; status: string;
  recommendation_json: any; recommendation_view?: RecommendationView; created_at: string;
};

function toNum(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmt(v: unknown) { return toNum(v).toLocaleString("en-US", { maximumFractionDigits: 3 }); }

export default function InventoryAlertsPage() {
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [aiExpiryOps, setAiExpiryOps] = useState<AiRecRow[]>([]);
  const [days, setDays] = useState("30");
  const [expiry, setExpiry] = useState<ExpiryRow[]>([]);
  const [reorder, setReorder] = useState<ReorderRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function loadBase() { const w = await apiGet<{ warehouses: Warehouse[] }>("/warehouses"); setWarehouses(w.warehouses || []); }
  async function loadExpiry() {
    const n = Math.max(1, Math.min(3650, Number(days || 30)));
    const res = await apiGet<{ rows: ExpiryRow[] }>(`/inventory/expiry-alerts?days=${encodeURIComponent(String(n))}`);
    setExpiry(res.rows || []);
  }
  async function loadReorder() {
    const qs = new URLSearchParams(); if (warehouseId) qs.set("warehouse_id", warehouseId);
    const res = await apiGet<{ rows: ReorderRow[] }>(`/inventory/reorder-alerts${qs.toString() ? `?${qs.toString()}` : ""}`);
    setReorder(res.rows || []);
  }
  async function loadAi() {
    try { const ai = await apiGet<{ recommendations: AiRecRow[] }>("/ai/recommendations?status=pending&agent_code=AI_EXPIRY_OPS&limit=12"); setAiExpiryOps(ai.recommendations || []); }
    catch { setAiExpiryOps([]); }
  }
  async function loadAll() {
    setLoading(true);
    try { await loadBase(); await Promise.all([loadExpiry(), loadReorder(), loadAi()]); }
    catch { /* handled per-section */ }
    finally { setLoading(false); }
  }

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { loadReorder(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId]);

  const aiColumns = useMemo<ColumnDef<AiRecRow>[]>(() => [
    { id: "type", accessorFn: (r) => recommendationView(r).kindLabel, header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />, cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{recommendationView(row.original).kindLabel}</span> },
    {
      id: "recommendation", accessorFn: (r) => recommendationView(r).title,
      header: "Recommendation",
      cell: ({ row }) => { const v = recommendationView(row.original); return (
        <div className="space-y-1">
          <div className="text-xs font-medium">{v.title}</div>
          <div className="text-xs text-muted-foreground">{v.summary}</div>
          {v.details.length ? <div className="text-xs text-muted-foreground/70">{v.details[0]}</div> : null}
          {v.linkHref ? <a className="text-xs text-primary hover:underline" href={v.linkHref}>{v.linkLabel || "Open"}</a> : null}
        </div>
      ); },
    },
    { id: "next", accessorFn: (r) => recommendationView(r).nextStep, header: ({ column }) => <DataTableColumnHeader column={column} title="Next Step" />, cell: ({ row }) => <span className="text-xs text-muted-foreground">{recommendationView(row.original).nextStep}</span> },
    { id: "created", accessorFn: (r) => r.created_at, header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />, cell: ({ row }) => <span className="font-mono text-xs">{formatDateLike(row.original.created_at)}</span> },
  ], []);

  const expiryColumns = useMemo<ColumnDef<ExpiryRow>[]>(() => [
    { id: "expiry_date", accessorFn: (r) => r.expiry_date || "", header: ({ column }) => <DataTableColumnHeader column={column} title="Expiry" />, cell: ({ row }) => <span className="font-mono text-xs">{(row.original.expiry_date || "").slice(0, 10) || "-"}</span> },
    {
      id: "item", accessorFn: (r) => `${r.item_sku || ""} ${r.item_name || ""}`,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <Link href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`} className="hover:underline">
          <span className="font-mono text-xs">{row.original.item_sku || row.original.item_id}</span>
          {row.original.item_name ? ` \u00b7 ${row.original.item_name}` : ""}
        </Link>
      ),
    },
    { id: "warehouse", accessorFn: (r) => r.warehouse_name || whById.get(r.warehouse_id)?.name || r.warehouse_id, header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" /> },
    { id: "batch", accessorFn: (r) => r.batch_no || "", header: "Batch", cell: ({ row }) => <span className="font-mono text-xs">{row.original.batch_no || "-"}</span> },
    {
      id: "status", accessorFn: (r) => (r.status as string) || "available",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={(row.original.status as string) || "available"} />,
    },
    { id: "qty", accessorFn: (r) => toNum(r.qty_on_hand), header: ({ column }) => <DataTableColumnHeader column={column} title="Qty" />, cell: ({ row }) => <span className="font-mono text-sm">{fmt(row.original.qty_on_hand)}</span> },
  ], [whById]);

  const reorderColumns = useMemo<ColumnDef<ReorderRow>[]>(() => [
    {
      id: "item", accessorFn: (r) => `${r.sku || ""} ${r.name || ""}`,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <Link href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`} className="hover:underline">
          <span className="font-mono text-xs">{row.original.sku}</span> {"\u00b7"} {row.original.name}
        </Link>
      ),
    },
    { id: "warehouse", accessorFn: (r) => whById.get(r.warehouse_id)?.name || r.warehouse_id, header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" /> },
    { id: "qty_on_hand", accessorFn: (r) => toNum(r.qty_on_hand), header: ({ column }) => <DataTableColumnHeader column={column} title="On Hand" />, cell: ({ row }) => <span className="font-mono text-sm">{fmt(row.original.qty_on_hand)}</span> },
    { id: "reorder_point", accessorFn: (r) => toNum(r.reorder_point), header: ({ column }) => <DataTableColumnHeader column={column} title="Reorder Point" />, cell: ({ row }) => <span className="font-mono text-sm">{fmt(row.original.reorder_point)}</span> },
    { id: "reorder_qty", accessorFn: (r) => toNum(r.reorder_qty), header: ({ column }) => <DataTableColumnHeader column={column} title="Reorder Qty" />, cell: ({ row }) => <span className="font-mono text-sm">{fmt(row.original.reorder_qty)}</span> },
  ], [whById]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Stock Alerts"
        description="Expiry alerts, reorder alerts, and AI recommendations"
        badge={<Badge variant="outline"><AlertTriangle className="mr-1 h-3 w-3" />{expiry.length + reorder.length} alerts</Badge>}
        actions={
          <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {aiExpiryOps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI: Expiry Ops</CardTitle>
            <CardDescription>{aiExpiryOps.length} pending suggestions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <DataTable columns={aiColumns} data={aiExpiryOps.slice(0, 8)} pageSize={8} />
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm"><a href="/automation/ai-hub">Open AI Hub</a></Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expiry Alerts</CardTitle>
          <CardDescription>Batches expiring soon that still have stock</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full md:w-48 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Days Ahead</label>
              <Input value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <Button variant="outline" size="sm" onClick={loadExpiry}>Apply</Button>
          </div>
          <DataTable columns={expiryColumns} data={expiry} isLoading={loading} searchPlaceholder="Search item / batch / warehouse..." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reorder Alerts</CardTitle>
          <CardDescription>Items below reorder point</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="w-full md:w-64">
              <SearchableSelect
                value={warehouseId} onChange={setWarehouseId} placeholder="All warehouses"
                searchPlaceholder="Search warehouses..."
                options={[{ value: "", label: "All warehouses" }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
              />
            </div>
          </div>
          <DataTable columns={reorderColumns} data={reorder} isLoading={loading} searchPlaceholder="Search item / warehouse..." />
        </CardContent>
      </Card>
    </div>
  );
}
