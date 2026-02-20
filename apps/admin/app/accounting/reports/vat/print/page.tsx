"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { fmtLbp } from "@/lib/money";
import { applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

type VatRow = {
  tax_code_id: string;
  tax_name: string;
  period: string;
  direction: "output" | "input" | "other";
  direction_label: string;
  base_lbp: string | number;
  tax_lbp: string | number;
  line_count: number;
  source_types: string[];
};

type VatSummary = {
  output_base_lbp: string | number;
  output_tax_lbp: string | number;
  input_base_lbp: string | number;
  input_tax_lbp: string | number;
  net_tax_lbp: string | number;
  other_base_lbp: string | number;
  other_tax_lbp: string | number;
  rows_count: number;
};

type VatRes = {
  start_date?: string | null;
  end_date?: string | null;
  summary: VatSummary;
  vat: VatRow[];
};

function n(v: unknown) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

function VatReportPrintInner() {
  const sp = useSearchParams();
  const startDate = sp.get("start_date") || "";
  const endDate = sp.get("end_date") || "";

  const [rows, setRows] = useState<VatRow[]>([]);
  const [summary, setSummary] = useState<VatSummary | null>(null);
  const [status, setStatus] = useState("");

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("start_date", startDate);
    if (endDate) qs.set("end_date", endDate);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [endDate, startDate]);

  const load = useCallback(async () => {
    setStatus("");
    try {
      const res = await apiGet<VatRes>(`/reports/vat${query}`);
      setRows(res.vat || []);
      setSummary(
        res.summary || {
          output_base_lbp: 0,
          output_tax_lbp: 0,
          input_base_lbp: 0,
          input_tax_lbp: 0,
          net_tax_lbp: 0,
          other_base_lbp: 0,
          other_tax_lbp: 0,
          rows_count: 0,
        }
      );
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
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/accounting/reports/vat${query}`}>Back</Link>
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
            <h1 className="text-xl font-semibold tracking-tight">VAT Filing View (LBP)</h1>
            <p className="mt-1 text-xs text-black/70">
              Period: <span className="font-mono">{startDate || "all"} → {endDate || "all"}</span>
            </p>
          </div>
          <div className="text-right text-[11px] text-black/60">
            <div className="font-mono">Rows: {rows.length}</div>
            <div className="font-mono">Generated: {formatDateTime(new Date())}</div>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-md border border-black/15 p-3">
            <p className="text-[11px] uppercase tracking-wider text-black/60">Output VAT (Sales)</p>
            <p className="mt-1 font-mono text-sm">{fmtLbp(summary?.output_tax_lbp || 0)}</p>
            <p className="font-mono text-sm">Base {fmtLbp(summary?.output_base_lbp || 0)}</p>
          </div>
          <div className="rounded-md border border-black/15 p-3">
            <p className="text-[11px] uppercase tracking-wider text-black/60">Input VAT (Purchases)</p>
            <p className="mt-1 font-mono text-sm">{fmtLbp(summary?.input_tax_lbp || 0)}</p>
            <p className="font-mono text-sm">Base {fmtLbp(summary?.input_base_lbp || 0)}</p>
          </div>
          <div className="rounded-md border border-black/15 p-3">
            <p className="text-[11px] uppercase tracking-wider text-black/60">Net VAT</p>
            <p className="mt-1 font-mono text-sm">{fmtLbp(summary?.net_tax_lbp || 0)}</p>
            <p className="font-mono text-sm">Rows {n(summary?.rows_count).toLocaleString("en-US")}</p>
          </div>
        </section>

        <div className="mt-4 rounded-md border border-black/15">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                <tr>
                  <th className="px-4 py-2 text-left">Period</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Tax</th>
                  <th className="px-3 py-2 text-right">Taxable Base (LBP)</th>
                  <th className="px-4 py-2 text-right">VAT (LBP)</th>
                  <th className="px-4 py-2 text-right">Lines</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.tax_code_id}:${r.period}:${idx}`} className="border-t border-black/10">
                    <td className="px-4 py-2 font-mono text-[11px]">{r.period}</td>
                    <td className="px-3 py-2 text-[11px]">{r.direction_label || "-"}</td>
                    <td className="px-3 py-2 text-sm">{r.tax_name}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtLbp(r.base_lbp)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtLbp(r.tax_lbp)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[11px]">{Number(r.line_count || 0).toLocaleString("en-US")}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-black/60" colSpan={6}>
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

export default function VatReportPrintPage() {
  return (
    <Suspense fallback={<div className="print-paper min-h-screen px-4 py-10 text-sm text-black/70">Loading...</div>}>
      <VatReportPrintInner />
    </Suspense>
  );
}
