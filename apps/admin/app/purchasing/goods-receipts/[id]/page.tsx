"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { fmtLbp, fmtUsd } from "@/lib/money";

import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type Supplier = { id: string; name: string };
type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };
type TaxCode = { id: string; name: string; rate: string | number };

type ReceiptRow = {
  id: string;
  receipt_no: string | null;
  supplier_id: string | null;
  supplier_ref?: string | null;
  warehouse_id: string | null;
  purchase_order_id?: string | null;
  purchase_order_no?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  received_at?: string | null;
  created_at: string;
  exchange_rate: string | number;
};

type ReceiptLine = {
  id: string;
  item_id: string;
  qty: string | number;
  batch_no: string | null;
  expiry_date: string | null;
};

type ReceiptDetail = { receipt: ReceiptRow; lines: ReceiptLine[] };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

export default function GoodsReceiptViewPage() {
  const router = useRouter();
  const params = useParams();
  const idParam = (params as Record<string, string | string[] | undefined>)?.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? (idParam[0] || "") : "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

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

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [d, s, i, w, tc] = await Promise.all([
        apiGet<ReceiptDetail>(`/purchases/receipts/${encodeURIComponent(id)}`),
        apiGet<{ suppliers: Supplier[] }>("/suppliers"),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes")
      ]);
      setDetail(d);
      setSuppliers(s.suppliers || []);
      setItems(i.items || []);
      setWarehouses(w.warehouses || []);
      setTaxCodes(tc.tax_codes || []);
    } catch (e) {
      setDetail(null);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // In Next.js App Router, client pages should read dynamic params via useParams().
    // Only attempt loading once the param is available.
    if (!id) {
      setLoading(false);
      return;
    }
    load();
  }, [load, id]);

  function openPost() {
    if (!detail) return;
    if (detail.receipt.status !== "draft") return;
    if (!(detail.lines || []).length) {
      setErr(new Error("Cannot post: add at least one line to this draft first."));
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
    setErr(null);
    try {
      const res = await apiPost<{ id: string; invoice_no: string }>(`/purchases/invoices/drafts/from-receipt/${encodeURIComponent(detail.receipt.id)}`, {
        invoice_no: createInvInvoiceNo.trim() || undefined,
        invoice_date: createInvInvoiceDate || undefined,
        tax_code_id: createInvTaxCodeId || undefined
      });
      setCreateInvOpen(false);
      router.push(`/purchasing/supplier-invoices/${encodeURIComponent(res.id)}`);
    } catch (e2) {
      setErr(e2);
    } finally {
      setCreateInvSubmitting(false);
    }
  }

  async function postReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (!(detail.lines || []).length) {
      setErr(new Error("Cannot post: add at least one line to this draft first."));
      return;
    }
    setPosting(true);
    setErr(null);
    try {
      await apiPost(`/purchases/receipts/${encodeURIComponent(detail.receipt.id)}/post`, { posting_date: postingDate || undefined });
      setPostOpen(false);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setPosting(false);
    }
  }

  async function cancelReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.receipt.status !== "posted") return;
    setCanceling(true);
    setErr(null);
    try {
      await apiPost(`/purchases/receipts/${encodeURIComponent(detail.receipt.id)}/cancel`, {
        cancel_date: cancelDate || undefined,
        reason: cancelReason || undefined
      });
      setCancelOpen(false);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setCanceling(false);
    }
  }

  async function cancelDraftReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (detail.receipt.status !== "draft") return;
    setCancelDrafting(true);
    setErr(null);
    try {
      await apiPost(`/purchases/receipts/${encodeURIComponent(detail.receipt.id)}/cancel-draft`, { reason: cancelDraftReason || undefined });
      setCancelDraftOpen(false);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setCancelDrafting(false);
    }
  }

  if (!loading && !detail && !err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <EmptyState title="Goods receipt not found" description="This goods receipt may not exist or you may not have access." actionLabel="Back" onAction={() => router.push("/purchasing/goods-receipts")} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{detail?.receipt?.receipt_no || (loading ? "Loading..." : "Goods Receipt")}</h1>
          <p className="text-sm text-fg-muted">
            <span className="font-mono text-xs">{id}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/purchasing/goods-receipts")}>
            Back
          </Button>
          <Button asChild variant="outline">
            <a
              href={`/purchasing/goods-receipts/${encodeURIComponent(id)}/print`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Print / PDF
            </a>
          </Button>
          <Button asChild variant="outline">
            <a
              href={`/exports/goods-receipts/${encodeURIComponent(id)}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Download PDF
            </a>
          </Button>
          {detail?.receipt?.status === "draft" ? (
            <Button type="button" variant="outline" onClick={() => router.push(`/purchasing/goods-receipts/${encodeURIComponent(id)}/edit`)}>
              Edit Draft
            </Button>
          ) : null}
          {detail?.receipt ? (
            <DocumentUtilitiesDrawer
              entityType="goods_receipt"
              entityId={detail.receipt.id}
              allowUploadAttachments={detail.receipt.status === "draft"}
              className="ml-1"
            />
          ) : null}
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      {detail ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Header</CardTitle>
              <CardDescription>Supplier, warehouse, totals.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-fg-subtle">Status:</span> <StatusChip value={detail.receipt.status} />
              </div>
              <div>
                <span className="text-fg-subtle">Supplier:</span>{" "}
                {detail.receipt.supplier_id ? (
                  <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(detail.receipt.supplier_id)}`} title="Open supplier">
                    {supplierById.get(detail.receipt.supplier_id)?.name || detail.receipt.supplier_id}
                  </ShortcutLink>
                ) : (
                  "-"
                )}
              </div>
              <div>
                <span className="text-fg-subtle">Supplier Ref:</span> {(detail.receipt as any).supplier_ref || "-"}
              </div>
              <div>
                <span className="text-fg-subtle">Warehouse:</span> {whById.get(detail.receipt.warehouse_id || "")?.name || "-"}
              </div>
              {detail.receipt.purchase_order_id ? (
                <div>
                  <span className="text-fg-subtle">PO:</span>{" "}
                  <ShortcutLink
                    href={`/purchasing/purchase-orders/${encodeURIComponent(detail.receipt.purchase_order_id)}`}
                    title="Open purchase order"
                    className="data-mono"
                  >
                    {detail.receipt.purchase_order_no || detail.receipt.purchase_order_id.slice(0, 8)}
                  </ShortcutLink>
                </div>
              ) : null}
              <div>
                <span className="text-fg-subtle">Totals:</span>{" "}
                <span className="data-mono">
                  {fmtUsd(detail.receipt.total_usd)} / {fmtLbp(detail.receipt.total_lbp)}
                </span>
              </div>
              <div>
                <span className="text-fg-subtle">Received At:</span> {(detail.receipt.received_at as string) || "-"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Actions</CardTitle>
                  <CardDescription>Posting, voiding, and matching.</CardDescription>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {detail.receipt.status === "draft" ? (
                    <>
                      <Button type="button" onClick={openPost}>
                        Post
                      </Button>
                      <Button
                        type="button"
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
                  {detail.receipt.status === "posted" ? (
                    <>
                      <Button type="button" variant="outline" onClick={openCreateInvoice}>
                        Create Supplier Invoice Draft
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => {
                          setCancelDate(todayIso());
                          setCancelReason("");
                          setCancelOpen(true);
                        }}
                      >
                        Void
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lines</CardTitle>
              <CardDescription>Received quantities.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2">Batch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.lines || []).map((l) => (
                      <tr key={l.id} className="ui-tr-hover">
                        <td className="px-3 py-2">
                          {itemById.get(l.item_id) ? (
                            <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item">
                              <span className="font-mono text-xs text-fg-muted">{itemById.get(l.item_id)?.sku}</span>{" "}
                              <span className="text-foreground">· {itemById.get(l.item_id)?.name}</span>
                            </ShortcutLink>
                          ) : (
                            <ShortcutLink
                              href={`/catalog/items/${encodeURIComponent(l.item_id)}`}
                              title="Open item"
                              className="font-mono text-xs text-fg-muted"
                            >
                              {l.item_id}
                            </ShortcutLink>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.qty || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-sm text-fg-muted">
                          {l.batch_no || l.expiry_date ? (
                            <span className="font-mono text-xs">
                              {l.batch_no ? `#${l.batch_no}` : ""} {l.expiry_date ? `exp ${String(l.expiry_date).slice(0, 10)}` : ""}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                    {!detail.lines?.length ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={3}>
                          No lines.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Dialog open={postOpen} onOpenChange={setPostOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Post Goods Receipt</DialogTitle>
                <DialogDescription>This will add stock and write accounting entries.</DialogDescription>
              </DialogHeader>
              <form onSubmit={postReceipt} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Posting Date</label>
                  <Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setPostOpen(false)} disabled={posting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={posting}>
                    {posting ? "..." : "Post"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Void Goods Receipt</DialogTitle>
                <DialogDescription>Voiding reverses stock and accounting for this receipt.</DialogDescription>
              </DialogHeader>
              <form onSubmit={cancelReceipt} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Void Date</label>
                  <Input type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
                  <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={canceling}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" disabled={canceling}>
                    {canceling ? "..." : "Void"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={cancelDraftOpen} onOpenChange={setCancelDraftOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Cancel Draft Receipt</DialogTitle>
                <DialogDescription>This cancels the draft without posting inventory.</DialogDescription>
              </DialogHeader>
              <form onSubmit={cancelDraftReceipt} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
                  <Input value={cancelDraftReason} onChange={(e) => setCancelDraftReason(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCancelDraftOpen(false)} disabled={cancelDrafting}>
                    Back
                  </Button>
                  <Button type="submit" variant="destructive" disabled={cancelDrafting}>
                    {cancelDrafting ? "..." : "Cancel Draft"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={createInvOpen} onOpenChange={setCreateInvOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Supplier Invoice Draft</DialogTitle>
                <DialogDescription>Creates a draft invoice prefilled from this receipt.</DialogDescription>
              </DialogHeader>
              <form onSubmit={createInvoiceFromReceipt} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Invoice No (optional)</label>
                  <Input value={createInvInvoiceNo} onChange={(e) => setCreateInvInvoiceNo(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Invoice Date</label>
                  <Input type="date" value={createInvInvoiceDate} onChange={(e) => setCreateInvInvoiceDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Tax Code (optional)</label>
                  <select className="ui-select" value={createInvTaxCodeId} onChange={(e) => setCreateInvTaxCodeId(e.target.value)}>
                    <option value="">No tax</option>
                    {taxCodes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setCreateInvOpen(false)} disabled={createInvSubmitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createInvSubmitting}>
                    {createInvSubmitting ? "..." : "Create Draft"}
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
