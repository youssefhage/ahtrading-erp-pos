"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { parseNumberInput } from "@/lib/numbers";
import { ErrorBanner } from "@/components/error-banner";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { MoneyInput } from "@/components/money-input";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PaymentMethodMapping = { method: string; role_code: string; created_at: string };

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  subtotal_usd?: string | number;
  subtotal_lbp?: string | number;
  discount_total_usd?: string | number;
  discount_total_lbp?: string | number;
  exchange_rate: string | number;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  pricing_currency: string;
  settlement_currency: string;
  invoice_date?: string;
  due_date?: string | null;
  created_at: string;
};

type InvoiceLine = {
  id: string;
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
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
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  payments: SalesPayment[];
  tax_lines: TaxLine[];
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

function SalesInvoiceShowInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);

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
        apiGet<InvoiceDetail>(`/sales/invoices/${id}`),
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
      }>(`/sales/invoices/${detail.invoice.id}/post-preview?apply_vat=1`);
      setPostPreview({
        total_usd: Number(prev.total_usd || 0),
        total_lbp: Number(prev.total_lbp || 0),
        tax_usd: Number(prev.tax_usd || 0),
        tax_lbp: Number(prev.tax_lbp || 0)
      });
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
      setPostPreview({
        total_usd: Number(prev.total_usd || 0),
        total_lbp: Number(prev.total_lbp || 0),
        tax_usd: Number(prev.tax_usd || 0),
        tax_lbp: Number(prev.tax_lbp || 0)
      });
    } catch {
      setPostPreview(null);
    }
  }

  async function postDraftInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.invoice.status !== "draft") return;

    let usd = 0;
    let lbp = 0;
    if (postRecordPayment) {
      const usdRes = parseNumberInput(postUsd);
      const lbpRes = parseNumberInput(postLbp);
      if (!usdRes.ok && usdRes.reason === "invalid") return setStatus("Invalid payment USD amount.");
      if (!lbpRes.ok && lbpRes.reason === "invalid") return setStatus("Invalid payment LL amount.");
      usd = usdRes.ok ? usdRes.value : 0;
      lbp = lbpRes.ok ? lbpRes.value : 0;
    }
    const pay = !postRecordPayment || (usd === 0 && lbp === 0) ? [] : [{ method: postMethod, amount_usd: usd, amount_lbp: lbp }];

    setPostSubmitting(true);
    setStatus("Posting invoice...");
    try {
      await apiPost(`/sales/invoices/${detail.invoice.id}/post`, { apply_vat: postApplyingVat, payments: pay });
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
          <Button variant="outline" onClick={() => router.push("/sales/invoices")}>
            Back to List
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
          <Button onClick={() => router.push("/sales/invoices/new")}>New Draft</Button>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      {detail ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Sales Invoice</CardTitle>
                  <CardDescription>
                    <span className="font-mono text-xs">{detail.invoice.invoice_no || "(draft)"}</span> ·{" "}
                    <span className="text-xs">{detail.invoice.status}</span>
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button asChild variant="outline">
                    <Link
                      href={`/sales/invoices/${encodeURIComponent(detail.invoice.id)}/print`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Print / PDF
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <a
                      href={`/exports/sales-invoices/${encodeURIComponent(detail.invoice.id)}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download PDF
                    </a>
                  </Button>
                  {detail.invoice.status === "draft" ? (
                    <>
                      <Button asChild variant="outline">
                        <Link href={`/sales/invoices/${encodeURIComponent(detail.invoice.id)}/edit`}>Edit Draft</Link>
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
                  <DocumentUtilitiesDrawer
                    entityType="sales_invoice"
                    entityId={detail.invoice.id}
                    allowUploadAttachments={detail.invoice.status === "draft"}
                    className="ml-1"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <p className="text-xs text-fg-muted">Customer</p>
                  <p className="text-sm font-medium text-foreground">
                    {detail.invoice.customer_id ? (
                      <ShortcutLink href={`/partners/customers/${encodeURIComponent(detail.invoice.customer_id)}`} title="Open customer">
                        {detail.invoice.customer_name || detail.invoice.customer_id}
                      </ShortcutLink>
                    ) : (
                      "Walk-in"
                    )}
                  </p>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <p className="text-xs text-fg-muted">Warehouse</p>
                  <p className="text-sm font-medium text-foreground">{detail.invoice.warehouse_name || detail.invoice.warehouse_id || "-"}</p>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <p className="text-xs text-fg-muted">Dates</p>
                  <p className="text-sm data-mono text-foreground">Inv {fmtIso(detail.invoice.invoice_date)}</p>
                  <p className="text-sm data-mono text-foreground">Due {fmtIso(detail.invoice.due_date)}</p>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <p className="text-xs text-fg-muted">Totals</p>
                  <div className="mt-1 space-y-1 text-xs text-fg-muted">
                    <div className="flex items-center justify-between gap-2">
                      <span>Subtotal</span>
                      <span className="data-mono text-foreground">
                        {fmtUsd(detail.invoice.subtotal_usd ?? detail.invoice.total_usd)} / {fmtLbp(detail.invoice.subtotal_lbp ?? detail.invoice.total_lbp)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>Discount</span>
                      <span className="data-mono text-foreground">
                        {fmtUsd(detail.invoice.discount_total_usd ?? 0)} / {fmtLbp(detail.invoice.discount_total_lbp ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>Total</span>
                      <span className="data-mono text-foreground">
                        {fmtUsd(detail.invoice.total_usd)} / {fmtLbp(detail.invoice.total_lbp)}
                      </span>
                    </div>
                  </div>
                  {(() => {
                    const paidUsd = (detail.payments || []).reduce((a, p) => a + Number(p.amount_usd || 0), 0);
                    const paidLbp = (detail.payments || []).reduce((a, p) => a + Number(p.amount_lbp || 0), 0);
                    const balUsd = Number(detail.invoice.total_usd || 0) - paidUsd;
                    const balLbp = Number(detail.invoice.total_lbp || 0) - paidLbp;
                    return (
                      <p className="mt-2 text-xs text-fg-muted">
                        Balance:{" "}
                        <span className="data-mono text-foreground">
                          {fmtUsd(balUsd)} / {fmtLbp(balLbp)}
                        </span>
                      </p>
                    );
                  })()}
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                  <p className="text-xs text-fg-muted">Status</p>
                  <p className="text-sm font-medium text-foreground">{detail.invoice.status}</p>
                </div>
              </div>

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
                          <th className="px-3 py-2 text-right">Total USD</th>
                          <th className="px-3 py-2 text-right">Total LL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.lines.map((l) => (
                          <tr key={l.id} className="ui-tr-hover">
                            <td className="px-3 py-2">
                              {l.item_sku || l.item_name ? (
                                <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item">
                                  <span className="font-mono text-xs">{l.item_sku || "-"}</span> · {l.item_name || "-"}
                                </ShortcutLink>
                              ) : (
                                <ShortcutLink
                                  href={`/catalog/items/${encodeURIComponent(l.item_id)}`}
                                  title="Open item"
                                  className="font-mono text-xs"
                                >
                                  {l.item_id}
                                </ShortcutLink>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                            </td>
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
                            <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
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
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">Payments</p>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/sales/payments?invoice_id=${encodeURIComponent(detail.invoice.id)}&record=1`}>Record Payment</Link>
                    </Button>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-fg-muted">
                    {detail.payments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2">
                        <span className="data-mono">{p.method}</span>
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
                <DialogDescription>Posting writes stock moves + GL. You can optionally record a payment now.</DialogDescription>
              </DialogHeader>
              <form onSubmit={postDraftInvoice} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <label className="md:col-span-6 flex items-center gap-2 text-xs text-fg-muted">
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
                <label className="md:col-span-6 flex items-center gap-2 text-xs text-fg-muted">
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
                  <div className="md:col-span-6 rounded-md border border-border-subtle bg-bg-elevated/60 p-3 text-xs text-fg-muted">
                    <div className="flex items-center justify-between gap-2">
                      <span>VAT</span>
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
                ) : (
                  <div className="md:col-span-6 text-xs text-fg-muted">
                    Tip: If you post without paying the full amount, the remaining balance becomes credit and requires a customer.
                  </div>
                )}
                {postRecordPayment ? (
                  <>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Payment Method</label>
                      <select className="ui-select" value={postMethod} onChange={(e) => setPostMethod(e.target.value)}>
                        {methodChoices.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <MoneyInput label="Amount" currency="USD" value={postUsd} onChange={setPostUsd} quick={[0, 1, 10, 100]} className="md:col-span-3" />
                    <MoneyInput label="Amount" currency="LBP" value={postLbp} onChange={setPostLbp} quick={[0, 100000, 500000, 1000000]} className="md:col-span-3" />
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
                  <label className="text-xs font-medium text-fg-muted">Void Date</label>
                  <Input type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-6">
                  <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
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

export default function SalesInvoiceShowPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <SalesInvoiceShowInner />
    </Suspense>
  );
}
