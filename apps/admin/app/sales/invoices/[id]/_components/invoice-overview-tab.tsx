"use client";

import Link from "next/link";

import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { formatDateLike } from "@/lib/datetime";
import { ConfirmButton } from "@/components/confirm-button";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

function n(v: unknown) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

function fmtIso(iso?: string | null) {
  return formatDateLike(iso);
}

function formatMethodLabel(method: string) {
  const s = String(method || "").trim();
  if (!s) return "";
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hasTender(p: { tender_usd?: unknown; tender_lbp?: unknown }) {
  return n(p.tender_usd) !== 0 || n(p.tender_lbp) !== 0;
}

export type SalesOverview = {
  paidUsd: number;
  paidLbp: number;
  tenderUsd: number;
  tenderLbp: number;
  hasAnyTender: boolean;
  vatUsd: number;
  vatLbp: number;
  totalUsd: number;
  totalLbp: number;
  settle: string;
  balUsd: number;
  balLbp: number;
  subUsd: number;
  subLbp: number;
  discUsd: number;
  discLbp: number;
  rate: number;
  primaryTotal: number;
  primaryPaid: number;
  primaryBal: number;
  secondaryTotal: number;
  secondaryPaid: number;
  secondaryBal: number;
  primaryFmt: (v: number) => string;
  secondaryFmt: (v: number) => string;
  primaryTone: string;
};

export type CustomerAccountOverviewData = {
  hasCustomer: boolean;
  hasBalance: boolean;
  overallUsd: number;
  overallLbp: number;
  excludingInvoiceUsd: number;
  excludingInvoiceLbp: number;
  includingInvoiceUsd: number;
  includingInvoiceLbp: number;
  invoiceIncludedNow: boolean;
};

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  sales_channel?: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate: string | number;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  settlement_currency: string;
  receipt_no?: string | null;
  invoice_date?: string;
  due_date?: string | null;
  created_at: string;
};

type SalesPayment = {
  id: string;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  tender_usd?: string | number | null;
  tender_lbp?: string | number | null;
  created_at: string;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  base_usd: string | number;
  base_lbp: string | number;
  tax_usd: string | number;
  tax_lbp: string | number;
};

export interface InvoiceOverviewTabProps {
  invoice: InvoiceRow;
  payments: SalesPayment[];
  taxLines: TaxLine[];
  salesOverview: SalesOverview;
  customerAccountOverview: CustomerAccountOverviewData | null;
  invoiceMathOpen: boolean;
  onInvoiceMathToggle: (open: boolean) => void;
  onRecomputePayment: (paymentId: string) => void;
  onVoidPayment: (paymentId: string) => void;
  onError: (msg: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function InvoiceOverviewTab({
  invoice,
  payments,
  taxLines,
  salesOverview,
  customerAccountOverview,
  invoiceMathOpen,
  onInvoiceMathToggle,
  onRecomputePayment,
  onVoidPayment,
  onError,
}: InvoiceOverviewTabProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      {/* Left column: customer, dates, document */}
      <div className="space-y-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-[220px]">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Customer</p>
                <p className="mt-1 text-lg font-semibold text-foreground leading-tight">
                  {invoice.customer_id ? (
                    <ShortcutLink href={`/partners/customers/${encodeURIComponent(invoice.customer_id)}`} title="Open customer">
                      {invoice.customer_name || invoice.customer_id}
                    </ShortcutLink>
                  ) : (
                    "Walk-in"
                  )}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Created{" "}
                  <span className="data-mono">{formatDateLike(invoice.created_at)}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs">
                  <span className="text-muted-foreground">Warehouse</span>
                  <span className="data-mono text-foreground">{invoice.warehouse_name || invoice.warehouse_id || "-"}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs">
                  <span className="text-muted-foreground">Settle</span>
                  <span className="data-mono text-foreground">{salesOverview.settle}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs">
                  <span className="text-muted-foreground">Rate</span>
                  <span className="data-mono text-foreground">{salesOverview.rate ? salesOverview.rate.toLocaleString("en-US") : "-"}</span>
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/25 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Dates</p>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Invoice</span>
                    <span className="text-sm font-medium">{fmtIso(invoice.invoice_date)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Due</span>
                    <span className="text-sm font-medium">{fmtIso(invoice.due_date)}</span>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/25 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Document</p>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Invoice No</span>
                    <span className="text-sm font-medium">{invoice.invoice_no || "(draft)"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Receipt</span>
                    <span className="text-sm font-medium">{invoice.receipt_no || "-"}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right column: NOW panel, payments, customer account */}
      <div className="space-y-4">
        {/* NOW Panel */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="rounded-lg border bg-muted/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Now</p>
                  <p className="mt-1 text-xs text-muted-foreground">What needs action on this invoice.</p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${salesOverview.primaryBal > 0 ? "bg-warning/15 text-warning" : "bg-success/20 text-success"}`}
                >
                  {salesOverview.primaryBal > 0 ? "Open balance" : "Settled"}
                </span>
              </div>

              <div className={`data-mono mt-3 text-3xl font-semibold leading-none ${salesOverview.primaryTone}`}>
                {salesOverview.primaryFmt(salesOverview.primaryBal)}
              </div>

              <div className="mt-3">
                {invoice.status === "posted" ? (
                  <Button asChild className="w-full">
                    <Link href={`/sales/payments?invoice_id=${encodeURIComponent(invoice.id)}&record=1`}>
                      Record Payment
                    </Link>
                  </Button>
                ) : (
                  <Button className="w-full" disabled>
                    Record Payment
                  </Button>
                )}
              </div>

              {invoice.status !== "posted" ? (
                <p className="mt-2 text-xs text-muted-foreground">Post the invoice first to record payments.</p>
              ) : null}

              <details
                className="mt-3 rounded-lg border bg-card/40 p-2.5"
                open={invoiceMathOpen}
                onToggle={(e) => onInvoiceMathToggle((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Invoice math</summary>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Settlement currency</span>
                    <span className="text-sm font-medium">{salesOverview.settle}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Amount due</span>
                    <span className="text-sm font-medium">{salesOverview.primaryFmt(salesOverview.primaryBal)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Amount due (other)</span>
                    <span className="text-sm font-medium">{salesOverview.secondaryFmt(salesOverview.secondaryBal)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Invoice total</span>
                    <span className="text-sm font-medium">{salesOverview.primaryFmt(salesOverview.primaryTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Applied</span>
                    <span className="text-sm font-medium">{salesOverview.primaryFmt(salesOverview.primaryPaid)}</span>
                  </div>
                  {salesOverview.hasAnyTender ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">Amount received</span>
                      <span className="text-sm font-medium">
                        {salesOverview.settle === "LBP" ? fmtLbp(salesOverview.tenderLbp) : fmtUsd(salesOverview.tenderUsd)}
                      </span>
                    </div>
                  ) : null}
                  {taxLines.length > 0 ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">VAT</span>
                      <span className="text-sm font-medium">
                        {salesOverview.settle === "LBP" ? fmtLbp(salesOverview.vatLbp) : fmtUsd(salesOverview.vatUsd)}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Subtotal</span>
                    <span className="text-sm font-medium">
                      {salesOverview.settle === "LBP" ? fmtLbp(salesOverview.subLbp) : fmtUsd(salesOverview.subUsd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Discount</span>
                    <span className="text-sm font-medium">
                      {salesOverview.settle === "LBP" ? fmtLbp(salesOverview.discLbp) : fmtUsd(salesOverview.discUsd)}
                    </span>
                  </div>
                </div>
              </details>
            </div>

            {/* Money Movement / Payments */}
            <div className="rounded-lg border bg-muted/25 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Money Movement</p>
              <p className="mt-1 text-xs text-muted-foreground">Payments already applied to this invoice.</p>

              <div className="mt-2 max-h-56 space-y-2 overflow-auto pr-1">
                {payments.map((p) => (
                  <div key={p.id} className="rounded-md border bg-card/50 px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="data-mono text-sm text-foreground">{formatMethodLabel(p.method)}</span>
                      <span className="data-mono text-xs text-right text-foreground">
                        {salesOverview.settle === "LBP" ? fmtLbp(n(p.amount_lbp)) : fmtUsd(n(p.amount_usd))}
                      </span>
                    </div>
                    {hasTender(p) ? (
                      <div className="mt-1 data-mono text-xs text-muted-foreground">
                        Received {salesOverview.settle === "LBP" ? fmtLbp(n(p.tender_lbp)) : fmtUsd(n(p.tender_usd))}
                      </div>
                    ) : null}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Actions</summary>
                      <div className="mt-2 flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => onRecomputePayment(p.id)}>
                          Fix
                        </Button>
                        <ConfirmButton
                          variant="destructive"
                          size="sm"
                          title="Void Payment?"
                          description="This will create a reversing GL entry."
                          confirmText="Void"
                          confirmVariant="destructive"
                          onError={(err) => onError(err instanceof Error ? err.message : String(err))}
                          onConfirm={() => onVoidPayment(p.id)}
                        >
                          Void
                        </ConfirmButton>
                      </div>
                    </details>
                  </div>
                ))}
                {payments.length === 0 ? <p className="text-xs text-muted-foreground">No payments yet.</p> : null}
              </div>
            </div>

            {/* Customer Account Context */}
            <details className="rounded-lg border bg-muted/25 p-3">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Customer Account Context
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">All open invoices/credits, including unapplied payments.</p>
              {customerAccountOverview?.hasBalance ? (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-2 font-medium">
                    <span className="text-sm text-muted-foreground">Account balance (overall)</span>
                    <span className="text-sm font-medium">
                      {fmtUsdLbp(customerAccountOverview.overallUsd, customerAccountOverview.overallLbp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-sm text-muted-foreground">Excluding this invoice</span>
                    <span className="text-sm font-medium">
                      {fmtUsdLbp(customerAccountOverview.excludingInvoiceUsd, customerAccountOverview.excludingInvoiceLbp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-sm text-muted-foreground">
                      {customerAccountOverview.invoiceIncludedNow ? "Including this invoice (current)" : "Including this invoice (once posted)"}
                    </span>
                    <span className="text-sm font-medium">
                      {fmtUsdLbp(customerAccountOverview.includingInvoiceUsd, customerAccountOverview.includingInvoiceLbp)}
                    </span>
                  </div>
                </div>
              ) : customerAccountOverview?.hasCustomer ? (
                <p className="mt-2 text-xs text-muted-foreground">Customer account balance unavailable.</p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">No customer selected for this invoice.</p>
              )}
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
