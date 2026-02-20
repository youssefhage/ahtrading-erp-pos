"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

type BsRow = {
  account_code: string;
  name_en: string | null;
  normal_balance: string;
  balance_usd: string | number;
  balance_lbp: string | number;
};

type BsRes = { as_of: string; rows: BsRow[] };

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmt(n: string | number, frac = 2) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

function splitBalanceByNormal(normalBalance: string | null | undefined, value: string | number) {
  const n = Number(value || 0);
  const isCredit = String(normalBalance || "").toLowerCase() === "credit";
  if (isCredit) return n >= 0 ? { debit: 0, credit: n } : { debit: Math.abs(n), credit: 0 };
  return n >= 0 ? { debit: n, credit: 0 } : { debit: 0, credit: Math.abs(n) };
}

function BalanceSheetPrintInner() {
  const sp = useSearchParams();
  const asOf = sp.get("as_of") || todayIso();

  const [status, setStatus] = useState("");
  const [data, setData] = useState<BsRes | null>(null);

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (asOf) qs.set("as_of", asOf);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [asOf]);

  const load = useCallback(async () => {
    setStatus("");
    try {
      const res = await apiGet<BsRes>(`/reports/balance-sheet${query}`);
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
              <Link href="/accounting/reports/balance-sheet">Back</Link>
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
            <h1 className="text-xl font-semibold tracking-tight">Balance Sheet</h1>
            <p className="mt-1 text-xs text-black/70">
              As of: <span className="font-mono">{data?.as_of || asOf}</span>
            </p>
          </div>
          <div className="text-right text-[11px] text-black/60">
            <div className="font-mono">Accounts: {data?.rows?.length || 0}</div>
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
                  <th className="px-3 py-2 text-left">Normal</th>
                  <th className="px-3 py-2 text-right">Debit USD</th>
                  <th className="px-3 py-2 text-right">Credit USD</th>
                  <th className="px-3 py-2 text-right">Debit LL</th>
                  <th className="px-4 py-2 text-right">Credit LL</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).map((r) => (
                  <tr key={r.account_code} className="border-t border-black/10">
                    <td className="px-4 py-2 font-mono text-[11px]">{r.account_code}</td>
                    <td className="px-3 py-2 text-sm">{r.name_en || "-"}</td>
                    <td className="px-3 py-2 text-[11px] text-black/70">{r.normal_balance}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmt(splitBalanceByNormal(r.normal_balance, r.balance_usd).debit, 2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmt(splitBalanceByNormal(r.normal_balance, r.balance_usd).credit, 2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmt(splitBalanceByNormal(r.normal_balance, r.balance_lbp).debit, 0)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[11px]">{fmt(splitBalanceByNormal(r.normal_balance, r.balance_lbp).credit, 0)}</td>
                  </tr>
                ))}
                {(data?.rows || []).length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-black/60" colSpan={7}>
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

export default function BalanceSheetPrintPage() {
  return (
    <Suspense fallback={<div className="print-paper min-h-screen px-4 py-10 text-sm text-black/70">Loading...</div>}>
      <BalanceSheetPrintInner />
    </Suspense>
  );
}
