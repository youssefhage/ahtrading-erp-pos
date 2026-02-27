"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { apiGet, apiPost, getCompanyId } from "@/lib/api";
import { getDefaultWarehouseId, setDefaultWarehouseId } from "@/lib/op-context";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { ItemTypeahead, type ItemTypeaheadItem } from "@/components/item-typeahead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type WarehouseRow = { id: string; name: string };
type LocationRow = { id: string; code: string; name?: string | null };
type RuleRow = {
  id: string; warehouse_id: string; warehouse_name: string;
  from_location_id: string | null; from_location_code: string | null;
  to_location_id: string; to_location_code: string | null;
  item_id: string; item_sku: string; item_name: string;
  min_qty: string | number; target_qty: string | number; max_qty: string | number;
  is_active: boolean; updated_at: string;
};
type SuggestionRow = {
  rule_id: string; item_id: string; item_sku: string; item_name: string;
  qty_on_hand: string | number; min_qty: string | number; target_qty: string | number;
  qty_needed: string | number; from_location_id: string | null; from_location_code: string | null;
  to_location_id: string; to_location_code: string | null;
};

function toNum(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmt(v: unknown) { return toNum(v).toLocaleString("en-US", { maximumFractionDigits: 3 }); }

export default function ReplenishmentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [toLocationId, setToLocationId] = useState("");
  const [defaultFromLocationId, setDefaultFromLocationId] = useState("");
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);

  const [pickedItem, setPickedItem] = useState<ItemTypeaheadItem | null>(null);
  const [ruleFromLocationId, setRuleFromLocationId] = useState("");
  const [minQty, setMinQty] = useState("0");
  const [targetQty, setTargetQty] = useState("0");
  const [maxQty, setMaxQty] = useState("0");
  const [savingRule, setSavingRule] = useState(false);

  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const fromLocOptions = locations.filter((l) => l.id !== toLocationId);

  const loadWarehouses = useCallback(async () => {
    const res = await apiGet<{ warehouses: WarehouseRow[] }>("/warehouses");
    const ws = res.warehouses || []; setWarehouses(ws);
    const cid = getCompanyId();
    const def = getDefaultWarehouseId(cid);
    setWarehouseId(def && ws.find((w) => w.id === def) ? def : (ws[0]?.id || ""));
  }, []);
  const loadLocations = useCallback(async (wid: string) => {
    if (!wid) { setLocations([]); setToLocationId(""); return; }
    const res = await apiGet<{ locations: LocationRow[] }>(`/inventory/warehouses/${encodeURIComponent(wid)}/locations?limit=500`);
    const locs = res.locations || []; setLocations(locs);
    setToLocationId((prev) => (prev && locs.find((l) => l.id === prev) ? prev : (locs[0]?.id || "")));
  }, []);
  const loadRules = useCallback(async (wid: string, toLoc: string) => {
    if (!wid || !toLoc) { setRules([]); return; }
    const p = new URLSearchParams({ warehouse_id: wid, to_location_id: toLoc, limit: "500" });
    const res = await apiGet<{ rules: RuleRow[] }>(`/warehouse/replenishment/rules?${p}`); setRules(res.rules || []);
  }, []);
  const loadSuggestions = useCallback(async (wid: string, toLoc: string) => {
    if (!wid || !toLoc) { setSuggestions([]); return; }
    const p = new URLSearchParams({ warehouse_id: wid, to_location_id: toLoc, limit: "500" });
    const res = await apiGet<{ suggestions: SuggestionRow[] }>(`/warehouse/replenishment/suggestions?${p}`); setSuggestions(res.suggestions || []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setStatus("");
    try { await loadRules(warehouseId, toLocationId); await loadSuggestions(warehouseId, toLocationId); }
    catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [loadRules, loadSuggestions, warehouseId, toLocationId]);

  useEffect(() => { loadWarehouses().catch(() => {}); }, [loadWarehouses]);
  useEffect(() => { if (!warehouseId) return; setDefaultWarehouseId(getCompanyId(), warehouseId); loadLocations(warehouseId).catch(() => {}); }, [warehouseId, loadLocations]);
  useEffect(() => { refresh(); }, [warehouseId, toLocationId, refresh]);

  async function upsertRule(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId || !toLocationId || !pickedItem?.id) { setStatus("Warehouse, location, and item are required"); return; }
    setSavingRule(true);
    try {
      await apiPost("/warehouse/replenishment/rules", {
        warehouse_id: warehouseId, to_location_id: toLocationId, from_location_id: ruleFromLocationId.trim() || null,
        item_id: pickedItem.id, min_qty: Number(minQty || 0), target_qty: Number(targetQty || 0), max_qty: Number(maxQty || 0), is_active: true,
      });
      setPickedItem(null); setRuleFromLocationId(""); setMinQty("0"); setTargetQty("0"); setMaxQty("0");
      await refresh(); setStatus("");
    } catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
    finally { setSavingRule(false); }
  }

  async function createTransferDraft() {
    if (!warehouseId || !toLocationId || !suggestions.length) return;
    const lines = suggestions.map((s) => ({ item_id: s.item_id, qty: toNum(s.qty_needed) })).filter((l) => l.qty > 0);
    if (!lines.length) { setStatus("No positive quantities."); return; }
    const froms = new Set(suggestions.map((s) => s.from_location_id || "").filter(Boolean));
    const fromLoc = froms.size === 1 ? Array.from(froms)[0] : (defaultFromLocationId.trim() || null);
    if (!fromLoc) { setStatus("From location required."); return; }
    setStatus("Creating draft...");
    try {
      const res = await apiPost<{ id: string }>("/warehouse/replenishment/create-transfer-draft", {
        warehouse_id: warehouseId, from_location_id: fromLoc, to_location_id: toLocationId,
        memo: `Replenishment \u2192 ${locById.get(toLocationId)?.code || "bin"}`, lines,
      });
      router.push(`/inventory/transfers/${encodeURIComponent(res.id)}`);
    } catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
  }

  const suggestionColumns = useMemo<ColumnDef<SuggestionRow>[]>(() => [
    { id: "item", accessorFn: (s) => `${s.item_sku || ""} ${s.item_name || ""}`, header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (<div><div className="font-mono text-xs">{row.original.item_sku}</div><div className="text-xs text-muted-foreground">{row.original.item_name}</div>{row.original.from_location_code && <div className="text-xs text-muted-foreground/70">From: <span className="font-mono">{row.original.from_location_code}</span></div>}</div>) },
    { id: "on_hand", accessorFn: (s) => toNum(s.qty_on_hand), header: ({ column }) => <DataTableColumnHeader column={column} title="On Hand" />, cell: ({ row }) => <span className="font-mono text-sm">{fmt(row.original.qty_on_hand)}</span> },
    { id: "min", accessorFn: (s) => toNum(s.min_qty), header: "Min", cell: ({ row }) => <span className="font-mono text-sm">{fmt(row.original.min_qty)}</span> },
    { id: "target", accessorFn: (s) => toNum(s.target_qty), header: "Target", cell: ({ row }) => <span className="font-mono text-sm">{fmt(row.original.target_qty)}</span> },
    { id: "needed", accessorFn: (s) => toNum(s.qty_needed), header: ({ column }) => <DataTableColumnHeader column={column} title="Needed" />, cell: ({ row }) => <span className="font-mono text-sm font-medium">{fmt(row.original.qty_needed)}</span> },
  ], []);

  const ruleColumns = useMemo<ColumnDef<RuleRow>[]>(() => [
    { id: "item", accessorFn: (r) => `${r.item_sku || ""} ${r.item_name || ""}`, header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (<div><div className="font-mono text-xs">{row.original.item_sku}</div><div className="text-xs text-muted-foreground">{row.original.item_name}</div></div>) },
    { id: "from", accessorFn: (r) => r.from_location_code || "", header: "From", cell: ({ row }) => <span className="font-mono text-xs">{row.original.from_location_code || "-"}</span> },
    { id: "min", accessorFn: (r) => toNum(r.min_qty), header: "Min", cell: ({ row }) => <span className="font-mono text-sm">{fmt(row.original.min_qty)}</span> },
    { id: "target", accessorFn: (r) => toNum(r.target_qty), header: "Target", cell: ({ row }) => <span className="font-mono text-sm">{fmt(row.original.target_qty)}</span> },
    { id: "max", accessorFn: (r) => toNum(r.max_qty), header: "Max", cell: ({ row }) => <span className="font-mono text-sm">{fmt(row.original.max_qty)}</span> },
  ], []);

  const toLoc = locById.get(toLocationId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Replenishment"
        description="Rule-based bin replenishment with transfer drafts"
        actions={
          <>
            <select className="h-9 rounded-md border bg-background px-3 text-sm" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              {!warehouses.length && <option value="">No warehouses</option>}
            </select>
            <select className="h-9 rounded-md border bg-background px-3 text-sm" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code}{l.name ? ` \u00b7 ${l.name}` : ""}</option>)}
              {!locations.length && <option value="">No locations</option>}
            </select>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={createTransferDraft} disabled={!suggestions.length}>Create Transfer Draft</Button>
          </>
        }
      />
      {status && <p className="text-sm text-destructive">{status}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Suggestions</CardTitle>
            <CardDescription>For <span className="font-mono">{toLoc?.code || "-"}</span>. {suggestions.length} lines, {suggestions.reduce((a, s) => a + toNum(s.qty_needed), 0).toLocaleString("en-US", { maximumFractionDigits: 3 })} total qty needed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {suggestions.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Default From Location</label>
                <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={defaultFromLocationId} onChange={(e) => setDefaultFromLocationId(e.target.value)}>
                  <option value="">Select...</option>
                  {fromLocOptions.map((l) => <option key={l.id} value={l.id}>{l.code}{l.name ? ` \u00b7 ${l.name}` : ""}</option>)}
                </select>
              </div>
            )}
            <DataTable columns={suggestionColumns} data={suggestions} searchPlaceholder="Search item..." pageSize={10} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rules</CardTitle>
            <CardDescription>Min/target quantities for the selected destination</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={upsertRule} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="md:col-span-6 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Item</label>
                <ItemTypeahead onSelect={(it) => setPickedItem(it)} onClear={() => setPickedItem(null)} placeholder={pickedItem ? `${pickedItem.sku} \u00b7 ${pickedItem.name}` : "Search items..."} />
              </div>
              <div className="md:col-span-3 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">From Location</label>
                <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={ruleFromLocationId} onChange={(e) => setRuleFromLocationId(e.target.value)}>
                  <option value="">Auto/Any</option>
                  {fromLocOptions.map((l) => <option key={l.id} value={l.id}>{l.code}{l.name ? ` \u00b7 ${l.name}` : ""}</option>)}
                </select>
              </div>
              <div className="md:col-span-1 space-y-1"><label className="text-xs font-medium text-muted-foreground">Min</label><Input value={minQty} onChange={(e) => setMinQty(e.target.value)} /></div>
              <div className="md:col-span-1 space-y-1"><label className="text-xs font-medium text-muted-foreground">Target</label><Input value={targetQty} onChange={(e) => setTargetQty(e.target.value)} /></div>
              <div className="md:col-span-1 space-y-1"><label className="text-xs font-medium text-muted-foreground">Max</label><Input value={maxQty} onChange={(e) => setMaxQty(e.target.value)} /></div>
              <div className="md:col-span-6 flex justify-end"><Button type="submit" size="sm" disabled={savingRule}>{savingRule ? "..." : "Upsert Rule"}</Button></div>
            </form>
            <DataTable columns={ruleColumns} data={rules} searchPlaceholder="Search item..." pageSize={10} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
