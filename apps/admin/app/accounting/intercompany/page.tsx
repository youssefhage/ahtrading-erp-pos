"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

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

  const docColumns = useMemo((): Array<DataTableColumn<DocRow>> => {
    return [
      {
        id: "created_at",
        header: "When",
        accessor: (d) => d.created_at || "",
        mono: true,
        sortable: true,
        globalSearch: false,
        cell: (d) => <span className="data-mono text-xs">{formatDateTime(d.created_at)}</span>,
      },
      {
        id: "source",
        header: "Source",
        accessor: (d) => `${d.source_type}:${String(d.source_id).slice(0, 8)}`,
        mono: true,
        sortable: true,
        cell: (d) => (
          <span className="data-mono text-xs">
            {d.source_type}:{String(d.source_id).slice(0, 8)}
          </span>
        ),
      },
      { id: "source_company_name", header: "Source Co", accessor: (d) => d.source_company_name || d.source_company_id.slice(0, 8), sortable: true },
      { id: "issue_company_name", header: "Issue Co", accessor: (d) => d.issue_company_name || d.issue_company_id.slice(0, 8), sortable: true },
      { id: "sell_company_name", header: "Sell Co", accessor: (d) => d.sell_company_name || d.sell_company_id.slice(0, 8), sortable: true },
      { id: "settlement_status", header: "Status", accessor: (d) => d.settlement_status, sortable: true, globalSearch: false, cell: (d) => <StatusChip value={d.settlement_status} /> },
    ];
  }, []);

  const settlementColumns = useMemo((): Array<DataTableColumn<SettlementRow>> => {
    return [
      {
        id: "created_at",
        header: "When",
        accessor: (s) => s.created_at || "",
        mono: true,
        sortable: true,
        globalSearch: false,
        cell: (s) => <span className="data-mono text-xs">{formatDateTime(s.created_at)}</span>,
      },
      { id: "from_company_name", header: "From", accessor: (s) => s.from_company_name || s.from_company_id.slice(0, 8), sortable: true },
      { id: "to_company_name", header: "To", accessor: (s) => s.to_company_name || s.to_company_id.slice(0, 8), sortable: true },
      { id: "amount_usd", header: "USD", accessor: (s) => Number(s.amount_usd || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (s) => <span className="data-mono ui-tone-usd">{fmt(s.amount_usd)}</span> },
      { id: "amount_lbp", header: "LL", accessor: (s) => Number(s.amount_lbp || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (s) => <span className="data-mono ui-tone-lbp">{fmt(s.amount_lbp)}</span> },
      { id: "exchange_rate", header: "Rate", accessor: (s) => Number(s.exchange_rate || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (s) => <span className="data-mono">{fmt(s.exchange_rate)}</span> },
    ];
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    async function prime() {
      // Only prime if the user hasn't set anything yet.
      const curr = Number(exchangeRate || 0);
      if (Number.isFinite(curr) && curr > 0) return;
      const r = await getFxRateUsdToLbp();
      if (cancelled) return;
      const n = Number(r?.usd_to_lbp || 0);
      if (Number.isFinite(n) && n > 0) setExchangeRate(String(n));
    }
    prime().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [exchangeRate]);

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
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Accounting</p>
            <h1 className="ui-module-title">Intercompany</h1>
            <p className="ui-module-subtitle">Track documents and settlements between legal entities.</p>
          </div>
        </div>
      </div>
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Intercompany Settlement</CardTitle>
          <CardDescription>Record a settlement between companies (posts journals on both sides).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={settle} className="ui-form-grid-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">From (payer)</label>
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
              <label className="text-xs font-medium text-fg-muted">To (receiver)</label>
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
              <label className="text-xs font-medium text-fg-muted">Method</label>
              <select className="ui-select" value={method} onChange={(e) => setMethod(e.target.value as any)}>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Amount USD</label>
              <Input value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Amount LL</label>
              <Input value={amountLbp} onChange={(e) => setAmountLbp(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Exchange Rate</label>
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
        <CardContent>
          <DataTable<DocRow>
            tableId="accounting.intercompany.documents"
            rows={docs}
            columns={docColumns}
            initialSort={{ columnId: "created_at", dir: "desc" }}
            globalFilterPlaceholder="Search source / company..."
            emptyText="No intercompany documents."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlements</CardTitle>
          <CardDescription>{settlements.length} recent settlements</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<SettlementRow>
            tableId="accounting.intercompany.settlements"
            rows={settlements}
            columns={settlementColumns}
            initialSort={{ columnId: "created_at", dir: "desc" }}
            globalFilterPlaceholder="Search company..."
            emptyText="No settlements."
          />
        </CardContent>
      </Card>
    </div>
  );
}
