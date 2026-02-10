"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";

type Company = { id: string; name: string };

type TrialRow = {
  account_code: string;
  name_en: string | null;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
};

type PLRow = {
  account_code: string;
  name_en: string | null;
  kind: "revenue" | "expense";
  amount_usd: string | number;
  amount_lbp: string | number;
};

type BSRow = {
  account_code: string;
  name_en: string | null;
  normal_balance: string | null;
  balance_usd: string | number;
  balance_lbp: string | number;
};

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthStartISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

export default function ConsolidatedReportsPage() {
  const [status, setStatus] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [report, setReport] = useState<"trial" | "pl" | "bs">("trial");

  const [startDate, setStartDate] = useState(monthStartISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [asOf, setAsOf] = useState(todayISO());

  const [trial, setTrial] = useState<TrialRow[]>([]);
  const [pl, setPl] = useState<PLRow[]>([]);
  const [plTotals, setPlTotals] = useState<{ revenue_usd: any; revenue_lbp: any; expense_usd: any; expense_lbp: any; net_profit_usd: any; net_profit_lbp: any } | null>(null);
  const [bs, setBs] = useState<BSRow[]>([]);

  const trialColumns = useMemo((): Array<DataTableColumn<TrialRow>> => {
    return [
      { id: "account_code", header: "Code", accessor: (r) => r.account_code, mono: true, sortable: true, globalSearch: false },
      { id: "name_en", header: "Account", accessor: (r) => r.name_en || "", sortable: true },
      {
        id: "debit_usd",
        header: "Dr USD",
        accessor: (r) => Number(r.debit_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.debit_usd)}</span>,
        globalSearch: false,
      },
      {
        id: "credit_usd",
        header: "Cr USD",
        accessor: (r) => Number(r.credit_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.credit_usd)}</span>,
        globalSearch: false,
      },
      {
        id: "debit_lbp",
        header: "Dr LL",
        accessor: (r) => Number(r.debit_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.debit_lbp)}</span>,
        globalSearch: false,
      },
      {
        id: "credit_lbp",
        header: "Cr LL",
        accessor: (r) => Number(r.credit_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.credit_lbp)}</span>,
        globalSearch: false,
      },
    ];
  }, []);

  const plColumns = useMemo((): Array<DataTableColumn<PLRow>> => {
    return [
      { id: "account_code", header: "Code", accessor: (r) => r.account_code, mono: true, sortable: true, globalSearch: false },
      { id: "name_en", header: "Account", accessor: (r) => r.name_en || "", sortable: true },
      { id: "kind", header: "Kind", accessor: (r) => r.kind, sortable: true, globalSearch: false },
      {
        id: "amount_usd",
        header: "USD",
        accessor: (r) => Number(r.amount_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.amount_usd)}</span>,
        globalSearch: false,
      },
      {
        id: "amount_lbp",
        header: "LL",
        accessor: (r) => Number(r.amount_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.amount_lbp)}</span>,
        globalSearch: false,
      },
    ];
  }, []);

  const bsColumns = useMemo((): Array<DataTableColumn<BSRow>> => {
    return [
      { id: "account_code", header: "Code", accessor: (r) => r.account_code, mono: true, sortable: true, globalSearch: false },
      { id: "name_en", header: "Account", accessor: (r) => r.name_en || "", sortable: true },
      { id: "normal_balance", header: "Normal", accessor: (r) => r.normal_balance || "", sortable: true, globalSearch: false },
      {
        id: "balance_usd",
        header: "Balance USD",
        accessor: (r) => Number(r.balance_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.balance_usd)}</span>,
        globalSearch: false,
      },
      {
        id: "balance_lbp",
        header: "Balance LL",
        accessor: (r) => Number(r.balance_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.balance_lbp)}</span>,
        globalSearch: false,
      },
    ];
  }, []);

  const companyIds = useMemo(() => {
    const ids = companies.map((c) => c.id).filter((id) => selected[id]);
    return ids;
  }, [companies, selected]);

  function companyIdsQS() {
    return encodeURIComponent(companyIds.join(","));
  }

  async function loadCompanies() {
    setStatus("Loading companies...");
    try {
      const res = await apiGet<{ companies: Company[] }>("/companies");
      setCompanies(res.companies || []);
      // Default: select all companies the user has access to.
      const next: Record<string, boolean> = {};
      for (const c of res.companies || []) next[c.id] = true;
      setSelected(next);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function loadReport() {
    if (companyIds.length === 0) {
      setStatus("Select at least one company.");
      return;
    }
    setStatus("Loading consolidated report...");
    try {
      if (report === "trial") {
        const res = await apiGet<{ trial_balance: TrialRow[] }>(`/reports/consolidated/trial-balance?company_ids=${companyIdsQS()}`);
        setTrial(res.trial_balance || []);
      } else if (report === "pl") {
        const res = await apiGet<{ rows: PLRow[]; revenue_usd: any; revenue_lbp: any; expense_usd: any; expense_lbp: any; net_profit_usd: any; net_profit_lbp: any }>(
          `/reports/consolidated/profit-loss?company_ids=${companyIdsQS()}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`
        );
        setPl(res.rows || []);
        setPlTotals({
          revenue_usd: res.revenue_usd,
          revenue_lbp: res.revenue_lbp,
          expense_usd: res.expense_usd,
          expense_lbp: res.expense_lbp,
          net_profit_usd: res.net_profit_usd,
          net_profit_lbp: res.net_profit_lbp
        });
      } else {
        const res = await apiGet<{ rows: BSRow[] }>(`/reports/consolidated/balance-sheet?company_ids=${companyIdsQS()}&as_of=${encodeURIComponent(asOf)}`);
        setBs(res.rows || []);
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    // Auto-load once we have companies selected.
    if (companies.length) loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies.length]);

  function toggleCompany(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function selectAll(v: boolean) {
    const next: Record<string, boolean> = {};
    for (const c of companies) next[c.id] = v;
    setSelected(next);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? (
        <ErrorBanner
          error={status}
          onRetry={() => {
            if (!companies.length) return loadCompanies();
            return loadReport();
          }}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Consolidated Reports</CardTitle>
          <CardDescription>Roll up accounting across multiple companies (requires aligned COA codes).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-fg-muted">Report</label>
              <select className="ui-select" value={report} onChange={(e) => setReport(e.target.value as any)}>
                <option value="trial">Trial Balance</option>
                <option value="pl">Profit &amp; Loss</option>
                <option value="bs">Balance Sheet</option>
              </select>
            </div>

            {report === "pl" ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Start</label>
                  <Input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">End</label>
                  <Input value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
              </>
            ) : null}

            {report === "bs" ? (
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">As of</label>
                <Input value={asOf} onChange={(e) => setAsOf(e.target.value)} placeholder="YYYY-MM-DD" />
              </div>
            ) : null}
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">Companies ({companyIds.length} selected)</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => selectAll(true)}>
                  Select all
                </Button>
                <Button variant="outline" onClick={() => selectAll(false)}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {companies.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!selected[c.id]} onChange={() => toggleCompany(c.id)} />
                  <span>{c.name}</span>
                  <span className="font-mono text-xs text-fg-subtle">{c.id.slice(0, 8)}</span>
                </label>
              ))}
              {companies.length === 0 ? <div className="text-sm text-fg-subtle">No companies.</div> : null}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={loadCompanies}>
              Refresh Companies
            </Button>
            <Button onClick={loadReport}>Run</Button>
          </div>
        </CardContent>
      </Card>

      {report === "trial" ? (
        <Card>
          <CardHeader>
            <CardTitle>Trial Balance (Consolidated)</CardTitle>
            <CardDescription>{trial.length} accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<TrialRow>
              tableId="accounting.reports.consolidated.trial"
              rows={trial}
              columns={trialColumns}
              initialSort={{ columnId: "account_code", dir: "asc" }}
              globalFilterPlaceholder="Search code / account..."
              emptyText="No GL entries yet."
            />
          </CardContent>
        </Card>
      ) : null}

      {report === "pl" ? (
        <Card>
          <CardHeader>
            <CardTitle>Profit &amp; Loss (Consolidated)</CardTitle>
            <CardDescription>
              {plTotals ? (
                <>
                  Revenue: {fmtUsd(plTotals.revenue_usd)} / {fmtLbp(plTotals.revenue_lbp)} · Expense: {fmtUsd(plTotals.expense_usd)} /{" "}
                  {fmtLbp(plTotals.expense_lbp)} · Net: {fmtUsd(plTotals.net_profit_usd)} / {fmtLbp(plTotals.net_profit_lbp)}
                </>
              ) : (
                `${pl.length} rows`
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<PLRow>
              tableId="accounting.reports.consolidated.pl"
              rows={pl}
              columns={plColumns}
              initialSort={{ columnId: "kind", dir: "asc" }}
              globalFilterPlaceholder="Search code / account..."
              emptyText="No P&L entries yet."
            />
          </CardContent>
        </Card>
      ) : null}

      {report === "bs" ? (
        <Card>
          <CardHeader>
            <CardTitle>Balance Sheet (Consolidated)</CardTitle>
            <CardDescription>{bs.length} accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<BSRow>
              tableId="accounting.reports.consolidated.bs"
              rows={bs}
              columns={bsColumns}
              initialSort={{ columnId: "account_code", dir: "asc" }}
              globalFilterPlaceholder="Search code / account..."
              emptyText="No balance sheet entries yet."
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
