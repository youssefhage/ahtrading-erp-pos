"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type CoaAccount = {
  id: string;
  account_code: string;
  name_en: string | null;
};

type DimensionRow = { id: string; code: string; name: string; is_active: boolean };

type JournalRow = {
  id: string;
  journal_no: string;
  source_type: string | null;
  source_id: string | null;
  journal_date: string;
  rate_type: string;
  exchange_rate: string | number;
  memo: string | null;
  created_at: string;
  created_by_email: string | null;
};

type JournalEntry = {
  id: string;
  account_id: string;
  account_code: string;
  name_en: string | null;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
  memo: string | null;
  cost_center_id?: string | null;
  cost_center_code?: string | null;
  cost_center_name?: string | null;
  project_id?: string | null;
  project_code?: string | null;
  project_name?: string | null;
};

type JournalDetail = {
  journal: JournalRow;
  entries: JournalEntry[];
};

type RateRow = { id: string; rate_date: string; rate_type: string; usd_to_lbp: string | number };

type LineDraft = {
  key: string;
  side: "debit" | "credit";
  account_code: string;
  account_id: string | null;
  memo: string;
  amount_usd: string;
  amount_lbp: string;
  cost_center_id: string;
  project_id: string;
};

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: string | number, frac = 2) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function JournalsPage() {
  const [status, setStatus] = useState("");
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [costCenters, setCostCenters] = useState<DimensionRow[]>([]);
  const [projects, setProjects] = useState<DimensionRow[]>([]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sourceType, setSourceType] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [journalDate, setJournalDate] = useState(todayIso());
  const [rateType, setRateType] = useState("market");
  const [exchangeRate, setExchangeRate] = useState("0");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { key: "l1", side: "debit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "", cost_center_id: "", project_id: "" },
    { key: "l2", side: "credit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "", cost_center_id: "", project_id: "" }
  ]);
  const [creating, setCreating] = useState(false);

  const [reverseOpen, setReverseOpen] = useState(false);
  const [reversing, setReversing] = useState(false);

  const accountByCode = useMemo(() => {
    const m = new Map<string, CoaAccount>();
    for (const a of accounts) m.set(a.account_code, a);
    return m;
  }, [accounts]);

  const totals = useMemo(() => {
    let dUsd = 0;
    let cUsd = 0;
    let dLbp = 0;
    let cLbp = 0;
    for (const l of lines) {
      const usd = toNum(l.amount_usd);
      const lbp = toNum(l.amount_lbp);
      if (l.side === "debit") {
        dUsd += usd;
        dLbp += lbp;
      } else {
        cUsd += usd;
        cLbp += lbp;
      }
    }
    return { dUsd, cUsd, dLbp, cLbp, diffUsd: dUsd - cUsd, diffLbp: dLbp - cLbp };
  }, [lines]);

  const journalColumns = useMemo((): Array<DataTableColumn<JournalRow>> => {
    return [
      { id: "journal_date", header: "Date", accessor: (j) => j.journal_date, mono: true, sortable: true, globalSearch: false, cell: (j) => <span className="data-mono text-sm">{j.journal_date}</span> },
      { id: "journal_no", header: "No", accessor: (j) => j.journal_no, mono: true, sortable: true, cell: (j) => <span className="data-mono text-sm">{j.journal_no}</span> },
      { id: "source_type", header: "Source", accessor: (j) => j.source_type || "-", sortable: true, cell: (j) => <span className="text-sm text-fg-muted">{j.source_type || "-"}</span> },
      { id: "memo", header: "Memo", accessor: (j) => j.memo || "", sortable: true, cell: (j) => <span className="text-sm text-fg-muted">{j.memo || ""}</span> },
      { id: "created_by_email", header: "By", accessor: (j) => j.created_by_email || "-", sortable: true, cell: (j) => <span className="text-sm text-fg-muted">{j.created_by_email || "-"}</span> },
    ];
  }, []);

  const entryColumns = useMemo((): Array<DataTableColumn<JournalEntry>> => {
    return [
      {
        id: "account",
        header: "Account",
        accessor: (e) => `${e.account_code || ""} ${e.name_en || ""}`.trim(),
        sortable: true,
        cell: (e) => (
          <div>
            <div className="font-mono text-sm">{e.account_code}</div>
            <div className="text-sm text-fg-muted">{e.name_en || ""}</div>
          </div>
        ),
      },
      {
        id: "dims",
        header: "Dims",
        accessor: (e) => `${e.cost_center_code || ""} ${e.project_code || ""}`.trim(),
        sortable: true,
        cell: (e) => (
          <div className="text-sm text-fg-muted">
            {e.cost_center_code ? <span className="font-mono">{e.cost_center_code}</span> : <span>-</span>}
            {e.project_code ? <span className="ml-2 font-mono">{e.project_code}</span> : null}
          </div>
        ),
      },
      { id: "debit_usd", header: "Debit USD", accessor: (e) => Number(e.debit_usd || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (e) => <span className="data-mono ui-tone-usd">{fmt(e.debit_usd, 4)}</span> },
      { id: "credit_usd", header: "Credit USD", accessor: (e) => Number(e.credit_usd || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (e) => <span className="data-mono ui-tone-usd">{fmt(e.credit_usd, 4)}</span> },
      { id: "debit_lbp", header: "Debit LL", accessor: (e) => Number(e.debit_lbp || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (e) => <span className="data-mono ui-tone-lbp">{fmt(e.debit_lbp, 2)}</span> },
      { id: "credit_lbp", header: "Credit LL", accessor: (e) => Number(e.credit_lbp || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (e) => <span className="data-mono ui-tone-lbp">{fmt(e.credit_lbp, 2)}</span> },
    ];
  }, []);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (sourceType) params.set("source_type", sourceType);
      const [j, a, cc, pr] = await Promise.all([
        apiGet<{ journals: JournalRow[] }>(`/accounting/journals${params.toString() ? `?${params.toString()}` : ""}`),
        apiGet<{ accounts: CoaAccount[] }>("/coa/accounts"),
        apiGet<{ cost_centers: DimensionRow[] }>("/dimensions/cost-centers"),
        apiGet<{ projects: DimensionRow[] }>("/dimensions/projects")
      ]);
      setJournals(j.journals || []);
      setAccounts(a.accounts || []);
      setCostCenters(cc.cost_centers || []);
      setProjects(pr.projects || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [q, startDate, endDate, sourceType]);

  async function loadDetail(id: string) {
    if (!id) {
      setDetail(null);
      return;
    }
    setStatus("Loading journal...");
    try {
      const res = await apiGet<JournalDetail>(`/accounting/journals/${id}`);
      setDetail(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  const primeExchangeRate = useCallback(async (nextDate: string, nextRateType: string) => {
    try {
      const r = await getFxRateUsdToLbp({ rateDate: nextDate, rateType: nextRateType });
      const rate = Number(r?.usd_to_lbp || 0);
      if (Number.isFinite(rate) && rate > 0) setExchangeRate(String(rate));
    } catch {
      // Keep whatever is already in the input.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!createOpen) return;
    primeExchangeRate(journalDate, rateType);
  }, [createOpen, journalDate, rateType, primeExchangeRate]);

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function onAccountCodeChange(idx: number, code: string) {
    const normalized = (code || "").trim();
    const acc = accountByCode.get(normalized);
    updateLine(idx, { account_code: normalized, account_id: acc?.id || null });
  }

  function applyUsd(idx: number, usd: string) {
    const rate = toNum(exchangeRate);
    const n = toNum(usd);
    const lbp = rate > 0 ? (n * rate).toFixed(2) : "";
    updateLine(idx, { amount_usd: usd, amount_lbp: lbp });
  }

  function applyLbp(idx: number, lbp: string) {
    const rate = toNum(exchangeRate);
    const n = toNum(lbp);
    const usd = rate > 0 ? (n / rate).toFixed(4) : "";
    updateLine(idx, { amount_lbp: lbp, amount_usd: usd });
  }

  async function createManualJournal(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setStatus("Creating...");
    try {
      const payload = {
        journal_date: journalDate,
        rate_type: rateType,
        exchange_rate: Number(exchangeRate || 0),
        memo: memo.trim() || null,
        lines: lines
          .filter((l) => l.account_id && (toNum(l.amount_usd) !== 0 || toNum(l.amount_lbp) !== 0))
          .map((l) => ({
            account_id: l.account_id,
            side: l.side,
            amount_usd: Number(l.amount_usd || 0),
            amount_lbp: Number(l.amount_lbp || 0),
            memo: l.memo.trim() || null,
            cost_center_id: l.cost_center_id || null,
            project_id: l.project_id || null
          }))
      };
      const res = await apiPost<{ id: string; journal_no: string }>("/accounting/manual-journals", payload);
      setCreateOpen(false);
      setMemo("");
      setLines([
        { key: `l-${Date.now()}-1`, side: "debit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "", cost_center_id: "", project_id: "" },
        { key: `l-${Date.now()}-2`, side: "credit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "", cost_center_id: "", project_id: "" }
      ]);
      await load();
      await loadDetail(res.id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  async function reverseSelected() {
    if (!detail?.journal?.id) return;
    setReversing(true);
    setStatus("Reversing...");
    try {
      const res = await apiPost<{ id: string; journal_no: string }>(`/accounting/journals/${detail.journal.id}/reverse`, {
        memo: null
      });
      setReverseOpen(false);
      await load();
      await loadDetail(res.id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setReversing(false);
    }
  }

  return (
    <div className="ui-module-shell">
        <div className="ui-module-head">
          <div className="ui-module-head-row">
            <div>
              <p className="ui-module-kicker">Accounting</p>
              <h1 className="ui-module-title">Journals</h1>
              <p className="ui-module-subtitle">Review posted journals and create balanced manual entries.</p>
            </div>
          </div>
        </div>
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Journal List</CardTitle>
              <CardDescription>{journals.length} recent journals (max 500)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline">Filters</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-xl">
                      <DialogHeader>
                        <DialogTitle>Filters</DialogTitle>
                        <DialogDescription>Narrow down the journal list.</DialogDescription>
                      </DialogHeader>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-xs font-medium text-fg-muted">Search</label>
                          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Journal no or memo..." />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Start Date</label>
                          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">End Date</label>
                          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-xs font-medium text-fg-muted">Source Type</label>
                          <Input value={sourceType} onChange={(e) => setSourceType(e.target.value)} placeholder="manual_journal, sales_invoice..." />
                        </div>
                        <div className="flex justify-end md:col-span-2">
                          <Button
                            onClick={async () => {
                              setFiltersOpen(false);
                              await load();
                            }}
                          >
                            Apply
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Button variant="outline" onClick={load}>
                    Refresh
                  </Button>
                </div>

                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                  <DialogTrigger asChild>
                    <Button>New Manual Journal</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Manual Journal</DialogTitle>
                      <DialogDescription>Balanced dual-currency entry. Small rounding differences auto-balance to the ROUNDING account.</DialogDescription>
                    </DialogHeader>

                    <datalist id="coa-accounts">
                      {accounts.map((a) => (
                        <option key={a.id} value={a.account_code}>
                          {a.name_en || ""}
                        </option>
                      ))}
                    </datalist>

                    <form onSubmit={createManualJournal} className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Date</label>
                          <Input
                            type="date"
                            value={journalDate}
                            onChange={(e) => {
                              setJournalDate(e.target.value);
                              primeExchangeRate(e.target.value, rateType);
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Rate Type</label>
                          <Input
                            value={rateType}
                            onChange={(e) => {
                              setRateType(e.target.value);
                              primeExchangeRate(journalDate, e.target.value);
                            }}
                            placeholder="market"
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD→LL)</label>
                          <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
                        </div>
                        <div className="space-y-1 md:col-span-4">
                          <label className="text-xs font-medium text-fg-muted">Memo (optional)</label>
                          <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Why are we booking this?" />
                        </div>
                      </div>

                      <div className="ui-table-scroll">
                        <table className="ui-table">
                          <thead className="ui-thead">
                            <tr>
                              <th className="px-3 py-2">Side</th>
                              <th className="px-3 py-2">Account</th>
                              <th className="px-3 py-2 text-right">USD</th>
                              <th className="px-3 py-2 text-right">LL</th>
                              <th className="px-3 py-2">Memo</th>
                              <th className="px-3 py-2">Cost Center</th>
                              <th className="px-3 py-2">Project</th>
                              <th className="px-3 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((l, idx) => {
                              const acc = l.account_code ? accountByCode.get(l.account_code) : undefined;
                              return (
                                <tr key={l.key} className="border-t border-border-subtle align-top">
                                  <td className="px-3 py-2">
                                    <select
                                      className="h-9 w-28 rounded-md border border-border bg-bg-elevated px-2 text-sm"
                                      value={l.side}
                                      onChange={(e) => updateLine(idx, { side: e.target.value as "debit" | "credit" })}
                                    >
                                      <option value="debit">Debit</option>
                                      <option value="credit">Credit</option>
                                    </select>
                                  </td>
                                  <td className="px-3 py-2">
                                    <Input
                                      list="coa-accounts"
                                      value={l.account_code}
                                      onChange={(e) => onAccountCodeChange(idx, e.target.value)}
                                      placeholder="Account code..."
                                    />
                                    <div className="mt-1 text-xs text-fg-subtle">
                                      {acc?.name_en || (l.account_code ? "Unknown account" : "")}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <Input
                                      value={l.amount_usd}
                                      onChange={(e) => applyUsd(idx, e.target.value)}
                                      placeholder="0.0000"
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <Input
                                      value={l.amount_lbp}
                                      onChange={(e) => applyLbp(idx, e.target.value)}
                                      placeholder="0.00"
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <Input value={l.memo} onChange={(e) => updateLine(idx, { memo: e.target.value })} placeholder="Line memo..." />
                                  </td>
                                  <td className="px-3 py-2">
                                    <select
                                      className="ui-select"
                                      value={l.cost_center_id}
                                      onChange={(e) => updateLine(idx, { cost_center_id: e.target.value })}
                                    >
                                      <option value="">-</option>
                                      {costCenters
                                        .filter((x) => x.is_active)
                                        .map((x) => (
                                          <option key={x.id} value={x.id}>
                                            {x.code} {x.name ? `- ${x.name}` : ""}
                                          </option>
                                        ))}
                                    </select>
                                  </td>
                                  <td className="px-3 py-2">
                                    <select className="ui-select" value={l.project_id} onChange={(e) => updateLine(idx, { project_id: e.target.value })}>
                                      <option value="">-</option>
                                      {projects
                                        .filter((x) => x.is_active)
                                        .map((x) => (
                                          <option key={x.id} value={x.id}>
                                            {x.code} {x.name ? `- ${x.name}` : ""}
                                          </option>
                                        ))}
                                    </select>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                                      disabled={lines.length <= 2}
                                    >
                                      Remove
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="border-t border-border bg-bg-sunken/20">
                            <tr>
                              <td className="px-3 py-2 text-xs font-semibold text-fg-muted" colSpan={2}>
                                Totals
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs">
                                D {fmt(totals.dUsd, 4)} / C {fmt(totals.cUsd, 4)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs">
                                D {fmt(totals.dLbp, 2)} / C {fmt(totals.cLbp, 2)}
                              </td>
                              <td className="px-3 py-2 text-xs text-fg-muted" colSpan={4}>
                                Diff USD {fmt(totals.diffUsd, 4)} | Diff LL {fmt(totals.diffLbp, 2)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setLines((prev) => [
                              ...prev,
                              {
                                key: `l-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                                side: "debit",
                                account_code: "",
                                account_id: null,
                                memo: "",
                                amount_usd: "",
                                amount_lbp: "",
                                cost_center_id: "",
                                project_id: ""
                              }
                            ])
                          }
                        >
                          Add Line
                        </Button>
                        <Button type="submit" disabled={creating}>
                          {creating ? "..." : "Create Journal"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>

              <DataTable<JournalRow>
                tableId="accounting.journals.list"
                rows={journals}
                columns={journalColumns}
                onRowClick={(j) => loadDetail(j.id)}
                getRowId={(j) => j.id}
                initialSort={{ columnId: "journal_date", dir: "desc" }}
                globalFilterPlaceholder="Search journal no / memo / source..."
                emptyText="No journals."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Journal Detail</CardTitle>
              <CardDescription>{detail ? detail.journal.journal_no : "Select a journal to inspect entries."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail ? (
                <>
                  <div className="rounded-md border border-border bg-bg-elevated p-3 text-sm">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <div>
                        <div className="text-sm text-fg-subtle">Date</div>
                        <div className="font-mono text-sm">{detail.journal.journal_date}</div>
                      </div>
                      <div>
                        <div className="text-sm text-fg-subtle">Source</div>
                        <div className="text-sm text-fg-muted">{detail.journal.source_type || "-"}</div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-sm text-fg-subtle">Memo</div>
                        <div className="text-sm text-fg-muted">{detail.journal.memo || "-"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <Button variant="outline" onClick={() => loadDetail(detail.journal.id)}>
                      Refresh
                    </Button>
                    <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
                      <DialogTrigger asChild>
                        <Button variant="secondary">Reverse</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Reverse Journal</DialogTitle>
                          <DialogDescription>This creates a new journal with inverted debits/credits.</DialogDescription>
                        </DialogHeader>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={() => setReverseOpen(false)}>
                            Cancel
                          </Button>
                          <Button onClick={reverseSelected} disabled={reversing}>
                            {reversing ? "..." : "Reverse"}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <DataTable<JournalEntry>
                    tableId={`accounting.journals.${detail.journal.id}.entries`}
                    rows={detail.entries}
                    columns={entryColumns}
                    initialSort={{ columnId: "account", dir: "asc" }}
                    globalFilterPlaceholder="Search account / dims..."
                    emptyText="No entries."
                  />
                </>
              ) : (
                <p className="text-sm text-fg-muted">Pick a journal from the list to see entries.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>);
}
