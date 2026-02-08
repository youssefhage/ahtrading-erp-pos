"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type CoaAccount = {
  id: string;
  account_code: string;
  name_en: string | null;
};

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
    { key: "l1", side: "debit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "" },
    { key: "l2", side: "credit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "" }
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

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (sourceType) params.set("source_type", sourceType);
      const [j, a] = await Promise.all([
        apiGet<{ journals: JournalRow[] }>(`/accounting/journals${params.toString() ? `?${params.toString()}` : ""}`),
        apiGet<{ accounts: CoaAccount[] }>("/coa/accounts")
      ]);
      setJournals(j.journals || []);
      setAccounts(a.accounts || []);
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
      const res = await apiGet<{ rates: RateRow[] }>("/config/exchange-rates");
      const rates = res.rates || [];
      const exact = rates.find((r) => r.rate_type === nextRateType && r.rate_date === nextDate);
      const latestSameType = rates.find((r) => r.rate_type === nextRateType);
      const rate = exact?.usd_to_lbp ?? latestSameType?.usd_to_lbp ?? 0;
      setExchangeRate(String(rate));
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
            memo: l.memo.trim() || null
          }))
      };
      const res = await apiPost<{ id: string; journal_no: string }>("/accounting/manual-journals", payload);
      setCreateOpen(false);
      setMemo("");
      setLines([
        { key: `l-${Date.now()}-1`, side: "debit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "" },
        { key: `l-${Date.now()}-2`, side: "credit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "" }
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
    <div className="mx-auto max-w-7xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors and validations show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

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

                      <div className="ui-table-wrap">
                        <table className="ui-table">
                          <thead className="ui-thead">
                            <tr>
                              <th className="px-3 py-2">Side</th>
                              <th className="px-3 py-2">Account</th>
                              <th className="px-3 py-2 text-right">USD</th>
                              <th className="px-3 py-2 text-right">LL</th>
                              <th className="px-3 py-2">Memo</th>
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
                                    <div className="mt-1 text-[11px] text-fg-subtle">
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
                              <td className="px-3 py-2 text-xs text-fg-muted" colSpan={2}>
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
                                amount_lbp: ""
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

              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">No</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Memo</th>
                      <th className="px-3 py-2">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journals.map((j) => (
                      <tr
                        key={j.id}
                        className="cursor-pointer border-t border-border-subtle hover:bg-bg-sunken/20"
                        onClick={() => loadDetail(j.id)}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{j.journal_date}</td>
                        <td className="px-3 py-2 font-mono text-xs">{j.journal_no}</td>
                        <td className="px-3 py-2 text-xs text-fg-muted">{j.source_type || "-"}</td>
                        <td className="px-3 py-2 text-xs text-fg-muted">{j.memo || ""}</td>
                        <td className="px-3 py-2 text-xs text-fg-muted">{j.created_by_email || "-"}</td>
                      </tr>
                    ))}
                    {journals.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                          No journals.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
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
                        <div className="text-xs text-fg-subtle">Date</div>
                        <div className="font-mono text-xs">{detail.journal.journal_date}</div>
                      </div>
                      <div>
                        <div className="text-xs text-fg-subtle">Source</div>
                        <div className="text-xs text-fg-muted">{detail.journal.source_type || "-"}</div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-xs text-fg-subtle">Memo</div>
                        <div className="text-xs text-fg-muted">{detail.journal.memo || "-"}</div>
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

                  <div className="ui-table-wrap">
                    <table className="ui-table">
                      <thead className="ui-thead">
                        <tr>
                          <th className="px-3 py-2">Account</th>
                          <th className="px-3 py-2 text-right">Debit USD</th>
                          <th className="px-3 py-2 text-right">Credit USD</th>
                          <th className="px-3 py-2 text-right">Debit LL</th>
                          <th className="px-3 py-2 text-right">Credit LL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.entries.map((e) => (
                          <tr key={e.id} className="ui-tr-hover">
                            <td className="px-3 py-2">
                              <div className="font-mono text-xs">{e.account_code}</div>
                              <div className="text-xs text-fg-muted">{e.name_en || ""}</div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">{fmt(e.debit_usd, 4)}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs">{fmt(e.credit_usd, 4)}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs">{fmt(e.debit_lbp, 2)}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs">{fmt(e.credit_lbp, 2)}</td>
                          </tr>
                        ))}
                        {detail.entries.length === 0 ? (
                          <tr>
                            <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                              No entries.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-sm text-fg-muted">Pick a journal from the list to see entries.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>);
}
