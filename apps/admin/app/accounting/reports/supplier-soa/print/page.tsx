"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

type Row = {
  tx_date: string;
  kind: string;
  ref: string | null;
  memo: string | null;
  delta_usd: string | number;
  delta_lbp: string | number;
  balance_usd: string | number;
  balance_lbp: string | number;
};

type SoaRes = {
  supplier: { id: string; code?: string | null; name: string };
  start_date: string;
  end_date: string;
  opening_usd: string | number;
  opening_lbp: string | number;
  closing_usd: string | number;
  closing_lbp: string | number;
  rows: Row[];
};

function kindLabel(kind: string) {
  const k = String(kind || "").toLowerCase();
  if (k === "invoice") return "Invoice";
  if (k === "payment") return "Payment";
  if (k === "credit_note") return "Credit Note";
  return kind || "-";
}

export default function SupplierSoaPrintPage() {
  const [supplierId, setSupplierId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (supplierId) qs.set("supplier_id", supplierId);
    if (startDate) qs.set("start_date", startDate);
    if (endDate) qs.set("end_date", endDate);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [supplierId, startDate, endDate]);

  const [data, setData] = useState<SoaRes | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    // Avoid useSearchParams() to keep Next builds happy without extra Suspense wrappers.
    try {
      const qs = new URLSearchParams(window.location.search);
      setSupplierId((qs.get("supplier_id") || "").trim());
      setStartDate((qs.get("start_date") || "").trim());
      setEndDate((qs.get("end_date") || "").trim());
    } catch {
      // ignore
    }
  }, []);

  const load = useCallback(async () => {
    if (!supplierId) return;
    setStatus("Loading...");
    try {
      const res = await apiGet<SoaRes>(`/reports/supplier-soa${query}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [supplierId, query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    applyPrintSettingsFromQuery();
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("autoprint") === "1") setTimeout(() => window.print(), 250);
    } catch {
      // ignore
    }
  }, []);

  const rows = data?.rows || [];

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/accounting/reports/supplier-soa${query}`}>Back</Link>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={load} disabled={!supplierId}>
              Refresh
            </Button>
            <Button onClick={() => window.print()} disabled={!supplierId}>
              Print / Save PDF
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/15 pb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Supplier Statement of Account</h1>
            <p className="mt-1 text-xs text-black/70">
              {data?.supplier?.name || supplierId || "Select a supplier"} {data?.supplier?.code ? `(${data.supplier.code})` : ""}
            </p>
            <p className="mt-1 text-[11px] text-black/60 font-mono">
              {data?.start_date || startDate || "-"} to {data?.end_date || endDate || "-"}
            </p>
          </div>
          <div className="text-right text-[11px] text-black/60">
            <div className="font-mono">Rows: {rows.length}</div>
            <div className="font-mono">Generated: {new Date().toISOString().slice(0, 19).replace("T", " ")}</div>
          </div>
        </header>

        {data ? (
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-black/15 p-3">
              <div className="text-[11px] uppercase tracking-wider text-black/50">Opening</div>
              <div className="mt-1 font-mono">{fmtUsd(data.opening_usd)}</div>
              <div className="font-mono text-black/60">{fmtLbp(data.opening_lbp)}</div>
            </div>
            <div className="rounded-md border border-black/15 p-3">
              <div className="text-[11px] uppercase tracking-wider text-black/50">Closing</div>
              <div className="mt-1 font-mono">{fmtUsd(data.closing_usd)}</div>
              <div className="font-mono text-black/60">{fmtLbp(data.closing_lbp)}</div>
            </div>
            <div className="rounded-md border border-black/15 p-3">
              <div className="text-[11px] uppercase tracking-wider text-black/50">Notes</div>
              <div className="mt-1 text-black/70">Positive balance means we owe the supplier.</div>
              <div className="text-black/70">Negative means supplier credit.</div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-md border border-black/15">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Ref</th>
                  <th className="px-3 py-2 text-left">Memo</th>
                  <th className="px-3 py-2 text-right">Delta USD</th>
                  <th className="px-3 py-2 text-right">Delta LL</th>
                  <th className="px-4 py-2 text-right">Balance USD</th>
                  <th className="px-4 py-2 text-right">Balance LL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.tx_date}:${r.kind}:${idx}`} className="border-t border-black/10">
                    <td className="px-4 py-2 font-mono text-[11px]">{r.tx_date}</td>
                    <td className="px-3 py-2">{kindLabel(r.kind)}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.ref || ""}</td>
                    <td className="px-3 py-2 text-black/70">{r.memo || ""}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtUsd(r.delta_usd)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{fmtLbp(r.delta_lbp)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtUsd(r.balance_usd)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtLbp(r.balance_lbp)}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-black/60" colSpan={8}>
                      {supplierId ? "No transactions in range." : "Missing supplier_id."}
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
