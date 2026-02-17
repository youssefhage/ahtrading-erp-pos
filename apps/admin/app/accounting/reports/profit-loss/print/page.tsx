"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { fmtLbp, fmtLbpMaybe, fmtUsd, fmtUsdMaybe } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

type PlRow = {
  account_code: string;
  name_en: string | null;
  kind: "revenue" | "expense";
  amount_usd: string | number;
  amount_lbp: string | number;
};

type PlRes = {
  start_date: string;
  end_date: string;
  revenue_usd: string | number;
  revenue_lbp: string | number;
  expense_usd: string | number;
  expense_lbp: string | number;
  net_profit_usd: string | number;
  net_profit_lbp: string | number;
  rows: PlRow[];
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function ProfitLossPrintInner() {
  const sp = useSearchParams();
  const startDate = sp.get("start_date") || monthStartIso();
  const endDate = sp.get("end_date") || todayIso();

  const [status, setStatus] = useState("");
  const [data, setData] = useState<PlRes | null>(null);

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("start_date", startDate);
    if (endDate) qs.set("end_date", endDate);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [startDate, endDate]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const res = await apiGet<PlRes>(`/reports/profit-loss${query}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [query]);

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

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/accounting/reports/profit-loss">Back</Link>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
            <Button onClick={() => window.print()}>Print / Save PDF</Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/15 pb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Profit &amp; Loss</h1>
            <p className="mt-1 text-xs text-black/70">
              Period:{" "}
              <span className="font-mono">
                {data?.start_date || startDate} → {data?.end_date || endDate}
              </span>
            </p>
          </div>
          <div className="text-right text-[11px] text-black/60">
            <div className="font-mono">Rows: {data?.rows?.length || 0}</div>
            <div className="font-mono">Generated: {formatDateTime(new Date())}</div>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-md border border-black/15 p-3">
            <p className="text-[11px] uppercase tracking-wider text-black/60">Revenue</p>
            <p className="mt-1 font-mono text-sm">{fmtUsdMaybe(data?.revenue_usd)}</p>
            <p className="font-mono text-sm">{fmtLbpMaybe(data?.revenue_lbp, { dashIfZero: Number(data?.revenue_usd || 0) !== 0 })}</p>
          </div>
          <div className="rounded-md border border-black/15 p-3">
            <p className="text-[11px] uppercase tracking-wider text-black/60">Expenses</p>
            <p className="mt-1 font-mono text-sm">{fmtUsdMaybe(data?.expense_usd)}</p>
            <p className="font-mono text-sm">{fmtLbpMaybe(data?.expense_lbp, { dashIfZero: Number(data?.expense_usd || 0) !== 0 })}</p>
          </div>
          <div className="rounded-md border border-black/15 p-3">
            <p className="text-[11px] uppercase tracking-wider text-black/60">Net Profit</p>
            <p className="mt-1 font-mono text-sm">{fmtUsdMaybe(data?.net_profit_usd)}</p>
            <p className="font-mono text-sm">{fmtLbpMaybe(data?.net_profit_lbp, { dashIfZero: Number(data?.net_profit_usd || 0) !== 0 })}</p>
          </div>
        </section>

        <div className="mt-4 rounded-md border border-black/15">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                <tr>
                  <th className="px-4 py-2 text-left">Kind</th>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-right">USD</th>
                  <th className="px-4 py-2 text-right">LL</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).map((r) => (
                  <tr key={`${r.kind}-${r.account_code}`} className="border-t border-black/10">
                    <td className="px-4 py-2 text-[11px] text-black/70">{r.kind}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.account_code}</td>
                    <td className="px-3 py-2 text-sm">{r.name_en || "-"}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(r.amount_usd)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtLbp(r.amount_lbp)}</td>
                  </tr>
                ))}
                {(data?.rows || []).length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-black/60" colSpan={5}>
                      No rows.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProfitLossPrintPage() {
  return (
    <Suspense fallback={<div className="print-paper min-h-screen px-4 py-10 text-sm text-black/70">Loading...</div>}>
      <ProfitLossPrintInner />
    </Suspense>
  );
}
