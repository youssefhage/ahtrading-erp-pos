"use client";

import { useEffect, useState } from "react";

import { apiBase, apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

export default function VatReportPage() {
  const [rows, setRows] = useState<VatRow[]>([]);
  const [status, setStatus] = useState("");

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ vat: VatRow[] }>("/reports/vat");
      setRows(res.vat || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function downloadCsv() {
    setStatus("Downloading CSV...");
    try {
      const res = await fetch(`${apiBase()}/reports/vat?format=csv`, {
        credentials: "include"
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vat_report.csv";
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
    <div className="mx-auto max-w-5xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Monthly VAT (LBP)</CardTitle>
            <CardDescription>Aggregated from tax lines. {rows.length} rows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Button variant="secondary" onClick={downloadCsv}>
                Download CSV
              </Button>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Period</th>
                    <th className="px-3 py-2">Tax</th>
                    <th className="px-3 py-2 text-right">Base (LBP)</th>
                    <th className="px-3 py-2 text-right">VAT (LBP)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={`${r.tax_code_id}:${r.period}:${idx}`} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{r.period}</td>
                      <td className="px-3 py-2">{r.tax_name}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmtLbp(r.base_lbp)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmtLbp(r.tax_lbp)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                        No VAT rows yet.
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
