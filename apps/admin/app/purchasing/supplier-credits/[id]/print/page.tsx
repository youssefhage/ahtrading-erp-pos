"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { fmtLbp, fmtLbpMaybe, fmtUsd, fmtUsdLbp, fmtUsdMaybe } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

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

type LineRow = {
  id: string;
  line_no: number | string;
  description: string | null;
  amount_usd: string | number;
  amount_lbp: string | number;
};

type AppRow = {
  id: string;
  supplier_invoice_id: string;
  invoice_no: string;
  invoice_date: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  created_at: string;
};

type AllocRow = {
  id: string;
  goods_receipt_line_id: string;
  batch_id: string | null;
  amount_usd: string | number;
  amount_lbp: string | number;
  created_at: string;
};

type DetailRes = { credit: CreditDoc; lines: LineRow[]; applications: AppRow[]; allocations: AllocRow[] };

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

export default function SupplierCreditPrintPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DetailRes | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await apiGet<DetailRes>(`/purchases/credits/${encodeURIComponent(id)}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setData(null);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    applyPrintSettingsFromQuery();
    // Optional: allow kiosk-style auto print via ?autoprint=1.
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("autoprint") === "1") setTimeout(() => window.print(), 250);
    } catch {
      // ignore
    }
  }, []);

  const credit = data?.credit || null;
  const lines = data?.lines || [];
  const allocs = data?.allocations || [];

  const appliedTotals = useMemo(() => {
    const apps = data?.applications || [];
    let usd = 0;
    let lbp = 0;
    for (const a of apps) {
      usd += toNum(a.amount_usd);
      lbp += toNum(a.amount_lbp);
    }
    return { usd, lbp };
  }, [data?.applications]);

  const remaining = useMemo(() => {
    const totalUsd = toNum(credit?.total_usd);
    const totalLbp = toNum(credit?.total_lbp);
    return { usd: totalUsd - appliedTotals.usd, lbp: totalLbp - appliedTotals.lbp };
  }, [credit?.total_usd, credit?.total_lbp, appliedTotals.usd, appliedTotals.lbp]);

  const apps = data?.applications || [];

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/purchasing/supplier-credits/${encodeURIComponent(id)}`}>Back</Link>
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

        {!data || !credit ? (
          <div className="py-16 text-sm text-black/70">{loading ? "Loading..." : "No data."}</div>
        ) : (
          <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/15 pb-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Supplier Credit</h1>
                <p className="mt-1 font-mono text-xs text-black/70">
                  {credit.credit_no} · {credit.status} · {credit.kind}
                </p>
              </div>
              <div className="text-right text-xs text-black/70">
                <div className="font-mono">Date {fmtIso(credit.credit_date)}</div>
                <div className="font-mono">
                  Rate {credit.rate_type} @ {String(credit.exchange_rate ?? "")}
                </div>
              </div>
            </header>

            <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Supplier</p>
                <p className="mt-1 text-sm font-medium">{credit.supplier_name || credit.supplier_id}</p>
                {credit.goods_receipt_id ? (
                  <p className="mt-1 font-mono text-[11px] text-black/70">
                    Receipt: {credit.goods_receipt_no || credit.goods_receipt_id}
                  </p>
                ) : null}
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Totals</p>
                <p className="mt-1 font-mono text-sm">{fmtUsdMaybe(credit.total_usd)}</p>
                <p className="font-mono text-sm">{fmtLbpMaybe(credit.total_lbp, { dashIfZero: toNum(credit.total_usd) !== 0 })}</p>
              </div>
              <div className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Applied / Remaining</p>
                <p className="mt-1 font-mono text-[11px] text-black/70">
                  Applied: {fmtUsdLbp(appliedTotals.usd, appliedTotals.lbp)}
                </p>
                <p className="font-mono text-sm">
                  Remaining: {fmtUsdLbp(remaining.usd, remaining.lbp)}
                </p>
              </div>
            </section>

            {credit.memo ? (
              <section className="rounded-md border border-black/15 p-3">
                <p className="text-[11px] uppercase tracking-wider text-black/60">Memo</p>
                <p className="mt-1 text-sm">{credit.memo}</p>
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
                      <th className="px-4 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-right">USD</th>
                      <th className="px-4 py-2 text-right">LL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-t border-black/10 align-top">
                        <td className="px-4 py-2 font-mono text-[11px]">{String(l.line_no)}</td>
                        <td className="px-3 py-2 text-sm">{l.description || "-"}</td>
                        <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(l.amount_usd)}</td>
                        <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtLbp(l.amount_lbp)}</td>
                      </tr>
                    ))}
                    {lines.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-black/60" colSpan={4}>
                          No items.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-md border border-black/15">
                <div className="border-b border-black/10 px-4 py-3">
                  <h2 className="text-sm font-semibold">Applications</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                      <tr>
                        <th className="px-4 py-2 text-left">Invoice</th>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-right">USD</th>
                        <th className="px-4 py-2 text-right">LL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apps.map((a) => (
                        <tr key={a.id} className="border-t border-black/10">
                          <td className="px-4 py-2">
                            <div className="font-mono text-[11px] text-black/70">{a.invoice_no}</div>
                            <div className="font-mono text-[11px] text-black/60">{a.supplier_invoice_id}</div>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px]">{fmtIso(a.invoice_date)}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(a.amount_usd)}</td>
                          <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtLbp(a.amount_lbp)}</td>
                        </tr>
                      ))}
                      {apps.length === 0 ? (
                        <tr>
                          <td className="px-4 py-8 text-center text-black/60" colSpan={4}>
                            No applications.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-md border border-black/15">
                <div className="border-b border-black/10 px-4 py-3">
                  <h2 className="text-sm font-semibold">Allocations</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                      <tr>
                        <th className="px-4 py-2 text-left">GR Line</th>
                        <th className="px-3 py-2 text-left">Batch</th>
                        <th className="px-3 py-2 text-right">USD</th>
                        <th className="px-4 py-2 text-right">LL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocs.map((a) => (
                        <tr key={a.id} className="border-t border-black/10">
                          <td className="px-4 py-2 font-mono text-[11px]">{a.goods_receipt_line_id}</td>
                          <td className="px-3 py-2 font-mono text-[11px]">{a.batch_id || "-"}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(a.amount_usd)}</td>
                          <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtLbp(a.amount_lbp)}</td>
                        </tr>
                      ))}
                      {allocs.length === 0 ? (
                        <tr>
                          <td className="px-4 py-8 text-center text-black/60" colSpan={4}>
                            No allocations.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <footer className="pt-2 text-[11px] text-black/60">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/15 pt-3">
                <span className="font-mono">Credit ID: {credit.id}</span>
                <span className="font-mono">Generated: {new Date().toISOString().slice(0, 19).replace("T", " ")}</span>
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
