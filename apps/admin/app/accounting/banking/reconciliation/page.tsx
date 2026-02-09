"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { MoneyInput } from "@/components/money-input";
import { useToast } from "@/components/toast-provider";

type BankAccountRow = {
  id: string;
  name: string;
  currency: "USD" | "LBP";
  gl_account_id: string;
  account_code: string;
  name_en: string | null;
  is_active: boolean;
};
type CoaAccount = { id: string; account_code: string; name_en: string | null };

type BankTxnRow = {
  id: string;
  bank_account_id: string;
  bank_account_name: string;
  currency: "USD" | "LBP";
  txn_date: string;
  direction: "inflow" | "outflow";
  amount_usd: string | number;
  amount_lbp: string | number;
  description: string | null;
  reference: string | null;
  counterparty: string | null;
  matched_journal_id: string | null;
  matched_at: string | null;
  created_at: string;
};

type JournalRow = {
  id: string;
  journal_no: string;
  journal_date: string;
  memo: string | null;
  created_at: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n: string | number, frac = 2) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

export default function BankingReconciliationPage() {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [coaAccounts, setCoaAccounts] = useState<CoaAccount[]>([]);
  const [txns, setTxns] = useState<BankTxnRow[]>([]);

  const [bankAccountId, setBankAccountId] = useState("");
  const [matched, setMatched] = useState<"" | "true" | "false">("false");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [txnBankAccountId, setTxnBankAccountId] = useState("");
  const [txnDate, setTxnDate] = useState(todayIso());
  const [direction, setDirection] = useState<"inflow" | "outflow">("inflow");
  const [amountUsd, setAmountUsd] = useState("");
  const [amountLbp, setAmountLbp] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [counterparty, setCounterparty] = useState("");

  const [matchOpen, setMatchOpen] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchTxnId, setMatchTxnId] = useState("");
  const [journalId, setJournalId] = useState("");
  const [journalQuery, setJournalQuery] = useState("");
  const [journalHits, setJournalHits] = useState<JournalRow[]>([]);

  const [createJournalOpen, setCreateJournalOpen] = useState(false);
  const [creatingJournal, setCreatingJournal] = useState(false);
  const [createTxnId, setCreateTxnId] = useState("");
  const [offsetAccountCode, setOffsetAccountCode] = useState("");
  const [createMemo, setCreateMemo] = useState("");

  async function loadBankAccounts() {
    const res = await apiGet<{ accounts: BankAccountRow[] }>("/banking/accounts");
    setBankAccounts((res.accounts || []).filter((a) => a.is_active));
  }

  async function loadCoa() {
    const res = await apiGet<{ accounts: CoaAccount[] }>("/coa/accounts");
    setCoaAccounts(res.accounts || []);
  }

  const loadTxns = useCallback(async () => {
    setStatus("Loading...");
    try {
      const qs = new URLSearchParams();
      if (bankAccountId) qs.set("bank_account_id", bankAccountId);
      if (matched) qs.set("matched", matched);
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      qs.set("limit", "500");
      const res = await apiGet<{ transactions: BankTxnRow[] }>(`/banking/transactions?${qs.toString()}`);
      setTxns(res.transactions || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [bankAccountId, matched, dateFrom, dateTo]);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadBankAccounts(), loadCoa()]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(message);
      }
    })();
  }, []);

  useEffect(() => {
    loadTxns();
  }, [loadTxns]);

  async function createTxn(e: React.FormEvent) {
    e.preventDefault();
    if (!txnBankAccountId) return setStatus("Pick a bank account.");
    const usd = (() => {
      const r = parseNumberInput(amountUsd);
      return r.ok ? r.value : 0;
    })();
    const lbp = (() => {
      const r = parseNumberInput(amountLbp);
      return r.ok ? r.value : 0;
    })();
    if (usd <= 0 && lbp <= 0) return setStatus("Enter an amount.");
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost<{ id: string }>("/banking/transactions", {
        bank_account_id: txnBankAccountId,
        txn_date: txnDate,
        direction,
        amount_usd: usd,
        amount_lbp: lbp,
        description: description.trim() || null,
        reference: reference.trim() || null,
        counterparty: counterparty.trim() || null
      });
      toast.success("Transaction added", "Statement line recorded successfully.");
      setCreateOpen(false);
      setTxnBankAccountId("");
      setTxnDate(todayIso());
      setDirection("inflow");
      setAmountUsd("");
      setAmountLbp("");
      setDescription("");
      setReference("");
      setCounterparty("");
      await loadTxns();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  function openMatch(txnId: string) {
    setMatchTxnId(txnId);
    setJournalId("");
    setJournalQuery("");
    setJournalHits([]);
    setMatchOpen(true);
  }

  function openCreateJournal(txnId: string) {
    const t = txns.find((x) => x.id === txnId);
    if (!t) return;
    setCreateTxnId(txnId);
    setOffsetAccountCode("");
    const baseMemo = [t.description, t.reference, t.counterparty].filter(Boolean).join(" · ");
    setCreateMemo(baseMemo || "Bank transaction");
    setCreateJournalOpen(true);
  }

  async function createAndMatchJournal() {
    if (!createTxnId) return;
    const t = txns.find((x) => x.id === createTxnId);
    if (!t) return;
    const bankAcc = bankAccounts.find((b) => b.id === t.bank_account_id);
    const bankGlId = bankAcc?.gl_account_id as string | undefined;
    if (!bankGlId) {
      setStatus("Bank account GL mapping is missing. Set it in Bank Accounts.");
      return;
    }

    const code = (offsetAccountCode || "").trim();
    const offset = coaAccounts.find((a) => a.account_code === code);
    if (!offset) {
      setStatus("Offset account code is invalid.");
      return;
    }

    const usd = Number(t.amount_usd || 0);
    const lbp = Number(t.amount_lbp || 0);
    if (usd === 0 && lbp === 0) {
      setStatus("Transaction amount is zero.");
      return;
    }

    const memo = (createMemo || "").trim() || null;
    const journalDate = t.txn_date;

    const inflow = t.direction === "inflow";
    const lines = inflow
      ? [
          { side: "debit", account_id: bankGlId, amount_usd: usd, amount_lbp: lbp, memo: "Bank" },
          { side: "credit", account_id: offset.id, amount_usd: usd, amount_lbp: lbp, memo: "Offset" }
        ]
      : [
          { side: "debit", account_id: offset.id, amount_usd: usd, amount_lbp: lbp, memo: "Offset" },
          { side: "credit", account_id: bankGlId, amount_usd: usd, amount_lbp: lbp, memo: "Bank" }
        ];

    setCreatingJournal(true);
    setStatus("Creating journal...");
    try {
      const res = await apiPost<{ id: string; journal_no: string }>("/accounting/manual-journals", {
        journal_date: journalDate,
        rate_type: "market",
        exchange_rate: null,
        memo,
        lines
      });
      setStatus("Matching...");
      await apiPost(`/banking/transactions/${createTxnId}/match`, { journal_id: res.id });
      setCreateJournalOpen(false);
      setCreateTxnId("");
      await loadTxns();
      setStatus(`Created ${res.journal_no} and matched.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreatingJournal(false);
    }
  }

  async function searchJournals(q: string) {
    const needle = (q || "").trim();
    setJournalQuery(needle);
    if (!needle) {
      setJournalHits([]);
      return;
    }
    try {
      const qs = new URLSearchParams();
      qs.set("q", needle);
      qs.set("start_date", "");
      qs.set("end_date", "");
      const res = await apiGet<{ journals: any[] }>(`/accounting/journals?${qs.toString()}`);
      const hits = (res.journals || []).slice(0, 15).map((j) => ({
        id: j.id,
        journal_no: j.journal_no,
        journal_date: j.journal_date,
        memo: j.memo,
        created_at: j.created_at
      })) as JournalRow[];
      setJournalHits(hits);
    } catch {
      setJournalHits([]);
    }
  }

  async function match() {
    if (!matchTxnId) return;
    if (!journalId.trim()) return setStatus("Journal ID is required.");
    setMatching(true);
    setStatus("Matching...");
    try {
      await apiPost(`/banking/transactions/${matchTxnId}/match`, { journal_id: journalId.trim() });
      setMatchOpen(false);
      await loadTxns();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setMatching(false);
    }
  }

  async function unmatch(txnId: string) {
    setStatus("Unmatching...");
    try {
      await apiPost(`/banking/transactions/${txnId}/unmatch`, {});
      await loadTxns();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={loadTxns} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Limit transactions for faster matching.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Bank Account</label>
              <select
                className="ui-select"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">All</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Matched</label>
              <select
                className="ui-select"
                value={matched}
                onChange={(e) => setMatched(e.target.value as any)}
              >
                <option value="">All</option>
                <option value="false">Unmatched</option>
                <option value="true">Matched</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">From</label>
              <Input value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} type="date" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">To</label>
              <Input value={dateTo} onChange={(e) => setDateTo(e.target.value)} type="date" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
            <CardDescription>{txns.length} rows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={loadTxns}>
                Refresh
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button>Add Transaction</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Bank Transaction</DialogTitle>
                    <DialogDescription>Record a statement line, then match it to a journal.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createTxn} className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Bank Account</label>
                      <select
                        className="ui-select"
                        value={txnBankAccountId}
                        onChange={(e) => setTxnBankAccountId(e.target.value)}
                      >
                        <option value="">Select...</option>
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.currency})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Date</label>
                        <Input value={txnDate} onChange={(e) => setTxnDate(e.target.value)} type="date" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Direction</label>
                        <select
                          className="ui-select"
                          value={direction}
                          onChange={(e) => setDirection(e.target.value as any)}
                        >
                          <option value="inflow">Inflow</option>
                          <option value="outflow">Outflow</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <MoneyInput
                        label="Amount"
                        currency="USD"
                        value={amountUsd}
                        onChange={setAmountUsd}
                        placeholder="0"
                        quick={[0, 1, 10]}
                        disabled={creating}
                      />
                      <MoneyInput
                        label="Amount"
                        currency="LBP"
                        value={amountLbp}
                        onChange={setAmountLbp}
                        placeholder="0"
                        quick={[0, 1, 10]}
                        disabled={creating}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Reference (optional)</label>
                        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / transfer ref" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Counterparty (optional)</label>
                        <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="Bank / customer / supplier" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Description (optional)</label>
                      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Statement text" />
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={creating}>
                        {creating ? "..." : "Create"}
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
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Dir</th>
                    <th className="px-3 py-2">USD</th>
                    <th className="px-3 py-2">LL</th>
                    <th className="px-3 py-2">Ref</th>
                    <th className="px-3 py-2">Matched</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t) => (
                    <tr key={t.id} className="ui-tr-hover">
                      <td className="px-3 py-2 text-xs">{t.txn_date}</td>
                      <td className="px-3 py-2">
                        <div className="text-sm font-medium">{t.bank_account_name}</div>
                        <div className="text-xs text-fg-subtle">{t.description || ""}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{t.direction}</td>
                      <td className="px-3 py-2 font-mono text-xs">{fmt(t.amount_usd)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{fmt(t.amount_lbp, 0)}</td>
                      <td className="px-3 py-2 text-xs">{t.reference || "-"}</td>
                      <td className="px-3 py-2 text-xs">{t.matched_journal_id ? "yes" : "no"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          {!t.matched_journal_id ? (
                            <>
                              <Button variant="outline" size="sm" onClick={() => openCreateJournal(t.id)}>
                                Create Journal
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => openMatch(t.id)}>
                                Match
                              </Button>
                            </>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => unmatch(t.id)}>
                              Unmatch
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {txns.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={8}>
                        No transactions.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={matchOpen} onOpenChange={setMatchOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Match Transaction</DialogTitle>
              <DialogDescription>Link a statement line to a journal entry.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Journal ID</label>
                <Input value={journalId} onChange={(e) => setJournalId(e.target.value)} placeholder="uuid" />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Find Journal</CardTitle>
                  <CardDescription>Search by journal number or memo (fills Journal ID).</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Input
                    value={journalQuery}
                    onChange={(e) => searchJournals(e.target.value)}
                    placeholder="Search journals..."
                  />
                  <div className="max-h-48 overflow-auto rounded-md border border-border">
                    {journalHits.map((j) => (
                      <button
                        key={j.id}
                        className="flex w-full items-start justify-between gap-2 border-b border-border-subtle px-3 py-2 text-left text-sm hover:bg-bg-sunken/20"
                        onClick={() => setJournalId(j.id)}
                        type="button"
                      >
                        <div>
                          <div className="font-mono text-xs">{j.journal_no}</div>
                          <div className="text-xs text-fg-muted">{j.memo || ""}</div>
                        </div>
                        <div className="text-xs text-fg-subtle">{j.journal_date}</div>
                      </button>
                    ))}
                    {journalQuery && journalHits.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-fg-subtle">No matches.</div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setMatchOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={match} disabled={matching}>
                  {matching ? "..." : "Match"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={createJournalOpen} onOpenChange={setCreateJournalOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Journal From Transaction</DialogTitle>
              <DialogDescription>
                Creates a manual journal using the bank account GL mapping and matches this transaction automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Offset Account Code</label>
                <Input
                  value={offsetAccountCode}
                  onChange={(e) => setOffsetAccountCode(e.target.value)}
                  placeholder="e.g. 400100 (Sales) or 610100 (Expense)"
                  list="coaCodesReconcile"
                />
                <datalist id="coaCodesReconcile">
                  {coaAccounts.slice(0, 2000).map((a) => (
                    <option key={a.id} value={a.account_code}>
                      {a.name_en || ""}
                    </option>
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Memo (optional)</label>
                <Input value={createMemo} onChange={(e) => setCreateMemo(e.target.value)} placeholder="Statement description" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateJournalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={createAndMatchJournal} disabled={creatingJournal}>
                  {creatingJournal ? "..." : "Create + Match"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>);
}
