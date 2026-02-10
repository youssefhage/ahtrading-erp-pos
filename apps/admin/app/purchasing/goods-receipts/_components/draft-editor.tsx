"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPatch, apiPost, ApiError, getCompanyId } from "@/lib/api";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { parseNumberInput } from "@/lib/numbers";
import { getDefaultWarehouseId } from "@/lib/op-context";
import { ErrorBanner } from "@/components/error-banner";
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";
import { ItemTypeahead, type ItemTypeaheadItem } from "@/components/item-typeahead";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Warehouse = { id: string; name: string };
type WarehouseLocation = { id: string; warehouse_id: string; code: string; name: string | null; is_active: boolean };

type ReceiptRow = {
  id: string;
  status: string;
  supplier_id: string | null;
  supplier_ref?: string | null;
  warehouse_id: string | null;
  purchase_order_id?: string | null;
  exchange_rate: string | number;
};

type ReceiptLine = {
  id: string;
  purchase_order_line_id?: string | null;
  item_id: string;
  qty: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  location_id?: string | null;
  landed_cost_total_usd?: string | number | null;
  landed_cost_total_lbp?: string | number | null;
  batch_no: string | null;
  expiry_date: string | null;
};

type ReceiptDetail = { receipt: ReceiptRow; lines: ReceiptLine[] };

type LineDraft = {
  purchase_order_line_id?: string | null;
  item_id: string;
  item: ItemTypeaheadItem | null;
  qty: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
  location_id: string;
  landed_cost_total_usd: string;
  landed_cost_total_lbp: string;
  batch_no: string;
  expiry_date: string;
};

function toNum(raw: unknown): number {
  const r = parseNumberInput(raw);
  return r.ok ? r.value : 0;
}

export function GoodsReceiptDraftEditor(props: { mode: "create" | "edit"; receiptId?: string }) {
  const router = useRouter();
  const receiptId = props.receiptId || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierTypeaheadSupplier | null>(null);

  const [warehouseId, setWarehouseId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("90000");
  const [supplierRef, setSupplierRef] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);

  const title = props.mode === "edit" ? "Edit Goods Receipt Draft" : "New Goods Receipt Draft";

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [wRes, detailRes, fx] = await Promise.all([
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
        props.mode === "edit" && receiptId ? apiGet<ReceiptDetail>(`/purchases/receipts/${encodeURIComponent(receiptId)}`) : Promise.resolve(null),
        getFxRateUsdToLbp(),
      ]);
      const whs = wRes.warehouses || [];
      setWarehouses(whs);
      const defaultEx = Number(fx?.usd_to_lbp || 0) > 0 ? Number(fx.usd_to_lbp) : 90000;
      const preferredWarehouseId = (() => {
        const cid = getCompanyId();
        const pref = getDefaultWarehouseId(cid);
        return pref && whs.some((x) => x.id === pref) ? pref : "";
      })();

      if (detailRes) {
        if ((detailRes as any)?.receipt?.status !== "draft") {
          setErr(new ApiError(409, "HTTP 409: only draft receipts can be edited", { detail: "only draft receipts can be edited" }));
          return;
        }

        const r = (detailRes as any).receipt as ReceiptRow;
        setWarehouseId(String(r.warehouse_id || preferredWarehouseId || (whs?.[0]?.id || "")));
        const ex = Number(r.exchange_rate || 0);
        setExchangeRate(String(ex > 0 ? ex : defaultEx));
        setSupplierRef(String(r.supplier_ref || ""));
        setPurchaseOrderId(String(r.purchase_order_id || ""));

        const supplierId = String(r.supplier_id || "");
        if (supplierId) {
          try {
            const s = await apiGet<{ supplier: SupplierTypeaheadSupplier }>(`/suppliers/${encodeURIComponent(supplierId)}`);
            setSelectedSupplier(s.supplier || null);
          } catch {
            setSelectedSupplier({ id: supplierId, name: supplierId });
          }
        } else {
          setSelectedSupplier(null);
        }

        const ln: LineDraft[] = ((detailRes as any).lines || []).map((l: ReceiptLine) => ({
          purchase_order_line_id: (l.purchase_order_line_id as any) || null,
          item_id: l.item_id,
          item: null,
          qty: String(l.qty || 0),
          unit_cost_usd: String((l as any).unit_cost_usd || 0),
          unit_cost_lbp: String((l as any).unit_cost_lbp || 0),
          location_id: String((l as any).location_id || ""),
          landed_cost_total_usd: String((l as any).landed_cost_total_usd || 0),
          landed_cost_total_lbp: String((l as any).landed_cost_total_lbp || 0),
          batch_no: String((l as any).batch_no || ""),
          expiry_date: String((l as any).expiry_date || ""),
        }));
        setLines(ln);

        const ids = Array.from(new Set(ln.map((x) => x.item_id).filter(Boolean)));
        if (ids.length) {
          const results = await Promise.all(
            ids.map(async (id) => {
              try {
                const it = await apiGet<{ item: ItemTypeaheadItem }>(`/items/${encodeURIComponent(id)}`);
                return it.item || null;
              } catch {
                return null;
              }
            })
          );
          const byId = new Map(results.filter(Boolean).map((it) => [(it as any).id, it as ItemTypeaheadItem]));
          setLines((prev) => prev.map((l) => ({ ...l, item: byId.get(l.item_id) || l.item })));
        }
      } else {
        setSelectedSupplier(null);
        setWarehouseId(String(preferredWarehouseId || (whs?.[0]?.id || "")));
        setExchangeRate(String(defaultEx));
        setSupplierRef("");
        setPurchaseOrderId("");
        setLines([]);
      }
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [props.mode, receiptId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!warehouseId) {
        setLocations([]);
        return;
      }
      try {
        const res = await apiGet<{ locations: WarehouseLocation[] }>(`/inventory/warehouses/${encodeURIComponent(warehouseId)}/locations`);
        if (!cancelled) setLocations((res.locations || []).filter((x) => x.is_active));
      } catch {
        // Purchasing users may not have config:read; keep location optional.
        if (!cancelled) setLocations([]);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        purchase_order_line_id: null,
        item_id: "",
        item: null,
        qty: "1",
        unit_cost_usd: "0",
        unit_cost_lbp: "0",
        location_id: "",
        landed_cost_total_usd: "0",
        landed_cost_total_lbp: "0",
        batch_no: "",
        expiry_date: "",
      },
    ]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  const canSubmit = useMemo(() => {
    if (loading || saving) return false;
    if (!selectedSupplier?.id) return false;
    if (!warehouseId) return false;
    if (!toNum(exchangeRate)) return false;
    return true;
  }, [loading, saving, selectedSupplier?.id, warehouseId, exchangeRate]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!selectedSupplier?.id) return setErr(new ApiError(422, "HTTP 422: supplier is required", { detail: "supplier is required" }));
    if (!warehouseId) return setErr(new ApiError(422, "HTTP 422: warehouse is required", { detail: "warehouse is required" }));
    const ex = toNum(exchangeRate);
    if (!ex) return setErr(new ApiError(422, "HTTP 422: exchange_rate is required", { detail: "exchange_rate is required" }));

    const validLines = (lines || []).filter((l) => l.item_id && toNum(l.qty) > 0);

    setSaving(true);
    try {
      const payload = {
        supplier_id: selectedSupplier.id,
        supplier_ref: supplierRef.trim() || undefined,
        warehouse_id: warehouseId,
        purchase_order_id: purchaseOrderId.trim() || undefined,
        exchange_rate: ex,
        lines: validLines.map((l) => ({
          purchase_order_line_id: l.purchase_order_line_id || undefined,
          item_id: l.item_id,
          qty: toNum(l.qty),
          unit_cost_usd: toNum(l.unit_cost_usd),
          unit_cost_lbp: toNum(l.unit_cost_lbp),
          location_id: l.location_id.trim() || undefined,
          landed_cost_total_usd: toNum(l.landed_cost_total_usd),
          landed_cost_total_lbp: toNum(l.landed_cost_total_lbp),
          batch_no: l.batch_no.trim() || undefined,
          expiry_date: l.expiry_date.trim() || undefined,
        })),
      };

      if (props.mode === "create") {
        const res = await apiPost<{ id: string }>("/purchases/receipts/drafts", payload);
        router.push(`/purchasing/goods-receipts/${encodeURIComponent(res.id)}`);
      } else {
        await apiPatch(`/purchases/receipts/${encodeURIComponent(receiptId)}/draft`, payload);
        router.push(`/purchasing/goods-receipts/${encodeURIComponent(receiptId)}`);
      }
    } catch (e2) {
      setErr(e2);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-fg-muted">Capture received quantities and batches before posting.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => router.push("/purchasing/goods-receipts")} disabled={saving}>
          Back
        </Button>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Supplier, warehouse, and exchange rate.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Supplier</label>
                {selectedSupplier ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-foreground">
                        {selectedSupplier.code ? <span className="font-mono text-xs text-fg-muted">{selectedSupplier.code}</span> : null}
                        {selectedSupplier.code ? <span className="text-fg-muted"> · </span> : null}
                        <span className="font-medium">{selectedSupplier.name}</span>
                      </div>
                      <div className="truncate font-mono text-[10px] text-fg-subtle">{selectedSupplier.id}</div>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelectedSupplier(null)} disabled={saving || loading}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <SupplierTypeahead disabled={saving || loading} onSelect={(s) => setSelectedSupplier(s)} />
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Warehouse</label>
                <SearchableSelect
                  value={warehouseId}
                  onChange={setWarehouseId}
                  disabled={saving || loading}
                  placeholder="Select warehouse..."
                  searchPlaceholder="Search warehouses..."
                  options={[
                    { value: "", label: "Select warehouse..." },
                    ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                  ]}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD to LL)</label>
                <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} disabled={saving || loading} inputMode="numeric" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Supplier Ref (optional)</label>
                <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="Packing list / delivery note..." disabled={saving || loading} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Purchase Order ID (optional)</label>
                <Input value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)} placeholder="UUID" disabled={saving || loading} />
              </div>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
	                  <tr>
	                    <th className="px-3 py-2">Item</th>
	                    <th className="px-3 py-2 text-right">Qty</th>
	                    <th className="px-3 py-2 text-right">Unit USD</th>
	                    <th className="px-3 py-2 text-right">Unit LL</th>
	                    <th className="px-3 py-2">Location</th>
	                    <th className="px-3 py-2 text-right">Landed USD</th>
	                    <th className="px-3 py-2 text-right">Landed LL</th>
	                    <th className="px-3 py-2">Batch</th>
	                    <th className="px-3 py-2">Expiry</th>
	                    <th className="px-3 py-2 text-right">Actions</th>
	                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx} className="ui-tr-hover">
                      <td className="px-3 py-2">
                        {l.item ? (
                          <div className="rounded-md border border-border bg-bg-elevated px-3 py-2">
                            <div className="truncate text-sm text-foreground">
                              <span className="font-mono text-xs text-fg-muted">{l.item.sku}</span> · {l.item.name}
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <div className="truncate font-mono text-[10px] text-fg-subtle">{l.item_id}</div>
                              <Button type="button" size="sm" variant="outline" onClick={() => updateLine(idx, { item_id: "", item: null })} disabled={saving || loading}>
                                Clear
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <ItemTypeahead disabled={saving || loading} onSelect={(it) => updateLine(idx, { item_id: it.id, item: it })} placeholder="Pick item..." />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input value={l.qty} onChange={(e) => updateLine(idx, { qty: e.target.value })} disabled={saving || loading} inputMode="decimal" />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input value={l.unit_cost_usd} onChange={(e) => updateLine(idx, { unit_cost_usd: e.target.value })} disabled={saving || loading} inputMode="decimal" />
                      </td>
	                      <td className="px-3 py-2 text-right">
	                        <Input value={l.unit_cost_lbp} onChange={(e) => updateLine(idx, { unit_cost_lbp: e.target.value })} disabled={saving || loading} inputMode="decimal" />
	                      </td>
	                      <td className="px-3 py-2">
	                        <SearchableSelect
	                          value={String(l.location_id || "")}
	                          onChange={(v) => updateLine(idx, { location_id: v })}
	                          disabled={saving || loading || !warehouseId || locations.length === 0}
	                          placeholder={locations.length ? "(no bin)" : "(no bins)"}
	                          searchPlaceholder="Search bins..."
	                          maxOptions={120}
	                          options={[
	                            { value: "", label: locations.length ? "(no bin)" : "(no bins)" },
	                            ...locations.map((loc) => ({
	                              value: loc.id,
	                              label: `${loc.code}${loc.name ? ` · ${loc.name}` : ""}`,
	                              keywords: `${loc.code} ${loc.name || ""}`.trim(),
	                            })),
	                          ]}
	                        />
	                      </td>
	                      <td className="px-3 py-2 text-right">
	                        <Input
	                          value={l.landed_cost_total_usd}
	                          onChange={(e) => updateLine(idx, { landed_cost_total_usd: e.target.value })}
	                          disabled={saving || loading}
	                          inputMode="decimal"
	                        />
	                      </td>
	                      <td className="px-3 py-2 text-right">
	                        <Input
	                          value={l.landed_cost_total_lbp}
	                          onChange={(e) => updateLine(idx, { landed_cost_total_lbp: e.target.value })}
	                          disabled={saving || loading}
	                          inputMode="decimal"
	                        />
	                      </td>
	                      <td className="px-3 py-2">
	                        <Input value={l.batch_no} onChange={(e) => updateLine(idx, { batch_no: e.target.value })} disabled={saving || loading} placeholder="(optional)" />
	                      </td>
                      <td className="px-3 py-2">
                        <Input type="date" value={l.expiry_date || ""} onChange={(e) => updateLine(idx, { expiry_date: e.target.value })} disabled={saving || loading} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button type="button" variant="outline" size="sm" onClick={() => removeLine(idx)} disabled={saving || loading}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
	                  {!lines.length ? (
	                    <tr>
	                      <td className="px-3 py-3 text-sm text-fg-muted" colSpan={10}>
	                        No lines yet.
	                      </td>
	                    </tr>
	                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="outline" onClick={addLine} disabled={saving || loading}>
                Add Line
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {saving ? "..." : props.mode === "edit" ? "Save Draft" : "Create Draft"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
