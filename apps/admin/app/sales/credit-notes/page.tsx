"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";

type ReturnRow = {
  id: string;
  return_no: string | null;
  invoice_id: string | null;
  warehouse_id: string | null;
  refund_method: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  restocking_fee_usd?: string | number;
  restocking_fee_lbp?: string | number;
  created_at: string;
};

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
};

type ReturnLine = {
  id: string;
  item_id: string;
  qty: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  tax_usd: string | number;
  tax_lbp: string | number;
};

type ReturnDetail = {
  return: ReturnRow & { exchange_rate: string | number };
  lines: ReturnLine[];
  tax_lines: TaxLine[];
  refunds: Array<{
    id: string;
    method: string;
    amount_usd: string | number;
    amount_lbp: string | number;
    created_at: string;
  }>;
};

function lc(v: unknown) {
  return String(v || "").trim().toLowerCase();
}

export default function SalesCreditNotesPage() {
  const [status, setStatus] = useState("");
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ReturnDetail | null>(null);

  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);

  const creditNotes = useMemo(() => {
    return (returns || []).filter((r) => lc(r.refund_method) === "credit");
  }, [returns]);

  const totals = useMemo(() => {
    let grossUsd = 0;
    let grossLbp = 0;
    let netUsd = 0;
    let netLbp = 0;
    for (const r of creditNotes) {
      const totalUsd = Number(r.total_usd || 0) || 0;
      const totalLbp = Number(r.total_lbp || 0) || 0;
      const feeUsd = Number(r.restocking_fee_usd || 0) || 0;
      const feeLbp = Number(r.restocking_fee_lbp || 0) || 0;
      grossUsd += totalUsd;
      grossLbp += totalLbp;
      netUsd += totalUsd - feeUsd;
      netLbp += totalLbp - feeLbp;
    }
    return { grossUsd, grossLbp, netUsd, netLbp };
  }, [creditNotes]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [r, inv] = await Promise.all([
        apiGet<{ returns: ReturnRow[] }>("/sales/returns"),
        apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices"),
      ]);
      const allReturns = r.returns || [];
      const explicitCredit = allReturns.filter((row) => lc(row.refund_method) === "credit");
      const unknownMethod = allReturns.filter((row) => !lc(row.refund_method));
      let resolvedCreditUnknown: ReturnRow[] = [];
      if (unknownMethod.length) {
        const probes: Array<ReturnRow | null> = await Promise.all(
          unknownMethod.map(async (row) => {
            const det = await apiGet<ReturnDetail>(`/sales/returns/${encodeURIComponent(row.id)}`).catch(() => null);
            const hasCreditRefund = (det?.refunds || []).some((rf) => lc(rf.method) === "credit");
            if (!hasCreditRefund) return null;
            const normalized: ReturnRow = { ...row, refund_method: row.refund_method || "credit" };
            return normalized;
          })
        );
        resolvedCreditUnknown = probes.filter((row): row is ReturnRow => row !== null);
      }
      const merged = new Map<string, ReturnRow>();
      for (const row of [...explicitCredit, ...resolvedCreditUnknown]) merged.set(row.id, row);
      setReturns(Array.from(merged.values()));
      setInvoices(inv.invoices || []);
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
    setStatus("Loading credit note...");
    try {
      const res = await apiGet<ReturnDetail>(`/sales/returns/${encodeURIComponent(id)}`);
      const isCredit =
        lc((res.return as any).refund_method) === "credit" ||
        (res.refunds || []).some((rf) => lc(rf.method) === "credit");
      if (!isCredit) {
        setDetail(null);
        setStatus("Selected return is not a credit note.");
        return;
      }
      setDetail(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetail(null);
      setStatus(message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const columns = useMemo((): Array<DataTableColumn<ReturnRow>> => {
    return [
      {
        id: "credit_no",
        header: "Credit Note",
        sortable: true,
        mono: true,
        accessor: (r) => r.return_no || r.id,
        cell: (r) => <span className="font-mono text-xs">{r.return_no || r.id.slice(0, 8)}</span>,
      },
      {
        id: "invoice",
        header: "Invoice",
        sortable: true,
        accessor: (r) => (r.invoice_id ? invoiceById.get(r.invoice_id)?.invoice_no || r.invoice_id : ""),
        cell: (r) =>
          r.invoice_id ? (
            <ShortcutLink href={`/sales/invoices/${encodeURIComponent(r.invoice_id)}`} title="Open invoice" className="font-mono text-xs">
              {invoiceById.get(r.invoice_id)?.invoice_no || r.invoice_id.slice(0, 8)}
            </ShortcutLink>
          ) : (
            "-"
          ),
      },
      {
        id: "customer",
        header: "Customer",
        sortable: true,
        accessor: (r) => (r.invoice_id ? invoiceById.get(r.invoice_id)?.customer_name || invoiceById.get(r.invoice_id)?.customer_id || "" : ""),
        cell: (r) => {
          const inv = r.invoice_id ? invoiceById.get(r.invoice_id) : null;
          const customerId = String(inv?.customer_id || "");
          if (!customerId) return <span className="text-fg-subtle">Walk-in</span>;
          return (
            <ShortcutLink href={`/partners/customers/${encodeURIComponent(customerId)}`} title="Open customer" className="text-sm">
              {inv?.customer_name || customerId}
            </ShortcutLink>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        sortable: true,
        accessor: (r) => r.status,
        cell: (r) => <StatusChip value={r.status} />,
      },
      {
        id: "credit_usd",
        header: "Credit USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_usd || 0) - Number(r.restocking_fee_usd || 0),
        cell: (r) => {
          const net = (Number(r.total_usd || 0) || 0) - (Number(r.restocking_fee_usd || 0) || 0);
          return <span className="ui-tone-usd">{fmtUsd(net)}</span>;
        },
      },
      {
        id: "credit_lbp",
        header: "Credit LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_lbp || 0) - Number(r.restocking_fee_lbp || 0),
        cell: (r) => {
          const net = (Number(r.total_lbp || 0) || 0) - (Number(r.restocking_fee_lbp || 0) || 0);
          return <span className="ui-tone-lbp">{fmtLbp(net)}</span>;
        },
      },
      {
        id: "date",
        header: "Date",
        sortable: true,
        mono: true,
        accessor: (r) => r.created_at,
        cell: (r) => <span className="font-mono text-xs text-fg-muted">{formatDateLike(r.created_at)}</span>,
      },
    ];
  }, [invoiceById]);

  const detailNet = useMemo(() => {
    if (!detail) return { usd: 0, lbp: 0 };
    const totalUsd = Number(detail.return.total_usd || 0) || 0;
    const totalLbp = Number(detail.return.total_lbp || 0) || 0;
    const feeUsd = Number((detail.return as any).restocking_fee_usd || 0) || 0;
    const feeLbp = Number((detail.return as any).restocking_fee_lbp || 0) || 0;
    return { usd: totalUsd - feeUsd, lbp: totalLbp - feeLbp };
  }, [detail]);

  return (
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Sales</p>
            <h1 className="ui-module-title">Credit Notes</h1>
            <p className="ui-module-subtitle">Customer credit notes generated from credit-method returns.</p>
          </div>
          <div className="ui-module-actions">
            <Button variant="outline" onClick={load}>Refresh</Button>
          </div>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Credit Note Totals</CardTitle>
          <CardDescription>{creditNotes.length} credit note(s)</CardDescription>
        </CardHeader>
        <CardContent className="ui-metric-grid">
          <div className="ui-metric">
            <div className="ui-metric-label">Gross</div>
            <div className="ui-metric-value">{fmtUsdLbp(totals.grossUsd, totals.grossLbp)}</div>
          </div>
          <div className="ui-metric">
            <div className="ui-metric-label">Net Credit</div>
            <div className="ui-metric-value">{fmtUsdLbp(totals.netUsd, totals.netLbp)}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credit Notes</CardTitle>
          <CardDescription>Select a credit note to print or export.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <DataTable<ReturnRow>
                tableId="sales.credit_notes.list"
                rows={creditNotes}
                columns={columns}
                getRowId={(r) => r.id}
                onRowClick={(r) => setSelectedId(r.id)}
                rowClassName={(r) => (r.id === selectedId ? "bg-bg-sunken/20" : undefined)}
                initialSort={{ columnId: "date", dir: "desc" }}
                globalFilterPlaceholder="Search credit note / invoice / customer"
                emptyText="No credit notes."
              />
            </div>

            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Selected Credit Note</CardTitle>
                  <CardDescription>{detail ? `Status: ${detail.return.status}` : "Pick one from the list"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail ? (
                    <>
                      <div className="rounded-md border border-border-subtle bg-bg-sunken/25 p-3">
                        <div className="ui-kv">
                          <span className="ui-kv-label">Credit Note</span>
                          <span className="ui-kv-value data-mono">{detail.return.return_no || detail.return.id.slice(0, 8)}</span>
                        </div>
                        <div className="ui-kv mt-1">
                          <span className="ui-kv-label">Invoice</span>
                          <span className="ui-kv-value">
                            {detail.return.invoice_id ? (
                              <ShortcutLink href={`/sales/invoices/${encodeURIComponent(detail.return.invoice_id)}`} title="Open invoice" className="font-mono text-xs">
                                {invoiceById.get(detail.return.invoice_id)?.invoice_no || detail.return.invoice_id.slice(0, 8)}
                              </ShortcutLink>
                            ) : "-"}
                          </span>
                        </div>
                        <div className="ui-kv mt-1">
                          <span className="ui-kv-label">Net Credit</span>
                          <span className="ui-kv-value">{fmtUsdLbp(detailNet.usd, detailNet.lbp)}</span>
                        </div>
                        <div className="ui-kv mt-1">
                          <span className="ui-kv-label">Created</span>
                          <span className="ui-kv-value data-mono">{formatDateLike(detail.return.created_at)}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/sales/credit-notes/${encodeURIComponent(detail.return.id)}/print`} target="_blank" rel="noopener noreferrer">
                            Print
                          </Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <a href={`/exports/sales-credit-notes/${encodeURIComponent(detail.return.id)}/pdf`} target="_blank" rel="noopener noreferrer">
                            Download PDF
                          </a>
                        </Button>
                      </div>

                      <div className="rounded-md border border-border-subtle p-3 text-xs">
                        <div className="font-medium text-foreground">Refund Entries</div>
                        <div className="mt-2 space-y-1 text-fg-muted">
                          {detail.refunds.map((r) => (
                            <div key={r.id} className="flex items-center justify-between gap-2">
                              <span className="font-mono">{r.method}</span>
                              <span className="font-mono">{fmtUsdLbp(r.amount_usd, r.amount_lbp)}</span>
                            </div>
                          ))}
                          {detail.refunds.length === 0 ? <p>No refunds recorded.</p> : null}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-fg-muted">No selection.</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
