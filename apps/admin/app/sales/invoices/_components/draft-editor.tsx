"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPatch, apiPost, getCompanyId } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { getDefaultWarehouseId } from "@/lib/op-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { ItemTypeahead, type ItemTypeaheadItem } from "@/components/item-typeahead";
import { CustomerTypeahead, type CustomerTypeaheadCustomer } from "@/components/customer-typeahead";
import { SearchableSelect } from "@/components/searchable-select";
import { Page, PageHeader } from "@/components/page";
import { ShortcutLink } from "@/components/shortcut-link";

type Warehouse = { id: string; name: string };
type UserRow = { id: string; email: string; full_name?: string | null };

type InvoiceLineDraft = {
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  unit_of_measure?: string | null;
  qty: string;
  unit_price_usd: string;
  unit_price_lbp: string;
  // Discount percent as 0..100 (UI-friendly). Saved to backend as 0..1.
  discount_pct: string;
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
    invoice_discount_pct?: string | number | null;
    invoice_discount_usd?: string | number | null;
    invoice_discount_lbp?: string | number | null;
    salesperson_user_id?: string | null;
    sales_channel?: string | null;
    delivery_address?: string | null;
    delivery_phone?: string | null;
    shipping_method?: string | null;
    tracking_no?: string | null;
    shipping_notes?: string | null;
    delivered_at?: string | null;
  };
  lines: Array<{
    item_id: string;
    item_sku?: string | null;
    item_name?: string | null;
    unit_of_measure?: string | null;
    qty: string | number;
    unit_price_usd: string | number;
    unit_price_lbp: string | number;
    pre_discount_unit_price_usd?: string | number | null;
    pre_discount_unit_price_lbp?: string | number | null;
    discount_pct?: string | number | null;
  }>;
};

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

function clampPct01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function parsePct100(v: string) {
  const n = toNum(v);
  if (!Number.isFinite(n) || n <= 0) return { pct100: 0, pct01: 0 };
  const pct100 = Math.min(100, Math.max(0, n));
  return { pct100, pct01: clampPct01(pct100 / 100) };
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

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerTypeaheadCustomer | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => todayIso());
  const [autoDueDate, setAutoDueDate] = useState(true);
  const [dueDate, setDueDate] = useState(() => todayIso());
  const [reserveStock, setReserveStock] = useState(false);
  const [exchangeRate, setExchangeRate] = useState("0");

  const [invoiceDiscPct, setInvoiceDiscPct] = useState("0");
  const [invoiceDiscUsd, setInvoiceDiscUsd] = useState("0");
  const [invoiceDiscLbp, setInvoiceDiscLbp] = useState("0");

  const [salespersonUserId, setSalespersonUserId] = useState("");
  const [salesChannel, setSalesChannel] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryPhone, setDeliveryPhone] = useState("");
  const [shippingMethod, setShippingMethod] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [shippingNotes, setShippingNotes] = useState("");
  const [deliveredAt, setDeliveredAt] = useState("");

  const [lines, setLines] = useState<InvoiceLineDraft[]>([]);

  const [addItem, setAddItem] = useState<ItemTypeaheadItem | null>(null);
  const [addQty, setAddQty] = useState("1");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");
  const [addDisc, setAddDisc] = useState("0");

  const [bulkLineDisc, setBulkLineDisc] = useState("");

  const addQtyRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [wh, usr] = await Promise.all([
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
        apiGet<{ users: UserRow[] }>("/users").catch(() => ({ users: [] as UserRow[] }))
      ]);
      setWarehouses(wh.warehouses || []);
      setUsers(usr.users || []);

      const firstWhId = (wh.warehouses || [])[0]?.id || "";
      const preferredWhId = (() => {
        const cid = getCompanyId();
        const pref = getDefaultWarehouseId(cid);
        return pref && (wh.warehouses || []).some((w) => w.id === pref) ? pref : "";
      })();
      if (firstWhId || preferredWhId) setWarehouseId((prev) => prev || preferredWhId || firstWhId);

      if (props.mode === "edit") {
        const id = props.invoiceId || "";
        if (!id) throw new Error("missing invoice id");
        const det = await apiGet<InvoiceDetail>(`/sales/invoices/${id}`);
        if (det.invoice.status !== "draft") throw new Error("Only draft invoices can be edited.");

        const uniq = Array.from(new Set((det.lines || []).map((l) => l.item_id).filter(Boolean)));
        const look = uniq.length
          ? await apiPost<{ items: Array<{ id: string; sku: string; name: string; unit_of_measure: string }> }>("/items/lookup", {
              ids: uniq
            })
          : { items: [] };
        const byId = new Map((look.items || []).map((it) => [it.id, it]));

        setCustomerId(det.invoice.customer_id || "");
        if (det.invoice.customer_id) {
          try {
            const c = await apiGet<{ customer: CustomerTypeaheadCustomer }>(
              `/customers/${encodeURIComponent(det.invoice.customer_id)}`
            );
            setSelectedCustomer(c.customer || null);
          } catch {
            setSelectedCustomer(null);
          }
        } else {
          setSelectedCustomer(null);
        }
        setWarehouseId(det.invoice.warehouse_id || preferredWhId || firstWhId || "");
        setInvoiceDate(String(det.invoice.invoice_date || todayIso()).slice(0, 10));
        setAutoDueDate(false);
        setDueDate(String(det.invoice.due_date || det.invoice.invoice_date || todayIso()).slice(0, 10));
        setReserveStock(Boolean(det.invoice.reserve_stock));
        setExchangeRate(String(det.invoice.exchange_rate || 0));
        const pct01 = Number(det.invoice.invoice_discount_pct || 0);
        setInvoiceDiscPct(String(Math.round(pct01 * 10000) / 100));
        // If pct is set, treat the discount as percent-based even if the backend also stores derived amounts.
        if (pct01 > 0) {
          setInvoiceDiscUsd("0");
          setInvoiceDiscLbp("0");
        } else {
          setInvoiceDiscUsd(String(det.invoice.invoice_discount_usd || 0));
          setInvoiceDiscLbp(String(det.invoice.invoice_discount_lbp || 0));
        }
        setSalespersonUserId(String(det.invoice.salesperson_user_id || ""));
        setSalesChannel(String(det.invoice.sales_channel || ""));
        setDeliveryAddress(String(det.invoice.delivery_address || ""));
        setDeliveryPhone(String(det.invoice.delivery_phone || ""));
        setShippingMethod(String(det.invoice.shipping_method || ""));
        setTrackingNo(String(det.invoice.tracking_no || ""));
        setShippingNotes(String(det.invoice.shipping_notes || ""));
        setDeliveredAt(String(det.invoice.delivered_at || "").slice(0, 10));
        setLines(
          (det.lines || []).map((l) => ({
            item_id: l.item_id,
            item_sku: (l as any).item_sku || byId.get(l.item_id)?.sku || null,
            item_name: (l as any).item_name || byId.get(l.item_id)?.name || null,
            unit_of_measure: (l as any).unit_of_measure || byId.get(l.item_id)?.unit_of_measure || null,
            qty: String(l.qty || 0),
            unit_price_usd: String((l as any).pre_discount_unit_price_usd ?? l.unit_price_usd ?? 0),
            unit_price_lbp: String((l as any).pre_discount_unit_price_lbp ?? l.unit_price_lbp ?? 0),
            discount_pct: String(Math.round(Number((l as any).discount_pct || 0) * 10000) / 100)
          }))
        );
      } else {
        setCustomerId("");
        setSelectedCustomer(null);
        setInvoiceDate(todayIso());
        setAutoDueDate(true);
        setDueDate(todayIso());
        setReserveStock(false);
        setExchangeRate("0");
        setInvoiceDiscPct("0");
        setInvoiceDiscUsd("0");
        setInvoiceDiscLbp("0");
        setSalespersonUserId("");
        setSalesChannel("");
        setDeliveryAddress("");
        setDeliveryPhone("");
        setShippingMethod("");
        setTrackingNo("");
        setShippingNotes("");
        setDeliveredAt("");
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
    const terms = Number(selectedCustomer?.payment_terms_days || 0);
    const next = addDays(invDate, Number.isFinite(terms) ? terms : 0);
    setDueDate(next);
  }, [autoDueDate, customerId, invoiceDate, selectedCustomer?.payment_terms_days]);

  function onPickItem(it: ItemTypeaheadItem) {
    setAddItem(it);
    setAddQty("1");

    const usd = toNum(String((it as any).price_usd ?? ""));
    const lbp = toNum(String((it as any).price_lbp ?? ""));
    setAddUsd(usd > 0 ? String(usd) : "");
    setAddLbp(lbp > 0 ? String(lbp) : "");

    setStatus("");
    setTimeout(() => addQtyRef.current?.focus(), 0);
  }

  function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!addItem) return setStatus("Select an item.");
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
      {
        item_id: addItem.id,
        item_sku: addItem.sku,
        item_name: addItem.name,
        unit_of_measure: addItem.unit_of_measure ?? null,
        qty: String(q),
        unit_price_usd: String(unitUsd),
        unit_price_lbp: String(unitLbp),
        discount_pct: String(parsePct100(addDisc).pct100 || 0)
      }
    ]);
    setAddItem(null);
    setAddQty("1");
    setAddUsd("");
    setAddLbp("");
    setAddDisc("0");
    setStatus("");
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!warehouseId) return setStatus("warehouse is required");

    const exRes = parseNumberInput(exchangeRate);
    if (!exRes.ok && exRes.reason === "invalid") return setStatus("Invalid exchange rate.");
    const ex = exRes.ok ? exRes.value : 0;

    const invDiscPctRes = parseNumberInput(invoiceDiscPct);
    const invDiscUsdRes = parseNumberInput(invoiceDiscUsd);
    const invDiscLbpRes = parseNumberInput(invoiceDiscLbp);
    if (!invDiscPctRes.ok && invDiscPctRes.reason === "invalid") return setStatus("Invalid invoice discount %.");
    if (!invDiscUsdRes.ok && invDiscUsdRes.reason === "invalid") return setStatus("Invalid invoice discount USD.");
    if (!invDiscLbpRes.ok && invDiscLbpRes.reason === "invalid") return setStatus("Invalid invoice discount LL.");
    const invPct = parsePct100(String(invDiscPctRes.ok ? invDiscPctRes.value : 0));
    const invAmtUsd = invDiscUsdRes.ok ? invDiscUsdRes.value : 0;
    const invAmtLbp = invDiscLbpRes.ok ? invDiscLbpRes.value : 0;

    const linesOut: Array<{
      item_id: string;
      qty: number;
      uom?: string | null;
      qty_factor?: number;
      qty_entered?: number;
      unit_price_usd: number;
      unit_price_lbp: number;
      pre_discount_unit_price_usd?: number;
      pre_discount_unit_price_lbp?: number;
      discount_pct?: number;
      discount_amount_usd?: number;
      discount_amount_lbp?: number;
    }> = [];
    for (let i = 0; i < (lines || []).length; i++) {
      const l = lines[i];
      const qtyRes = parseNumberInput(l.qty);
      const usdRes = parseNumberInput(l.unit_price_usd);
      const lbpRes = parseNumberInput(l.unit_price_lbp);
      const discRes = parseNumberInput(l.discount_pct);
      if (!qtyRes.ok && qtyRes.reason === "invalid") return setStatus(`Invalid qty on line ${i + 1}.`);
      if (!usdRes.ok && usdRes.reason === "invalid") return setStatus(`Invalid unit USD on line ${i + 1}.`);
      if (!lbpRes.ok && lbpRes.reason === "invalid") return setStatus(`Invalid unit LL on line ${i + 1}.`);
      if (!discRes.ok && discRes.reason === "invalid") return setStatus(`Invalid discount % on line ${i + 1}.`);
      const qty = qtyRes.ok ? qtyRes.value : 0;
      let preUsd = usdRes.ok ? usdRes.value : 0;
      let preLbp = lbpRes.ok ? lbpRes.value : 0;
      const disc = parsePct100(String(discRes.ok ? discRes.value : 0));
      if (qty <= 0) return setStatus(`Qty must be > 0 (line ${i + 1}).`);
      if (preUsd === 0 && preLbp === 0) return setStatus(`Set USD or LL unit price (line ${i + 1}).`);
      if (ex > 0) {
        if (preUsd === 0 && preLbp > 0) preUsd = preLbp / ex;
        if (preLbp === 0 && preUsd > 0) preLbp = preUsd * ex;
      }
      const netUsd = preUsd * (1 - disc.pct01);
      const netLbp = preLbp * (1 - disc.pct01);
      const discAmtUsd = (preUsd - netUsd) * qty;
      const discAmtLbp = (preLbp - netLbp) * qty;
      linesOut.push({
        item_id: l.item_id,
        qty,
        uom: l.unit_of_measure || undefined,
        qty_factor: 1,
        qty_entered: qty,
        unit_price_usd: netUsd,
        unit_price_lbp: netLbp,
        pre_discount_unit_price_usd: preUsd,
        pre_discount_unit_price_lbp: preLbp,
        discount_pct: disc.pct01,
        discount_amount_usd: discAmtUsd,
        discount_amount_lbp: discAmtLbp
      });
    }

    setSaving(true);
    setStatus(props.mode === "edit" ? "Saving draft..." : "Creating draft...");
    try {
      // Canonical UI semantics:
      // - If invoice discount % > 0, treat it as percent-based (even if amount fields have values).
      // - Else treat amounts as a fixed discount.
      const usingAmt = (invAmtUsd > 0 || invAmtLbp > 0) && invPct.pct01 === 0;
      const payload = {
        customer_id: customerId || null,
        warehouse_id: warehouseId,
        invoice_date: invoiceDate || undefined,
        due_date: dueDate || undefined,
        reserve_stock: reserveStock,
        exchange_rate: ex,
        pricing_currency: "USD",
        settlement_currency: "USD",
        invoice_discount_pct: usingAmt ? 0 : invPct.pct01,
        invoice_discount_usd: usingAmt ? invAmtUsd : 0,
        invoice_discount_lbp: usingAmt ? invAmtLbp : 0,
        salesperson_user_id: salespersonUserId || null,
        sales_channel: salesChannel || null,
        delivery_address: deliveryAddress || null,
        delivery_phone: deliveryPhone || null,
        shipping_method: shippingMethod || null,
        tracking_no: trackingNo || null,
        shipping_notes: shippingNotes || null,
        delivered_at: deliveredAt ? `${deliveredAt}T00:00:00Z` : null,
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
    <Page width="lg">
      <PageHeader
        title={headerTitle}
        description={headerDesc}
        actions={
          <Button variant="outline" onClick={() => router.push("/sales/invoices")}>
            Back
          </Button>
        }
      />

      {status ? (
        <ErrorBanner error={status} onRetry={load} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Required fields and due date logic.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Customer (optional)</label>
                <CustomerTypeahead
                  disabled={loading}
                  onSelect={(c) => {
                    setSelectedCustomer(c);
                    setCustomerId(c.id);
                  }}
                  onClear={() => {
                    setSelectedCustomer(null);
                    setCustomerId("");
                  }}
                  placeholder="Walk-in or search customer..."
                />
                {selectedCustomer ? (
                  <div className="text-[11px] text-fg-subtle">
                    Selected: <span className="font-medium text-foreground">{selectedCustomer.name}</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-fg-subtle">Walk-in customer</div>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Warehouse</label>
                <SearchableSelect
                  value={warehouseId}
                  onChange={setWarehouseId}
                  disabled={loading}
                  placeholder="Select warehouse..."
                  searchPlaceholder="Search warehouses..."
                  options={[
                    { value: "", label: "Select warehouse..." },
                    ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                  ]}
                />
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

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Salesperson (optional)</label>
                <SearchableSelect
                  value={salespersonUserId}
                  onChange={setSalespersonUserId}
                  disabled={loading}
                  placeholder="Select salesperson..."
                  searchPlaceholder="Search users..."
                  options={[
                    { value: "", label: "None" },
                    ...users.map((u) => ({
                      value: u.id,
                      label: (u.full_name || u.email || u.id).trim()
                    }))
                  ]}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Sales Channel (optional)</label>
                <Input value={salesChannel} onChange={(e) => setSalesChannel(e.target.value)} disabled={loading} placeholder="online / wholesale / ..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Delivered At (optional)</label>
                <Input type="date" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} disabled={loading} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Delivery Address (optional)</label>
                <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} disabled={loading} placeholder="Address / area / notes..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Delivery Phone (optional)</label>
                <Input value={deliveryPhone} onChange={(e) => setDeliveryPhone(e.target.value)} disabled={loading} placeholder="+961..." />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Shipping Method (optional)</label>
                <Input value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)} disabled={loading} placeholder="DHL / driver / pickup..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Tracking No (optional)</label>
                <Input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} disabled={loading} placeholder="..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Shipping Notes (optional)</label>
                <Input value={shippingNotes} onChange={(e) => setShippingNotes(e.target.value)} disabled={loading} placeholder="..." />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Invoice Discount % (optional)</label>
                <Input value={invoiceDiscPct} onChange={(e) => setInvoiceDiscPct(e.target.value)} disabled={loading} placeholder="0" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Invoice Discount USD (optional)</label>
                <Input value={invoiceDiscUsd} onChange={(e) => setInvoiceDiscUsd(e.target.value)} disabled={loading} placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Invoice Discount LL (optional)</label>
                <Input value={invoiceDiscLbp} onChange={(e) => setInvoiceDiscLbp(e.target.value)} disabled={loading} placeholder="0" />
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
                  <div className="space-y-1 md:col-span-5">
                    <label className="text-xs font-medium text-fg-muted">Item (search by name or barcode)</label>
                    <ItemTypeahead
                      endpoint="/pricing/catalog/typeahead"
                      onSelect={(it) => onPickItem(it)}
                      disabled={loading}
                      placeholder="Search item name / barcode..."
                    />
                    {addItem ? (
                      <p className="text-[11px] text-fg-subtle">
                        Selected: <span className="font-mono">{addItem.sku}</span> · {addItem.name}
                      </p>
                    ) : (
                      <p className="text-[11px] text-fg-subtle">Tip: scan a barcode or type a few letters of the name, then Enter.</p>
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
                  <div className="space-y-1 md:col-span-1">
                    <label className="text-xs font-medium text-fg-muted">Disc%</label>
                    <Input value={addDisc} onChange={(e) => setAddDisc(e.target.value)} placeholder="0" />
                  </div>
                  <div className="md:col-span-12 flex justify-end gap-2">
                    <Button type="submit" variant="outline" disabled={loading}>
                      Add Line
                    </Button>
                  </div>
                </form>

                <div className="ui-table-wrap">
                  <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                    <div className="text-[11px] text-fg-subtle">
                      {(() => {
                        let subtotalUsd = 0;
                        let subtotalLbp = 0;
                        let discUsd = 0;
                        let discLbp = 0;
                        for (const ln of lines || []) {
                          const qty = toNum(String(ln.qty || 0));
                          const preUsd = toNum(String(ln.unit_price_usd || 0));
                          const preLbp = toNum(String(ln.unit_price_lbp || 0));
                          const d = parsePct100(String(ln.discount_pct || 0));
                          subtotalUsd += qty * preUsd;
                          subtotalLbp += qty * preLbp;
                          discUsd += qty * preUsd * d.pct01;
                          discLbp += qty * preLbp * d.pct01;
                        }
                        const netUsd = subtotalUsd - discUsd;
                        const netLbp = subtotalLbp - discLbp;

                        const invPct = parsePct100(String(invoiceDiscPct || "0")).pct01;
                        let invDiscUsd = toNum(String(invoiceDiscUsd || 0));
                        let invDiscLbp = toNum(String(invoiceDiscLbp || 0));
                        const ex = toNum(String(exchangeRate || 0));
                        if (ex > 0) {
                          if (invDiscUsd === 0 && invDiscLbp > 0) invDiscUsd = invDiscLbp / ex;
                          if (invDiscLbp === 0 && invDiscUsd > 0) invDiscLbp = invDiscUsd * ex;
                        }
                        if (invPct > 0) {
                          invDiscUsd = netUsd * invPct;
                          invDiscLbp = netLbp * invPct;
                        } else if (invDiscUsd === 0 && invDiscLbp === 0) {
                          invDiscUsd = 0;
                          invDiscLbp = 0;
                        }
                        invDiscUsd = Math.min(invDiscUsd, netUsd);
                        invDiscLbp = Math.min(invDiscLbp, netLbp);

                        const totalUsd = netUsd - invDiscUsd;
                        const totalLbp = netLbp - invDiscLbp;
                        return (
                          <>
                            Subtotal {subtotalUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD ·{" "}
                            {subtotalLbp.toLocaleString("en-US", { maximumFractionDigits: 0 })} LL{" "}
                            <span className="px-1">·</span> Discount {discUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD ·{" "}
                            {discLbp.toLocaleString("en-US", { maximumFractionDigits: 0 })} LL{" "}
                            <span className="px-1">·</span> Invoice Discount {invDiscUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD ·{" "}
                            {invDiscLbp.toLocaleString("en-US", { maximumFractionDigits: 0 })} LL{" "}
                            <span className="px-1">·</span> Total {totalUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD ·{" "}
                            {totalLbp.toLocaleString("en-US", { maximumFractionDigits: 0 })} LL
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Bulk Line Disc%</label>
                        <Input value={bulkLineDisc} onChange={(e) => setBulkLineDisc(e.target.value)} placeholder="0" className="w-24" />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const d = parsePct100(bulkLineDisc);
                          setLines((prev) => prev.map((x) => ({ ...x, discount_pct: String(d.pct100 || 0) })));
                        }}
                        disabled={loading || saving || lines.length === 0}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                  <table className="ui-table">
                    <thead className="ui-thead">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Unit USD</th>
                        <th className="px-3 py-2 text-right">Unit LL</th>
                        <th className="px-3 py-2 text-right">Disc%</th>
                        <th className="px-3 py-2 text-right">Total USD</th>
                        <th className="px-3 py-2 text-right">Total LL</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, idx) => {
                        const qty = toNum(String(l.qty));
                        const unitUsd = toNum(String(l.unit_price_usd));
                        const unitLbp = toNum(String(l.unit_price_lbp));
                        const d = parsePct100(String(l.discount_pct || 0));
                        const netUsd = unitUsd * (1 - d.pct01);
                        const netLbp = unitLbp * (1 - d.pct01);
                        return (
                          <tr key={`${l.item_id}-${idx}`} className="ui-tr-hover">
                            <td className="px-3 py-2">
                              <ShortcutLink
                                href={`/catalog/items/${encodeURIComponent(l.item_id)}`}
                                title="Open item"
                              >
                                <span className="font-mono text-xs">{l.item_sku || l.item_id.slice(0, 8)}</span>
                                {l.item_name ? <span> · {l.item_name}</span> : null}
                              </ShortcutLink>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}{" "}
                              {l.unit_of_measure ? <span className="text-[10px] text-fg-subtle">{l.unit_of_measure}</span> : null}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {unitUsd.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {unitLbp.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Input
                                value={l.discount_pct}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, discount_pct: v } : x)));
                                }}
                                className="h-8 w-20 text-right font-mono text-xs"
                                placeholder="0"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {(qty * netUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {(qty * netLbp).toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
                          <td className="px-3 py-6 text-center text-fg-subtle" colSpan={8}>
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
              <Button type="button" onClick={() => save()} disabled={saving || loading}>
                {saving ? "..." : props.mode === "edit" ? "Save Draft" : "Create Draft"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}
