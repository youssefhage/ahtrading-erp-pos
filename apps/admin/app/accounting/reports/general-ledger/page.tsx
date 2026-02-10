"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiBase, apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

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

function fmt(n: string | number) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function GeneralLedgerPage() {
  const [rows, setRows] = useState<GlRow[]>([]);
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

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

  async function downloadCsv() {
    setStatus("Downloading CSV...");
    try {
      const res = await fetch(`${apiBase()}/reports/gl${query}${query ? "&" : "?"}format=csv`, {
        credentials: "include"
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "general_ledger.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Entries (USD + LL)</CardTitle>
            <CardDescription>
              Filter by journal date, then export CSV. {rows.length} rows
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Start</label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">End</label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={load}>
                  Refresh
                </Button>
                <Button asChild variant="outline">
                  <Link
                    href={`/accounting/reports/general-ledger/print?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Print / PDF
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <a
                    href={`/exports/reports/general-ledger/pdf?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download PDF
                  </a>
                </Button>
                <Button variant="secondary" onClick={downloadCsv}>
                  Download CSV
                </Button>
              </div>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Journal</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2 text-right">Dr USD</th>
                    <th className="px-3 py-2 text-right">Cr USD</th>
                    <th className="px-3 py-2 text-right">Dr LL</th>
                    <th className="px-3 py-2 text-right">Cr LL</th>
                    <th className="px-3 py-2">Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={`${r.journal_no}:${r.account_code}:${idx}`} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{String(r.journal_date)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.journal_no}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{r.account_code}</span>{" "}
                        <span className="text-fg-muted">{r.name_en || ""}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.debit_usd)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.credit_usd)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.debit_lbp)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.credit_lbp)}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{r.memo || ""}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={8}>
                        No GL entries yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>);
}
