"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPost, getCompanyId } from "@/lib/api";
import { getDefaultWarehouseId, setDefaultWarehouseId } from "@/lib/op-context";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { ItemTypeahead, type ItemTypeaheadItem } from "@/components/item-typeahead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type WarehouseRow = { id: string; name: string };
type LocationRow = { id: string; code: string; name?: string | null };

type RuleRow = {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  from_location_id: string | null;
  from_location_code: string | null;
  to_location_id: string;
  to_location_code: string | null;
  item_id: string;
  item_sku: string;
  item_name: string;
  min_qty: string | number;
  target_qty: string | number;
  max_qty: string | number;
  is_active: boolean;
  updated_at: string;
};

type SuggestionRow = {
  rule_id: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  qty_on_hand: string | number;
  min_qty: string | number;
  target_qty: string | number;
  qty_needed: string | number;
  from_location_id: string | null;
  from_location_code: string | null;
  to_location_id: string;
  to_location_code: string | null;
};

function toNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function ReplenishmentPage() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [toLocationId, setToLocationId] = useState("");
  const [defaultFromLocationId, setDefaultFromLocationId] = useState("");

  const [rules, setRules] = useState<RuleRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);

  // Upsert rule form
  const [pickedItem, setPickedItem] = useState<ItemTypeaheadItem | null>(null);
  const [ruleFromLocationId, setRuleFromLocationId] = useState("");
  const [minQty, setMinQty] = useState("0");
  const [targetQty, setTargetQty] = useState("0");
  const [maxQty, setMaxQty] = useState("0");
  const [savingRule, setSavingRule] = useState(false);

  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const suggestionColumns = useMemo((): Array<DataTableColumn<SuggestionRow>> => {
    return [
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (s) => `${s.item_sku || ""} ${s.item_name || ""}`,
        cell: (s) => (
          <div>
            <div className="data-mono text-xs">{s.item_sku || s.item_id.slice(0, 8)}</div>
            <div className="text-xs text-fg-muted">{s.item_name}</div>
            {s.from_location_code ? (
              <div className="text-xs text-fg-subtle">
                From: <span className="data-mono">{s.from_location_code}</span>
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "qty_on_hand",
        header: "On Hand",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => toNum(s.qty_on_hand),
        cell: (s) => <span className="data-mono text-xs ui-tone-qty">{toNum(s.qty_on_hand).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>,
      },
      {
        id: "min_qty",
        header: "Min",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => toNum(s.min_qty),
        cell: (s) => <span className="data-mono text-xs">{toNum(s.min_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>,
      },
      {
        id: "target_qty",
        header: "Target",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => toNum(s.target_qty),
        cell: (s) => <span className="data-mono text-xs">{toNum(s.target_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>,
      },
      {
        id: "qty_needed",
        header: "Needed",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => toNum(s.qty_needed),
        cell: (s) => <span className="data-mono text-xs ui-tone-qty">{toNum(s.qty_needed).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>,
      },
    ];
  }, []);
  const ruleColumns = useMemo((): Array<DataTableColumn<RuleRow>> => {
    return [
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (r) => `${r.item_sku || ""} ${r.item_name || ""}`,
        cell: (r) => (
          <div>
            <div className="data-mono text-xs">{r.item_sku}</div>
            <div className="text-xs text-fg-muted">{r.item_name}</div>
          </div>
        ),
      },
      {
        id: "from_location_code",
        header: "From",
        sortable: true,
        mono: true,
        accessor: (r) => r.from_location_code || "",
        cell: (r) => <span className="data-mono text-xs">{r.from_location_code || "-"}</span>,
      },
      {
        id: "min_qty",
        header: "Min",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => toNum(r.min_qty),
        cell: (r) => <span className="data-mono text-xs">{toNum(r.min_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>,
      },
      {
        id: "target_qty",
        header: "Target",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => toNum(r.target_qty),
        cell: (r) => <span className="data-mono text-xs">{toNum(r.target_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>,
      },
      {
        id: "max_qty",
        header: "Max",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => toNum(r.max_qty),
        cell: (r) => <span className="data-mono text-xs">{toNum(r.max_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</span>,
      },
    ];
  }, []);

  const loadWarehouses = useCallback(async () => {
    const res = await apiGet<{ warehouses: WarehouseRow[] }>("/warehouses");
    const ws = res.warehouses || [];
    setWarehouses(ws);
    const cid = getCompanyId();
    const def = getDefaultWarehouseId(cid);
    const next = def && ws.find((w) => w.id === def) ? def : (ws[0]?.id || "");
    setWarehouseId(next);
  }, []);

  const loadLocations = useCallback(async (wid: string) => {
    if (!wid) {
      setLocations([]);
      setToLocationId("");
      return;
    }
    const res = await apiGet<{ locations: LocationRow[] }>(`/inventory/warehouses/${encodeURIComponent(wid)}/locations?limit=500`);
    const locs = res.locations || [];
    setLocations(locs);
    setToLocationId((prev) => (prev && locs.find((l) => l.id === prev) ? prev : (locs[0]?.id || "")));
  }, []);

  const loadRules = useCallback(async (wid: string, toLoc: string) => {
    if (!wid || !toLoc) {
      setRules([]);
      return;
    }
    const params = new URLSearchParams();
    params.set("warehouse_id", wid);
    params.set("to_location_id", toLoc);
    params.set("limit", "500");
    const res = await apiGet<{ rules: RuleRow[] }>(`/warehouse/replenishment/rules?${params.toString()}`);
    setRules(res.rules || []);
  }, []);

  const loadSuggestions = useCallback(async (wid: string, toLoc: string) => {
    if (!wid || !toLoc) {
      setSuggestions([]);
      return;
    }
    const params = new URLSearchParams();
    params.set("warehouse_id", wid);
    params.set("to_location_id", toLoc);
    params.set("limit", "500");
    const res = await apiGet<{ suggestions: SuggestionRow[] }>(`/warehouse/replenishment/suggestions?${params.toString()}`);
    setSuggestions(res.suggestions || []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      await loadRules(warehouseId, toLocationId);
      await loadSuggestions(warehouseId, toLocationId);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [loadRules, loadSuggestions, warehouseId, toLocationId]);

  useEffect(() => {
    loadWarehouses().catch((e) => setStatus(String(e)));
  }, [loadWarehouses]);

  useEffect(() => {
    if (!warehouseId) return;
    const cid = getCompanyId();
    setDefaultWarehouseId(cid, warehouseId);
    loadLocations(warehouseId).catch((e) => setStatus(String(e)));
  }, [warehouseId, loadLocations]);

  useEffect(() => {
    refresh();
  }, [warehouseId, toLocationId, refresh]);

  async function upsertRule(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId) return;
    if (!toLocationId) {
      setStatus("Destination location is required");
      return;
    }
    if (!pickedItem?.id) {
      setStatus("Item is required");
      return;
    }
    setSavingRule(true);
    setStatus("Saving rule...");
    try {
      await apiPost("/warehouse/replenishment/rules", {
        warehouse_id: warehouseId,
        to_location_id: toLocationId,
        from_location_id: ruleFromLocationId.trim() || null,
        item_id: pickedItem.id,
        min_qty: Number(minQty || 0),
        target_qty: Number(targetQty || 0),
        max_qty: Number(maxQty || 0),
        is_active: true,
      });
      setPickedItem(null);
      setRuleFromLocationId("");
      setMinQty("0");
      setTargetQty("0");
      setMaxQty("0");
      await refresh();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingRule(false);
    }
  }

  async function createTransferDraft() {
    if (!warehouseId || !toLocationId) return;
    if (!suggestions.length) {
      setStatus("No suggestions to transfer.");
      return;
    }
    // Prefer per-rule from_location_id, fall back to the page default.
    const lines = suggestions.map((s) => ({ item_id: s.item_id, qty: Number(s.qty_needed || 0) })).filter((l) => l.qty > 0);
    if (!lines.length) {
      setStatus("No positive quantities to transfer.");
      return;
    }
    const froms = new Set(suggestions.map((s) => s.from_location_id || "").filter(Boolean));
    const fromLoc = froms.size === 1 ? Array.from(froms)[0] : (defaultFromLocationId.trim() || null);
    if (!fromLoc) {
      setStatus("From location is required (rules are missing from_location_id).");
      return;
    }
    setStatus("Creating draft transfer...");
    try {
      const res = await apiPost<{ id: string; transfer_no: string }>("/warehouse/replenishment/create-transfer-draft", {
        warehouse_id: warehouseId,
        from_location_id: fromLoc,
        to_location_id: toLocationId,
        memo: `Replenishment → ${locById.get(toLocationId)?.code || "bin"}`,
        lines,
      });
      setStatus("");
      router.push(`/inventory/transfers/${encodeURIComponent(res.id)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  const toLoc = locById.get(toLocationId);
  const fromLocOptions = locations.filter((l) => l.id !== toLocationId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={refresh} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select className="ui-select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
            {!warehouses.length ? <option value="">No warehouses</option> : null}
          </select>
          <select className="ui-select" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}{l.name ? ` · ${l.name}` : ""}
              </option>
            ))}
            {!locations.length ? <option value="">No locations</option> : null}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
          <Button onClick={createTransferDraft} disabled={!suggestions.length}>
            Create Transfer Draft
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Suggestions</CardTitle>
            <CardDescription>
              Rule-based replenishment for <span className="data-mono">{toLoc?.code || "-"}</span>. Create a transfer draft to move stock.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {suggestions.length ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Default From Location (used only when rules omit from_location_id)</label>
                    <select className="ui-select" value={defaultFromLocationId} onChange={(e) => setDefaultFromLocationId(e.target.value)}>
                      <option value="">Select…</option>
                      {fromLocOptions.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}{l.name ? ` · ${l.name}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-lg border border-border-subtle bg-bg-elevated/60 p-3">
                    <div className="text-xs text-fg-muted">Total Lines</div>
                    <div className="mt-1 data-mono text-lg ui-tone-qty">{suggestions.length.toLocaleString("en-US")}</div>
                    <div className="mt-2 text-xs text-fg-muted">Qty Needed (sum)</div>
                    <div className="mt-1 data-mono text-sm ui-tone-qty">
                      {suggestions.reduce((a, s) => a + toNum(s.qty_needed), 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                    </div>
                  </div>
                </div>

                <DataTable<SuggestionRow>
                  tableId="inventory.replenishment.suggestions"
                  rows={suggestions}
                  columns={suggestionColumns}
                  getRowId={(s) => `${s.rule_id}-${s.item_id}`}
                  enableGlobalFilter={false}
                  enablePagination
                  initialSort={{ columnId: "qty_needed", dir: "desc" }}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-border-subtle bg-bg-elevated/60 p-6 text-sm text-fg-muted">
                No suggestions. Add replenishment rules for this destination bin.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rules</CardTitle>
            <CardDescription>Define min/target quantities for the selected destination location.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={upsertRule} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="md:col-span-6">
                <label className="text-xs font-medium text-fg-muted">Item</label>
                <div className="mt-1">
                  <ItemTypeahead
                    onSelect={(it) => setPickedItem(it)}
                    onClear={() => setPickedItem(null)}
                    placeholder={pickedItem ? `${pickedItem.sku} · ${pickedItem.name}` : "Search items (sku, name, barcode)..."}
                  />
                </div>
                {pickedItem ? <div className="mt-1 text-xs text-fg-subtle data-mono">{pickedItem.id}</div> : null}
              </div>

              <div className="md:col-span-3">
                <label className="text-xs font-medium text-fg-muted">From Location (optional)</label>
                <select className="ui-select mt-1" value={ruleFromLocationId} onChange={(e) => setRuleFromLocationId(e.target.value)}>
                  <option value="">Auto/Any</option>
                  {fromLocOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code}{l.name ? ` · ${l.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1">
                <label className="text-xs font-medium text-fg-muted">Min</label>
                <Input className="mt-1" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
              </div>
              <div className="md:col-span-1">
                <label className="text-xs font-medium text-fg-muted">Target</label>
                <Input className="mt-1" value={targetQty} onChange={(e) => setTargetQty(e.target.value)} />
              </div>
              <div className="md:col-span-1">
                <label className="text-xs font-medium text-fg-muted">Max</label>
                <Input className="mt-1" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} />
              </div>

              <div className="md:col-span-6 flex justify-end">
                <Button type="submit" disabled={savingRule}>
                  {savingRule ? "..." : "Upsert Rule"}
                </Button>
              </div>
            </form>

            <DataTable<RuleRow>
              tableId="inventory.replenishment.rules"
              rows={rules}
              columns={ruleColumns}
              getRowId={(r) => r.id}
              emptyText="No rules for this destination location."
              enableGlobalFilter={false}
              initialSort={{ columnId: "item", dir: "asc" }}
            />

            <div className="rounded-lg border border-border-subtle bg-bg-elevated/60 p-3 text-xs text-fg-muted">
              Tip: After creating a transfer draft, go to Inventory Transfers to pick/confirm and post it.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
