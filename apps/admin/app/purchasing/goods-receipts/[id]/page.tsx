"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { fmtLbp, fmtUsd } from "@/lib/money";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { TabBar } from "@/components/tab-bar";
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
  const lineColumns = useMemo((): Array<DataTableColumn<ReceiptLine>> => {
    return [
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (l) => {
          const it = itemById.get(l.item_id);
          return `${it?.sku || ""} ${it?.name || l.item_id}`;
        },
        cell: (l) =>
          itemById.get(l.item_id) ? (
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
          ),
      },
      {
        id: "qty",
        header: "Qty",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (l) => Number(l.qty || 0),
        cell: (l) => <span className="font-mono text-xs">{Number(l.qty || 0).toFixed(2)}</span>,
      },
      {
        id: "batch",
        header: "Batch",
        sortable: true,
        mono: true,
        accessor: (l) => `${l.batch_no || ""} ${l.expiry_date || ""}`,
        cell: (l) => (
          <span className="text-sm text-fg-muted">
            {l.batch_no || l.expiry_date ? (
              <span className="font-mono text-xs">
                {l.batch_no ? `#${l.batch_no}` : ""} {l.expiry_date ? `exp ${String(l.expiry_date).slice(0, 10)}` : ""}
              </span>
            ) : (
              "-"
            )}
          </span>
        ),
      },
    ];
  }, [itemById]);

  const [postOpen, setPostOpen] = useState(false);
  const [postingDate, setPostingDate] = useState(() => todayIso());
  const [posting, setPosting] = useState(false);
  const searchParams = useSearchParams();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState(() => todayIso());
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);

  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelDraftReason, setCancelDraftReason] = useState("");
  const [cancelDrafting, setCancelDrafting] = useState(false);

  const activeTab = (() => {
    const t = String(searchParams.get("tab") || "overview").toLowerCase();
    if (t === "lines") return "lines";
    return "overview";
  })();
  const receiptTabs = [
    { label: "Overview", href: "?tab=overview", activeQuery: { key: "tab", value: "overview" } },
    { label: "Lines", href: "?tab=lines", activeQuery: { key: "tab", value: "lines" } },
  ];

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
        apiGet<{ items: Item[] }>("/items/min"),
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
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
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
          {detail?.receipt?.status === "draft" ? (
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
          {detail?.receipt?.status === "posted" ? (
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
          <TabBar tabs={receiptTabs} />
          {activeTab === "overview" ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="ui-panel p-5 md:col-span-8">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[220px]">
                    <p className="ui-panel-title">Supplier</p>
                    <p className="mt-1 text-lg font-semibold leading-tight text-foreground">
                      {detail.receipt.supplier_id ? (
                        <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(detail.receipt.supplier_id)}`} title="Open supplier">
                          {supplierById.get(detail.receipt.supplier_id)?.name || detail.receipt.supplier_id}
                        </ShortcutLink>
                      ) : (
                        "-"
                      )}
                    </p>
                    <p className="mt-1 text-xs text-fg-muted">
                      Created{" "}
                      <span className="data-mono">{String(detail.receipt.created_at || "").slice(0, 19).replace("T", " ") || "-"}</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="ui-chip ui-chip-default">
                      <span className="text-fg-subtle">Warehouse</span>
                      <span className="data-mono text-foreground">{whById.get(detail.receipt.warehouse_id || "")?.name || "-"}</span>
                    </span>
                    <span className="ui-chip ui-chip-default">
                      <span className="text-fg-subtle">Exchange</span>
                      <span className="data-mono text-foreground">{Number(detail.receipt.exchange_rate || 0).toFixed(0)}</span>
                    </span>
                    <span className="ui-chip ui-chip-default">
                      <span className="text-fg-subtle">Status</span>
                      <span className="data-mono text-foreground">{detail.receipt.status}</span>
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
                    <p className="ui-panel-title">Dates</p>
                    <div className="mt-2 space-y-1">
                      <div className="ui-kv">
                        <span className="ui-kv-label">Received At</span>
                        <span className="ui-kv-value">{(detail.receipt.received_at as string) || "-"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
                    <p className="ui-panel-title">Document</p>
                    <div className="mt-2 space-y-1">
                      <div className="ui-kv">
                        <span className="ui-kv-label">Receipt No</span>
                        <span className="ui-kv-value">{detail.receipt.receipt_no || "(draft)"}</span>
                      </div>
                      <div className="ui-kv">
                        <span className="ui-kv-label">Supplier Ref</span>
                        <span className="ui-kv-value">{(detail.receipt as any).supplier_ref || "-"}</span>
                      </div>
                      {detail.receipt.purchase_order_id ? (
                        <div className="ui-kv">
                          <span className="ui-kv-label">PO</span>
                          <span className="ui-kv-value">
                            <ShortcutLink
                              href={`/purchasing/purchase-orders/${encodeURIComponent(detail.receipt.purchase_order_id)}`}
                              title="Open purchase order"
                              className="data-mono"
                            >
                              {detail.receipt.purchase_order_no || detail.receipt.purchase_order_id.slice(0, 8)}
                            </ShortcutLink>
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="ui-panel p-5 md:col-span-4">
                <p className="ui-panel-title">Totals</p>

                <div className="mt-3">
                  <div className="text-xs text-fg-muted">Total</div>
                  <div className="data-mono mt-1 text-3xl font-semibold leading-none ui-tone-usd">{fmtUsd(detail.receipt.total_usd)}</div>
                  <div className="data-mono mt-1 text-sm text-fg-muted">{fmtLbp(detail.receipt.total_lbp)}</div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="ui-kv ui-kv-strong">
                    <span className="ui-kv-label">Total USD</span>
                    <span className="ui-kv-value">{fmtUsd(detail.receipt.total_usd)}</span>
                  </div>
                  <div className="ui-kv ui-kv-sub">
                    <span className="ui-kv-label">Total LL</span>
                    <span className="ui-kv-value">{fmtLbp(detail.receipt.total_lbp)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "lines" ? (
            <Card>
              <CardHeader>
                <CardTitle>Lines</CardTitle>
                <CardDescription>Received quantities.</CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable<ReceiptLine>
                  tableId="purchasing.goods_receipt.lines"
                  rows={detail.lines || []}
                  columns={lineColumns}
                  getRowId={(l) => l.id}
                  emptyText="No lines."
                  enableGlobalFilter={false}
                  initialSort={{ columnId: "item", dir: "asc" }}
                />
              </CardContent>
            </Card>
          ) : null}

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
