"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { BookOpen, Plus, RefreshCw, RotateCcw, Filter } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { fmtUsd, fmtLbp } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { ConfirmDialog } from "@/components/business/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

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

type LineField = "side" | "account_code" | "amount_usd" | "amount_lbp" | "memo" | "cost_center_id" | "project_id";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const lineFieldOrder: LineField[] = ["side", "account_code", "amount_usd", "amount_lbp", "memo", "cost_center_id", "project_id"];

function createLineDraft(side: "debit" | "credit" = "debit"): LineDraft {
  return {
    key: `l-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    side,
    account_code: "",
    account_id: null,
    memo: "",
    amount_usd: "",
    amount_lbp: "",
    cost_center_id: "",
    project_id: "",
  };
}

function resetDraftLines(): LineDraft[] {
  return [createLineDraft("debit"), createLineDraft("credit")];
}

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function n(v: unknown) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

function fmt(val: string | number, frac = 2) {
  return Number(val || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function JournalsPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [costCenters, setCostCenters] = useState<DimensionRow[]>([]);
  const [projects, setProjects] = useState<DimensionRow[]>([]);

  // Filters
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sourceType, setSourceType] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [journalDate, setJournalDate] = useState(todayIso());
  const [rateType, setRateType] = useState("market");
  const [exchangeRate, setExchangeRate] = useState("0");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => resetDraftLines());
  const [creating, setCreating] = useState(false);

  // Reverse
  const [reversing, setReversing] = useState(false);

  const statusIsBusy = /^(Creating|Reversing)\b/i.test(status);

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
  const isBalanced = Math.abs(totals.diffUsd) < 0.0001 && Math.abs(totals.diffLbp) < 0.01;

  /* ---- Columns ---- */

  const journalColumns = useMemo<ColumnDef<JournalRow>[]>(
    () => [
      {
        id: "journal_date",
        accessorFn: (r) => r.journal_date,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="font-mono text-sm">{formatDate(row.original.journal_date)}</span>,
      },
      {
        id: "journal_no",
        accessorFn: (r) => r.journal_no,
        header: ({ column }) => <DataTableColumnHeader column={column} title="No" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.journal_no}</span>,
      },
      {
        id: "source_type",
        accessorFn: (r) => r.source_type || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.source_type || "-"}</span>
        ),
      },
      {
        id: "memo",
        accessorFn: (r) => r.memo || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Memo" />,
        cell: ({ row }) => (
          <span className="max-w-[200px] truncate text-sm text-muted-foreground">
            {row.original.memo || ""}
          </span>
        ),
      },
      {
        id: "created_by_email",
        accessorFn: (r) => r.created_by_email || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="By" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.created_by_email || "-"}</span>
        ),
      },
    ],
    [],
  );

  const entryColumns = useMemo<ColumnDef<JournalEntry>[]>(
    () => [
      {
        id: "account",
        accessorFn: (e) => `${e.account_code || ""} ${e.name_en || ""}`.trim(),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-sm">{row.original.account_code}</div>
            <div className="text-xs text-muted-foreground">{row.original.name_en || ""}</div>
          </div>
        ),
      },
      {
        id: "dims",
        accessorFn: (e) => `${e.cost_center_code || ""} ${e.project_code || ""}`.trim(),
        header: "Dims",
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="text-xs text-muted-foreground">
              {e.cost_center_code ? <span className="font-mono">{e.cost_center_code}</span> : <span>-</span>}
              {e.project_code ? <span className="ml-2 font-mono">{e.project_code}</span> : null}
            </div>
          );
        },
      },
      {
        id: "debit_usd",
        accessorFn: (e) => n(e.debit_usd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Debit USD" className="justify-end" />,
        cell: ({ row }) => (
          <div className="text-right font-mono text-sm">{fmtUsd(row.original.debit_usd, { maximumFractionDigits: 4 })}</div>
        ),
      },
      {
        id: "credit_usd",
        accessorFn: (e) => n(e.credit_usd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Credit USD" className="justify-end" />,
        cell: ({ row }) => (
          <div className="text-right font-mono text-sm">{fmtUsd(row.original.credit_usd, { maximumFractionDigits: 4 })}</div>
        ),
      },
      {
        id: "debit_lbp",
        accessorFn: (e) => n(e.debit_lbp),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Debit LL" className="justify-end" />,
        cell: ({ row }) => (
          <div className="text-right font-mono text-sm text-muted-foreground">
            {fmtLbp(row.original.debit_lbp)}
          </div>
        ),
      },
      {
        id: "credit_lbp",
        accessorFn: (e) => n(e.credit_lbp),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Credit LL" className="justify-end" />,
        cell: ({ row }) => (
          <div className="text-right font-mono text-sm text-muted-foreground">
            {fmtLbp(row.original.credit_lbp)}
          </div>
        ),
      },
    ],
    [],
  );

  /* ---- Data loading ---- */

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("");
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
        apiGet<{ projects: DimensionRow[] }>("/dimensions/projects"),
      ]);
      setJournals(j.journals || []);
      setAccounts(a.accounts || []);
      setCostCenters(cc.cost_centers || []);
      setProjects(pr.projects || []);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [q, startDate, endDate, sourceType]);

  async function loadDetail(id: string) {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    setStatus("");
    try {
      const res = await apiGet<JournalDetail>(`/accounting/journals/${id}`);
      setDetail(res);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
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

  /* ---- Line editing helpers ---- */

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
    const val = toNum(usd);
    const lbp = rate > 0 ? (val * rate).toFixed(2) : "";
    updateLine(idx, { amount_usd: usd, amount_lbp: lbp });
  }

  function applyLbp(idx: number, lbp: string) {
    const rate = toNum(exchangeRate);
    const val = toNum(lbp);
    const usd = rate > 0 ? (val / rate).toFixed(4) : "";
    updateLine(idx, { amount_lbp: lbp, amount_usd: usd });
  }

  function focusLineField(lineIndex: number, field: LineField) {
    if (typeof document === "undefined") return;
    const selector = `[data-line-index="${lineIndex}"][data-line-field="${field}"]`;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) {
      try { el.select(); } catch { /* no-op */ }
    }
  }

  function moveToNextLineField(lineIndex: number, field: LineField) {
    const fieldIndex = lineFieldOrder.indexOf(field);
    if (fieldIndex < 0) return;
    const isLastField = fieldIndex === lineFieldOrder.length - 1;

    if (!isLastField) {
      focusLineField(lineIndex, lineFieldOrder[fieldIndex + 1]);
      return;
    }

    const nextLineIndex = lineIndex + 1;
    if (nextLineIndex >= lines.length) {
      setLines((prev) => [...prev, createLineDraft("debit")]);
      setTimeout(() => focusLineField(nextLineIndex, "side"), 0);
      return;
    }
    focusLineField(nextLineIndex, "side");
  }

  function handleLineKeyDown(e: React.KeyboardEvent<HTMLElement>, lineIndex: number, field: LineField) {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    moveToNextLineField(lineIndex, field);
  }

  /* ---- Actions ---- */

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
            project_id: l.project_id || null,
          })),
      };
      const res = await apiPost<{ id: string; journal_no: string }>("/accounting/manual-journals", payload);
      setCreateOpen(false);
      setMemo("");
      setLines(resetDraftLines());
      await load();
      await loadDetail(res.id);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function reverseSelected() {
    if (!detail?.journal?.id) return;
    setReversing(true);
    setStatus("Reversing...");
    try {
      const res = await apiPost<{ id: string; journal_no: string }>(
        `/accounting/journals/${detail.journal.id}/reverse`,
        { memo: null },
      );
      await load();
      await loadDetail(res.id);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setReversing(false);
    }
  }

  /* ---- Render ---- */

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        title="Journals"
        description="Review posted journals and create balanced manual entries."
        actions={
          <>
            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="mr-2 h-4 w-4" />
                  Filters
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Filter Journals</DialogTitle>
                  <DialogDescription>Narrow down the journal list.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Search</Label>
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Journal no or memo..." />
                  </div>
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Source Type</Label>
                    <Input
                      value={sourceType}
                      onChange={(e) => setSourceType(e.target.value)}
                      placeholder="manual_journal, sales_invoice..."
                    />
                  </div>
                  <div className="flex justify-end sm:col-span-2">
                    <Button onClick={async () => { setFiltersOpen(false); await load(); }}>Apply</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New Manual Journal
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[min(98vw,1200px)] max-w-none p-0">
                <DialogHeader className="border-b px-6 py-5">
                  <DialogTitle className="text-xl font-semibold">Manual Journal</DialogTitle>
                  <DialogDescription>
                    Balanced dual-currency entry. Small rounding differences auto-balance to the ROUNDING account.
                  </DialogDescription>
                </DialogHeader>

                <datalist id="coa-accounts">
                  {accounts.map((a) => (
                    <option key={a.id} value={a.account_code}>
                      {a.name_en || ""}
                    </option>
                  ))}
                </datalist>

                <form onSubmit={createManualJournal} className="space-y-5 px-6 pb-6 pt-5">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                        <div className="space-y-2 md:col-span-3">
                          <Label>Date</Label>
                          <Input
                            autoFocus
                            type="date"
                            value={journalDate}
                            onChange={(e) => {
                              setJournalDate(e.target.value);
                              primeExchangeRate(e.target.value, rateType);
                            }}
                          />
                        </div>
                        <div className="space-y-2 md:col-span-3">
                          <Label>Rate Type</Label>
                          <Input
                            value={rateType}
                            onChange={(e) => {
                              setRateType(e.target.value);
                              primeExchangeRate(journalDate, e.target.value);
                            }}
                            placeholder="market"
                          />
                        </div>
                        <div className="space-y-2 md:col-span-6">
                          <Label>Exchange Rate (USD to LL)</Label>
                          <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} inputMode="decimal" />
                        </div>
                        <div className="space-y-2 md:col-span-12">
                          <Label>Memo (optional)</Label>
                          <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Why are we booking this?" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold">Entry Lines</h3>
                        <p className="text-xs text-muted-foreground">
                          Use matching debit and credit totals before creating the journal.
                        </p>
                      </div>
                      <Badge variant={isBalanced ? "success" : "destructive"}>
                        {isBalanced ? "Balanced" : "Out of balance"}
                      </Badge>
                    </div>

                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full min-w-[1100px]">
                        <colgroup>
                          <col className="w-[130px]" />
                          <col className="w-[280px]" />
                          <col className="w-[140px]" />
                          <col className="w-[150px]" />
                          <col className="w-[220px]" />
                          <col className="w-[170px]" />
                          <col className="w-[170px]" />
                          <col className="w-[80px]" />
                        </colgroup>
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Side</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Account</th>
                            <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">USD</th>
                            <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">LL</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Memo</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Cost Center</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Project</th>
                            <th className="px-3 py-2.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((l, idx) => {
                            const acc = l.account_code ? accountByCode.get(l.account_code) : undefined;
                            return (
                              <tr key={l.key} className="border-b align-top">
                                <td className="px-3 py-2">
                                  <select
                                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                                    data-line-index={idx}
                                    data-line-field="side"
                                    value={l.side}
                                    onChange={(e) => updateLine(idx, { side: e.target.value as "debit" | "credit" })}
                                    onKeyDown={(e) => handleLineKeyDown(e, idx, "side")}
                                  >
                                    <option value="debit">Debit</option>
                                    <option value="credit">Credit</option>
                                  </select>
                                </td>
                                <td className="px-3 py-2">
                                  <Input
                                    list="coa-accounts"
                                    data-line-index={idx}
                                    data-line-field="account_code"
                                    value={l.account_code}
                                    onChange={(e) => onAccountCodeChange(idx, e.target.value)}
                                    onKeyDown={(e) => handleLineKeyDown(e, idx, "account_code")}
                                    placeholder="Type account code..."
                                    className="h-9"
                                  />
                                  <div className="mt-1 min-h-[1rem] truncate text-xs text-muted-foreground">
                                    {acc?.name_en || (l.account_code ? "Unknown account" : "")}
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <Input
                                    className="h-9 text-right font-mono"
                                    data-line-index={idx}
                                    data-line-field="amount_usd"
                                    value={l.amount_usd}
                                    onChange={(e) => applyUsd(idx, e.target.value)}
                                    onKeyDown={(e) => handleLineKeyDown(e, idx, "amount_usd")}
                                    placeholder="0.0000"
                                    inputMode="decimal"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <Input
                                    className="h-9 text-right font-mono"
                                    data-line-index={idx}
                                    data-line-field="amount_lbp"
                                    value={l.amount_lbp}
                                    onChange={(e) => applyLbp(idx, e.target.value)}
                                    onKeyDown={(e) => handleLineKeyDown(e, idx, "amount_lbp")}
                                    placeholder="0.00"
                                    inputMode="decimal"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <Input
                                    className="h-9"
                                    data-line-index={idx}
                                    data-line-field="memo"
                                    value={l.memo}
                                    onChange={(e) => updateLine(idx, { memo: e.target.value })}
                                    onKeyDown={(e) => handleLineKeyDown(e, idx, "memo")}
                                    placeholder="Line memo..."
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <select
                                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                                    data-line-index={idx}
                                    data-line-field="cost_center_id"
                                    value={l.cost_center_id}
                                    onChange={(e) => updateLine(idx, { cost_center_id: e.target.value })}
                                    onKeyDown={(e) => handleLineKeyDown(e, idx, "cost_center_id")}
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
                                  <select
                                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                                    data-line-index={idx}
                                    data-line-field="project_id"
                                    value={l.project_id}
                                    onChange={(e) => updateLine(idx, { project_id: e.target.value })}
                                    onKeyDown={(e) => handleLineKeyDown(e, idx, "project_id")}
                                  >
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
                                    variant="ghost"
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
                        <tfoot>
                          <tr className="border-t bg-muted/30">
                            <td className="px-3 py-2.5 text-xs font-medium text-muted-foreground" colSpan={2}>
                              Totals
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-xs">
                              D {fmt(totals.dUsd, 4)} / C {fmt(totals.cUsd, 4)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-xs">
                              D {fmt(totals.dLbp, 2)} / C {fmt(totals.cLbp, 2)}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground" colSpan={4}>
                              Diff USD {fmt(totals.diffUsd, 4)} | Diff LL {fmt(totals.diffLbp, 2)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLines((prev) => [...prev, createLineDraft("debit")])}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Line
                    </Button>
                    <Button type="submit" disabled={creating} className="min-w-[180px]">
                      {creating ? "Creating..." : "Create Journal"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {status && !statusIsBusy && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Journal List */}
        <Card>
          <CardHeader>
            <CardTitle>Journal List</CardTitle>
            <p className="text-sm text-muted-foreground">{journals.length} recent journals (max 500)</p>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={journalColumns}
              data={journals}
              isLoading={loading}
              searchPlaceholder="Search journal no / memo / source..."
              onRowClick={(j) => loadDetail(j.id)}
            />
          </CardContent>
        </Card>

        {/* Journal Detail */}
        <Card>
          <CardHeader>
            <CardTitle>Journal Detail</CardTitle>
            <p className="text-sm text-muted-foreground">
              {loadingDetail ? "Loading journal..." : detail ? detail.journal.journal_no : "Select a journal to inspect entries."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {detail ? (
              <>
                <Card className="bg-muted/30">
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Date</p>
                        <p className="font-mono text-sm">{detail.journal.journal_date}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Source</p>
                        <p className="text-sm">{detail.journal.source_type || "-"}</p>
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <p className="text-xs text-muted-foreground">Memo</p>
                        <p className="text-sm">{detail.journal.memo || "-"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex items-center justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={() => loadDetail(detail.journal.id)} disabled={loadingDetail}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${loadingDetail ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                  <ConfirmDialog
                    title="Reverse Journal"
                    description="This creates a new journal with inverted debits/credits."
                    confirmLabel={reversing ? "Reversing..." : "Reverse"}
                    variant="destructive"
                    onConfirm={reverseSelected}
                    trigger={
                      <Button variant="outline" size="sm">
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Reverse
                      </Button>
                    }
                  />
                </div>

                <DataTable
                  columns={entryColumns}
                  data={detail.entries}
                  isLoading={loadingDetail}
                  searchPlaceholder="Search account / dims..."
                  pageSize={50}
                />
              </>
            ) : (
              <EmptyState
                icon={BookOpen}
                title="No journal selected"
                description="Pick a journal from the list to see entries."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
