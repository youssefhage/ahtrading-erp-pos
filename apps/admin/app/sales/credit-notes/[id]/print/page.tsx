"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

type ReturnRow = {
  id: string;
  return_no: string | null;
  invoice_id: string | null;
  refund_method: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate: string | number;
  restocking_fee_usd?: string | number;
  restocking_fee_lbp?: string | number;
  restocking_fee_reason?: string | null;
  created_at: string;
};

type ReturnLine = {
  id: string;
  item_id: string;
  qty: string | number;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  base_usd: string | number;
  base_lbp: string | number;
  tax_usd: string | number;
  tax_lbp: string | number;
};

type ReturnDetail = {
  return: ReturnRow;
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

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
};

function lc(v: unknown) {
  return String(v || "").trim().toLowerCase();
}

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

export default function SalesCreditNotePrintPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ReturnDetail | null>(null);
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const det = await apiGet<ReturnDetail>(`/sales/returns/${encodeURIComponent(id)}`);
      const isCredit =
        lc(det.return.refund_method) === "credit" ||
        (det.refunds || []).some((rf) => lc(rf.method) === "credit");
      if (!isCredit) {
        throw new Error("This return is not a credit note.");
      }
      setDetail(det);
      if (det.return.invoice_id) {
        const inv = await apiGet<{ invoice: InvoiceRow }>(`/sales/invoices/${encodeURIComponent(det.return.invoice_id)}`).catch(() => null);
        setInvoice(inv?.invoice || null);
      } else {
        setInvoice(null);
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetail(null);
      setInvoice(null);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    applyPrintSettingsFromQuery({ paper: "a4" });
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("autoprint") === "1") setTimeout(() => window.print(), 250);
    } catch {
      // ignore
    }
  }, []);

  const net = useMemo(() => {
    const totalUsd = Number(detail?.return.total_usd || 0) || 0;
    const totalLbp = Number(detail?.return.total_lbp || 0) || 0;
    const feeUsd = Number(detail?.return.restocking_fee_usd || 0) || 0;
    const feeLbp = Number(detail?.return.restocking_fee_lbp || 0) || 0;
    return { usd: totalUsd - feeUsd, lbp: totalLbp - feeLbp, feeUsd, feeLbp };
  }, [detail?.return.restocking_fee_lbp, detail?.return.restocking_fee_usd, detail?.return.total_lbp, detail?.return.total_usd]);

  const taxTotal = useMemo(() => {
    const taxes = detail?.tax_lines || [];
    let usd = 0;
    let lbp = 0;
    for (const t of taxes) {
      usd += Number(t.tax_usd || 0) || 0;
      lbp += Number(t.tax_lbp || 0) || 0;
    }
    return { usd, lbp };
  }, [detail?.tax_lines]);

  const methodLabel = useMemo(() => {
    if (!detail) return "credit";
    const fromReturn = String(detail.return.refund_method || "").trim();
    if (fromReturn) return fromReturn;
    const methods = Array.from(new Set((detail.refunds || []).map((r) => String(r.method || "").trim()).filter(Boolean)));
    return methods.length ? methods.join(", ") : "credit";
  }, [detail]);

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/sales/credit-notes">Back</Link>
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

      <div className="mx-auto max-w-5xl px-4 py-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        {!detail ? (
          <div className="py-16 text-sm text-black/70">{loading ? "Loading..." : "No data."}</div>
        ) : (
          <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/15 pb-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Sales Credit Note</h1>
                <p className="mt-1 font-mono text-xs text-black/70">
                  {detail.return.return_no || detail.return.id} · {detail.return.status}
                </p>
              </div>
              <div className="text-right text-xs text-black/70">
                <div className="font-mono">Date {fmtIso(detail.return.created_at)}</div>
                <div className="font-mono">Method {methodLabel}</div>
              </div>
            </header>

            <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Customer</p>
                <p className="mt-1 text-sm font-medium">{invoice?.customer_name || invoice?.customer_id || "-"}</p>
                <p className="mt-1 font-mono text-[11px] text-black/70">Invoice: {invoice?.invoice_no || detail.return.invoice_id || "-"}</p>
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Net Credit</p>
                <p className="mt-1 font-mono text-sm">{fmtUsd(net.usd)}</p>
                <p className="font-mono text-sm">{fmtLbp(net.lbp)}</p>
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Tax Impact</p>
                <p className="mt-1 font-mono text-sm">{fmtUsd(taxTotal.usd)}</p>
                <p className="font-mono text-sm">{fmtLbp(taxTotal.lbp)}</p>
              </div>
            </section>

            {(net.feeUsd !== 0 || net.feeLbp !== 0) ? (
              <section className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Restocking Fee</p>
                <p className="mt-1 text-sm font-mono">{fmtUsdLbp(net.feeUsd, net.feeLbp)}</p>
                {detail.return.restocking_fee_reason ? <p className="mt-1 text-xs text-black/60">Reason: {detail.return.restocking_fee_reason}</p> : null}
              </section>
            ) : null}

            <section className="rounded-md border border-black/15">
              <div className="border-b border-black/10 px-4 py-3">
                <h2 className="text-sm font-semibold">Items</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                    <tr>
                      <th className="px-4 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit USD</th>
                      <th className="px-3 py-2 text-right">Total USD</th>
                      <th className="px-4 py-2 text-right">Total LL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.lines || []).map((l) => (
                      <tr key={l.id} className="border-t border-black/10">
                        <td className="px-4 py-2 font-mono text-[11px]">{l.item_id}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">
                          {Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(l.unit_price_usd)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(l.line_total_usd)}</td>
                        <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtLbp(l.line_total_lbp)}</td>
                      </tr>
                    ))}
                    {(detail.lines || []).length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-black/60" colSpan={5}>No lines.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-md border border-black/15 p-3">
                <h2 className="text-sm font-semibold">Refund Entries</h2>
                <div className="mt-2 space-y-1 text-xs text-black/70">
                  {(detail.refunds || []).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2">
                      <span className="font-mono">{r.method}</span>
                      <span className="font-mono">{fmtUsdLbp(r.amount_usd, r.amount_lbp)}</span>
                    </div>
                  ))}
                  {(detail.refunds || []).length === 0 ? <p className="text-black/60">No refund rows.</p> : null}
                </div>
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <h2 className="text-sm font-semibold">Summary</h2>
                <div className="mt-2 space-y-1 text-xs text-black/70">
                  <div className="flex items-center justify-between gap-2">
                    <span>Gross Return</span>
                    <span className="font-mono">{fmtUsdLbp(detail.return.total_usd, detail.return.total_lbp)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Tax</span>
                    <span className="font-mono">{fmtUsdLbp(taxTotal.usd, taxTotal.lbp)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-2">
                    <span className="font-medium">Net Credit</span>
                    <span className="font-mono font-semibold">{fmtUsdLbp(net.usd, net.lbp)}</span>
                  </div>
                </div>
              </div>
            </section>

            <footer className="pt-2 text-[11px] text-black/60">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/15 pt-3">
                <span className="font-mono">Credit Note ID: {detail.return.id}</span>
                <span className="font-mono">Generated: {formatDateTime(new Date())}</span>
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
