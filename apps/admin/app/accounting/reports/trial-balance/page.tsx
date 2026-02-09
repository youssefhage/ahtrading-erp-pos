"use client";

import { useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type TrialRow = {
  account_code: string;
  name_en: string | null;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
};

function fmt(n: string | number) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function TrialBalancePage() {
  const [rows, setRows] = useState<TrialRow[]>([]);
  const [status, setStatus] = useState("");

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ trial_balance: TrialRow[] }>("/reports/trial-balance");
      setRows(res.trial_balance || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Balances (USD + LL)</CardTitle>
            <CardDescription>Aggregated from GL entries. {rows.length} accounts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2 text-right">Dr USD</th>
                    <th className="px-3 py-2 text-right">Cr USD</th>
                    <th className="px-3 py-2 text-right">Dr LL</th>
                    <th className="px-3 py-2 text-right">Cr LL</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.account_code} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{r.account_code}</td>
                      <td className="px-3 py-2">{r.name_en || ""}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.debit_usd)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.credit_usd)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.debit_lbp)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.credit_lbp)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
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
