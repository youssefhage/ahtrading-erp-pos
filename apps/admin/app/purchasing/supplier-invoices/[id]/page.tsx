"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { parseNumberInput } from "@/lib/numbers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PaymentMethodMapping = { method: string; role_code: string; created_at: string };

type InvoiceRow = {
  id: string;
  invoice_no: string;
  supplier_ref?: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  goods_receipt_id?: string | null;
  goods_receipt_no?: string | null;
  is_on_hold?: boolean;
  hold_reason?: string | null;
  hold_details?: unknown;
  held_at?: string | null;
  released_at?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate: string | number;
  tax_code_id?: string | null;
  invoice_date: string;
  due_date: string;
  created_at: string;
};

type InvoiceLine = {
  id: string;
  goods_receipt_line_id?: string | null;
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  qty: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
  batch_id: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  batch_status?: string | null;
};

type SupplierPayment = {
  id: string;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  reference?: string | null;
  auth_code?: string | null;
  provider?: string | null;
  settlement_currency?: string | null;
  captured_at?: string | null;
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
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  payments: SupplierPayment[];
  tax_lines: TaxLine[];
};

type PaymentDraft = { method: string; amount_usd: string; amount_lbp: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

function SupplierInvoiceShowInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);

  const [postOpen, setPostOpen] = useState(false);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postPostingDate, setPostPostingDate] = useState(() => todayIso());
  const [postPayments, setPostPayments] = useState<PaymentDraft[]>([{ method: "bank", amount_usd: "0", amount_lbp: "0" }]);
  const [postPreview, setPostPreview] = useState<{ base_usd: number; base_lbp: number; tax_usd: number; tax_lbp: number; total_usd: number; total_lbp: number } | null>(
    null
  );

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState(() => todayIso());
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);

  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelDraftReason, setCancelDraftReason] = useState("");
  const [cancelDrafting, setCancelDrafting] = useState(false);

  const [holdBusy, setHoldBusy] = useState(false);

  const methodChoices = useMemo(() => {
    const base = ["cash", "bank", "card", "transfer", "other"];
    const fromConfig = paymentMethods.map((m) => m.method);
    const merged = Array.from(new Set([...base, ...fromConfig])).filter(Boolean);
    merged.sort();
    return merged;
  }, [paymentMethods]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [det, pm] = await Promise.all([
        apiGet<InvoiceDetail>(`/purchases/invoices/${id}`),
        apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods").catch(() => ({ methods: [] as PaymentMethodMapping[] }))
      ]);
      setDetail(det);
      setPaymentMethods(pm.methods || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetail(null);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function openPostDialog() {
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;
    if (detail.invoice.is_on_hold) {
      setStatus("Invoice is on hold. Unhold it before posting.");
      return;
    }
    if (!(detail.lines || []).length) {
      setStatus("Cannot post: add at least one line to this draft first.");
      return;
    }
    setPostPostingDate(todayIso());
    setPostPayments([{ method: "bank", amount_usd: "0", amount_lbp: "0" }]);
    setPostPreview(null);
    try {
      const prev = await apiGet<{
        base_usd: number;
        base_lbp: number;
        tax_usd: number;
        tax_lbp: number;
        total_usd: number;
        total_lbp: number;
      }>(`/purchases/invoices/${detail.invoice.id}/post-preview`);
      setPostPreview(prev);
    } catch {
      setPostPreview(null);
    }
    setPostOpen(true);
  }

  async function postDraftInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;

    const paymentsOut: Array<{ method: string; amount_usd: number; amount_lbp: number }> = [];
    for (let i = 0; i < (postPayments || []).length; i++) {
      const p = postPayments[i];
      const usdRes = parseNumberInput(p.amount_usd);
      const lbpRes = parseNumberInput(p.amount_lbp);
      if (!usdRes.ok && usdRes.reason === "invalid") return setStatus(`Invalid USD amount on payment row ${i + 1}.`);
      if (!lbpRes.ok && lbpRes.reason === "invalid") return setStatus(`Invalid LL amount on payment row ${i + 1}.`);
      const usd = usdRes.ok ? usdRes.value : 0;
      const lbp = lbpRes.ok ? lbpRes.value : 0;
      if (usd !== 0 || lbp !== 0) paymentsOut.push({ method: p.method, amount_usd: usd, amount_lbp: lbp });
    }

    setPostSubmitting(true);
    setStatus("Posting invoice...");
    try {
      await apiPost(`/purchases/invoices/${detail.invoice.id}/post`, {
        posting_date: postPostingDate || undefined,
        payments: paymentsOut
      });
      setPostOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setPostSubmitting(false);
    }
  }

  async function unholdInvoice() {
    if (!detail) return;
    setHoldBusy(true);
    setStatus("Unholding...");
    try {
      await apiPost(`/purchases/invoices/${detail.invoice.id}/unhold`, {});
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setHoldBusy(false);
    }
  }

  async function holdInvoice() {
    if (!detail) return;
    setHoldBusy(true);
    setStatus("Holding...");
    try {
      await apiPost(`/purchases/invoices/${detail.invoice.id}/hold`, { reason: "Manual hold" });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setHoldBusy(false);
    }
  }

  async function cancelPostedInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "posted") return;
    setCanceling(true);
    setStatus("Voiding invoice...");
    try {
      await apiPost(`/purchases/invoices/${detail.invoice.id}/cancel`, {
        cancel_date: cancelDate || undefined,
        reason: cancelReason || undefined
      });
      setCancelOpen(false);
      await load();
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
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCancelDrafting(false);
    }
  }

  if (loading && !detail) {
    return <div className="min-h-[50vh] px-2 py-10 text-sm text-fg-muted">Loading...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/purchasing/supplier-invoices")}>
            Back to List
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
          <Button onClick={() => router.push("/purchasing/supplier-invoices/new")}>New Draft</Button>
        </div>
      </div>

      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>API errors will show here.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
          </CardContent>
        </Card>
      ) : null}

      {detail ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Supplier Invoice</CardTitle>
                  <CardDescription>
                    <span className="font-mono text-xs">{detail.invoice.invoice_no || "(draft)"}</span> ·{" "}
                    <span className="text-xs">{detail.invoice.status}</span>
                    {detail.invoice.is_on_hold ? (
                      <>
                        {" "}
                        ·{" "}
                        <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-200">
                          HOLD{detail.invoice.hold_reason ? `: ${detail.invoice.hold_reason}` : ""}
                        </span>
                      </>
                    ) : null}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {detail.invoice.status === "draft" ? (
                    <>
                      <Button asChild variant="outline">
                        <Link href={`/purchasing/supplier-invoices/${encodeURIComponent(detail.invoice.id)}/edit`}>Edit Draft</Link>
                      </Button>
                      {detail.invoice.is_on_hold ? (
                        <Button variant="outline" onClick={unholdInvoice} disabled={holdBusy}>
                          {holdBusy ? "..." : "Unhold"}
                        </Button>
                      ) : (
                        <Button variant="outline" onClick={holdInvoice} disabled={holdBusy}>
                          {holdBusy ? "..." : "Hold"}
                        </Button>
                      )}
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
                    </>
                  ) : null}
                  {detail.invoice.status === "posted" ? (
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
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
	              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
	                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
	                  <p className="text-xs text-fg-muted">Supplier</p>
	                  <p className="text-sm font-medium text-foreground">{detail.invoice.supplier_name || detail.invoice.supplier_id || "-"}</p>
	                </div>
	                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
	                  <p className="text-xs text-fg-muted">Supplier Ref</p>
	                  <p className="text-sm data-mono text-foreground">{(detail.invoice.supplier_ref as any) || "-"}</p>
	                </div>
	                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
	                  <p className="text-xs text-fg-muted">Goods Receipt</p>
	                  <p className="text-sm data-mono text-foreground">{detail.invoice.goods_receipt_no || "-"}</p>
	                </div>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <p className="text-xs text-fg-muted">Dates</p>
                  <p className="text-sm data-mono text-foreground">Inv {fmtIso(detail.invoice.invoice_date)}</p>
                  <p className="text-sm data-mono text-foreground">Due {fmtIso(detail.invoice.due_date)}</p>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <p className="text-xs text-fg-muted">Totals</p>
                  <p className="text-sm data-mono text-foreground">
                    {fmtUsd(detail.invoice.total_usd)}
                  </p>
                  <p className="text-sm data-mono text-foreground">
                    {fmtLbp(detail.invoice.total_lbp)}
                  </p>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <p className="text-xs text-fg-muted">Status</p>
                  <p className="text-sm font-medium text-foreground">{detail.invoice.status}</p>
                </div>
              </div>

              {detail.invoice.is_on_hold ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Hold Details</CardTitle>
                    <CardDescription>Posting and paying are blocked until you unhold.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-xs text-fg-muted">
                      Reason: <span className="font-mono">{detail.invoice.hold_reason || "-"}</span>
                    </div>
                    <pre className="max-h-64 overflow-auto rounded-md border border-border-subtle bg-bg-sunken/40 p-3 text-[11px] text-fg-muted">
{JSON.stringify(detail.invoice.hold_details ?? {}, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Lines</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="ui-table-wrap">
                    <table className="ui-table">
                      <thead className="ui-thead">
                        <tr>
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2">Batch</th>
                          <th className="px-3 py-2">Expiry</th>
                          <th className="px-3 py-2 text-right">Total USD</th>
                          <th className="px-3 py-2 text-right">Total LL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.lines.map((l) => (
                          <tr key={l.id} className="ui-tr-hover">
                            <td className="px-3 py-2">
                              {l.item_sku || l.item_name ? (
                                <span>
                                  <span className="font-mono text-xs">{l.item_sku || "-"}</span> · {l.item_name || "-"}
                                </span>
                              ) : (
                                <span className="font-mono text-xs">{l.item_id}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {l.batch_no || "-"}
                              {l.batch_status && l.batch_status !== "available" ? (
                                <span className="ml-2 rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-[10px] text-fg-muted">
                                  {l.batch_status}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{fmtIso(l.expiry_date)}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {fmtUsd(l.line_total_usd)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {fmtLbp(l.line_total_lbp)}
                            </td>
                          </tr>
                        ))}
                        {detail.lines.length === 0 ? (
                          <tr>
                            <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
                              No lines.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <p className="text-sm font-medium text-foreground">Payments</p>
	                  <div className="mt-2 space-y-1 text-xs text-fg-muted">
	                    {detail.payments.map((p) => (
	                      <div key={p.id} className="flex items-center justify-between gap-2">
	                        <span className="data-mono">
	                          {p.method}
	                          {p.reference ? <span className="text-fg-subtle"> · {p.reference}</span> : null}
	                        </span>
	                        <span className="data-mono">
	                          {fmtUsd(p.amount_usd)} / {fmtLbp(p.amount_lbp)}
	                        </span>
	                      </div>
	                    ))}
                    {detail.payments.length === 0 ? <p className="text-fg-subtle">No payments.</p> : null}
                  </div>
                </div>

                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <p className="text-sm font-medium text-foreground">Tax Lines</p>
                  <div className="mt-2 space-y-1 text-xs text-fg-muted">
                    {detail.tax_lines.map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2">
                        <span className="data-mono">{t.tax_code_id}</span>
                        <span className="data-mono">
                          {fmtUsd(t.tax_usd)} / {fmtLbp(t.tax_lbp)}
                        </span>
                      </div>
                    ))}
                    {detail.tax_lines.length === 0 ? <p className="text-fg-subtle">No tax lines.</p> : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Dialog open={postOpen} onOpenChange={setPostOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Post Draft Invoice</DialogTitle>
                <DialogDescription>Posting writes stock moves + GL. You can optionally record payments now.</DialogDescription>
              </DialogHeader>
              <form onSubmit={postDraftInvoice} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-fg-muted">Posting Date</label>
                    <Input type="date" value={postPostingDate} onChange={(e) => setPostPostingDate(e.target.value)} />
                  </div>
                </div>

                {postPreview ? (
                  <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3 text-xs text-fg-muted">
                    <div className="flex items-center justify-between gap-2">
                      <span>Base</span>
                      <span className="data-mono">
                        {fmtUsd(postPreview.base_usd)} / {fmtLbp(postPreview.base_lbp)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span>Tax</span>
                      <span className="data-mono">
                        {fmtUsd(postPreview.tax_usd)} / {fmtLbp(postPreview.tax_lbp)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span>Total</span>
                      <span className="data-mono">
                        {fmtUsd(postPreview.total_usd)} / {fmtLbp(postPreview.total_lbp)}
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">Payments (optional)</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPostPayments((prev) => [...prev, { method: "bank", amount_usd: "0", amount_lbp: "0" }])}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {postPayments.map((p, idx) => (
                      <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                        <div className="md:col-span-4">
                          <select
                            className="ui-select"
                            value={p.method}
                            onChange={(e) =>
                              setPostPayments((prev) => prev.map((x, i) => (i === idx ? { ...x, method: e.target.value } : x)))
                            }
                          >
                            {methodChoices.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-3">
                          <Input
                            value={p.amount_usd}
                            onChange={(e) =>
                              setPostPayments((prev) => prev.map((x, i) => (i === idx ? { ...x, amount_usd: e.target.value } : x)))
                            }
                            placeholder="USD"
                          />
                        </div>
                        <div className="md:col-span-3">
                            <Input
                              value={p.amount_lbp}
                              onChange={(e) =>
                                setPostPayments((prev) => prev.map((x, i) => (i === idx ? { ...x, amount_lbp: e.target.value } : x)))
                              }
                              placeholder="LL"
                            />
                          </div>
                        <div className="md:col-span-2 flex justify-end">
                          <Button type="button" variant="outline" size="sm" onClick={() => setPostPayments((prev) => prev.filter((_, i) => i !== idx))}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={postSubmitting}>
                    {postSubmitting ? "..." : "Post Invoice"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Void Supplier Invoice</DialogTitle>
                <DialogDescription>This will reverse VAT tax lines and GL entries. It is blocked if payments exist.</DialogDescription>
              </DialogHeader>
              <form onSubmit={cancelPostedInvoice} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Void Date</label>
                  <Input type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-6">
                  <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
                  <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="duplicate / correction / vendor dispute" />
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
                <DialogDescription>This will mark the draft as canceled. No tax or GL will be posted.</DialogDescription>
              </DialogHeader>
              <form onSubmit={cancelDraftInvoice} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
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
        </>
      ) : null}
    </div>
  );
}

export default function SupplierInvoiceShowPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <SupplierInvoiceShowInner />
    </Suspense>
  );
}
