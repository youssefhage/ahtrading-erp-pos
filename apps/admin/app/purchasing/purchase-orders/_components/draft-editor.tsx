"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPatch, apiPost, getCompanyId } from "@/lib/api";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { parseNumberInput } from "@/lib/numbers";
import { getDefaultWarehouseId } from "@/lib/op-context";
import { ErrorBanner } from "@/components/error-banner";
import { ItemTypeahead, type ItemTypeaheadItem } from "@/components/item-typeahead";
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Warehouse = { id: string; name: string };

type PurchaseOrderRow = {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  warehouse_id?: string | null;
  supplier_ref?: string | null;
  expected_delivery_date?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
};

type PurchaseOrderLine = {
  id: string;
  item_id: string;
  qty: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
};

type OrderDetail = {
  order: PurchaseOrderRow & { exchange_rate: string | number };
  lines: PurchaseOrderLine[];
};

type LineDraft = {
  item_id: string;
  item_sku?: string;
  item_name?: string;
  unit_of_measure?: string | null;
  qty: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
};

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

export function PurchaseOrderDraftEditor(props: { mode: "create" | "edit"; orderId?: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [supplierId, setSupplierId] = useState("");
  const [supplierLabel, setSupplierLabel] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("90000");
  const [supplierRef, setSupplierRef] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);

  const [addItem, setAddItem] = useState<ItemTypeaheadItem | null>(null);
  const [addQty, setAddQty] = useState("1");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");
  const addQtyRef = useRef<HTMLInputElement | null>(null);
  const supplierCostCache = useRef(new Map<string, { usd: number; lbp: number } | null>());

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [w, fx] = await Promise.all([
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
        getFxRateUsdToLbp(),
      ]);
      const whs = w.warehouses || [];
      setWarehouses(whs);
      const defaultEx = Number(fx?.usd_to_lbp || 0) > 0 ? Number(fx.usd_to_lbp) : 90000;
      const preferredWarehouseId = (() => {
        const cid = getCompanyId();
        const pref = getDefaultWarehouseId(cid);
        return pref && whs.some((x) => x.id === pref) ? pref : "";
      })();

      if (props.mode === "edit") {
        const id = props.orderId || "";
        if (!id) throw new Error("missing order id");
        const det = await apiGet<OrderDetail>(`/purchases/orders/${encodeURIComponent(id)}`);
        if (det.order.status !== "draft") throw new Error("Only draft purchase orders can be edited.");
        setSupplierId(det.order.supplier_id || "");
        setWarehouseId((det.order as any).warehouse_id || preferredWarehouseId || whs?.[0]?.id || "");
        const ex = Number(det.order.exchange_rate || 0);
        setExchangeRate(String(ex > 0 ? ex : defaultEx));
        setSupplierRef(String((det.order as any).supplier_ref || ""));
        setExpectedDeliveryDate(String((det.order as any).expected_delivery_date || ""));

        const supId = String(det.order.supplier_id || "");
        if (supId) {
          try {
            const sup = await apiGet<{ supplier: SupplierTypeaheadSupplier }>(`/suppliers/${encodeURIComponent(supId)}`);
            setSupplierLabel(String(sup.supplier?.name || ""));
          } catch {
            setSupplierLabel("");
          }
        }

        const ids = Array.from(new Set((det.lines || []).map((l) => String(l.item_id || "")).filter(Boolean)));
        const meta = new Map<string, any>();
        if (ids.length) {
          const res = await apiPost<{ items: Array<{ id: string; sku: string; name: string; unit_of_measure?: string | null }> }>("/items/lookup", { ids });
          for (const it of res.items || []) meta.set(String(it.id), it);
        }
        setLines(
          (det.lines || []).map((l) => {
            const it = meta.get(String(l.item_id));
            return {
              item_id: String(l.item_id),
              item_sku: it?.sku,
              item_name: it?.name,
              unit_of_measure: it?.unit_of_measure ?? null,
              qty: String(l.qty || 0),
              unit_cost_usd: String(l.unit_cost_usd || 0),
              unit_cost_lbp: String(l.unit_cost_lbp || 0)
            };
          })
        );
      } else {
        setSupplierId("");
        setSupplierLabel("");
        setWarehouseId(preferredWarehouseId || whs?.[0]?.id || "");
        setExchangeRate(String(defaultEx));
        setSupplierRef("");
        setExpectedDeliveryDate("");
        setLines([]);
      }
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [props.mode, props.orderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function fetchSupplierLastCost(itemId: string): Promise<{ usd: number; lbp: number } | null> {
    const sup = (supplierId || "").trim();
    if (!sup) return null;
    const key = `${sup}:${itemId}`;
    if (supplierCostCache.current.has(key)) return supplierCostCache.current.get(key) || null;
    try {
      const res = await apiGet<{
        suppliers: Array<{ supplier_id: string; last_cost_usd: string | number | null; last_cost_lbp: string | number | null }>;
      }>(`/suppliers/items/${encodeURIComponent(itemId)}`);
      const row = (res.suppliers || []).find((r) => r.supplier_id === sup);
      const usd = row ? toNum(String(row.last_cost_usd ?? "")) : 0;
      const lbp = row ? toNum(String(row.last_cost_lbp ?? "")) : 0;
      const val = usd > 0 || lbp > 0 ? { usd, lbp } : null;
      supplierCostCache.current.set(key, val);
      return val;
    } catch {
      supplierCostCache.current.set(key, null);
      return null;
    }
  }

  async function onPickItem(it: ItemTypeaheadItem) {
    setAddItem(it);
    setAddQty("1");
    const last = await fetchSupplierLastCost(it.id);
    setAddUsd(last?.usd ? String(last.usd) : "");
    setAddLbp(last?.lbp ? String(last.lbp) : "");
    setTimeout(() => addQtyRef.current?.focus(), 0);
  }

  function addLine(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!addItem) return setErr(new Error("Select an item."));
    const q = toNum(addQty);
    if (q <= 0) return setErr(new Error("qty must be > 0"));
    let unitUsd = toNum(addUsd);
    let unitLbp = toNum(addLbp);
    const ex = toNum(exchangeRate);
    if (ex > 0) {
      if (unitUsd === 0 && unitLbp > 0) unitUsd = unitLbp / ex;
      if (unitLbp === 0 && unitUsd > 0) unitLbp = unitUsd * ex;
    }
    if (unitUsd === 0 && unitLbp === 0) return setErr(new Error("Set USD or LL unit cost."));

    setLines((prev) => [
      ...prev,
      {
        item_id: addItem.id,
        item_sku: addItem.sku,
        item_name: addItem.name,
        unit_of_measure: (addItem as any).unit_of_measure ?? null,
        qty: String(q),
        unit_cost_usd: String(unitUsd),
        unit_cost_lbp: String(unitLbp)
      }
    ]);
    setAddItem(null);
    setAddQty("1");
    setAddUsd("");
    setAddLbp("");
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function save() {
    setErr(null);
    if (!supplierId) return setErr(new Error("supplier is required"));
    if (!warehouseId) return setErr(new Error("warehouse is required"));
    const ex = toNum(exchangeRate);
    if (!ex) return setErr(new Error("exchange_rate is required"));

    const linesOut = [];
    for (let i = 0; i < (lines || []).length; i++) {
      const l = lines[i];
      const qty = toNum(l.qty);
      const unitUsd = toNum(l.unit_cost_usd);
      const unitLbp = toNum(l.unit_cost_lbp);
      if (!l.item_id) continue;
      if (qty <= 0) return setErr(new Error(`Qty must be > 0 (line ${i + 1}).`));
      if (unitUsd === 0 && unitLbp === 0) return setErr(new Error(`Set USD or LL unit cost (line ${i + 1}).`));
      linesOut.push({ item_id: l.item_id, qty, unit_cost_usd: unitUsd, unit_cost_lbp: unitLbp });
    }

    setSaving(true);
    try {
      const payload = {
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        exchange_rate: ex,
        supplier_ref: supplierRef.trim() || undefined,
        expected_delivery_date: expectedDeliveryDate.trim() || undefined,
        lines: linesOut
      };
      if (props.mode === "edit") {
        const id = props.orderId || "";
        if (!id) throw new Error("missing order id");
        await apiPatch(`/purchases/orders/${encodeURIComponent(id)}/draft`, payload);
        router.push(`/purchasing/purchase-orders/${encodeURIComponent(id)}`);
      } else {
        const res = await apiPost<{ id: string }>("/purchases/orders/drafts", payload);
        router.push(`/purchasing/purchase-orders/${encodeURIComponent(res.id)}`);
      }
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  }

  const title = props.mode === "edit" ? "Edit Draft Purchase Order" : "Create Draft Purchase Order";

  const selectedSupplierText = useMemo(() => {
    if (!supplierId) return "";
    return supplierLabel ? `${supplierLabel}` : supplierId;
  }, [supplierId, supplierLabel]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-fg-muted">Draft first, Post when ready (commit incoming inventory).</p>
        </div>
        <Button type="button" variant="outline" onClick={() => router.push("/purchasing/purchase-orders")} disabled={saving}>
          Back
        </Button>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Supplier, warehouse, and delivery.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">Supplier</label>
              <SupplierTypeahead disabled={loading || saving} onSelect={(s) => { setSupplierId(s.id); setSupplierLabel(s.name); }} />
              {supplierId ? <div className="text-[11px] text-fg-subtle">Selected: {selectedSupplierText}</div> : null}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Warehouse</label>
              <SearchableSelect
                value={warehouseId}
                onChange={setWarehouseId}
                disabled={loading || saving}
                placeholder="Select warehouse..."
                searchPlaceholder="Search warehouses..."
                options={[
                  { value: "", label: "Select warehouse..." },
                  ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">Supplier Ref (optional)</label>
              <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="Vendor PO reference" disabled={loading || saving} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Expected Delivery (optional)</label>
              <Input value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} placeholder="YYYY-MM-DD" disabled={loading || saving} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD→LL)</label>
              <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} disabled={loading || saving} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>Add items and quantities. Costs auto-fill from supplier last cost when available.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addLine} className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-6 space-y-1">
              <label className="text-xs font-medium text-fg-muted">Item</label>
              <ItemTypeahead disabled={loading || saving} onSelect={onPickItem} />
              {addItem ? (
                <div className="text-[11px] text-fg-subtle">
                  Selected: <span className="font-mono">{addItem.sku}</span> · {addItem.name}{" "}
                  {(addItem as any).unit_of_measure ? <span className="font-mono">({String((addItem as any).unit_of_measure)})</span> : null}
                </div>
              ) : null}
            </div>
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs font-medium text-fg-muted">Qty</label>
              <Input ref={addQtyRef} value={addQty} onChange={(e) => setAddQty(e.target.value)} disabled={loading || saving} />
            </div>
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs font-medium text-fg-muted">Unit USD</label>
              <Input value={addUsd} onChange={(e) => setAddUsd(e.target.value)} disabled={loading || saving} />
            </div>
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs font-medium text-fg-muted">Unit LL</label>
              <Input value={addLbp} onChange={(e) => setAddLbp(e.target.value)} disabled={loading || saving} />
            </div>
            <div className="md:col-span-12 flex justify-end">
              <Button type="submit" disabled={loading || saving}>
                Add Line
              </Button>
            </div>
          </form>

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit USD</th>
                  <th className="px-3 py-2 text-right">Unit LL</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="ui-tr-hover">
                    <td className="px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate">
                          <span className="font-mono text-xs text-fg-muted">{l.item_sku || l.item_id}</span>{" "}
                          {l.item_name ? <span className="text-foreground">· {l.item_name}</span> : null}
                        </div>
                        {l.unit_of_measure ? <div className="mt-0.5 font-mono text-[10px] text-fg-subtle">{String(l.unit_of_measure)}</div> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input value={l.qty} onChange={(e) => updateLine(idx, { qty: e.target.value })} disabled={saving} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input value={l.unit_cost_usd} onChange={(e) => updateLine(idx, { unit_cost_usd: e.target.value })} disabled={saving} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input value={l.unit_cost_lbp} onChange={(e) => updateLine(idx, { unit_cost_lbp: e.target.value })} disabled={saving} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => removeLine(idx)} disabled={saving}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
                {!lines.length ? (
                  <tr>
                    <td className="px-3 py-3 text-sm text-fg-muted" colSpan={5}>
                      No lines yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button type="button" onClick={save} disabled={saving || loading}>
              {saving ? "..." : props.mode === "edit" ? "Save Draft" : "Create Draft"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
