"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
import { applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

type VatRow = {
  tax_code_id: string;
  tax_name: string;
  period: string;
  base_lbp: string | number;
  tax_lbp: string | number;
};

function fmtLbp(v: string | number) {
  return Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function VatReportPrintPage() {
  const [rows, setRows] = useState<VatRow[]>([]);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ vat: VatRow[] }>("/reports/vat");
      setRows(res.vat || []);
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

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/accounting/reports/vat">Back</Link>
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

      <div className="mx-auto max-w-5xl px-4 py-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/15 pb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">VAT Report (LBP)</h1>
            <p className="mt-1 text-xs text-black/70">Monthly VAT aggregated from tax lines.</p>
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
                  <th className="px-4 py-2 text-left">Period</th>
                  <th className="px-3 py-2 text-left">Tax</th>
                  <th className="px-3 py-2 text-right">Base (LBP)</th>
                  <th className="px-4 py-2 text-right">VAT (LBP)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.tax_code_id}:${r.period}:${idx}`} className="border-t border-black/10">
                    <td className="px-4 py-2 font-mono text-[11px]">{r.period}</td>
                    <td className="px-3 py-2 text-sm">{r.tax_name}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtLbp(r.base_lbp)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtLbp(r.tax_lbp)}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-black/60" colSpan={4}>
                      No VAT rows yet.
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
