"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ItemPicker, type ItemPickerItem } from "@/components/item-picker";

type Customer = { id: string; name: string; payment_terms_days?: string | number };
type CatalogItemBarcode = { id: string; barcode: string; qty_factor: string | number; label: string | null; is_primary: boolean };
type Item = ItemPickerItem & {
  barcode: string | null;
  unit_of_measure: string;
  price_usd: string | number | null;
  price_lbp: string | number | null;
  barcodes: CatalogItemBarcode[];
};
type Warehouse = { id: string; name: string };

type InvoiceLine = {
  id?: string;
  item_id: string;
  qty: string | number;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
};

type InvoiceDetail = {
  invoice: {
    id: string;
    status: string;
    customer_id: string | null;
    warehouse_id: string | null;
    invoice_date?: string | null;
    due_date?: string | null;
    reserve_stock?: boolean;
    exchange_rate: string | number;
  };
  lines: Array<{
    item_id: string;
    qty: string | number;
    unit_price_usd: string | number;
    unit_price_lbp: string | number;
  }>;
};

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + Math.max(0, days || 0));
  return d.toISOString().slice(0, 10);
}

export function SalesInvoiceDraftEditor(props: { mode: "create" | "edit"; invoiceId?: string }) {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => todayIso());
  const [autoDueDate, setAutoDueDate] = useState(true);
  const [dueDate, setDueDate] = useState(() => todayIso());
  const [reserveStock, setReserveStock] = useState(false);
  const [exchangeRate, setExchangeRate] = useState("0");

  const [lines, setLines] = useState<Array<{ item_id: string; qty: string; unit_price_usd: string; unit_price_lbp: string }>>([]);

  const [addItemId, setAddItemId] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");

  const addQtyRef = useRef<HTMLInputElement | null>(null);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const addItem = addItemId ? itemById.get(addItemId) : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [cust, it, wh] = await Promise.all([
        apiGet<{ customers: Customer[] }>("/customers"),
        apiGet<{ items: Item[] }>("/pricing/catalog"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses")
      ]);
      setCustomers(cust.customers || []);
      setItems(it.items || []);
      setWarehouses(wh.warehouses || []);

      const firstWhId = (wh.warehouses || [])[0]?.id || "";
      if (firstWhId) setWarehouseId((prev) => prev || firstWhId);

      if (props.mode === "edit") {
        const id = props.invoiceId || "";
        if (!id) throw new Error("missing invoice id");
        const det = await apiGet<InvoiceDetail>(`/sales/invoices/${id}`);
        if (det.invoice.status !== "draft") throw new Error("Only draft invoices can be edited.");

        setCustomerId(det.invoice.customer_id || "");
        setWarehouseId(det.invoice.warehouse_id || firstWhId || "");
        setInvoiceDate(String(det.invoice.invoice_date || todayIso()).slice(0, 10));
        setAutoDueDate(false);
        setDueDate(String(det.invoice.due_date || det.invoice.invoice_date || todayIso()).slice(0, 10));
        setReserveStock(Boolean(det.invoice.reserve_stock));
        setExchangeRate(String(det.invoice.exchange_rate || 0));
        setLines(
          (det.lines || []).map((l) => ({
            item_id: l.item_id,
            qty: String(l.qty || 0),
            unit_price_usd: String(l.unit_price_usd || 0),
            unit_price_lbp: String(l.unit_price_lbp || 0)
          }))
        );
      } else {
        setCustomerId("");
        setInvoiceDate(todayIso());
        setAutoDueDate(true);
        setDueDate(todayIso());
        setReserveStock(false);
        setExchangeRate("0");
        setLines([]);
      }

      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [props.mode, props.invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoDueDate) return;
    const invDate = invoiceDate || todayIso();
    const terms = Number(customerById.get(customerId)?.payment_terms_days || 0);
    const next = addDays(invDate, Number.isFinite(terms) ? terms : 0);
    setDueDate(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDueDate, customerId, invoiceDate, customers.length]);

  function onPickItem(it: Item) {
    setAddItemId(it.id);
    setAddQty("1");

    const usd = toNum(String(it.price_usd ?? ""));
    const lbp = toNum(String(it.price_lbp ?? ""));
    setAddUsd(usd > 0 ? String(usd) : "");
    setAddLbp(lbp > 0 ? String(lbp) : "");

    setStatus("");
    setTimeout(() => addQtyRef.current?.focus(), 0);
  }

  function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!addItemId) return setStatus("Select an item.");
    const q = toNum(addQty);
    if (q <= 0) return setStatus("qty must be > 0");
    let unitUsd = toNum(addUsd);
    let unitLbp = toNum(addLbp);
    const ex = toNum(exchangeRate);
    if (ex > 0) {
      if (unitUsd === 0 && unitLbp > 0) unitUsd = unitLbp / ex;
      if (unitLbp === 0 && unitUsd > 0) unitLbp = unitUsd * ex;
    }
    if (unitUsd === 0 && unitLbp === 0) return setStatus("Set USD or LL unit price.");
    setLines((prev) => [
      ...prev,
      { item_id: addItemId, qty: String(q), unit_price_usd: String(unitUsd), unit_price_lbp: String(unitLbp) }
    ]);
    setAddItemId("");
    setAddQty("1");
    setAddUsd("");
    setAddLbp("");
    setStatus("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId) return setStatus("warehouse is required");

    const exRes = parseNumberInput(exchangeRate);
    if (!exRes.ok && exRes.reason === "invalid") return setStatus("Invalid exchange rate.");
    const ex = exRes.ok ? exRes.value : 0;

    const linesOut: Array<{ item_id: string; qty: number; unit_price_usd: number; unit_price_lbp: number }> = [];
    for (let i = 0; i < (lines || []).length; i++) {
      const l = lines[i];
      const qtyRes = parseNumberInput(l.qty);
      const usdRes = parseNumberInput(l.unit_price_usd);
      const lbpRes = parseNumberInput(l.unit_price_lbp);
      if (!qtyRes.ok && qtyRes.reason === "invalid") return setStatus(`Invalid qty on line ${i + 1}.`);
      if (!usdRes.ok && usdRes.reason === "invalid") return setStatus(`Invalid unit USD on line ${i + 1}.`);
      if (!lbpRes.ok && lbpRes.reason === "invalid") return setStatus(`Invalid unit LL on line ${i + 1}.`);
      const qty = qtyRes.ok ? qtyRes.value : 0;
      const unitUsd = usdRes.ok ? usdRes.value : 0;
      const unitLbp = lbpRes.ok ? lbpRes.value : 0;
      if (qty <= 0) return setStatus(`Qty must be > 0 (line ${i + 1}).`);
      if (unitUsd === 0 && unitLbp === 0) return setStatus(`Set USD or LL unit price (line ${i + 1}).`);
      linesOut.push({ item_id: l.item_id, qty, unit_price_usd: unitUsd, unit_price_lbp: unitLbp });
    }

    setSaving(true);
    setStatus(props.mode === "edit" ? "Saving draft..." : "Creating draft...");
    try {
      const payload = {
        customer_id: customerId || null,
        warehouse_id: warehouseId,
        invoice_date: invoiceDate || undefined,
        due_date: dueDate || undefined,
        reserve_stock: reserveStock,
        exchange_rate: ex,
        pricing_currency: "USD",
        settlement_currency: "USD",
        lines: linesOut
      };

      if (props.mode === "edit") {
        const id = props.invoiceId || "";
        if (!id) throw new Error("missing invoice id");
        await apiPatch(`/sales/invoices/${id}`, payload);
        setStatus("");
        router.push(`/sales/invoices/${id}`);
      } else {
        const res = await apiPost<{ id: string }>("/sales/invoices/drafts", payload);
        setStatus("");
        router.push(`/sales/invoices/${res.id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  const headerTitle = props.mode === "edit" ? "Edit Draft Sales Invoice" : "Create Draft Sales Invoice";
  const headerDesc = "Draft first, then Post when ready (stock + GL).";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{headerTitle}</h1>
          <p className="text-sm text-fg-muted">{headerDesc}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/sales/invoices")}>
            Back
          </Button>
        </div>
      </div>

      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Fix the issue and try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Required fields and due date logic.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Customer (optional)</label>
                <select className="ui-select" value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={loading}>
                  <option value="">Walk-in</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Warehouse</label>
                <select className="ui-select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={loading}>
                  <option value="">Select warehouse...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Invoice Date</label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={loading} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Due Date</label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={loading || autoDueDate}
                />
              </div>
              <div className="md:col-span-2 flex items-end">
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={autoDueDate} onChange={(e) => setAutoDueDate(e.target.checked)} />
                  Auto-calculate from customer payment terms
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD→LL)</label>
                <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} disabled={loading} />
              </div>
              <div className="md:col-span-2 flex items-end">
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={reserveStock} onChange={(e) => setReserveStock(e.target.checked)} />
                  Reserve stock while draft (affects availability reporting)
                </label>
              </div>
            </div>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">Lines</CardTitle>
                    <CardDescription>Add items, then Post when ready.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <form onSubmit={addLine} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                  <div className="space-y-1 md:col-span-6">
                    <label className="text-xs font-medium text-fg-muted">Item (search by SKU, name, or barcode)</label>
                    <ItemPicker items={items} onSelect={(it) => onPickItem(it as Item)} disabled={loading} />
                    {addItem ? (
                      <p className="text-[11px] text-fg-subtle">
                        Selected: <span className="font-mono">{addItem.sku}</span> · {addItem.name}
                      </p>
                    ) : (
                      <p className="text-[11px] text-fg-subtle">Tip: paste/scan a barcode then press Enter.</p>
                    )}
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Qty</label>
                    <div className="relative">
                      <Input ref={addQtyRef} value={addQty} onChange={(e) => setAddQty(e.target.value)} className="pr-14" />
                      {addItem?.unit_of_measure ? (
                        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-fg-subtle">
                          {addItem.unit_of_measure}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Unit USD</label>
                    <Input value={addUsd} onChange={(e) => setAddUsd(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Unit LL</label>
                    <Input value={addLbp} onChange={(e) => setAddLbp(e.target.value)} placeholder="0" />
                  </div>
                  <div className="md:col-span-12 flex justify-end gap-2">
                    <Button type="submit" variant="outline" disabled={loading}>
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
                        <th className="px-3 py-2 text-right">Total USD</th>
                        <th className="px-3 py-2 text-right">Total LL</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, idx) => {
                        const it = itemById.get(l.item_id);
                        const qty = toNum(String(l.qty));
                        const unitUsd = toNum(String(l.unit_price_usd));
                        const unitLbp = toNum(String(l.unit_price_lbp));
                        return (
                          <tr key={`${l.item_id}-${idx}`} className="ui-tr-hover">
                            <td className="px-3 py-2">
                              {it ? (
                                <span>
                                  <span className="font-mono text-xs">{it.sku}</span> · {it.name}
                                </span>
                              ) : (
                                <span className="font-mono text-xs">{l.item_id}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}{" "}
                              {it?.unit_of_measure ? <span className="text-[10px] text-fg-subtle">{it.unit_of_measure}</span> : null}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {unitUsd.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {unitLbp.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {(qty * unitUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {(qty * unitLbp).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                                >
                                  Remove
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {lines.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-fg-subtle" colSpan={7}>
                            No lines yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving || loading}>
                {saving ? "..." : props.mode === "edit" ? "Save Draft" : "Create Draft"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
