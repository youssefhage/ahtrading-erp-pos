"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Link2, Unlink, FileText, ArrowDownUp } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { fmtUsd, fmtLbp } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { MoneyInput } from "@/components/money-input";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function n(v: unknown) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function BankingReconciliationPage() {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [coaAccounts, setCoaAccounts] = useState<CoaAccount[]>([]);
  const [txns, setTxns] = useState<BankTxnRow[]>([]);

  // Filters
  const [bankAccountId, setBankAccountId] = useState("");
  const [matched, setMatched] = useState<"" | "true" | "false">("false");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Create transaction dialog
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

  // Match dialog
  const [matchOpen, setMatchOpen] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchTxnId, setMatchTxnId] = useState("");
  const [journalId, setJournalId] = useState("");
  const [journalQuery, setJournalQuery] = useState("");
  const [journalHits, setJournalHits] = useState<JournalRow[]>([]);

  // Create journal dialog
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
    setLoadingTxns(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (bankAccountId) qs.set("bank_account_id", bankAccountId);
      if (matched) qs.set("matched", matched);
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      qs.set("limit", "500");
      const res = await apiGet<{ transactions: BankTxnRow[] }>(`/banking/transactions?${qs.toString()}`);
      setTxns(res.transactions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTxns(false);
    }
  }, [bankAccountId, matched, dateFrom, dateTo]);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadBankAccounts(), loadCoa()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  useEffect(() => {
    loadTxns();
  }, [loadTxns]);

  async function createTxn(e: React.FormEvent) {
    e.preventDefault();
    if (!txnBankAccountId) return setError("Pick a bank account.");
    const usd = (() => { const r = parseNumberInput(amountUsd); return r.ok ? r.value : 0; })();
    const lbp = (() => { const r = parseNumberInput(amountLbp); return r.ok ? r.value : 0; })();
    if (usd <= 0 && lbp <= 0) return setError("Enter an amount.");
    setCreating(true);
    setError(null);
    try {
      await apiPost<{ id: string }>("/banking/transactions", {
        bank_account_id: txnBankAccountId,
        txn_date: txnDate,
        direction,
        amount_usd: usd,
        amount_lbp: lbp,
        description: description.trim() || null,
        reference: reference.trim() || null,
        counterparty: counterparty.trim() || null,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const openMatch = useCallback((txnId: string) => {
    setMatchTxnId(txnId);
    setJournalId("");
    setJournalQuery("");
    setJournalHits([]);
    setMatchOpen(true);
  }, []);

  const openCreateJournal = useCallback(
    (txnId: string) => {
      const t = txns.find((x) => x.id === txnId);
      if (!t) return;
      setCreateTxnId(txnId);
      setOffsetAccountCode("");
      const baseMemo = [t.description, t.reference, t.counterparty].filter(Boolean).join(" - ");
      setCreateMemo(baseMemo || "Bank transaction");
      setCreateJournalOpen(true);
    },
    [txns],
  );

  async function createAndMatchJournal() {
    if (!createTxnId) return;
    const t = txns.find((x) => x.id === createTxnId);
    if (!t) return;
    const bankAcc = bankAccounts.find((b) => b.id === t.bank_account_id);
    const bankGlId = bankAcc?.gl_account_id as string | undefined;
    if (!bankGlId) {
      setError("Bank account GL mapping is missing. Set it in Bank Accounts.");
      return;
    }

    const code = (offsetAccountCode || "").trim();
    const offset = coaAccounts.find((a) => a.account_code === code);
    if (!offset) {
      setError("Offset account code is invalid.");
      return;
    }

    const usd = Number(t.amount_usd || 0);
    const lbp = Number(t.amount_lbp || 0);
    if (usd === 0 && lbp === 0) {
      setError("Transaction amount is zero.");
      return;
    }

    const memo = (createMemo || "").trim() || null;
    const journalDate = t.txn_date;

    const inflow = t.direction === "inflow";
    const lines = inflow
      ? [
          { side: "debit", account_id: bankGlId, amount_usd: usd, amount_lbp: lbp, memo: "Bank" },
          { side: "credit", account_id: offset.id, amount_usd: usd, amount_lbp: lbp, memo: "Offset" },
        ]
      : [
          { side: "debit", account_id: offset.id, amount_usd: usd, amount_lbp: lbp, memo: "Offset" },
          { side: "credit", account_id: bankGlId, amount_usd: usd, amount_lbp: lbp, memo: "Bank" },
        ];

    setCreatingJournal(true);
    setError(null);
    try {
      const res = await apiPost<{ id: string; journal_no: string }>("/accounting/manual-journals", {
        journal_date: journalDate,
        rate_type: "market",
        exchange_rate: null,
        memo,
        lines,
      });
      await apiPost(`/banking/transactions/${createTxnId}/match`, { journal_id: res.id });
      setCreateJournalOpen(false);
      setCreateTxnId("");
      await loadTxns();
      toast.success("Matched", `Created ${res.journal_no} and matched successfully.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      const res = await apiGet<{ journals: JournalRow[] }>(`/accounting/journals?${qs.toString()}`);
      setJournalHits((res.journals || []).slice(0, 15));
    } catch {
      setJournalHits([]);
    }
  }

  async function matchTxn() {
    if (!matchTxnId) return;
    if (!journalId.trim()) return setError("Journal ID is required.");
    setMatching(true);
    setError(null);
    try {
      await apiPost(`/banking/transactions/${matchTxnId}/match`, { journal_id: journalId.trim() });
      setMatchOpen(false);
      await loadTxns();
      toast.success("Matched", "Transaction linked to journal.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMatching(false);
    }
  }

  const unmatch = useCallback(
    async (txnId: string) => {
      setError(null);
      try {
        await apiPost(`/banking/transactions/${txnId}/unmatch`, {});
        await loadTxns();
        toast.success("Unmatched", "Transaction unlinked.");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [loadTxns, toast],
  );

  const txnColumns = useMemo<ColumnDef<BankTxnRow>[]>(
    () => [
      {
        id: "txn_date",
        accessorFn: (t) => t.txn_date,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.txn_date}</span>,
      },
      {
        id: "bank_account_name",
        accessorFn: (t) => `${t.bank_account_name || ""} ${t.description || ""}`.trim(),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-sm">{row.original.bank_account_name}</p>
            {row.original.description && (
              <p className="text-xs text-muted-foreground">{row.original.description}</p>
            )}
          </div>
        ),
      },
      {
        id: "direction",
        accessorFn: (t) => t.direction,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Dir" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.direction} />
        ),
      },
      {
        id: "amount_usd",
        accessorFn: (t) => n(t.amount_usd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="USD" className="justify-end" />,
        cell: ({ row }) => <CurrencyDisplay amount={n(row.original.amount_usd)} currency="USD" />,
      },
      {
        id: "amount_lbp",
        accessorFn: (t) => n(t.amount_lbp),
        header: ({ column }) => <DataTableColumnHeader column={column} title="LBP" className="justify-end" />,
        cell: ({ row }) => <CurrencyDisplay amount={n(row.original.amount_lbp)} currency="LBP" />,
      },
      {
        id: "reference",
        accessorFn: (t) => t.reference || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ref" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.reference || "-"}</span>
        ),
      },
      {
        id: "matched",
        accessorFn: (t) => (t.matched_journal_id ? "yes" : "no"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Matched" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.matched_journal_id ? "active" : "draft"} />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="flex justify-end gap-2">
              {!t.matched_journal_id ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => openCreateJournal(t.id)}>
                    <FileText className="mr-1 h-3 w-3" />
                    Create Journal
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openMatch(t.id)}>
                    <Link2 className="mr-1 h-3 w-3" />
                    Match
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => unmatch(t.id)}>
                  <Unlink className="mr-1 h-3 w-3" />
                  Unmatch
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [openCreateJournal, openMatch, unmatch],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Reconciliation"
        description="Record statement lines and match them to accounting journals."
        actions={
          <Button variant="outline" size="sm" onClick={loadTxns} disabled={loadingTxns}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loadingTxns ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {error && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={loadTxns}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <p className="text-sm text-muted-foreground">Limit transactions for faster matching.</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Bank Account</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">All</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Matched</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={matched}
                onChange={(e) => setMatched(e.target.value as "" | "true" | "false")}
              >
                <option value="">All</option>
                <option value="false">Unmatched</option>
                <option value="true">Matched</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>From</Label>
              <Input value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} type="date" />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <Input value={dateTo} onChange={(e) => setDateTo(e.target.value)} type="date" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Transactions</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{txns.length} rows</p>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Transaction
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Bank Transaction</DialogTitle>
                  <DialogDescription>Record a statement line, then match it to a journal.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createTxn} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Bank Account</Label>
                    <select
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={txnBankAccountId}
                      onChange={(e) => setTxnBankAccountId(e.target.value)}
                    >
                      <option value="">Select...</option>
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Input value={txnDate} onChange={(e) => setTxnDate(e.target.value)} type="date" />
                    </div>
                    <div className="space-y-2">
                      <Label>Direction</Label>
                      <select
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                        value={direction}
                        onChange={(e) => setDirection(e.target.value as "inflow" | "outflow")}
                      >
                        <option value="inflow">Inflow</option>
                        <option value="outflow">Outflow</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Reference (optional)</Label>
                      <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / transfer ref" />
                    </div>
                    <div className="space-y-2">
                      <Label>Counterparty (optional)</Label>
                      <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="Bank / customer / supplier" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Description (optional)</Label>
                    <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Statement text" />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating}>
                      {creating ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {!loadingTxns && txns.length === 0 ? (
            <EmptyState
              icon={ArrowDownUp}
              title="No transactions"
              description="Add a bank transaction to start reconciling."
              action={{ label: "Add Transaction", onClick: () => setCreateOpen(true) }}
            />
          ) : (
            <DataTable
              columns={txnColumns}
              data={txns}
              isLoading={loadingTxns}
              searchPlaceholder="Search account / description / ref..."
              pageSize={50}
            />
          )}
        </CardContent>
      </Card>

      {/* Match Dialog */}
      <Dialog open={matchOpen} onOpenChange={setMatchOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Match Transaction</DialogTitle>
            <DialogDescription>Link a statement line to a journal entry.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Journal ID</Label>
              <Input
                value={journalId}
                onChange={(e) => setJournalId(e.target.value)}
                placeholder="uuid"
                className="font-mono"
              />
            </div>
            <Card className="bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Find Journal</CardTitle>
                <p className="text-xs text-muted-foreground">Search by journal number or memo (fills Journal ID).</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input
                  value={journalQuery}
                  onChange={(e) => searchJournals(e.target.value)}
                  placeholder="Search journals..."
                />
                <div className="max-h-48 overflow-auto rounded-lg border">
                  {journalHits.map((j) => (
                    <button
                      key={j.id}
                      className="flex w-full items-start justify-between gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted/50"
                      onClick={() => setJournalId(j.id)}
                      type="button"
                    >
                      <div>
                        <div className="font-mono text-xs">{j.journal_no}</div>
                        <div className="text-xs text-muted-foreground">{j.memo || ""}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{j.journal_date}</div>
                    </button>
                  ))}
                  {journalQuery && journalHits.length === 0 && (
                    <div className="px-3 py-3 text-xs text-muted-foreground">No matches.</div>
                  )}
                </div>
              </CardContent>
            </Card>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMatchOpen(false)}>Cancel</Button>
              <Button onClick={matchTxn} disabled={matching}>
                {matching ? "Matching..." : "Match"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Journal Dialog */}
      <Dialog open={createJournalOpen} onOpenChange={setCreateJournalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Journal From Transaction</DialogTitle>
            <DialogDescription>
              Creates a manual journal using the bank account GL mapping and matches this transaction automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Offset Account Code</Label>
              <Input
                value={offsetAccountCode}
                onChange={(e) => setOffsetAccountCode(e.target.value)}
                placeholder="e.g. 400100 (Sales) or 610100 (Expense)"
                list="coaCodesReconcile"
              />
              <datalist id="coaCodesReconcile">
                {coaAccounts.slice(0, 2000).map((a) => (
                  <option key={a.id} value={a.account_code}>{a.name_en || ""}</option>
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>Memo (optional)</Label>
              <Input value={createMemo} onChange={(e) => setCreateMemo(e.target.value)} placeholder="Statement description" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateJournalOpen(false)}>Cancel</Button>
              <Button onClick={createAndMatchJournal} disabled={creatingJournal}>
                {creatingJournal ? "Creating..." : "Create + Match"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
