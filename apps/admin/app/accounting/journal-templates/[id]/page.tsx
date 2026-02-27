"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Play, Pencil, RefreshCw, ExternalLink } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
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

type TemplateRow = {
  id: string;
  name: string;
  is_active: boolean;
  memo: string | null;
  default_rate_type: string;
  created_at: string;
  updated_at: string;
};

type LineRow = {
  id: string;
  line_no: number | string;
  account_id: string;
  account_code: string;
  name_en: string | null;
  side: "debit" | "credit";
  amount_usd: string | number;
  amount_lbp: string | number;
  memo: string | null;
  cost_center_code?: string | null;
  cost_center_name?: string | null;
  project_code?: string | null;
  project_name?: string | null;
};

type DetailRes = { template: TemplateRow; lines: LineRow[] };

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

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

export default function JournalTemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id || "");

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DetailRes | null>(null);

  // Run dialog
  const [runOpen, setRunOpen] = useState(false);
  const [journalDate, setJournalDate] = useState(todayIso());
  const [rateType, setRateType] = useState("market");
  const [exchangeRate, setExchangeRate] = useState("0");
  const [memo, setMemo] = useState("");
  const [runResult, setRunResult] = useState<{ id: string; journal_no: string } | null>(null);
  const [running, setRunning] = useState(false);

  const totals = useMemo(() => {
    let dUsd = 0;
    let cUsd = 0;
    let dLbp = 0;
    let cLbp = 0;
    for (const l of data?.lines || []) {
      const usd = Number(l.amount_usd || 0);
      const lbp = Number(l.amount_lbp || 0);
      if (l.side === "debit") {
        dUsd += usd;
        dLbp += lbp;
      } else {
        cUsd += usd;
        cLbp += lbp;
      }
    }
    return { dUsd, cUsd, dLbp, cLbp, diffUsd: dUsd - cUsd, diffLbp: dLbp - cLbp };
  }, [data]);

  const lineColumns = useMemo<ColumnDef<LineRow>[]>(
    () => [
      {
        id: "line_no",
        accessorFn: (l) => Number(l.line_no || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="#" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.line_no}</span>,
      },
      {
        id: "account",
        accessorFn: (l) => `${l.account_code || ""} ${l.name_en || ""} ${l.memo || ""}`.trim(),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
        cell: ({ row }) => {
          const l = row.original;
          return (
            <div>
              <div className="font-mono text-sm">{l.account_code}</div>
              <div className="text-xs text-muted-foreground">{l.name_en || ""}</div>
              {l.memo && <div className="mt-0.5 text-xs text-muted-foreground">{l.memo}</div>}
            </div>
          );
        },
      },
      {
        id: "side",
        accessorFn: (l) => l.side,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Side" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.side} />
        ),
      },
      {
        id: "amount_usd",
        accessorFn: (l) => n(l.amount_usd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="USD" className="justify-end" />,
        cell: ({ row }) => (
          <div className="text-right font-mono text-sm">
            {fmtUsd(row.original.amount_usd, { maximumFractionDigits: 4 })}
          </div>
        ),
      },
      {
        id: "amount_lbp",
        accessorFn: (l) => n(l.amount_lbp),
        header: ({ column }) => <DataTableColumnHeader column={column} title="LL" className="justify-end" />,
        cell: ({ row }) => (
          <div className="text-right font-mono text-sm text-muted-foreground">
            {fmtLbp(row.original.amount_lbp)}
          </div>
        ),
      },
      {
        id: "dims",
        accessorFn: (l) => `${l.cost_center_code || ""} ${l.project_code || ""}`.trim(),
        header: "Dimensions",
        cell: ({ row }) => {
          const l = row.original;
          return (
            <div className="text-xs text-muted-foreground">
              <div>{l.cost_center_code ? `${l.cost_center_code} - ${l.cost_center_name || ""}` : "-"}</div>
              <div>{l.project_code ? `${l.project_code} - ${l.project_name || ""}` : "-"}</div>
            </div>
          );
        },
      },
    ],
    [],
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setStatus("");
    try {
      const res = await apiGet<DetailRes>(`/accounting/journal-templates/${encodeURIComponent(id)}`);
      setData(res);
      setRateType(String(res.template?.default_rate_type || "market"));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const primeExchangeRate = useCallback(async (nextDate: string, nextRateType: string) => {
    try {
      const r = await getFxRateUsdToLbp({ rateDate: nextDate, rateType: nextRateType });
      const rate = Number(r?.usd_to_lbp || 0);
      if (Number.isFinite(rate) && rate > 0) setExchangeRate(String(rate));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!runOpen) return;
    setRunResult(null);
    primeExchangeRate(journalDate, rateType);
  }, [runOpen, journalDate, rateType, primeExchangeRate]);

  async function runTemplate() {
    if (!id) return;
    setRunning(true);
    setStatus("");
    try {
      const res = await apiPost<{ id: string; journal_no: string }>(
        `/accounting/journal-templates/${encodeURIComponent(id)}/create-journal`,
        {
          journal_date: journalDate,
          rate_type: rateType,
          exchange_rate: toNum(exchangeRate),
          memo: memo.trim() || null,
        },
      );
      setRunResult(res);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={data?.template?.name || "Template"}
        description={`Template ID: ${id}`}
        backHref="/accounting/journal-templates/list"
        badge={data?.template && <StatusBadge status={data.template.is_active ? "active" : "inactive"} />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/accounting/journal-templates/${encodeURIComponent(id)}/edit`)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <Dialog open={runOpen} onOpenChange={setRunOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Play className="mr-2 h-4 w-4" />
                  Run Template
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Run Template</DialogTitle>
                  <DialogDescription>Create a new journal from this template.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Journal Date</Label>
                    <Input type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Rate Type</Label>
                    <select
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={rateType}
                      onChange={(e) => setRateType(e.target.value)}
                    >
                      <option value="market">market</option>
                      <option value="official">official</option>
                      <option value="internal">internal</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Exchange Rate</Label>
                    <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} inputMode="decimal" />
                  </div>
                  <div className="space-y-2 sm:col-span-3">
                    <Label>Memo (optional)</Label>
                    <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional memo for the journal..." />
                  </div>
                  <div className="flex items-center justify-end gap-2 sm:col-span-3">
                    <Button variant="outline" onClick={() => setRunOpen(false)}>Close</Button>
                    <Button onClick={runTemplate} disabled={running}>
                      {running ? "Running..." : "Run"}
                    </Button>
                  </div>
                  {runResult && (
                    <Card className="bg-muted/30 sm:col-span-3">
                      <CardContent className="pt-4">
                        <p className="text-sm text-muted-foreground">Created journal</p>
                        <p className="mt-1 font-mono text-sm font-medium">{runResult.journal_no}</p>
                        <Button
                          className="mt-3"
                          variant="outline"
                          size="sm"
                          onClick={() => router.push("/accounting/journals")}
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Open Journals
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {status && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Default Rate Type</p>
              <p className="font-mono text-sm">{data?.template?.default_rate_type || "-"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Lines</p>
              <p className="font-mono text-sm">{data?.lines?.length ?? 0}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Status</p>
              {data?.template && <StatusBadge status={data.template.is_active ? "active" : "inactive"} />}
            </div>
            {data?.template?.memo && (
              <div className="space-y-1 sm:col-span-3">
                <p className="text-xs text-muted-foreground">Memo</p>
                <p className="text-sm">{data.template.memo}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <p className="text-sm text-muted-foreground">
            Debits{" "}
            {fmtUsdLbp(totals.dUsd, totals.dLbp, {
              usd: { maximumFractionDigits: 4 },
              lbp: { maximumFractionDigits: 2 },
            })}{" "}
            -- Credits{" "}
            {fmtUsdLbp(totals.cUsd, totals.cLbp, {
              usd: { maximumFractionDigits: 4 },
              lbp: { maximumFractionDigits: 2 },
            })}
          </p>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={lineColumns}
            data={data?.lines || []}
            isLoading={loading}
            searchPlaceholder="Search account / memo / dims..."
            pageSize={50}
          />
        </CardContent>
      </Card>
    </div>
  );
}
