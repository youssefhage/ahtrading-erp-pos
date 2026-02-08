"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type DocRow = {
  id: string;
  source_company_id: string;
  source_company_name: string | null;
  issue_company_id: string;
  issue_company_name: string | null;
  sell_company_id: string;
  sell_company_name: string | null;
  source_type: string;
  source_id: string;
  settlement_status: string;
  created_at: string;
};

type SettlementRow = {
  id: string;
  from_company_id: string;
  from_company_name: string | null;
  to_company_id: string;
  to_company_name: string | null;
  amount_usd: string | number;
  amount_lbp: string | number;
  exchange_rate: string | number;
  created_at: string;
};

type Company = { id: string; name: string };

function fmt(n: string | number) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function IntercompanyPage() {
  const [status, setStatus] = useState("");
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  const [fromCompanyId, setFromCompanyId] = useState("");
  const [toCompanyId, setToCompanyId] = useState("");
  const [amountUsd, setAmountUsd] = useState("0");
  const [amountLbp, setAmountLbp] = useState("0");
  const [exchangeRate, setExchangeRate] = useState("0");
  const [method, setMethod] = useState<"cash" | "bank">("bank");
  const [saving, setSaving] = useState(false);

  async function load() {
    setStatus("Loading...");
    try {
      const [c, d, s] = await Promise.all([
        apiGet<{ companies: Company[] }>("/companies"),
        apiGet<{ documents: DocRow[] }>("/intercompany/documents?limit=200"),
        apiGet<{ settlements: SettlementRow[] }>("/intercompany/settlements?limit=200")
      ]);
      setCompanies(c.companies || []);
      setDocs(d.documents || []);
      setSettlements(s.settlements || []);
      if (!fromCompanyId && c.companies?.length) setFromCompanyId(c.companies[0].id);
      if (!toCompanyId && c.companies?.length) setToCompanyId(c.companies[0].id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function settle(e: React.FormEvent) {
    e.preventDefault();
    if (!fromCompanyId || !toCompanyId) return setStatus("from/to company are required");
    if (fromCompanyId === toCompanyId) return setStatus("from and to must differ");
    setSaving(true);
    setStatus("Posting settlement...");
    try {
      await apiPost("/intercompany/settle", {
        from_company_id: fromCompanyId,
        to_company_id: toCompanyId,
        amount_usd: Number(amountUsd || 0),
        amount_lbp: Number(amountLbp || 0),
        exchange_rate: Number(exchangeRate || 0),
        method
      });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
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
          <CardTitle>Intercompany Settlement</CardTitle>
          <CardDescription>Record a settlement between companies (posts journals on both sides).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={settle} className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">From (payer)</label>
              <select className="ui-select" value={fromCompanyId} onChange={(e) => setFromCompanyId(e.target.value)}>
                <option value="">Select...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">To (receiver)</label>
              <select className="ui-select" value={toCompanyId} onChange={(e) => setToCompanyId(e.target.value)}>
                <option value="">Select...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">Method</label>
              <select className="ui-select" value={method} onChange={(e) => setMethod(e.target.value as any)}>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">Amount USD</label>
              <Input value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">Amount LBP</label>
              <Input value={amountLbp} onChange={(e) => setAmountLbp(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">Exchange Rate</label>
              <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
            </div>

            <div className="flex items-end justify-end md:col-span-3">
              <div className="flex items-center gap-2">
                <Button variant="outline" type="button" onClick={load}>
                  Refresh
                </Button>
                <Button disabled={saving} type="submit">
                  {saving ? "Posting..." : "Settle"}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Intercompany Documents</CardTitle>
          <CardDescription>{docs.length} recent documents</CardDescription>
        </CardHeader>
        <CardContent className="ui-table-wrap">
          <table className="ui-table">
            <thead className="ui-thead">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Source Co</th>
                <th className="px-3 py-2">Issue Co</th>
                <th className="px-3 py-2">Sell Co</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="ui-tr-hover">
                  <td className="px-3 py-2 font-mono text-xs">{String(d.created_at || "").replace("T", " ").slice(0, 19)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {d.source_type}:{String(d.source_id).slice(0, 8)}
                  </td>
                  <td className="px-3 py-2">{d.source_company_name || d.source_company_id.slice(0, 8)}</td>
                  <td className="px-3 py-2">{d.issue_company_name || d.issue_company_id.slice(0, 8)}</td>
                  <td className="px-3 py-2">{d.sell_company_name || d.sell_company_id.slice(0, 8)}</td>
                  <td className="px-3 py-2">{d.settlement_status}</td>
                </tr>
              ))}
              {docs.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                    No intercompany documents.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlements</CardTitle>
          <CardDescription>{settlements.length} recent settlements</CardDescription>
        </CardHeader>
        <CardContent className="ui-table-wrap">
          <table className="ui-table">
            <thead className="ui-thead">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2 text-right">USD</th>
                <th className="px-3 py-2 text-right">LBP</th>
                <th className="px-3 py-2 text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id} className="ui-tr-hover">
                  <td className="px-3 py-2 font-mono text-xs">{String(s.created_at || "").replace("T", " ").slice(0, 19)}</td>
                  <td className="px-3 py-2">{s.from_company_name || s.from_company_id.slice(0, 8)}</td>
                  <td className="px-3 py-2">{s.to_company_name || s.to_company_id.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{fmt(s.amount_usd)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{fmt(s.amount_lbp)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{fmt(s.exchange_rate)}</td>
                </tr>
              ))}
              {settlements.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                    No settlements.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

