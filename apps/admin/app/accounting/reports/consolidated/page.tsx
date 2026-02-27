"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

/* ---------- types ---------- */

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

/* ---------- helpers ---------- */

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function splitBalanceByNormal(normalBalance: string | null | undefined, value: string | number) {
  const n = toNum(value);
  const isCredit = String(normalBalance || "").toLowerCase() === "credit";
  if (isCredit) return n >= 0 ? { debit: 0, credit: n } : { debit: Math.abs(n), credit: 0 };
  return n >= 0 ? { debit: n, credit: 0 } : { debit: 0, credit: Math.abs(n) };
}

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

function fmt(n: number, frac = 2) {
  return n.toLocaleString("en-US", { maximumFractionDigits: frac });
}

/* ---------- page ---------- */

export default function ConsolidatedReportsPage() {
  const [error, setError] = useState("");
  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [report, setReport] = useState<"trial" | "pl" | "bs">("trial");
  const [startDate, setStartDate] = useState(monthStartISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [asOf, setAsOf] = useState(todayISO());

  const [trial, setTrial] = useState<TrialRow[]>([]);
  const [pl, setPl] = useState<PLRow[]>([]);
  const [plTotals, setPlTotals] = useState<{ revenue_usd: unknown; revenue_lbp: unknown; expense_usd: unknown; expense_lbp: unknown; net_profit_usd: unknown; net_profit_lbp: unknown } | null>(null);
  const [bs, setBs] = useState<BSRow[]>([]);

  const companyIds = useMemo(() => companies.map((c) => c.id).filter((id) => selected[id]), [companies, selected]);

  const loading = loadingInit || loadingReport;

  /* --- Trial columns --- */
  const trialColumns = useMemo<ColumnDef<TrialRow>[]>(() => [
    { id: "account_code", accessorFn: (r) => r.account_code, header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />, cell: ({ row }) => <span className="font-mono text-sm">{row.original.account_code}</span> },
    { id: "name_en", accessorFn: (r) => r.name_en || "", header: ({ column }) => <DataTableColumnHeader column={column} title="Account" /> },
    { id: "debit_usd", accessorFn: (r) => toNum(r.debit_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="Debit USD" />, cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums">{fmt(toNum(row.original.debit_usd))}</div> },
    { id: "credit_usd", accessorFn: (r) => toNum(r.credit_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="Credit USD" />, cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums">{fmt(toNum(row.original.credit_usd))}</div> },
    { id: "debit_lbp", accessorFn: (r) => toNum(r.debit_lbp), header: ({ column }) => <DataTableColumnHeader column={column} title="Debit LBP" />, cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(toNum(row.original.debit_lbp))}</div> },
    { id: "credit_lbp", accessorFn: (r) => toNum(r.credit_lbp), header: ({ column }) => <DataTableColumnHeader column={column} title="Credit LBP" />, cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(toNum(row.original.credit_lbp))}</div> },
  ], []);

  /* --- P&L columns --- */
  const plColumns = useMemo<ColumnDef<PLRow>[]>(() => [
    { id: "account_code", accessorFn: (r) => r.account_code, header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />, cell: ({ row }) => <span className="font-mono text-sm">{row.original.account_code}</span> },
    { id: "name_en", accessorFn: (r) => r.name_en || "", header: ({ column }) => <DataTableColumnHeader column={column} title="Account" /> },
    { id: "kind", accessorFn: (r) => r.kind, header: ({ column }) => <DataTableColumnHeader column={column} title="Kind" />, cell: ({ row }) => <Badge variant={row.original.kind === "revenue" ? "success" : "warning"}>{row.original.kind}</Badge> },
    { id: "amount_usd", accessorFn: (r) => toNum(r.amount_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="USD" />, cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={toNum(row.original.amount_usd)} currency="USD" className="font-mono text-sm" /></div> },
    { id: "amount_lbp", accessorFn: (r) => toNum(r.amount_lbp), header: ({ column }) => <DataTableColumnHeader column={column} title="LBP" />, cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={toNum(row.original.amount_lbp)} currency="LBP" className="font-mono text-sm" /></div> },
  ], []);

  /* --- BS columns --- */
  const bsColumns = useMemo<ColumnDef<BSRow>[]>(() => [
    { id: "account_code", accessorFn: (r) => r.account_code, header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />, cell: ({ row }) => <span className="font-mono text-sm">{row.original.account_code}</span> },
    { id: "name_en", accessorFn: (r) => r.name_en || "", header: ({ column }) => <DataTableColumnHeader column={column} title="Account" /> },
    { id: "normal_balance", accessorFn: (r) => r.normal_balance || "", header: ({ column }) => <DataTableColumnHeader column={column} title="Normal" />, cell: ({ row }) => <span className="text-xs text-muted-foreground capitalize">{row.original.normal_balance}</span> },
    { id: "debit_usd", accessorFn: (r) => splitBalanceByNormal(r.normal_balance, r.balance_usd).debit, header: ({ column }) => <DataTableColumnHeader column={column} title="Debit USD" />, cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums">{fmt(splitBalanceByNormal(row.original.normal_balance, row.original.balance_usd).debit)}</div> },
    { id: "credit_usd", accessorFn: (r) => splitBalanceByNormal(r.normal_balance, r.balance_usd).credit, header: ({ column }) => <DataTableColumnHeader column={column} title="Credit USD" />, cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums">{fmt(splitBalanceByNormal(row.original.normal_balance, row.original.balance_usd).credit)}</div> },
    { id: "debit_lbp", accessorFn: (r) => splitBalanceByNormal(r.normal_balance, r.balance_lbp).debit, header: ({ column }) => <DataTableColumnHeader column={column} title="Debit LBP" />, cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(splitBalanceByNormal(row.original.normal_balance, row.original.balance_lbp).debit, 0)}</div> },
    { id: "credit_lbp", accessorFn: (r) => splitBalanceByNormal(r.normal_balance, r.balance_lbp).credit, header: ({ column }) => <DataTableColumnHeader column={column} title="Credit LBP" />, cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(splitBalanceByNormal(row.original.normal_balance, row.original.balance_lbp).credit, 0)}</div> },
  ], []);

  const loadCompanies = useCallback(async () => {
    setLoadingInit(true);
    setError("");
    try {
      const res = await apiGet<{ companies: Company[] }>("/companies");
      setCompanies(res.companies || []);
      const next: Record<string, boolean> = {};
      for (const c of res.companies || []) next[c.id] = true;
      setSelected(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingInit(false);
    }
  }, []);

  const loadReport = useCallback(async () => {
    if (companyIds.length === 0) {
      setError("Select at least one company.");
      return;
    }
    setLoadingReport(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("company_ids", companyIds.join(","));
      if (report === "trial") {
        const res = await apiGet<{ trial_balance: TrialRow[] }>(`/reports/consolidated/trial-balance?${params.toString()}`);
        setTrial(res.trial_balance || []);
      } else if (report === "pl") {
        if (startDate) params.set("start_date", startDate);
        if (endDate) params.set("end_date", endDate);
        const res = await apiGet<{ rows: PLRow[]; revenue_usd: unknown; revenue_lbp: unknown; expense_usd: unknown; expense_lbp: unknown; net_profit_usd: unknown; net_profit_lbp: unknown }>(
          `/reports/consolidated/profit-loss?${params.toString()}`,
        );
        setPl(res.rows || []);
        setPlTotals({ revenue_usd: res.revenue_usd, revenue_lbp: res.revenue_lbp, expense_usd: res.expense_usd, expense_lbp: res.expense_lbp, net_profit_usd: res.net_profit_usd, net_profit_lbp: res.net_profit_lbp });
      } else {
        if (asOf) params.set("as_of", asOf);
        const res = await apiGet<{ rows: BSRow[] }>(`/reports/consolidated/balance-sheet?${params.toString()}`);
        setBs(res.rows || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingReport(false);
    }
  }, [companyIds, report, startDate, endDate, asOf]);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);

  useEffect(() => {
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
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Consolidated Reports"
        description="Roll up accounting across multiple companies (requires aligned COA codes)."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadCompanies} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={loadReport} disabled={loading}>
              {loadingReport ? "Running..." : "Run Report"}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
          <Button variant="link" size="sm" className="ml-2" onClick={() => { if (!companies.length) loadCompanies(); else loadReport(); }}>Retry</Button>
        </div>
      )}

      {/* Filter bar */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Tabs value={report} onValueChange={(v) => setReport(v as "trial" | "pl" | "bs")}>
            <TabsList>
              <TabsTrigger value="trial">Trial Balance</TabsTrigger>
              <TabsTrigger value="pl">Profit &amp; Loss</TabsTrigger>
              <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-end gap-4">
            {report === "pl" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Start</label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[180px]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">End</label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[180px]" />
                </div>
              </>
            )}
            {report === "bs" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">As of</label>
                <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-[180px]" />
              </div>
            )}
          </div>

          {/* Company selector */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Companies ({companyIds.length} selected)</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => selectAll(true)} disabled={loading}>Select all</Button>
                <Button variant="outline" size="sm" onClick={() => selectAll(false)} disabled={loading}>Clear</Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {companies.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!!selected[c.id]} onCheckedChange={() => toggleCompany(c.id)} />
                  <span>{c.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{c.id.slice(0, 8)}</span>
                </label>
              ))}
              {companies.length === 0 && <p className="text-sm text-muted-foreground">No companies.</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report tables */}
      {report === "trial" && (
        <DataTable columns={trialColumns} data={trial} isLoading={loadingReport} searchPlaceholder="Search code / account..." />
      )}

      {report === "pl" && (
        <>
          {plTotals && (
            <div className="text-sm text-muted-foreground">
              Revenue: {fmtUsdLbp(plTotals.revenue_usd, plTotals.revenue_lbp)} | Expense: {fmtUsdLbp(plTotals.expense_usd, plTotals.expense_lbp)} | Net: {fmtUsdLbp(plTotals.net_profit_usd, plTotals.net_profit_lbp)}
            </div>
          )}
          <DataTable columns={plColumns} data={pl} isLoading={loadingReport} searchPlaceholder="Search code / account..." />
        </>
      )}

      {report === "bs" && (
        <DataTable columns={bsColumns} data={bs} isLoading={loadingReport} searchPlaceholder="Search code / account..." />
      )}
    </div>
  );
}
