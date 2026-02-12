"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { fmtLbp, fmtLbpMaybe, fmtUsd, fmtUsdLbp, fmtUsdMaybe } from "@/lib/money";
import { ShortcutLink } from "@/components/shortcut-link";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";

type CreditDoc = {
  id: string;
  credit_no: string;
  status: "draft" | "posted" | "canceled";
  supplier_id: string;
  supplier_name: string | null;
  kind: "expense" | "receipt";
  goods_receipt_id: string | null;
  goods_receipt_no?: string | null;
  credit_date: string;
  rate_type: string;
  exchange_rate: string | number;
  memo: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  posted_at: string | null;
  canceled_at: string | null;
  cancel_reason?: string | null;
};

type LineRow = { id: string; line_no: number | string; description: string | null; amount_usd: string | number; amount_lbp: string | number };
type AppRow = { id: string; supplier_invoice_id: string; invoice_no: string; invoice_date: string; amount_usd: string | number; amount_lbp: string | number; created_at: string };
type AllocRow = { id: string; goods_receipt_line_id: string; batch_id: string | null; amount_usd: string | number; amount_lbp: string | number; created_at: string };

type DetailRes = { credit: CreditDoc; lines: LineRow[]; applications: AppRow[]; allocations: AllocRow[] };

type OpenInvoiceRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  paid_usd: string | number;
  paid_lbp: string | number;
  credits_applied_usd: string | number;
  credits_applied_lbp: string | number;
  balance_usd: string | number;
  balance_lbp: string | number;
};

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function SupplierCreditDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id || "");

  const [status, setStatus] = useState("");
  const [data, setData] = useState<DetailRes | null>(null);

  const [posting, setPosting] = useState(false);

  const [applyOpen, setApplyOpen] = useState(false);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [invoiceQ, setInvoiceQ] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [applyUsd, setApplyUsd] = useState("");
  const [applyLbp, setApplyLbp] = useState("");
  const [applying, setApplying] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState(todayIso());
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);

  const appliedTotals = useMemo(() => {
    let usd = 0;
    let lbp = 0;
    for (const a of data?.applications || []) {
      usd += toNum(a.amount_usd);
      lbp += toNum(a.amount_lbp);
    }
    return { usd, lbp };
  }, [data]);

  const remaining = useMemo(() => {
    const totalUsd = toNum(data?.credit?.total_usd);
    const totalLbp = toNum(data?.credit?.total_lbp);
    return { usd: totalUsd - appliedTotals.usd, lbp: totalLbp - appliedTotals.lbp };
  }, [data, appliedTotals]);

  const load = useCallback(async () => {
    if (!id) return;
    setStatus("Loading...");
    try {
      const res = await apiGet<DetailRes>(`/purchases/credits/${encodeURIComponent(id)}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const loadOpenInvoices = useCallback(async () => {
    const sid = data?.credit?.supplier_id;
    if (!sid) return;
    try {
      const params = new URLSearchParams();
      params.set("supplier_id", sid);
      if (invoiceQ.trim()) params.set("q", invoiceQ.trim());
      const res = await apiGet<{ invoices: OpenInvoiceRow[] }>(`/purchases/credits/open-invoices?${params.toString()}`);
      setOpenInvoices(res.invoices || []);
    } catch {
      setOpenInvoices([]);
    }
  }, [data?.credit?.supplier_id, invoiceQ]);

  useEffect(() => {
    if (!applyOpen) return;
    setInvoiceId("");
    setApplyUsd("");
    setApplyLbp("");
    loadOpenInvoices();
  }, [applyOpen, loadOpenInvoices]);

  async function post() {
    if (!id) return;
    setPosting(true);
    setStatus("Posting...");
    try {
      await apiPost(`/purchases/credits/${encodeURIComponent(id)}/post`, {});
      setStatus("");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setPosting(false);
    }
  }

  async function apply() {
    if (!id) return;
    if (!invoiceId) return setStatus("Select an invoice to apply to.");
    if (toNum(applyUsd) === 0 && toNum(applyLbp) === 0) return setStatus("Enter an amount.");
    setApplying(true);
    setStatus("Applying...");
    try {
      await apiPost(`/purchases/credits/${encodeURIComponent(id)}/apply`, {
        supplier_invoice_id: invoiceId,
        amount_usd: toNum(applyUsd),
        amount_lbp: toNum(applyLbp)
      });
      setApplyOpen(false);
      setStatus("");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setApplying(false);
    }
  }

  async function cancel() {
    if (!id) return;
    setCanceling(true);
    setStatus("Canceling...");
    try {
      await apiPost(`/purchases/credits/${encodeURIComponent(id)}/cancel`, {
        cancel_date: cancelDate || null,
        reason: cancelReason.trim() || null
      });
      setCancelOpen(false);
      setStatus("");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCanceling(false);
    }
  }

  const credit = data?.credit;
  const openInvoiceColumns: Array<DataTableColumn<OpenInvoiceRow>> = [
    {
      id: "invoice_no",
      header: "Invoice",
      sortable: true,
      mono: true,
      accessor: (inv) => inv.invoice_no,
      cell: (inv) => <span className="font-mono text-xs">{inv.invoice_no}</span>,
    },
    {
      id: "invoice_date",
      header: "Date",
      sortable: true,
      mono: true,
      accessor: (inv) => inv.invoice_date,
      cell: (inv) => <span className="font-mono text-xs text-fg-muted">{inv.invoice_date}</span>,
    },
    {
      id: "balance",
      header: "Balance",
      sortable: true,
      align: "right",
      mono: true,
      accessor: (inv) => toNum(inv.balance_usd),
      cell: (inv) => (
        <div className="text-right data-mono text-xs">
          {fmtUsd(inv.balance_usd)}
          <div className="text-[11px] text-fg-muted">{fmtLbp(inv.balance_lbp)}</div>
        </div>
      ),
    },
    {
      id: "select",
      header: "",
      align: "right",
      cell: (inv) => (
        <Button
          type="button"
          size="sm"
          variant={invoiceId === inv.id ? "default" : "outline"}
          onClick={() => {
            setInvoiceId(inv.id);
            const usd = Math.max(0, Math.min(toNum(inv.balance_usd), remaining.usd));
            const lbp = Math.max(0, Math.min(toNum(inv.balance_lbp), remaining.lbp));
            setApplyUsd(usd ? String(usd) : "");
            setApplyLbp(lbp ? String(lbp) : "");
          }}
        >
          {invoiceId === inv.id ? "Selected" : "Select"}
        </Button>
      ),
    },
  ];
  const appColumns: Array<DataTableColumn<AppRow>> = [
    {
      id: "invoice",
      header: "Invoice",
      sortable: true,
      mono: true,
      accessor: (a) => a.invoice_no,
      cell: (a) => (
        <div className="font-mono text-xs">
          <ShortcutLink href={`/purchasing/supplier-invoices/${encodeURIComponent(a.supplier_invoice_id)}`} title="Open supplier invoice">
            {a.invoice_no}
          </ShortcutLink>
          <div className="text-[11px] text-fg-muted">{a.invoice_date}</div>
        </div>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      sortable: true,
      align: "right",
      mono: true,
      accessor: (a) => toNum(a.amount_usd),
      cell: (a) => (
        <div className="text-right data-mono text-xs">
          {fmtUsd(a.amount_usd)}
          <div className="text-[11px] text-fg-muted">{fmtLbp(a.amount_lbp)}</div>
        </div>
      ),
    },
    {
      id: "created_at",
      header: "Created",
      sortable: true,
      mono: true,
      accessor: (a) => a.created_at,
      cell: (a) => <span className="font-mono text-xs text-fg-muted">{(a.created_at || "").slice(0, 10)}</span>,
    },
  ];
  const lineColumns: Array<DataTableColumn<LineRow>> = [
    {
      id: "line_no",
      header: "#",
      sortable: true,
      mono: true,
      accessor: (l) => Number(l.line_no || 0),
      cell: (l) => <span className="font-mono text-xs">{l.line_no}</span>,
    },
    {
      id: "description",
      header: "Description",
      sortable: true,
      accessor: (l) => l.description || "",
      cell: (l) => <span className="text-xs">{l.description || "-"}</span>,
    },
    {
      id: "amount_usd",
      header: "USD",
      sortable: true,
      align: "right",
      mono: true,
      accessor: (l) => toNum(l.amount_usd),
      cell: (l) => <span className="data-mono text-xs ui-tone-usd">{fmtUsd(l.amount_usd, { maximumFractionDigits: 4 })}</span>,
    },
    {
      id: "amount_lbp",
      header: "LL",
      sortable: true,
      align: "right",
      mono: true,
      accessor: (l) => toNum(l.amount_lbp),
      cell: (l) => <span className="data-mono text-xs ui-tone-lbp">{fmtLbp(l.amount_lbp, { maximumFractionDigits: 2 })}</span>,
    },
  ];
  const allocColumns: Array<DataTableColumn<AllocRow>> = [
    {
      id: "goods_receipt_line_id",
      header: "Goods Receipt Line",
      sortable: true,
      mono: true,
      accessor: (a) => a.goods_receipt_line_id,
      cell: (a) => <span className="font-mono text-xs">{a.goods_receipt_line_id}</span>,
    },
    {
      id: "batch_id",
      header: "Batch",
      sortable: true,
      mono: true,
      accessor: (a) => a.batch_id || "",
      cell: (a) => <span className="font-mono text-xs text-fg-muted">{a.batch_id || "-"}</span>,
    },
    {
      id: "amount_usd",
      header: "USD",
      sortable: true,
      align: "right",
      mono: true,
      accessor: (a) => toNum(a.amount_usd),
      cell: (a) => <span className="data-mono text-xs ui-tone-usd">{fmtUsd(a.amount_usd, { maximumFractionDigits: 4 })}</span>,
    },
    {
      id: "amount_lbp",
      header: "LL",
      sortable: true,
      align: "right",
      mono: true,
      accessor: (a) => toNum(a.amount_lbp),
      cell: (a) => <span className="data-mono text-xs ui-tone-lbp">{fmtLbp(a.amount_lbp, { maximumFractionDigits: 2 })}</span>,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Supplier Credit</CardTitle>
          <CardDescription className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono">{credit?.credit_no || id}</span>
            <span className="text-xs text-fg-muted">{credit?.status || ""}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-fg-muted space-y-1">
            <div>
              Supplier:{" "}
              {credit?.supplier_id ? (
                <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(credit.supplier_id)}`} title="Open supplier">
                  {credit.supplier_name || credit.supplier_id}
                </ShortcutLink>
              ) : (
                "-"
              )}
            </div>
            <div>
              Kind: <span className="font-mono">{credit?.kind}</span>{" "}
              {credit?.goods_receipt_id ? (
                <>
                  {" "}
                  · Receipt:{" "}
                  <ShortcutLink href={`/purchasing/goods-receipts/${encodeURIComponent(credit.goods_receipt_id)}`} title="Open goods receipt">
                    {credit.goods_receipt_no || credit.goods_receipt_id}
                  </ShortcutLink>
                </>
              ) : null}
            </div>
            <div>
              Date: <span className="font-mono">{credit?.credit_date}</span> · Rate:{" "}
              <span className="font-mono">{credit?.rate_type}</span> @{" "}
              <span className="font-mono">{String(credit?.exchange_rate ?? "")}</span>
            </div>
            {credit?.memo ? <div>Memo: {credit.memo}</div> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link
                href={`/purchasing/supplier-credits/${encodeURIComponent(id)}/print`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Print / PDF
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a
                href={`/exports/supplier-credits/${encodeURIComponent(id)}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download PDF
              </a>
            </Button>
            {credit?.status === "draft" ? (
              <>
                <Button variant="outline" onClick={() => router.push(`/purchasing/supplier-credits/${encodeURIComponent(id)}/edit`)}>
                  Edit Draft
                </Button>
                <Button onClick={post} disabled={posting}>
                  {posting ? "Posting..." : "Post"}
                </Button>
              </>
            ) : null}

            {credit?.status === "posted" ? (
              <>
                <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
                  <DialogTrigger asChild>
                    <Button disabled={remaining.usd <= 0 && remaining.lbp <= 0}>Apply to Invoice</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Apply Credit</DialogTitle>
                      <DialogDescription>Apply this posted credit note to a posted supplier invoice.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="text-fg-muted">
                          Remaining: <span className="data-mono">{fmtUsd(remaining.usd)}</span> /{" "}
                          <span className="data-mono">{fmtLbp(remaining.lbp)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input value={invoiceQ} onChange={(e) => setInvoiceQ(e.target.value)} placeholder="Search invoice no..." />
                          <Button type="button" variant="outline" onClick={loadOpenInvoices}>
                            Search
                          </Button>
                        </div>
                      </div>

                      <DataTable<OpenInvoiceRow>
                        tableId="purchasing.supplier_credit.open_invoices"
                        rows={openInvoices}
                        columns={openInvoiceColumns}
                        getRowId={(inv) => inv.id}
                        emptyText="No open invoices found."
                        enableGlobalFilter={false}
                        initialSort={{ columnId: "invoice_date", dir: "desc" }}
                      />

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <MoneyInput label="Apply USD" currency="USD" value={applyUsd} onChange={setApplyUsd} quick={[0]} />
                        <MoneyInput label="Apply LL" currency="LBP" value={applyLbp} onChange={setApplyLbp} quick={[0]} />
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setApplyOpen(false)}>
                          Close
                        </Button>
                        <Button type="button" onClick={apply} disabled={applying}>
                          {applying ? "Applying..." : "Apply"}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-xl">
                    <DialogHeader>
                      <DialogTitle>Cancel Credit Note</DialogTitle>
                      <DialogDescription>Creates a reversing journal and reverses rebate allocations.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Cancel Date</label>
                        <Input type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-fg-muted">Reason</label>
                        <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Optional..." />
                      </div>
                      <div className="flex justify-end md:col-span-2">
                        <Button type="button" onClick={cancel} disabled={canceling}>
                          {canceling ? "Canceling..." : "Confirm Cancel"}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
            <CardDescription>
              Total: {fmtUsdLbp(credit?.total_usd, credit?.total_lbp)} · Applied: {fmtUsdLbp(appliedTotals.usd, appliedTotals.lbp)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded-md border border-border bg-bg-elevated p-3">
              <div className="text-xs text-fg-subtle">Remaining USD</div>
              <div className="mt-1 data-mono text-sm">{fmtUsdMaybe(remaining.usd)}</div>
            </div>
            <div className="rounded-md border border-border bg-bg-elevated p-3">
              <div className="text-xs text-fg-subtle">Remaining LL</div>
              <div className="mt-1 data-mono text-sm">{fmtLbpMaybe(remaining.lbp, { dashIfZero: remaining.usd !== 0 })}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Applications</CardTitle>
            <CardDescription>{data?.applications?.length || 0} applications</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<AppRow>
              tableId="purchasing.supplier_credit.applications"
              rows={data?.applications || []}
              columns={appColumns}
              getRowId={(a) => a.id}
              emptyText="No applications."
              enableGlobalFilter={false}
              initialSort={{ columnId: "created_at", dir: "desc" }}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>{data?.lines?.length || 0} lines</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<LineRow>
            tableId="purchasing.supplier_credit.lines"
            rows={data?.lines || []}
            columns={lineColumns}
            getRowId={(l) => l.id}
            emptyText="No lines."
            enableGlobalFilter={false}
            initialSort={{ columnId: "line_no", dir: "asc" }}
          />
        </CardContent>
      </Card>

      {data?.allocations?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Allocations (Receipt Credits)</CardTitle>
            <CardDescription>Rebate allocations applied to goods receipt lines/batches.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<AllocRow>
              tableId="purchasing.supplier_credit.allocations"
              rows={data?.allocations || []}
              columns={allocColumns}
              getRowId={(a) => a.id}
              emptyText="No allocations."
              enableGlobalFilter={false}
              initialSort={{ columnId: "goods_receipt_line_id", dir: "asc" }}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
