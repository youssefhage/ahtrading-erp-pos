"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

type TrialRow = {
  account_code: string;
  name_en: string | null;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
};

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: string | number, frac = 2) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

export default function TrialBalancePrintPage() {
  const [rows, setRows] = useState<TrialRow[]>([]);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setStatus("");
    try {
      const res = await apiGet<{ trial_balance: TrialRow[] }>("/reports/trial-balance");
      setRows(res.trial_balance || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

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

  const totals = useMemo(() => {
    let drUsd = 0;
    let crUsd = 0;
    let drLbp = 0;
    let crLbp = 0;
    for (const r of rows) {
      drUsd += toNum(r.debit_usd);
      crUsd += toNum(r.credit_usd);
      drLbp += toNum(r.debit_lbp);
      crLbp += toNum(r.credit_lbp);
    }
    return { drUsd, crUsd, drLbp, crLbp };
  }, [rows]);

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/accounting/reports/trial-balance">Back</Link>
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
            <h1 className="text-xl font-semibold tracking-tight">Trial Balance</h1>
            <p className="mt-1 text-xs text-black/70">Aggregated from GL entries.</p>
          </div>
          <div className="text-right text-[11px] text-black/60">
            <div className="font-mono">Accounts: {rows.length}</div>
            <div className="font-mono">Generated: {formatDateTime(new Date())}</div>
          </div>
        </header>

        <div className="mt-4 rounded-md border border-black/15">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                <tr>
                  <th className="px-4 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-right">Debit USD</th>
                  <th className="px-3 py-2 text-right">Credit USD</th>
                  <th className="px-3 py-2 text-right">Debit LL</th>
                  <th className="px-4 py-2 text-right">Credit LL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.account_code} className="border-t border-black/10">
                    <td className="px-4 py-2 font-mono text-[11px]">{r.account_code}</td>
                    <td className="px-3 py-2 text-sm">{r.name_en || ""}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmt(r.debit_usd, 2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmt(r.credit_usd, 2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmt(r.debit_lbp, 0)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[11px]">{fmt(r.credit_lbp, 0)}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-black/60" colSpan={6}>
                      No GL entries yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/20 bg-black/[0.02]">
                  <td className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-black/60" colSpan={2}>
                    Totals
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] font-semibold">{fmt(totals.drUsd, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] font-semibold">{fmt(totals.crUsd, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] font-semibold">{fmt(totals.drLbp, 0)}</td>
                  <td className="px-4 py-2 text-right font-mono text-[11px] font-semibold">{fmt(totals.crLbp, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
