"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Supplier = { id: string; name: string };
type Item = { id: string; sku: string; name: string };

type TaxCode = {
  id: string;
  name: string;
  rate: string | number; // stored as fraction (e.g. 0.11)
  tax_type: string;
  reporting_currency: string;
};

type PaymentMethodMapping = { method: string; role_code: string; created_at: string };

type InvoiceRow = {
  id: string;
  invoice_no: string;
  supplier_id: string | null;
  goods_receipt_id?: string | null;
  goods_receipt_no?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  tax_code_id?: string | null;
  invoice_date: string;
  due_date: string;
  created_at: string;
};

type InvoiceLine = {
  id: string;
  goods_receipt_line_id?: string | null;
  item_id: string;
  qty: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
  batch_id: string | null;
  batch_no: string | null;
  expiry_date: string | null;
};

type SupplierPayment = {
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
  invoice: InvoiceRow & { exchange_rate: string | number };
  lines: InvoiceLine[];
  payments: SupplierPayment[];
  tax_lines: TaxLine[];
};

type LineDraft = {
  goods_receipt_line_id?: string | null;
  item_id: string;
  qty: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
  batch_no: string;
  expiry_date: string;
};

type PaymentDraft = {
  method: string;
  amount_usd: string;
  amount_lbp: string;
};

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function ratePct(rate: string | number) {
  const r = Number(rate || 0);
  return Number.isFinite(r) ? (r * 100).toFixed(2) : "0.00";
}

function SupplierInvoicesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qsInvoiceId = searchParams.get("id") || "";

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);

  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [invoiceId, setInvoiceId] = useState("");
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);

  const [draftOpen, setDraftOpen] = useState(false);
  const [draftEditId, setDraftEditId] = useState<string>("");
  const [draftSaving, setDraftSaving] = useState(false);

  const [draftSupplierId, setDraftSupplierId] = useState("");
  const [draftInvoiceNo, setDraftInvoiceNo] = useState("");
  const [draftInvoiceDate, setDraftInvoiceDate] = useState(() => todayIso());
  const [draftDueDate, setDraftDueDate] = useState("");
  const [draftExchangeRate, setDraftExchangeRate] = useState("90000");
  const [draftTaxCodeId, setDraftTaxCodeId] = useState("");
  const [draftGoodsReceiptId, setDraftGoodsReceiptId] = useState<string>("");
  const [draftLines, setDraftLines] = useState<LineDraft[]>([]);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchIdx, setBatchIdx] = useState<number>(-1);

  const [postOpen, setPostOpen] = useState(false);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postPostingDate, setPostPostingDate] = useState(() => todayIso());
  const [postPayments, setPostPayments] = useState<PaymentDraft[]>([{ method: "bank", amount_usd: "0", amount_lbp: "0" }]);
  const [postPreview, setPostPreview] = useState<{ base_usd: number; base_lbp: number; tax_usd: number; tax_lbp: number; total_usd: number; total_lbp: number } | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState(() => todayIso());
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);

  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelDraftReason, setCancelDraftReason] = useState("");
  const [cancelDrafting, setCancelDrafting] = useState(false);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const taxById = useMemo(() => new Map(taxCodes.map((t) => [t.id, t])), [taxCodes]);

  const filteredInvoices = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (invoices || []).filter((inv) => {
      if (statusFilter && inv.status !== statusFilter) return false;
      if (!needle) return true;
      const no = (inv.invoice_no || "").toLowerCase();
      const sup = inv.supplier_id ? (supplierById.get(inv.supplier_id)?.name || "").toLowerCase() : "";
      const gr = (inv.goods_receipt_no || "").toLowerCase();
      return no.includes(needle) || sup.includes(needle) || gr.includes(needle) || inv.id.toLowerCase().includes(needle);
    });
  }, [invoices, q, statusFilter, supplierById]);

  const methodChoices = useMemo(() => {
    const base = ["cash", "bank", "card", "transfer", "other"];
    const fromConfig = paymentMethods.map((m) => m.method);
    const merged = Array.from(new Set([...base, ...fromConfig])).filter(Boolean);
    merged.sort();
    return merged;
  }, [paymentMethods]);

  async function load() {
    setStatus("Loading...");
    try {
      const [inv, s, i, tc, pm] = await Promise.all([
        apiGet<{ invoices: InvoiceRow[] }>("/purchases/invoices"),
        apiGet<{ suppliers: Supplier[] }>("/suppliers"),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes"),
        apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods")
      ]);
      setInvoices(inv.invoices || []);
      setSuppliers(s.suppliers || []);
      setItems(i.items || []);
      setTaxCodes(tc.tax_codes || []);
      setPaymentMethods(pm.methods || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function loadDetail(id: string) {
    if (!id) {
      setDetail(null);
      return;
    }
    setStatus("Loading invoice...");
    try {
      const res = await apiGet<InvoiceDetail>(`/purchases/invoices/${id}`);
      setDetail(res);
      setStatus("");
    } catch (err) {
      setDetail(null);
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!qsInvoiceId) return;
    if (qsInvoiceId === invoiceId) return;
    setInvoiceId(qsInvoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qsInvoiceId]);

  useEffect(() => {
    loadDetail(invoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  function openNewDraft() {
    setDraftEditId("");
    setDraftSupplierId("");
    setDraftInvoiceNo("");
    setDraftInvoiceDate(todayIso());
    setDraftDueDate("");
    setDraftExchangeRate("90000");
    setDraftTaxCodeId("");
    setDraftGoodsReceiptId("");
    setDraftLines([]);
    setDraftOpen(true);
  }

  function openEditDraft() {
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;
    setDraftEditId(detail.invoice.id);
    setDraftSupplierId(detail.invoice.supplier_id || "");
    setDraftInvoiceNo(detail.invoice.invoice_no || "");
    setDraftInvoiceDate(detail.invoice.invoice_date || todayIso());
    setDraftDueDate(detail.invoice.due_date || "");
    setDraftExchangeRate(String(detail.invoice.exchange_rate || 0));
    setDraftTaxCodeId((detail.invoice.tax_code_id as string) || "");
    setDraftGoodsReceiptId((detail.invoice.goods_receipt_id as string) || "");
    setDraftLines(
      (detail.lines || []).map((l) => ({
        goods_receipt_line_id: (l.goods_receipt_line_id as string) || null,
        item_id: l.item_id,
        qty: String(l.qty || 0),
        unit_cost_usd: String(l.unit_cost_usd || 0),
        unit_cost_lbp: String(l.unit_cost_lbp || 0),
        batch_no: String(l.batch_no || ""),
        expiry_date: String(l.expiry_date || "")
      }))
    );
    setDraftOpen(true);
  }

  function addLine() {
    setDraftLines((prev) => [
      ...prev,
      { goods_receipt_line_id: null, item_id: "", qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0", batch_no: "", expiry_date: "" }
    ]);
  }

  function removeLine(idx: number) {
    setDraftLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setDraftLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function openBatch(idx: number) {
    setBatchIdx(idx);
    setBatchOpen(true);
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!draftSupplierId) return setStatus("supplier is required");
    const ex = toNum(draftExchangeRate);
    if (!ex) return setStatus("exchange_rate is required");

    const validLines = (draftLines || []).filter((l) => l.item_id && toNum(l.qty) > 0);

    setDraftSaving(true);
    setStatus(draftEditId ? "Saving draft..." : "Creating draft...");
    try {
      const payload = {
        supplier_id: draftSupplierId,
        invoice_no: draftInvoiceNo.trim() || undefined,
        exchange_rate: ex,
        invoice_date: draftInvoiceDate || undefined,
        due_date: draftDueDate.trim() || undefined,
        tax_code_id: draftTaxCodeId || undefined,
        goods_receipt_id: draftGoodsReceiptId || undefined,
        lines: validLines.map((l) => ({
          goods_receipt_line_id: l.goods_receipt_line_id || undefined,
          item_id: l.item_id,
          qty: toNum(l.qty),
          unit_cost_usd: toNum(l.unit_cost_usd),
          unit_cost_lbp: toNum(l.unit_cost_lbp),
          batch_no: l.batch_no.trim() || null,
          expiry_date: l.expiry_date.trim() || null
        }))
      };

      if (!draftEditId) {
        const res = await apiPost<{ id: string; invoice_no: string }>("/purchases/invoices/drafts", payload);
        setDraftOpen(false);
        await load();
        setInvoiceId(res.id);
        setStatus("");
        return;
      }

      await apiPatch(`/purchases/invoices/${draftEditId}/draft`, payload);
      setDraftOpen(false);
      await load();
      await loadDetail(draftEditId);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setDraftSaving(false);
    }
  }

  async function openPost() {
    if (!detail) return;
    if (!(detail.lines || []).length) {
      setStatus("Cannot post: add at least one line to this draft first.");
      return;
    }
    setPostPreview(null);
    setPostPostingDate(todayIso());
    setPostPayments([{ method: "bank", amount_usd: "0", amount_lbp: "0" }]);
    setPostOpen(true);
    setStatus("Loading preview...");
    try {
      const preview = await apiGet<{ base_usd: number; base_lbp: number; tax_usd: number; tax_lbp: number; total_usd: number; total_lbp: number }>(
        `/purchases/invoices/${detail.invoice.id}/post-preview`
      );
      setPostPreview(preview);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  function updatePayment(idx: number, patch: Partial<PaymentDraft>) {
    setPostPayments((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function addPayment() {
    setPostPayments((prev) => [...prev, { method: "bank", amount_usd: "0", amount_lbp: "0" }]);
  }

  function removePayment(idx: number) {
    setPostPayments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function postDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setPostSubmitting(true);
    setStatus("Posting...");
    try {
      const ex = Number(detail.invoice.exchange_rate || 0);
      const normalizedPayments = (postPayments || [])
        .map((p) => {
          const method = (p.method || "bank").trim().toLowerCase();
          let amountUsd = toNum(p.amount_usd);
          let amountLbp = toNum(p.amount_lbp);
          if (ex && amountUsd === 0 && amountLbp !== 0) amountUsd = amountLbp / ex;
          if (ex && amountLbp === 0 && amountUsd !== 0) amountLbp = amountUsd * ex;
          return { method, amount_usd: amountUsd, amount_lbp: amountLbp };
        })
        .filter((p) => p.amount_usd !== 0 || p.amount_lbp !== 0);

      await apiPost(`/purchases/invoices/${detail.invoice.id}/post`, {
        posting_date: postPostingDate || undefined,
        payments: normalizedPayments.length ? normalizedPayments : undefined
      });
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
    setStatus("Voiding supplier invoice...");
    try {
      await apiPost(`/purchases/invoices/${detail.invoice.id}/cancel`, {
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
      await apiPost(`/purchases/invoices/${detail.invoice.id}/cancel-draft`, { reason: cancelDraftReason || undefined });
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
              <CardDescription>Errors and action results show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Supplier Invoices</CardTitle>
                <CardDescription>{filteredInvoices.length} invoices</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={load}>
                  Refresh
                </Button>
                <Button onClick={openNewDraft}>New Draft</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-96">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice / supplier / GR..." />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <select className="ui-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="canceled">Canceled</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead className="ui-thead">
                      <tr>
                        <th className="px-3 py-2">Invoice</th>
                        <th className="px-3 py-2">Supplier</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Total USD</th>
                        <th className="px-3 py-2">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.map((inv) => {
                        const selected = inv.id === invoiceId;
                        return (
                          <tr
                            key={inv.id}
                            className={selected ? "bg-slate-50" : "ui-tr-hover"}
                            style={{ cursor: "pointer" }}
                            onClick={() => setInvoiceId(inv.id)}
                          >
                            <td className="px-3 py-2 font-medium">{inv.invoice_no}</td>
                            <td className="px-3 py-2">{supplierById.get(inv.supplier_id || "")?.name || "-"}</td>
                            <td className="px-3 py-2">{inv.status}</td>
                            <td className="px-3 py-2 text-right">{Number(inv.total_usd || 0).toFixed(2)}</td>
                            <td className="px-3 py-2">{inv.due_date || "-"}</td>
                          </tr>
                        );
                      })}
                      {filteredInvoices.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                            No supplier invoices.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="md:col-span-1">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Invoice Detail</CardTitle>
                    <CardDescription>{detail ? `Status: ${detail.invoice.status}` : "Select an invoice"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail ? (
                      <>
                        <div className="space-y-1 text-sm">
                          <div>
                            <span className="text-slate-500">Invoice:</span> {detail.invoice.invoice_no}
                          </div>
                          <div>
                            <span className="text-slate-500">Supplier:</span> {supplierById.get(detail.invoice.supplier_id || "")?.name || "-"}
                          </div>
                          {detail.invoice.goods_receipt_id ? (
                            <div>
                              <span className="text-slate-500">Receipt:</span>{" "}
                              {detail.invoice.goods_receipt_no || detail.invoice.goods_receipt_id}
                            </div>
                          ) : null}
                          <div>
                            <span className="text-slate-500">Dates:</span> {detail.invoice.invoice_date} (due {detail.invoice.due_date})
                          </div>
                          <div>
                            <span className="text-slate-500">VAT:</span>{" "}
                            {detail.invoice.tax_code_id ? `${taxById.get(String(detail.invoice.tax_code_id))?.name || detail.invoice.tax_code_id} (${ratePct(taxById.get(String(detail.invoice.tax_code_id))?.rate || 0)}%)` : "-"}
                          </div>
                          <div>
                            <span className="text-slate-500">Totals:</span> {Number(detail.invoice.total_usd || 0).toFixed(2)} USD / {Number(detail.invoice.total_lbp || 0).toFixed(0)} LBP
                          </div>
                        </div>

                        {detail.invoice.status === "draft" ? (
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={openEditDraft}>
                              Edit Draft
                            </Button>
                            <Button onClick={openPost}>Post</Button>
                            {detail.invoice.goods_receipt_id ? (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                  router.push(`/purchasing/goods-receipts?id=${encodeURIComponent(String(detail.invoice.goods_receipt_id))}`)
                                }
                              >
                                Open Receipt
                              </Button>
                            ) : null}
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
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="destructive"
                              onClick={() => {
                                setCancelDate(todayIso());
                                setCancelReason("");
                                setCancelOpen(true);
                              }}
                            >
                              Void
                            </Button>
                          </div>
                        ) : null}

                        <div className="ui-table-wrap">
                          <table className="ui-table">
                            <thead className="ui-thead">
                              <tr>
                                <th className="px-3 py-2">Item</th>
                                <th className="px-3 py-2 text-right">Qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(detail.lines || []).map((l) => (
                                <tr key={l.id} className="ui-tr-hover">
                                  <td className="px-3 py-2">{itemById.get(l.item_id)?.sku || l.item_id}</td>
                                  <td className="px-3 py-2 text-right">{Number(l.qty || 0).toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {(detail.tax_lines || []).length ? (
                          <div className="text-xs text-slate-700">
                            <div className="font-medium">Tax Lines</div>
                            {(detail.tax_lines || []).map((t) => (
                              <div key={t.id}>
                                {taxById.get(t.tax_code_id)?.name || t.tax_code_id}: {Number(t.tax_lbp || 0).toFixed(0)} LBP
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {(detail.payments || []).length ? (
                          <div className="text-xs text-slate-700">
                            <div className="font-medium">Payments</div>
                            {(detail.payments || []).map((p) => (
                              <div key={p.id}>
                                {p.method}: {Number(p.amount_usd || 0).toFixed(2)} USD / {Number(p.amount_lbp || 0).toFixed(0)} LBP
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="text-sm text-slate-600">Pick an invoice from the list to view it.</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>{draftEditId ? "Edit Supplier Invoice Draft" : "New Supplier Invoice Draft"}</DialogTitle>
              <DialogDescription>Draft first, post when you want accounting to be affected.</DialogDescription>
            </DialogHeader>

            <form onSubmit={saveDraft} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Supplier</label>
                  <select className="ui-select" value={draftSupplierId} onChange={(e) => setDraftSupplierId(e.target.value)}>
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Internal Invoice No (optional)</label>
                  <Input value={draftInvoiceNo} onChange={(e) => setDraftInvoiceNo(e.target.value)} placeholder="Leave blank to auto-assign" />
                </div>
                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-slate-700">Invoice Date</label>
                  <Input type="date" value={draftInvoiceDate} onChange={(e) => setDraftInvoiceDate(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-slate-700">Due Date</label>
                  <Input type="date" value={draftDueDate} onChange={(e) => setDraftDueDate(e.target.value)} />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Tax Code</label>
                  <select className="ui-select" value={draftTaxCodeId} onChange={(e) => setDraftTaxCodeId(e.target.value)}>
                    <option value="">No tax</option>
                    {taxCodes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({ratePct(t.rate)}%)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Exchange Rate (USD→LBP)</label>
                  <Input value={draftExchangeRate} onChange={(e) => setDraftExchangeRate(e.target.value)} />
                </div>
              </div>

              {draftGoodsReceiptId ? (
                <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
                  Linked to goods receipt: <span className="font-mono">{draftGoodsReceiptId}</span>
                </div>
              ) : null}

              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit USD</th>
                      <th className="px-3 py-2 text-right">Unit LBP</th>
                      <th className="px-3 py-2">Batch</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftLines.map((l, idx) => (
                      <tr key={idx} className="ui-tr-hover">
                        <td className="px-3 py-2">
                          <select
                            className="ui-select ui-control-sm"
                            value={l.item_id}
                            onChange={(e) => updateLine(idx, { item_id: e.target.value, goods_receipt_line_id: null })}
                          >
                            <option value="">Select item...</option>
                            {items.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.sku} · {it.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input value={l.qty} onChange={(e) => updateLine(idx, { qty: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input value={l.unit_cost_usd} onChange={(e) => updateLine(idx, { unit_cost_usd: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input value={l.unit_cost_lbp} onChange={(e) => updateLine(idx, { unit_cost_lbp: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => openBatch(idx)}>
                            {l.batch_no || l.expiry_date ? "Edit" : "Add"}
                          </Button>
                          {(l.batch_no || l.expiry_date) && (
                            <div className="mt-1 text-xs text-slate-600">{l.batch_no ? `#${l.batch_no}` : ""}{l.expiry_date ? ` · exp ${l.expiry_date}` : ""}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button type="button" variant="outline" size="sm" onClick={() => removeLine(idx)}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {!draftLines.length ? (
                      <tr>
                        <td className="px-3 py-3 text-sm text-slate-600" colSpan={6}>
                          No lines yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" onClick={addLine}>
                  Add Line
                </Button>
                <Button type="submit" disabled={draftSaving}>
                  {draftSaving ? "..." : draftEditId ? "Save Draft" : "Create Draft"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Batch / Expiry</DialogTitle>
              <DialogDescription>Optional, but recommended for expiry-managed items.</DialogDescription>
            </DialogHeader>
            {batchIdx >= 0 && batchIdx < draftLines.length ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Batch No</label>
                  <Input
                    value={draftLines[batchIdx].batch_no}
                    onChange={(e) => updateLine(batchIdx, { batch_no: e.target.value })}
                    placeholder="e.g. LOT123"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Expiry Date</label>
                  <Input
                    value={draftLines[batchIdx].expiry_date}
                    onChange={(e) => updateLine(batchIdx, { expiry_date: e.target.value })}
                    placeholder="YYYY-MM-DD"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setBatchOpen(false)}>
                    Done
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog open={postOpen} onOpenChange={setPostOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Post Supplier Invoice</DialogTitle>
              <DialogDescription>Posts GL + tax lines. Optional immediate payments.</DialogDescription>
            </DialogHeader>

            <form onSubmit={postDraft} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Posting Date</label>
                <Input value={postPostingDate} onChange={(e) => setPostPostingDate(e.target.value)} placeholder="YYYY-MM-DD" />
              </div>

              {postPreview ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Preview</CardTitle>
                    <CardDescription>Based on current draft lines and tax code.</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div>Base: {postPreview.base_usd.toFixed(2)} USD / {postPreview.base_lbp.toFixed(0)} LBP</div>
                    <div>Tax: {postPreview.tax_usd.toFixed(2)} USD / {postPreview.tax_lbp.toFixed(0)} LBP</div>
                    <div className="font-medium">Total: {postPreview.total_usd.toFixed(2)} USD / {postPreview.total_lbp.toFixed(0)} LBP</div>
                  </CardContent>
                </Card>
              ) : (
                <div className="text-sm text-slate-600">Loading preview...</div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Immediate Payments (Optional)</div>
                  <Button type="button" variant="outline" size="sm" onClick={addPayment}>
                    Add
                  </Button>
                </div>

                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead className="ui-thead">
                      <tr>
                        <th className="px-3 py-2">Method</th>
                        <th className="px-3 py-2 text-right">USD</th>
                        <th className="px-3 py-2 text-right">LBP</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {postPayments.map((p, idx) => (
                        <tr key={idx} className="ui-tr-hover">
                          <td className="px-3 py-2">
                            <select className="ui-select ui-control-sm" value={p.method} onChange={(e) => updatePayment(idx, { method: e.target.value })}>
                              {methodChoices.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input value={p.amount_usd} onChange={(e) => updatePayment(idx, { amount_usd: e.target.value })} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input value={p.amount_lbp} onChange={(e) => updatePayment(idx, { amount_lbp: e.target.value })} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button type="button" variant="outline" size="sm" onClick={() => removePayment(idx)}>
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPostOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={postSubmitting}>
                  {postSubmitting ? "..." : "Post"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Void Supplier Invoice</DialogTitle>
              <DialogDescription>
                This reverses VAT tax lines and GL. It is blocked if payments exist.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={cancelPostedInvoice} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-slate-700">Void Date</label>
                <Input type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-6">
                <label className="text-xs font-medium text-slate-700">Reason (optional)</label>
                <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="duplicate / correction" />
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
              <DialogTitle>Cancel Draft Supplier Invoice</DialogTitle>
              <DialogDescription>This will mark the draft as canceled. No tax or GL will be posted.</DialogDescription>
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
      </div>);
}

export default function SupplierInvoicesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-slate-700">Loading...</div>}>
      <SupplierInvoicesPageInner />
    </Suspense>
  );
}
