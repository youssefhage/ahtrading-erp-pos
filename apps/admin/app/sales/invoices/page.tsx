"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  warehouse_id?: string | null;
  invoice_date?: string;
  due_date?: string | null;
  created_at: string;
};

type Customer = { id: string; name: string; payment_terms_days?: string | number };
type Item = { id: string; sku: string; barcode: string | null; name: string };
type PaymentMethodMapping = { method: string; role_code: string; created_at: string };
type BankAccount = { id: string; name: string; currency: string; is_active: boolean };
type Warehouse = { id: string; name: string };

type InvoiceLine = {
  id: string;
  item_id: string;
  qty: string | number;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

type SalesPayment = {
  id: string;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  created_at: string;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  base_usd: string | number;
  base_lbp: string | number;
  tax_usd: string | number;
  tax_lbp: string | number;
  tax_date: string | null;
  created_at: string;
};

type InvoiceDetail = {
  invoice: InvoiceRow & {
    exchange_rate: string | number;
    pricing_currency: string;
    settlement_currency: string;
  };
  lines: InvoiceLine[];
  payments: SalesPayment[];
  tax_lines: TaxLine[];
};

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
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

function SalesInvoicesPageInner() {
  const searchParams = useSearchParams();
  const qsInvoiceId = searchParams.get("id") || "";

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [status, setStatus] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [draftOpen, setDraftOpen] = useState(false);
  const [draftEditId, setDraftEditId] = useState<string>("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftCustomerId, setDraftCustomerId] = useState("");
  const [draftWarehouseId, setDraftWarehouseId] = useState("");
  const [draftInvoiceDate, setDraftInvoiceDate] = useState(() => todayIso());
  const [draftAutoDueDate, setDraftAutoDueDate] = useState(true);
  const [draftDueDate, setDraftDueDate] = useState(() => todayIso());
  const [draftExchangeRate, setDraftExchangeRate] = useState("0");
  const [draftLines, setDraftLines] = useState<
    { item_id: string; qty: string; unit_price_usd: string; unit_price_lbp: string }[]
  >([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addSku, setAddSku] = useState("");
  const [addItemId, setAddItemId] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");

  const [lineEditOpen, setLineEditOpen] = useState(false);
  const [lineEditIdx, setLineEditIdx] = useState(-1);
  const [lineEditQty, setLineEditQty] = useState("1");
  const [lineEditUsd, setLineEditUsd] = useState("0");
  const [lineEditLbp, setLineEditLbp] = useState("0");

  const [postOpen, setPostOpen] = useState(false);
  const [postApplyingVat, setPostApplyingVat] = useState(true);
  const [postRecordPayment, setPostRecordPayment] = useState(false);
  const [postMethod, setPostMethod] = useState("cash");
  const [postUsd, setPostUsd] = useState("0");
  const [postLbp, setPostLbp] = useState("0");
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postPreview, setPostPreview] = useState<{ total_usd: number; total_lbp: number; tax_usd: number; tax_lbp: number } | null>(
    null
  );

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState(() => todayIso());
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);

  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelDraftReason, setCancelDraftReason] = useState("");
  const [cancelDrafting, setCancelDrafting] = useState(false);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const itemBySku = useMemo(() => new Map(items.map((i) => [i.sku.toUpperCase(), i])), [items]);
  const itemByBarcode = useMemo(
    () => new Map(items.filter((i) => i.barcode).map((i) => [String(i.barcode).toUpperCase(), i])),
    [items]
  );
  const warehouseById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const filteredInvoices = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (invoices || []).filter((inv) => {
      if (statusFilter && inv.status !== statusFilter) return false;
      if (!needle) return true;
      const no = (inv.invoice_no || "").toLowerCase();
      const cust = inv.customer_id ? (customerById.get(inv.customer_id)?.name || "").toLowerCase() : "walk-in";
      const wh = inv.warehouse_id ? (warehouseById.get(inv.warehouse_id)?.name || "").toLowerCase() : "";
      return no.includes(needle) || cust.includes(needle) || wh.includes(needle) || inv.id.toLowerCase().includes(needle);
    });
  }, [invoices, q, statusFilter, customerById, warehouseById]);

  const methodChoices = useMemo(() => {
    const base = ["cash", "bank", "card", "transfer", "other"];
    const fromConfig = paymentMethods.map((m) => m.method);
    const merged = Array.from(new Set([...base, ...fromConfig])).filter(Boolean);
    merged.sort();
    return merged;
  }, [paymentMethods]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [inv, cust, it, pm] = await Promise.all([
        apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices"),
        apiGet<{ customers: Customer[] }>("/customers"),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods")
      ]);
      setInvoices(inv.invoices || []);
      setCustomers(cust.customers || []);
      setItems(it.items || []);
      setPaymentMethods(pm.methods || []);
      try {
        const wh = await apiGet<{ warehouses: Warehouse[] }>("/warehouses");
        setWarehouses(wh.warehouses || []);
        const firstWhId = (wh.warehouses || [])[0]?.id || "";
        if (firstWhId) setDraftWarehouseId((prev) => prev || firstWhId);
      } catch {
        setWarehouses([]);
      }
      try {
        const ba = await apiGet<{ accounts: BankAccount[] }>("/banking/accounts");
        setBankAccounts((ba.accounts || []).filter((a) => a.is_active));
      } catch {
        setBankAccounts([]);
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return;
    }
    setStatus("Loading invoice...");
    try {
      const res = await apiGet<InvoiceDetail>(`/sales/invoices/${id}`);
      setDetail(res);
      setStatus("");
    } catch (err) {
      setDetail(null);
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!qsInvoiceId) return;
    // Use functional update so this effect doesn't need to depend on `invoiceId`.
    setInvoiceId((prev) => (prev === qsInvoiceId ? prev : qsInvoiceId));
  }, [qsInvoiceId]);

  useEffect(() => {
    loadDetail(invoiceId);
  }, [invoiceId, loadDetail]);

  function openNewDraft() {
    setDraftEditId("");
    setDraftCustomerId("");
    setDraftInvoiceDate(todayIso());
    setDraftAutoDueDate(true);
    setDraftDueDate(todayIso());
    setDraftExchangeRate(String(detail?.invoice.exchange_rate || 0));
    setDraftLines([]);
    setAddOpen(false);
    setLineEditOpen(false);
    setAddSku("");
    setAddItemId("");
    setAddQty("1");
    setAddUsd("");
    setAddLbp("");
    if (!draftWarehouseId && warehouses.length) setDraftWarehouseId(warehouses[0].id);
    setDraftOpen(true);
  }

  function openEditDraft() {
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;
    setDraftEditId(detail.invoice.id);
    setDraftCustomerId(detail.invoice.customer_id || "");
    setDraftWarehouseId(detail.invoice.warehouse_id || "");
    setDraftInvoiceDate((detail.invoice.invoice_date as string) || todayIso());
    setDraftAutoDueDate(false);
    setDraftDueDate(((detail.invoice as any).due_date as string) || (detail.invoice.invoice_date as string) || todayIso());
    setDraftExchangeRate(String(detail.invoice.exchange_rate || 0));
    setDraftLines(
      (detail.lines || []).map((l) => ({
        item_id: l.item_id,
        qty: String(l.qty || 0),
        unit_price_usd: String(l.unit_price_usd || 0),
        unit_price_lbp: String(l.unit_price_lbp || 0)
      }))
    );
    setAddOpen(false);
    setLineEditOpen(false);
    setAddSku("");
    setAddItemId("");
    setAddQty("1");
    setAddUsd("");
    setAddLbp("");
    setDraftOpen(true);
  }

  useEffect(() => {
    if (!draftOpen) return;
    if (!draftAutoDueDate) return;
    const invDate = draftInvoiceDate || todayIso();
    const terms = Number(customerById.get(draftCustomerId)?.payment_terms_days || 0);
    const next = addDays(invDate, Number.isFinite(terms) ? terms : 0);
    setDraftDueDate(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftOpen, draftAutoDueDate, draftCustomerId, draftInvoiceDate]);

  function onSkuChange(next: string) {
    const token = (next || "").trim().toUpperCase();
    setAddSku(token);
    const it = itemBySku.get(token) || itemByBarcode.get(token);
    setAddItemId(it?.id || "");
  }

  function addLineToDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!addItemId) return setStatus("Pick a valid SKU/item.");
    const q = toNum(addQty);
    if (q <= 0) return setStatus("qty must be > 0");
    if (toNum(addUsd) === 0 && toNum(addLbp) === 0) return setStatus("Set USD or LBP unit price.");
    setDraftLines((prev) => [
      ...prev,
      { item_id: addItemId, qty: String(q), unit_price_usd: String(toNum(addUsd)), unit_price_lbp: String(toNum(addLbp)) }
    ]);
    setAddSku("");
    setAddItemId("");
    setAddQty("1");
    setAddUsd("");
    setAddLbp("");
    setAddOpen(false);
    setStatus("");
  }

  function openLineEditor(idx: number) {
    const l = draftLines[idx];
    if (!l) return;
    setLineEditIdx(idx);
    setLineEditQty(String(l.qty || "0"));
    setLineEditUsd(String(l.unit_price_usd || "0"));
    setLineEditLbp(String(l.unit_price_lbp || "0"));
    setLineEditOpen(true);
  }

  function saveLineEdit(e: React.FormEvent) {
    e.preventDefault();
    const idx = lineEditIdx;
    if (idx < 0) return;
    const q = toNum(lineEditQty);
    if (q <= 0) return setStatus("qty must be > 0");
    if (toNum(lineEditUsd) === 0 && toNum(lineEditLbp) === 0) return setStatus("Set USD or LBP unit price.");
    setDraftLines((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, qty: String(q), unit_price_usd: String(toNum(lineEditUsd)), unit_price_lbp: String(toNum(lineEditLbp)) } : p
      )
    );
    setLineEditOpen(false);
    setStatus("");
  }

  async function createDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!draftWarehouseId) return setStatus("warehouse is required");
    setDraftSaving(true);
    setStatus(draftEditId ? "Saving draft..." : "Creating draft...");
    try {
      if (draftEditId) {
        await apiPatch(`/sales/invoices/${draftEditId}`, {
          customer_id: draftCustomerId || null,
          warehouse_id: draftWarehouseId,
          invoice_date: draftInvoiceDate || undefined,
          due_date: draftDueDate || undefined,
          exchange_rate: Number(draftExchangeRate || 0),
          pricing_currency: "USD",
          settlement_currency: "USD",
          lines: (draftLines || []).map((l) => ({
            item_id: l.item_id,
            qty: Number(l.qty || 0),
            unit_price_usd: Number(l.unit_price_usd || 0),
            unit_price_lbp: Number(l.unit_price_lbp || 0)
          }))
        });
        setDraftOpen(false);
        await load();
        await loadDetail(draftEditId);
      } else {
        const res = await apiPost<{ id: string; invoice_no: string }>("/sales/invoices/drafts", {
          customer_id: draftCustomerId || null,
          warehouse_id: draftWarehouseId,
          invoice_date: draftInvoiceDate || undefined,
          due_date: draftDueDate || undefined,
          exchange_rate: Number(draftExchangeRate || 0),
          pricing_currency: "USD",
          settlement_currency: "USD",
          lines: (draftLines || []).map((l) => ({
            item_id: l.item_id,
            qty: Number(l.qty || 0),
            unit_price_usd: Number(l.unit_price_usd || 0),
            unit_price_lbp: Number(l.unit_price_lbp || 0)
          }))
        });
        setDraftOpen(false);
        await load();
        setInvoiceId(res.id);
        await loadDetail(res.id);
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setDraftSaving(false);
    }
  }

  async function openPostDialog() {
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;
    if (!(detail.lines || []).length) {
      setStatus("Cannot post: add at least one line to this draft first.");
      return;
    }
    setPostApplyingVat(true);
    setPostRecordPayment(false);
    setPostMethod("cash");
    setPostUsd("0");
    setPostLbp("0");
    setPostPreview(null);
    try {
      const prev = await apiGet<{
        total_usd: string | number;
        total_lbp: string | number;
        tax_usd: string | number;
        tax_lbp: string | number;
      }>(`/sales/invoices/${detail.invoice.id}/post-preview?apply_vat=${encodeURIComponent("1")}`);
      const totalUsd = Number(prev.total_usd || 0);
      const totalLbp = Number(prev.total_lbp || 0);
      const taxUsd = Number(prev.tax_usd || 0);
      const taxLbp = Number(prev.tax_lbp || 0);
      setPostPreview({ total_usd: totalUsd, total_lbp: totalLbp, tax_usd: taxUsd, tax_lbp: taxLbp });
    } catch {
      setPostPreview(null);
    }
    setPostOpen(true);
  }

  async function refreshPostPreview(applyVat: boolean) {
    if (!detail) return;
    try {
      const prev = await apiGet<{
        total_usd: string | number;
        total_lbp: string | number;
        tax_usd: string | number;
        tax_lbp: string | number;
      }>(`/sales/invoices/${detail.invoice.id}/post-preview?apply_vat=${applyVat ? "1" : "0"}`);
      const totalUsd = Number(prev.total_usd || 0);
      const totalLbp = Number(prev.total_lbp || 0);
      const taxUsd = Number(prev.tax_usd || 0);
      const taxLbp = Number(prev.tax_lbp || 0);
      setPostPreview({ total_usd: totalUsd, total_lbp: totalLbp, tax_usd: taxUsd, tax_lbp: taxLbp });
    } catch {
      setPostPreview(null);
    }
  }

  async function postDraftInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;
    const usd = postRecordPayment ? toNum(postUsd) : 0;
    const lbp = postRecordPayment ? toNum(postLbp) : 0;
    const pay = !postRecordPayment || (usd === 0 && lbp === 0) ? [] : [{ method: postMethod, amount_usd: usd, amount_lbp: lbp }];
    setPostSubmitting(true);
    setStatus("Posting invoice...");
    try {
      await apiPost(`/sales/invoices/${detail.invoice.id}/post`, { apply_vat: postApplyingVat, payments: pay });
      setPostOpen(false);
      await load();
      await loadDetail(detail.invoice.id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setPostSubmitting(false);
    }
  }

  async function cancelPostedInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "posted") return;
    setCanceling(true);
    setStatus("Voiding invoice...");
    try {
      await apiPost(`/sales/invoices/${detail.invoice.id}/cancel`, {
        cancel_date: cancelDate || undefined,
        reason: cancelReason || undefined
      });
      setCancelOpen(false);
      await load();
      await loadDetail(detail.invoice.id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCanceling(false);
    }
  }

  async function cancelDraftInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;
    setCancelDrafting(true);
    setStatus("Canceling draft...");
    try {
      await apiPost(`/sales/invoices/${detail.invoice.id}/cancel-draft`, { reason: cancelDraftReason || undefined });
      setCancelDraftOpen(false);
      await load();
      await loadDetail(detail.invoice.id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCancelDrafting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
          <Button onClick={openNewDraft}>New Draft</Button>
        </div>

        <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{draftEditId ? "Edit Draft Sales Invoice" : "Create Draft Sales Invoice"}</DialogTitle>
              <DialogDescription>Draft first, then Post when ready (stock + GL).</DialogDescription>
            </DialogHeader>
            <form onSubmit={createDraft} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Customer (optional)</label>
                  <select className="ui-select" value={draftCustomerId} onChange={(e) => setDraftCustomerId(e.target.value)}>
                    <option value="">Walk-in</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Warehouse</label>
                  <select className="ui-select" value={draftWarehouseId} onChange={(e) => setDraftWarehouseId(e.target.value)}>
                    <option value="">Select warehouse...</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Invoice Date</label>
                  <Input type="date" value={draftInvoiceDate} onChange={(e) => setDraftInvoiceDate(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Due Date</label>
                  <Input
                    type="date"
                    value={draftDueDate}
                    onChange={(e) => setDraftDueDate(e.target.value)}
                    disabled={draftAutoDueDate}
                  />
                </div>
                <div className="md:col-span-2 flex items-end">
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={draftAutoDueDate}
                      onChange={(e) => setDraftAutoDueDate(e.target.checked)}
                    />
                    Auto-calculate from customer payment terms
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Exchange Rate (USD→LBP)</label>
                  <Input value={draftExchangeRate} onChange={(e) => setDraftExchangeRate(e.target.value)} />
                </div>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">Lines</CardTitle>
                      <CardDescription>Add items, then Post when ready.</CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setAddSku("");
                        setAddItemId("");
                        setAddQty("1");
                        setAddUsd("");
                        setAddLbp("");
                        setAddOpen(true);
                      }}
                    >
                      Add Line
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="ui-table-wrap">
                    <table className="ui-table">
                      <thead className="ui-thead">
                        <tr>
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2 text-right">Unit USD</th>
                          <th className="px-3 py-2 text-right">Unit LBP</th>
                          <th className="px-3 py-2 text-right">Total USD</th>
                          <th className="px-3 py-2 text-right">Total LBP</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draftLines.map((l, idx) => {
                          const it = itemById.get(l.item_id);
                          const qty = toNum(l.qty);
                          const unitUsd = toNum(l.unit_price_usd);
                          const unitLbp = toNum(l.unit_price_lbp);
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
                                {qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}
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
                                  <Button type="button" size="sm" variant="outline" onClick={() => openLineEditor(idx)}>
                                    Edit
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setDraftLines((prev) => prev.filter((_, i) => i !== idx))}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {draftLines.length === 0 ? (
                          <tr>
                            <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                              No lines yet.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Add Line</DialogTitle>
                    <DialogDescription>Enter SKU or scan barcode, then set qty and price.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={addLineToDraft} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">SKU or Barcode</label>
                      <Input value={addSku} onChange={(e) => onSkuChange(e.target.value)} placeholder="SKU-001 or 0123456789" />
                      <p className="text-[11px] text-slate-500">
                        Match:{" "}
                        {addItemId ? (
                          <span className="font-mono">{itemById.get(addItemId)?.sku || addItemId}</span>
                        ) : (
                          <span className="text-slate-400">none</span>
                        )}
                      </p>
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">Item</label>
                      <select
                        className="ui-select"
                        value={addItemId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setAddItemId(id);
                          const it = itemById.get(id);
                          if (it) setAddSku(it.sku);
                        }}
                      >
                        <option value="">Select item...</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.sku} · {it.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Qty</label>
                      <Input value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Unit USD</label>
                      <Input value={addUsd} onChange={(e) => setAddUsd(e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Unit LBP</label>
                      <Input value={addLbp} onChange={(e) => setAddLbp(e.target.value)} placeholder="0" />
                    </div>
                    <div className="md:col-span-6 flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                        Close
                      </Button>
                      <Button type="submit">Add Line</Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>

              <Dialog open={lineEditOpen} onOpenChange={setLineEditOpen}>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Edit Line</DialogTitle>
                    <DialogDescription>Update qty and unit prices.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={saveLineEdit} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                    <div className="space-y-1 md:col-span-6">
                      <label className="text-xs font-medium text-slate-700">Item</label>
                      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                        {(() => {
                          const it = itemById.get(draftLines[lineEditIdx]?.item_id || "");
                          return it ? `${it.sku} · ${it.name}` : (draftLines[lineEditIdx]?.item_id || "-");
                        })()}
                      </div>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Qty</label>
                      <Input value={lineEditQty} onChange={(e) => setLineEditQty(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Unit USD</label>
                      <Input value={lineEditUsd} onChange={(e) => setLineEditUsd(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Unit LBP</label>
                      <Input value={lineEditLbp} onChange={(e) => setLineEditLbp(e.target.value)} />
                    </div>
                    <div className="md:col-span-6 flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setLineEditOpen(false)}>
                        Close
                      </Button>
                      <Button type="submit">Save</Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>

              <div className="flex justify-end">
                <Button type="submit" disabled={draftSaving}>
                  {draftSaving ? "..." : draftEditId ? "Save Draft" : "Create Draft"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={postOpen} onOpenChange={setPostOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Post Draft Invoice</DialogTitle>
              <DialogDescription>Posting writes stock moves + GL. You can optionally record a payment now.</DialogDescription>
            </DialogHeader>
            <form onSubmit={postDraftInvoice} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <label className="md:col-span-6 flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={postApplyingVat}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setPostApplyingVat(next);
                    refreshPostPreview(next);
                  }}
                />
                Apply VAT from company tax codes
              </label>
              <label className="md:col-span-6 flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={postRecordPayment}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setPostRecordPayment(next);
                    if (!next) {
                      setPostUsd("0");
                      setPostLbp("0");
                      setPostMethod("cash");
                    }
                  }}
                />
                Record a payment now (otherwise invoice remains unpaid/credit)
              </label>
              {postPreview ? (
                <div className="md:col-span-6 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <span>VAT</span>
                    <span className="font-mono">
                      {postPreview.tax_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD /{" "}
                      {postPreview.tax_lbp.toLocaleString("en-US", { maximumFractionDigits: 0 })} LBP
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span>Total</span>
                    <span className="font-mono">
                      {postPreview.total_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD /{" "}
                      {postPreview.total_lbp.toLocaleString("en-US", { maximumFractionDigits: 0 })} LBP
                    </span>
                  </div>
                </div>
              ) : (
                <div className="md:col-span-6 text-xs text-slate-600">
                  Tip: If you post without paying the full amount, the remaining balance becomes credit and requires a customer.
                </div>
              )}
              {postRecordPayment ? (
                <>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-slate-700">Payment Method</label>
                    <select className="ui-select" value={postMethod} onChange={(e) => setPostMethod(e.target.value)}>
                      {methodChoices.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-slate-700">Amount USD</label>
                    <Input value={postUsd} onChange={(e) => setPostUsd(e.target.value)} />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-slate-700">Amount LBP</label>
                    <Input value={postLbp} onChange={(e) => setPostLbp(e.target.value)} />
                  </div>
                </>
              ) : null}
              <div className="md:col-span-6 flex justify-end">
                <Button type="submit" disabled={postSubmitting}>
                  {postSubmitting ? "..." : "Post Invoice"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {detail ? (
          <Card>
            <CardHeader>
              <CardTitle>Invoice Detail</CardTitle>
              <CardDescription>
                <span className="font-mono text-xs">{detail.invoice.invoice_no}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.invoice.status === "draft" ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="outline" onClick={openEditDraft}>
                    Edit Draft
                  </Button>
                  <Button variant="outline" onClick={openPostDialog}>
                    Post Draft
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setCancelDraftReason("");
                      setCancelDraftOpen(true);
                    }}
                  >
                    Cancel Draft
                  </Button>
                </div>
              ) : null}
              {detail.invoice.status === "posted" ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setCancelDate(todayIso());
                      setCancelReason("");
                      setCancelOpen(true);
                    }}
                  >
                    Void Invoice
                  </Button>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Customer</p>
                  <p className="text-sm font-medium text-slate-900">
                    {detail.invoice.customer_id ? customerById.get(detail.invoice.customer_id)?.name || detail.invoice.customer_id : "Walk-in"}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Warehouse</p>
                  <p className="text-sm font-medium text-slate-900">
                    {detail.invoice.warehouse_id ? warehouseById.get(detail.invoice.warehouse_id)?.name || detail.invoice.warehouse_id : "-"}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Dates</p>
                  <p className="text-sm font-mono text-slate-900">
                    Inv {String((detail.invoice as any).invoice_date || "").slice(0, 10) || "-"}
                  </p>
                  <p className="text-sm font-mono text-slate-900">
                    Due {String((detail.invoice as any).due_date || "").slice(0, 10) || "-"}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Totals</p>
                  <p className="text-sm font-mono text-slate-900">
                    {Number(detail.invoice.total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD
                  </p>
                  <p className="text-sm font-mono text-slate-900">
                    {Number(detail.invoice.total_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} LBP
                  </p>
                  {(() => {
                    const paidUsd = (detail.payments || []).reduce((a, p) => a + Number(p.amount_usd || 0), 0);
                    const paidLbp = (detail.payments || []).reduce((a, p) => a + Number(p.amount_lbp || 0), 0);
                    const balUsd = Number(detail.invoice.total_usd || 0) - paidUsd;
                    const balLbp = Number(detail.invoice.total_lbp || 0) - paidLbp;
                    return (
                      <p className="mt-2 text-xs text-slate-600">
                        Balance:{" "}
                        <span className="font-mono text-slate-900">
                          {balUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD /{" "}
                          {balLbp.toLocaleString("en-US", { maximumFractionDigits: 2 })} LBP
                        </span>
                      </p>
                    );
                  })()}
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Status</p>
                  <p className="text-sm font-medium text-slate-900">{detail.invoice.status}</p>
                </div>
              </div>

              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Total USD</th>
                      <th className="px-3 py-2 text-right">Total LBP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => {
                      const it = itemById.get(l.item_id);
                      return (
                        <tr key={l.id} className="ui-tr-hover">
                          <td className="px-3 py-2">
                            {it ? (
                              <span>
                                <span className="font-mono text-xs">{it.sku}</span> · {it.name}
                              </span>
                            ) : (
                              <span className="font-mono text-xs">{l.item_id}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.line_total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.line_total_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                    {detail.lines.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                          No lines.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">Payments</p>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/sales/payments?invoice_id=${encodeURIComponent(detail.invoice.id)}&record=1`}>Record Payment</Link>
                    </Button>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-700">
                    {detail.payments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{p.method}</span>
                        <span className="font-mono">
                          {Number(p.amount_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD /{" "}
                          {Number(p.amount_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} LBP
                        </span>
                      </div>
                    ))}
                    {detail.payments.length === 0 ? <p className="text-slate-500">No payments.</p> : null}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-sm font-medium text-slate-900">Tax Lines</p>
                  <div className="mt-2 space-y-1 text-xs text-slate-700">
                    {detail.tax_lines.map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{t.tax_code_id}</span>
                        <span className="font-mono">
                          {Number(t.tax_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD /{" "}
                          {Number(t.tax_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} LBP
                        </span>
                      </div>
                    ))}
                    {detail.tax_lines.length === 0 ? <p className="text-slate-500">No tax lines.</p> : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Void Sales Invoice</DialogTitle>
              <DialogDescription>
                This will reverse stock moves, VAT tax lines, and GL entries. It is blocked if payments or posted returns exist.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={cancelPostedInvoice} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-slate-700">Void Date</label>
                <Input type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-6">
                <label className="text-xs font-medium text-slate-700">Reason (optional)</label>
                <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="customer error / duplicate / correction" />
              </div>
              <div className="md:col-span-6 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
                  Close
                </Button>
                <Button type="submit" variant="destructive" disabled={canceling}>
                  {canceling ? "..." : "Void Invoice"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={cancelDraftOpen} onOpenChange={setCancelDraftOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Cancel Draft Invoice</DialogTitle>
              <DialogDescription>This will mark the draft as canceled. No stock or GL will be posted.</DialogDescription>
            </DialogHeader>
            <form onSubmit={cancelDraftInvoice} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Reason (optional)</label>
                <Input value={cancelDraftReason} onChange={(e) => setCancelDraftReason(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCancelDraftOpen(false)}>
                  Close
                </Button>
                <Button type="submit" variant="destructive" disabled={cancelDrafting}>
                  {cancelDrafting ? "..." : "Cancel Draft"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>{filteredInvoices.length} invoices</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-96">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice / customer / warehouse..." />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <select className="ui-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="canceled">Canceled</option>
                </select>
                <Button variant="outline" onClick={load}>
                  Refresh
                </Button>
              </div>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Warehouse</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Dates</th>
                    <th className="px-3 py-2 text-right">Total USD</th>
                    <th className="px-3 py-2 text-right">Total LBP</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className={(inv.id === invoiceId ? "bg-slate-50 " : "") + "border-t border-slate-100 hover:bg-slate-50 cursor-pointer"}
                      onClick={() => setInvoiceId(inv.id)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{inv.invoice_no || "(draft)"}</td>
                      <td className="px-3 py-2">
                        {inv.customer_id ? customerById.get(inv.customer_id)?.name || inv.customer_id : "Walk-in"}
                      </td>
                      <td className="px-3 py-2">{inv.warehouse_id ? warehouseById.get(inv.warehouse_id)?.name || inv.warehouse_id : "-"}</td>
                      <td className="px-3 py-2">{inv.status}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        <div>
                          Inv: <span className="font-mono">{String(inv.invoice_date || "").slice(0, 10) || "-"}</span>
                        </div>
                        <div className="text-slate-500">
                          Due: <span className="font-mono">{String(inv.due_date || "").slice(0, 10) || "-"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(inv.total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(inv.total_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                        No invoices.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>);
}

export default function SalesInvoicesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-slate-700">Loading...</div>}>
      <SalesInvoicesPageInner />
    </Suspense>
  );
}
