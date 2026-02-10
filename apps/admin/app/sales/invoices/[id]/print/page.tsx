"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

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

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

function sum<T>(arr: T[], f: (v: T) => number): number {
  let out = 0;
  for (const v of arr) out += f(v);
  return out;
}

export default function SalesInvoicePrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const det = await apiGet<InvoiceDetail>(`/sales/invoices/${id}`);
      setDetail(det);
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

  useEffect(() => {
    // Optional: allow kiosk-style auto print via ?autoprint=1.
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("autoprint") === "1") setTimeout(() => window.print(), 250);
    } catch {
      // ignore
    }
  }, []);

  const totals = useMemo(() => {
    const inv = detail?.invoice;
    const payments = detail?.payments || [];
    const paidUsd = sum(payments, (p) => Number(p.amount_usd || 0));
    const paidLbp = sum(payments, (p) => Number(p.amount_lbp || 0));
    const totalUsd = Number(inv?.total_usd || 0);
    const totalLbp = Number(inv?.total_lbp || 0);
    return {
      paidUsd,
      paidLbp,
      balUsd: totalUsd - paidUsd,
      balLbp: totalLbp - paidLbp
    };
  }, [detail]);

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/sales/invoices/${encodeURIComponent(id)}`}>Back</Link>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </Button>
            <Button onClick={() => window.print()}>Print / Save PDF</Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        {!detail ? (
          <div className="py-16 text-sm text-black/70">{loading ? "Loading..." : "No data."}</div>
        ) : (
          <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/15 pb-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Sales Invoice</h1>
                <p className="mt-1 font-mono text-xs text-black/70">
                  {detail.invoice.invoice_no || "(draft)"} · {detail.invoice.status}
                </p>
              </div>
              <div className="text-right text-xs text-black/70">
                <div className="font-mono">Inv {fmtIso(detail.invoice.invoice_date)}</div>
                <div className="font-mono">Due {fmtIso(detail.invoice.due_date)}</div>
              </div>
            </header>

            <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Customer</p>
                <p className="mt-1 text-sm font-medium">
                  {detail.invoice.customer_id ? detail.invoice.customer_name || detail.invoice.customer_id : "Walk-in"}
                </p>
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Warehouse</p>
                <p className="mt-1 text-sm font-medium">{detail.invoice.warehouse_name || detail.invoice.warehouse_id || "-"}</p>
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Currencies</p>
                <p className="mt-1 text-sm font-medium">
                  Pricing: <span className="font-mono">{detail.invoice.pricing_currency}</span>
                </p>
                <p className="text-sm font-medium">
                  Settlement: <span className="font-mono">{detail.invoice.settlement_currency}</span>
                </p>
              </div>
            </section>

            <section className="rounded-md border border-black/15">
              <div className="border-b border-black/10 px-4 py-3">
                <h2 className="text-sm font-semibold">Lines</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                    <tr>
                      <th className="px-4 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit USD</th>
                      <th className="px-3 py-2 text-right">Unit LL</th>
                      <th className="px-3 py-2 text-right">Total USD</th>
                      <th className="px-4 py-2 text-right">Total LL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.lines || []).map((l) => (
                      <tr key={l.id} className="border-t border-black/10 align-top">
                        <td className="px-4 py-2">
                          <div className="font-mono text-[11px] text-black/70">{l.item_sku || l.item_id}</div>
                          <div className="text-sm">{l.item_name || "-"}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">
                          {Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(l.unit_price_usd)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtLbp(l.unit_price_lbp)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(l.line_total_usd)}</td>
                        <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtLbp(l.line_total_lbp)}</td>
                      </tr>
                    ))}
                    {(detail.lines || []).length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-black/60" colSpan={6}>
                          No lines.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-md border border-black/15 p-3">
                <h2 className="text-sm font-semibold">Payments</h2>
                <div className="mt-2 space-y-1 text-xs text-black/70">
                  {(detail.payments || []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2">
                      <span className="font-mono">{p.method}</span>
                      <span className="font-mono">
                        {fmtUsd(p.amount_usd)} / {fmtLbp(p.amount_lbp)}
                      </span>
                    </div>
                  ))}
                  {(detail.payments || []).length === 0 ? <p className="text-black/60">No payments.</p> : null}
                </div>
              </div>

              <div className="rounded-md border border-black/15 p-3">
                <h2 className="text-sm font-semibold">Totals</h2>
                <div className="mt-2 space-y-1 text-xs text-black/70">
                  <div className="flex items-center justify-between gap-2">
                    <span>Subtotal</span>
                    <span className="font-mono">
                      {fmtUsd(detail.invoice.subtotal_usd ?? detail.invoice.total_usd)} / {fmtLbp(detail.invoice.subtotal_lbp ?? detail.invoice.total_lbp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Discount</span>
                    <span className="font-mono">
                      {fmtUsd(detail.invoice.discount_total_usd ?? 0)} / {fmtLbp(detail.invoice.discount_total_lbp ?? 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Total</span>
                    <span className="font-mono">
                      {fmtUsd(detail.invoice.total_usd)} / {fmtLbp(detail.invoice.total_lbp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Paid</span>
                    <span className="font-mono">
                      {fmtUsd(totals.paidUsd)} / {fmtLbp(totals.paidLbp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-2">
                    <span className="font-medium">Balance</span>
                    <span className="font-mono font-semibold">
                      {fmtUsd(totals.balUsd)} / {fmtLbp(totals.balLbp)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 border-t border-black/10 pt-3">
                  <h3 className="text-sm font-semibold">Tax</h3>
                  <div className="mt-2 space-y-1 text-xs text-black/70">
                    {(detail.tax_lines || []).map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{t.tax_code_id}</span>
                        <span className="font-mono">
                          {fmtUsd(t.tax_usd)} / {fmtLbp(t.tax_lbp)}
                        </span>
                      </div>
                    ))}
                    {(detail.tax_lines || []).length === 0 ? <p className="text-black/60">No tax lines.</p> : null}
                  </div>
                </div>
              </div>
            </section>

            <footer className="pt-2 text-[11px] text-black/60">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/15 pt-3">
                <span className="font-mono">Invoice ID: {detail.invoice.id}</span>
                <span className="font-mono">Generated: {new Date().toISOString().slice(0, 19).replace("T", " ")}</span>
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
