"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiBase, apiGet } from "@/lib/api";
import { fmtLbp } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Input } from "@/components/ui/input";

type VatRow = {
  tax_code_id: string;
  tax_name: string;
  period: string;
  direction: "output" | "input" | "other";
  direction_label: string;
  base_lbp: string | number;
  tax_lbp: string | number;
  line_count: number;
  source_types: string[];
};

type VatSummary = {
  output_base_lbp: string | number;
  output_tax_lbp: string | number;
  input_base_lbp: string | number;
  input_tax_lbp: string | number;
  net_tax_lbp: string | number;
  other_base_lbp: string | number;
  other_tax_lbp: string | number;
  rows_count: number;
};

type VatRes = {
  period?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  summary: VatSummary;
  vat: VatRow[];
};

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toIsoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthStartIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function monthEndIso(year: number, monthIndex0: number) {
  return toIsoDate(new Date(year, monthIndex0 + 1, 0));
}

function thisMonthRange() {
  const now = new Date();
  return { start: monthStartIso(), end: toIsoDate(now) };
}

function lastMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastMonthStart = new Date(y, m - 1, 1);
  return {
    start: toIsoDate(lastMonthStart),
    end: monthEndIso(lastMonthStart.getFullYear(), lastMonthStart.getMonth()),
  };
}

function thisQuarterRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const qStartMonth = Math.floor(m / 3) * 3;
  return { start: toIsoDate(new Date(y, qStartMonth, 1)), end: toIsoDate(now) };
}

function n(v: unknown) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

export default function VatReportPage() {
  const [rows, setRows] = useState<VatRow[]>([]);
  const [summary, setSummary] = useState<VatSummary | null>(null);
  const [status, setStatus] = useState("");
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("start_date", startDate);
    if (endDate) qs.set("end_date", endDate);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [endDate, startDate]);

  const columns = useMemo((): Array<DataTableColumn<VatRow>> => {
    return [
      { id: "period", header: "Period", accessor: (r) => r.period, mono: true, sortable: true, globalSearch: false },
      {
        id: "direction",
        header: "Type",
        accessor: (r) => r.direction,
        sortable: true,
        cell: (r) => (
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              r.direction === "output"
                ? "border-danger/40 bg-danger/10 text-danger"
                : r.direction === "input"
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-border-subtle bg-bg-sunken/30 text-fg-muted"
            }`}
          >
            {r.direction_label || "Other"}
          </span>
        ),
      },
      { id: "tax_name", header: "Tax", accessor: (r) => r.tax_name, sortable: true },
      {
        id: "base_lbp",
        header: "Taxable Base (LL)",
        accessor: (r) => Number(r.base_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.base_lbp)}</span>,
      },
      {
        id: "tax_lbp",
        header: "VAT (LL)",
        accessor: (r) => Number(r.tax_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.tax_lbp)}</span>,
      },
      {
        id: "line_count",
        header: "Lines",
        accessor: (r) => Number(r.line_count || 0),
        align: "right",
        mono: true,
        sortable: true,
        globalSearch: false,
      },
    ];
  }, []);

  const load = useCallback(async () => {
    setStatus("");
    try {
      const res = await apiGet<VatRes>(`/reports/vat${query}`);
      setRows(res.vat || []);
      setSummary(
        res.summary || {
          output_base_lbp: 0,
          output_tax_lbp: 0,
          input_base_lbp: 0,
          input_tax_lbp: 0,
          net_tax_lbp: 0,
          other_base_lbp: 0,
          other_tax_lbp: 0,
          rows_count: 0,
        }
      );
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadCsv() {
    setStatus("");
    setDownloadingCsv(true);
    try {
      const joiner = query ? "&" : "?";
      const res = await fetch(`${apiBase()}/reports/vat${query}${joiner}format=csv`, {
        credentials: "include"
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vat_report.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setDownloadingCsv(false);
    }
  }

  const netTax = n(summary?.net_tax_lbp);
  const otherTax = n(summary?.other_tax_lbp);
  const netLabel = netTax > 0 ? "Net VAT Payable" : netTax < 0 ? "Net VAT Recoverable" : "Net VAT";
  const netTone = netTax > 0 ? "warning" : netTax < 0 ? "success" : "info";
  const printQuery = query;
  const tm = thisMonthRange();
  const lm = lastMonthRange();
  const tq = thisQuarterRange();
  const isThisMonth = startDate === tm.start && endDate === tm.end;
  const isLastMonth = startDate === lm.start && endDate === lm.end;
  const isThisQuarter = startDate === tq.start && endDate === tq.end;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>VAT Filing View (LBP)</CardTitle>
          <CardDescription>
            Output vs input VAT by month and tax code. {rows.length} grouped rows
            {startDate || endDate ? (
              <span className="ml-1 font-mono text-xs">
                · {startDate || "-"} → {endDate || "-"}
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Start</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">End</label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
              >
                All Time
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Button asChild variant="outline">
                <Link href={`/accounting/reports/vat/print${printQuery}`} target="_blank" rel="noopener noreferrer">
                  Print / PDF
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href={`/exports/reports/vat/pdf${printQuery}`} target="_blank" rel="noopener noreferrer">
                  Download PDF
                </a>
              </Button>
              <Button variant="secondary" onClick={downloadCsv} disabled={downloadingCsv}>
                {downloadingCsv ? "Downloading..." : "Download CSV"}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-fg-muted">Quick ranges</span>
            <Button
              size="sm"
              variant={isThisMonth ? "secondary" : "outline"}
              onClick={() => {
                setStartDate(tm.start);
                setEndDate(tm.end);
              }}
            >
              This Month
            </Button>
            <Button
              size="sm"
              variant={isLastMonth ? "secondary" : "outline"}
              onClick={() => {
                setStartDate(lm.start);
                setEndDate(lm.end);
              }}
            >
              Last Month
            </Button>
            <Button
              size="sm"
              variant={isThisQuarter ? "secondary" : "outline"}
              onClick={() => {
                setStartDate(tq.start);
                setEndDate(tq.end);
              }}
            >
              This Quarter
            </Button>
          </div>

          <div className="ui-kpi-grid">
            <div className="ui-kpi-card" data-tone="danger">
              <div className="ui-kpi-label">Output VAT (Sales)</div>
              <div className="ui-kpi-value">{fmtLbp(summary?.output_tax_lbp || 0)}</div>
              <div className="ui-kpi-subvalue">Base {fmtLbp(summary?.output_base_lbp || 0)}</div>
            </div>
            <div className="ui-kpi-card" data-tone="success">
              <div className="ui-kpi-label">Input VAT (Purchases)</div>
              <div className="ui-kpi-value">{fmtLbp(summary?.input_tax_lbp || 0)}</div>
              <div className="ui-kpi-subvalue">Base {fmtLbp(summary?.input_base_lbp || 0)}</div>
            </div>
            <div className="ui-kpi-card" data-tone={netTone}>
              <div className="ui-kpi-label">{netLabel}</div>
              <div className="ui-kpi-value">{fmtLbp(netTax)}</div>
              <div className="ui-kpi-subvalue">Rows {n(summary?.rows_count).toLocaleString("en-US")}</div>
            </div>
          </div>

          {Math.abs(otherTax) > 0 ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              Other VAT sources detected: {fmtLbp(summary?.other_tax_lbp || 0)}. Review source types in CSV export.
            </div>
          ) : null}

          <DataTable<VatRow>
            tableId="accounting.reports.vat"
            rows={rows}
            columns={columns}
            initialSort={{ columnId: "period", dir: "desc" }}
            globalFilterPlaceholder="Search period / type / tax..."
            emptyText="No VAT rows yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
