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
type Warehouse = { id: string; name: string };
type TaxCode = { id: string; name: string; rate: string | number };

type ReceiptRow = {
  id: string;
  receipt_no: string | null;
  supplier_id: string | null;
  warehouse_id: string | null;
  purchase_order_id?: string | null;
  purchase_order_no?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
};

type ReceiptLine = {
  id: string;
  purchase_order_line_id?: string | null;
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

type ReceiptDetail = {
  receipt: ReceiptRow & { exchange_rate: string | number };
  lines: ReceiptLine[];
};

type LineDraft = {
  purchase_order_line_id?: string | null;
  item_id: string;
  qty: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
  batch_no: string;
  expiry_date: string;
};

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function GoodsReceiptsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qsReceiptId = searchParams.get("id") || "";

  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);

  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [receiptId, setReceiptId] = useState("");
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);

  const [draftOpen, setDraftOpen] = useState(false);
  const [draftEditId, setDraftEditId] = useState<string>("");
  const [draftSaving, setDraftSaving] = useState(false);

  const [draftSupplierId, setDraftSupplierId] = useState("");
  const [draftWarehouseId, setDraftWarehouseId] = useState("");
  const [draftExchangeRate, setDraftExchangeRate] = useState("90000");
  const [draftPurchaseOrderId, setDraftPurchaseOrderId] = useState<string>("");
  const [draftLines, setDraftLines] = useState<LineDraft[]>([]);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchIdx, setBatchIdx] = useState<number>(-1);

  const [postOpen, setPostOpen] = useState(false);
  const [postingDate, setPostingDate] = useState(() => todayIso());
  const [posting, setPosting] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState(() => todayIso());
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);

  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelDraftReason, setCancelDraftReason] = useState("");
  const [cancelDrafting, setCancelDrafting] = useState(false);

  const [createInvOpen, setCreateInvOpen] = useState(false);
  const [createInvSubmitting, setCreateInvSubmitting] = useState(false);
  const [createInvInvoiceNo, setCreateInvInvoiceNo] = useState("");
  const [createInvInvoiceDate, setCreateInvInvoiceDate] = useState(() => todayIso());
  const [createInvTaxCodeId, setCreateInvTaxCodeId] = useState("");

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const filteredReceipts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (receipts || []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!needle) return true;
      const no = (r.receipt_no || "").toLowerCase();
      const sup = r.supplier_id ? (supplierById.get(r.supplier_id)?.name || "").toLowerCase() : "";
      const wh = r.warehouse_id ? (whById.get(r.warehouse_id)?.name || "").toLowerCase() : "";
      const po = (r.purchase_order_no || "").toLowerCase();
      return no.includes(needle) || sup.includes(needle) || wh.includes(needle) || po.includes(needle) || r.id.toLowerCase().includes(needle);
    });
  }, [receipts, q, statusFilter, supplierById, whById]);

  async function load() {
    setStatus("Loading...");
    try {
      const [r, s, i, w, tc] = await Promise.all([
        apiGet<{ receipts: ReceiptRow[] }>("/purchases/receipts"),
        apiGet<{ suppliers: Supplier[] }>("/suppliers"),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes")
      ]);
      setReceipts(r.receipts || []);
      setSuppliers(s.suppliers || []);
      setItems(i.items || []);
      setWarehouses(w.warehouses || []);
      setTaxCodes(tc.tax_codes || []);
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
    setStatus("Loading receipt...");
    try {
      const res = await apiGet<ReceiptDetail>(`/purchases/receipts/${id}`);
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
    if (!qsReceiptId) return;
    if (qsReceiptId === receiptId) return;
    setReceiptId(qsReceiptId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qsReceiptId]);

  useEffect(() => {
    loadDetail(receiptId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  function openNewDraft() {
    setDraftEditId("");
    setDraftSupplierId("");
    setDraftWarehouseId(warehouses[0]?.id || "");
    setDraftExchangeRate("90000");
    setDraftPurchaseOrderId("");
    setDraftLines([]);
    setDraftOpen(true);
  }

  function openEditDraft() {
    if (!detail) return;
    if (detail.receipt.status !== "draft") return;
    setDraftEditId(detail.receipt.id);
    setDraftSupplierId(detail.receipt.supplier_id || "");
    setDraftWarehouseId(detail.receipt.warehouse_id || "");
    setDraftExchangeRate(String(detail.receipt.exchange_rate || 0));
    setDraftPurchaseOrderId((detail.receipt.purchase_order_id as string) || "");
    setDraftLines(
      (detail.lines || []).map((l) => ({
        purchase_order_line_id: (l.purchase_order_line_id as string) || null,
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
      { purchase_order_line_id: null, item_id: "", qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0", batch_no: "", expiry_date: "" }
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
    if (!draftWarehouseId) return setStatus("warehouse is required");
    const ex = toNum(draftExchangeRate);
    if (!ex) return setStatus("exchange_rate is required");

    const validLines = (draftLines || []).filter((l) => l.item_id && toNum(l.qty) > 0);

    setDraftSaving(true);
    setStatus(draftEditId ? "Saving draft..." : "Creating draft...");
    try {
      const payload = {
        supplier_id: draftSupplierId,
        warehouse_id: draftWarehouseId,
        exchange_rate: ex,
        purchase_order_id: draftPurchaseOrderId || undefined,
        lines: validLines.map((l) => ({
          purchase_order_line_id: l.purchase_order_line_id || undefined,
          item_id: l.item_id,
          qty: toNum(l.qty),
          unit_cost_usd: toNum(l.unit_cost_usd),
          unit_cost_lbp: toNum(l.unit_cost_lbp),
          batch_no: l.batch_no.trim() || null,
          expiry_date: l.expiry_date.trim() || null
        }))
      };

      if (!draftEditId) {
        const res = await apiPost<{ id: string }>("/purchases/receipts/drafts", payload);
        setDraftOpen(false);
        await load();
        setReceiptId(res.id);
        setStatus("");
        return;
      }

      await apiPatch(`/purchases/receipts/${draftEditId}/draft`, payload);
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

  function openPost() {
    if (!detail) return;
    if (!(detail.lines || []).length) {
      setStatus("Cannot post: add at least one line to this draft first.");
      return;
    }
    setPostingDate(todayIso());
    setPostOpen(true);
  }

  function openCreateInvoice() {
    if (!detail) return;
    if (detail.receipt.status !== "posted") return;
    setCreateInvInvoiceNo("");
    setCreateInvInvoiceDate(todayIso());
    setCreateInvTaxCodeId("");
    setCreateInvOpen(true);
  }

  async function createInvoiceFromReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setCreateInvSubmitting(true);
    setStatus("Creating supplier invoice draft...");
    try {
      const res = await apiPost<{ id: string; invoice_no: string }>(
        `/purchases/invoices/drafts/from-receipt/${detail.receipt.id}`,
        {
          invoice_no: createInvInvoiceNo.trim() || undefined,
          invoice_date: createInvInvoiceDate || undefined,
          tax_code_id: createInvTaxCodeId || undefined
        }
      );
      setCreateInvOpen(false);
      setStatus("");
      router.push(`/purchasing/supplier-invoices?id=${encodeURIComponent(res.id)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreateInvSubmitting(false);
    }
  }

  async function postReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (!(detail.lines || []).length) {
      setStatus("Cannot post: add at least one line to this draft first.");
      return;
    }
    setPosting(true);
    setStatus("Posting receipt...");
    try {
      await apiPost(`/purchases/receipts/${detail.receipt.id}/post`, { posting_date: postingDate || undefined });
      setPostOpen(false);
      await load();
      await loadDetail(detail.receipt.id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setPosting(false);
    }
  }

  async function cancelReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.receipt.status !== "posted") return;
    setCanceling(true);
    setStatus("Voiding receipt...");
    try {
      await apiPost(`/purchases/receipts/${detail.receipt.id}/cancel`, {
        cancel_date: cancelDate || undefined,
        reason: cancelReason || undefined
      });
      setCancelOpen(false);
      await load();
      await loadDetail(detail.receipt.id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCanceling(false);
    }
  }

  async function cancelDraftReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.receipt.status !== "draft") return;
    setCancelDrafting(true);
    setStatus("Canceling draft...");
    try {
      await apiPost(`/purchases/receipts/${detail.receipt.id}/cancel-draft`, { reason: cancelDraftReason || undefined });
      setCancelDraftOpen(false);
      await load();
      await loadDetail(detail.receipt.id);
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
                <CardTitle>Goods Receipts</CardTitle>
                <CardDescription>{filteredReceipts.length} receipts</CardDescription>
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
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt / supplier / warehouse / PO..." />
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
                        <th className="px-3 py-2">Receipt</th>
                        <th className="px-3 py-2">Supplier</th>
                        <th className="px-3 py-2">Warehouse</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Total USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReceipts.map((r) => {
                        const selected = r.id === receiptId;
                        return (
                          <tr
                            key={r.id}
                            className={selected ? "bg-slate-50" : "ui-tr-hover"}
                            style={{ cursor: "pointer" }}
                            onClick={() => setReceiptId(r.id)}
                          >
                            <td className="px-3 py-2 font-medium">{r.receipt_no || "(draft)"}</td>
                            <td className="px-3 py-2">{supplierById.get(r.supplier_id || "")?.name || "-"}</td>
                            <td className="px-3 py-2">{whById.get(r.warehouse_id || "")?.name || "-"}</td>
                            <td className="px-3 py-2">{r.status}</td>
                            <td className="px-3 py-2 text-right">{Number(r.total_usd || 0).toFixed(2)}</td>
                          </tr>
                        );
                      })}
                      {filteredReceipts.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                            No receipts.
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
                    <CardTitle className="text-base">Receipt Detail</CardTitle>
                    <CardDescription>{detail ? `Status: ${detail.receipt.status}` : "Select a receipt"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail ? (
                      <>
                        <div className="space-y-1 text-sm">
                          <div>
                            <span className="text-slate-500">Receipt:</span> {detail.receipt.receipt_no || "(draft)"}
                          </div>
                          <div>
                            <span className="text-slate-500">Supplier:</span> {supplierById.get(detail.receipt.supplier_id || "")?.name || "-"}
                          </div>
                          <div>
                            <span className="text-slate-500">Warehouse:</span> {whById.get(detail.receipt.warehouse_id || "")?.name || "-"}
                          </div>
                          {detail.receipt.purchase_order_id ? (
                            <div>
                              <span className="text-slate-500">PO:</span>{" "}
                              {detail.receipt.purchase_order_no || detail.receipt.purchase_order_id}
                            </div>
                          ) : null}
                          <div>
                            <span className="text-slate-500">Totals:</span> {Number(detail.receipt.total_usd || 0).toFixed(2)} USD / {Number(detail.receipt.total_lbp || 0).toFixed(0)} LBP
                          </div>
                        </div>

                        {detail.receipt.status === "draft" ? (
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={openEditDraft}>
                              Edit Draft
                            </Button>
                            <Button onClick={openPost}>Post</Button>
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
                        {detail.receipt.status === "posted" ? (
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={openCreateInvoice}>
                              Create Supplier Invoice Draft
                            </Button>
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
                      </>
                    ) : (
                      <div className="text-sm text-slate-600">Pick a receipt from the list to view it.</div>
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
              <DialogTitle>{draftEditId ? "Edit Goods Receipt Draft" : "New Goods Receipt Draft"}</DialogTitle>
              <DialogDescription>Draft first, post when you are ready to affect inventory and accounting.</DialogDescription>
            </DialogHeader>

            <form onSubmit={saveDraft} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
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
                  <label className="text-xs font-medium text-slate-700">Exchange Rate (USD→LBP)</label>
                  <Input value={draftExchangeRate} onChange={(e) => setDraftExchangeRate(e.target.value)} />
                </div>
              </div>

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
                            onChange={(e) => updateLine(idx, { item_id: e.target.value, purchase_order_line_id: null })}
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
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Post Goods Receipt</DialogTitle>
              <DialogDescription>This will create stock moves and an Inventory/GRNI journal.</DialogDescription>
            </DialogHeader>
            <form onSubmit={postReceipt} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Posting Date</label>
                <Input value={postingDate} onChange={(e) => setPostingDate(e.target.value)} placeholder="YYYY-MM-DD" />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPostOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={posting}>
                  {posting ? "..." : "Post"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={createInvOpen} onOpenChange={setCreateInvOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Supplier Invoice Draft</DialogTitle>
              <DialogDescription>Prefills remaining quantities from this posted Goods Receipt.</DialogDescription>
            </DialogHeader>
            <form onSubmit={createInvoiceFromReceipt} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-slate-700">Invoice Date</label>
                <Input type="date" value={createInvInvoiceDate} onChange={(e) => setCreateInvInvoiceDate(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-slate-700">Tax Code (optional)</label>
                <select className="ui-select" value={createInvTaxCodeId} onChange={(e) => setCreateInvTaxCodeId(e.target.value)}>
                  <option value="">(none)</option>
                  {taxCodes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({(Number(t.rate || 0) * 100).toFixed(2)}%)
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 md:col-span-6">
                <label className="text-xs font-medium text-slate-700">Internal Invoice No (optional)</label>
                <Input value={createInvInvoiceNo} onChange={(e) => setCreateInvInvoiceNo(e.target.value)} placeholder="Leave blank to auto-assign" />
              </div>
              <div className="md:col-span-6 flex justify-end">
                <Button type="submit" disabled={createInvSubmitting}>
                  {createInvSubmitting ? "..." : "Create Draft"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Void Goods Receipt</DialogTitle>
              <DialogDescription>
                This reverses stock moves and GL. It is blocked if a supplier invoice exists for this receipt.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={cancelReceipt} className="grid grid-cols-1 gap-3 md:grid-cols-6">
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
                  {canceling ? "..." : "Void Receipt"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={cancelDraftOpen} onOpenChange={setCancelDraftOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Cancel Draft Receipt</DialogTitle>
              <DialogDescription>This will mark the draft as canceled. No stock or GL will be posted.</DialogDescription>
            </DialogHeader>
            <form onSubmit={cancelDraftReceipt} className="space-y-3">
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

export default function GoodsReceiptsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-slate-700">Loading...</div>}>
      <GoodsReceiptsPageInner />
    </Suspense>
  );
}
