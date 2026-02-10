"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

type GlRow = {
  journal_date: string;
  journal_no: string;
  account_code: string;
  name_en: string | null;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
  memo: string | null;
};

function fmt(n: string | number, frac = 2) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

function GeneralLedgerPrintInner() {
  const sp = useSearchParams();
  const startDate = sp.get("start_date") || "";
  const endDate = sp.get("end_date") || "";

  const [rows, setRows] = useState<GlRow[]>([]);
  const [status, setStatus] = useState("");

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
      const res = await apiGet<{ gl: GlRow[] }>(`/reports/gl${query}`);
      setRows(res.gl || []);
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
    // Optional: allow kiosk-style auto print via ?autoprint=1.
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("autoprint") === "1") setTimeout(() => window.print(), 250);
    } catch {
      // ignore
    }
  }, []);

  const periodLabel = startDate || endDate ? `${startDate || "…"} → ${endDate || "…"}`
    : "All dates";

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/accounting/reports/general-ledger">Back</Link>
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
            <h1 className="text-xl font-semibold tracking-tight">General Ledger</h1>
            <p className="mt-1 text-xs text-black/70">
              Period: <span className="font-mono">{periodLabel}</span>
            </p>
          </div>
          <div className="text-right text-[11px] text-black/60">
            <div className="font-mono">Rows: {rows.length}</div>
            <div className="font-mono">Generated: {new Date().toISOString().slice(0, 19).replace("T", " ")}</div>
          </div>
        </header>

        <div className="mt-4 rounded-md border border-black/15">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Journal</th>
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-right">Dr USD</th>
                  <th className="px-3 py-2 text-right">Cr USD</th>
                  <th className="px-3 py-2 text-right">Dr LL</th>
                  <th className="px-3 py-2 text-right">Cr LL</th>
                  <th className="px-4 py-2 text-left">Memo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.journal_no}:${r.account_code}:${idx}`} className="border-t border-black/10 align-top">
                    <td className="px-4 py-2 font-mono text-[11px]">{String(r.journal_date)}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.journal_no}</td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-[11px]">{r.account_code}</div>
                      <div className="text-sm">{r.name_en || ""}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmt(r.debit_usd, 2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmt(r.credit_usd, 2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmt(r.debit_lbp, 0)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmt(r.credit_lbp, 0)}</td>
                    <td className="px-4 py-2 text-sm">{r.memo || ""}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-black/60" colSpan={8}>
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

export default function GeneralLedgerPrintPage() {
  return (
    <Suspense fallback={<div className="print-paper min-h-screen px-4 py-10 text-sm text-black/70">Loading...</div>}>
      <GeneralLedgerPrintInner />
    </Suspense>
  );
}
