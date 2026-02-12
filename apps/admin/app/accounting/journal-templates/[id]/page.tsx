"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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
type RateRow = { id: string; rate_date: string; rate_type: string; usd_to_lbp: string | number };

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function JournalTemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id || "");

  const [status, setStatus] = useState("");
  const [data, setData] = useState<DetailRes | null>(null);

  const [runOpen, setRunOpen] = useState(false);
  const [journalDate, setJournalDate] = useState(todayIso());
  const [rateType, setRateType] = useState("market");
  const [exchangeRate, setExchangeRate] = useState("0");
  const [memo, setMemo] = useState("");
  const [runResult, setRunResult] = useState<{ id: string; journal_no: string } | null>(null);
  const [running, setRunning] = useState(false);
  const searchParams = useSearchParams();

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

  const lineColumns = useMemo((): Array<DataTableColumn<LineRow>> => {
    return [
      { id: "line_no", header: "#", accessor: (l) => Number(l.line_no || 0), mono: true, sortable: true, globalSearch: false, cell: (l) => <span className="data-mono text-xs">{l.line_no}</span> },
      {
        id: "account",
        header: "Account",
        accessor: (l) => `${l.account_code || ""} ${l.name_en || ""} ${l.memo || ""}`.trim(),
        sortable: true,
        cell: (l) => (
          <div className="text-xs">
            <div className="font-mono text-[11px] text-fg-muted">{l.account_code}</div>
            <div>{l.name_en || ""}</div>
            {l.memo ? <div className="mt-1 text-[11px] text-fg-muted">{l.memo}</div> : null}
          </div>
        ),
      },
      { id: "side", header: "Side", accessor: (l) => l.side, sortable: true, globalSearch: false, cell: (l) => <span className="text-xs">{l.side}</span> },
      { id: "amount_usd", header: "USD", accessor: (l) => Number(l.amount_usd || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (l) => <span className="data-mono ui-tone-usd text-xs">{fmtUsd(l.amount_usd, { maximumFractionDigits: 4 })}</span> },
      { id: "amount_lbp", header: "LL", accessor: (l) => Number(l.amount_lbp || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (l) => <span className="data-mono ui-tone-lbp text-xs">{fmtLbp(l.amount_lbp, { maximumFractionDigits: 2 })}</span> },
      {
        id: "dims",
        header: "Dimensions",
        accessor: (l) => `${l.cost_center_code || ""} ${l.project_code || ""}`.trim(),
        sortable: true,
        globalSearch: false,
        cell: (l) => (
          <div className="text-xs text-fg-muted">
            <div>{l.cost_center_code ? `${l.cost_center_code} · ${l.cost_center_name || ""}` : "-"}</div>
            <div>{l.project_code ? `${l.project_code} · ${l.project_name || ""}` : "-"}</div>
          </div>
        ),
      },
    ];
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setStatus("Loading...");
    try {
      const res = await apiGet<DetailRes>(`/accounting/journal-templates/${encodeURIComponent(id)}`);
      setData(res);
      setRateType(String(res.template?.default_rate_type || "market"));
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
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

  const activeTab = (() => {
    const tab = String(searchParams.get("tab") || "overview").toLowerCase();
    if (tab === "memo" || tab === "lines") return tab;
    return "overview";
  })();
  const templateTabs = [
    { label: "Overview", href: "?tab=overview", activeQuery: { key: "tab", value: "overview" } },
    { label: "Memo", href: "?tab=memo", activeQuery: { key: "tab", value: "memo" } },
    { label: "Lines", href: "?tab=lines", activeQuery: { key: "tab", value: "lines" } },
  ];

  async function runTemplate() {
    if (!id) return;
    setRunning(true);
    setStatus("Running template...");
    try {
      const res = await apiPost<{ id: string; journal_no: string }>(
        `/accounting/journal-templates/${encodeURIComponent(id)}/create-journal`,
        {
          journal_date: journalDate,
          rate_type: rateType,
          exchange_rate: toNum(exchangeRate),
          memo: memo.trim() || null
        }
      );
      setRunResult(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <TabBar tabs={templateTabs} />

      {activeTab === "overview" ? (
        <Card>
        <CardHeader>
          <CardTitle>Journal Template</CardTitle>
          <CardDescription className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-fg-muted">{data?.template?.name || id}</span>
            <span className="font-mono text-xs text-fg-muted">{data?.template?.id || ""}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-fg-muted">
            Status: <span className="font-medium text-fg">{data?.template?.is_active ? "Active" : "Inactive"}</span>{" "}
            {"  "}Default rate type: <span className="font-mono">{data?.template?.default_rate_type}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
            <Button variant="outline" onClick={() => router.push(`/accounting/journal-templates/${encodeURIComponent(id)}/edit`)}>
              Edit
            </Button>
            <Dialog open={runOpen} onOpenChange={setRunOpen}>
              <DialogTrigger asChild>
                <Button>Run Template</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Run Template</DialogTitle>
                  <DialogDescription>Create a new journal from this template.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Journal Date</label>
                    <Input type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Rate Type</label>
                    <select className="ui-select w-full" value={rateType} onChange={(e) => setRateType(e.target.value)}>
                      <option value="market">market</option>
                      <option value="official">official</option>
                      <option value="internal">internal</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Exchange Rate</label>
                    <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} inputMode="decimal" />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-fg-muted">Memo (optional)</label>
                    <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional memo for the journal..." />
                  </div>
                  <div className="flex items-center justify-end gap-2 md:col-span-3">
                    <Button type="button" variant="outline" onClick={() => setRunOpen(false)}>
                      Close
                    </Button>
                    <Button type="button" onClick={runTemplate} disabled={running}>
                      {running ? "Running..." : "Run"}
                    </Button>
                  </div>
                  {runResult ? (
                    <div className="rounded-md border border-border bg-bg-elevated p-3 text-xs md:col-span-3">
                      <div className="text-fg-muted">Created journal</div>
                      <div className="mt-1 font-mono">{runResult.journal_no}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => router.push("/accounting/journals")}>
                          Open Journals
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </DialogContent>
            </Dialog>
          </div>
          </CardContent>
        </Card>
      ) : null}

      {data?.template?.memo && activeTab === "memo" ? (
        <Card>
          <CardHeader>
            <CardTitle>Memo</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-fg-muted">{data.template.memo}</CardContent>
        </Card>
      ) : null}

      {activeTab === "lines" ? (
        <Card>
          <CardHeader>
            <CardTitle>Lines</CardTitle>
            <CardDescription>
              Debits {fmtUsdLbp(totals.dUsd, totals.dLbp, { usd: { maximumFractionDigits: 4 }, lbp: { maximumFractionDigits: 2 } })} · Credits{" "}
              {fmtUsdLbp(totals.cUsd, totals.cLbp, { usd: { maximumFractionDigits: 4 }, lbp: { maximumFractionDigits: 2 } })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<LineRow>
              tableId={`accounting.journalTemplates.${id}.lines`}
              rows={data?.lines || []}
              columns={lineColumns}
              initialSort={{ columnId: "line_no", dir: "asc" }}
              globalFilterPlaceholder="Search account / memo / dims..."
              emptyText="No lines."
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
