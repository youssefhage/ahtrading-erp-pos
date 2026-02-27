"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Printer, Download, FileDown } from "lucide-react";

import { apiBase, apiGet } from "@/lib/api";
import { fmtLbp } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { KpiCard } from "@/components/business/kpi-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

/* ---------- types ---------- */

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

/* ---------- helpers ---------- */

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

/* ---------- page ---------- */

export default function VatReportPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<VatRow[]>([]);
  const [summary, setSummary] = useState<VatSummary | null>(null);
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

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await apiGet<VatRes>(`/reports/vat${query}`);
      setRows(res.vat || []);
      setSummary(
        res.summary || {
          output_base_lbp: 0, output_tax_lbp: 0,
          input_base_lbp: 0, input_tax_lbp: 0,
          net_tax_lbp: 0, other_base_lbp: 0, other_tax_lbp: 0, rows_count: 0,
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadCsv() {
    setError("");
    setDownloadingCsv(true);
    try {
      const joiner = query ? "&" : "?";
      const res = await fetch(`${apiBase()}/reports/vat${query}${joiner}format=csv`, {
        credentials: "include",
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingCsv(false);
    }
  }

  const netTax = n(summary?.net_tax_lbp);
  const otherTax = n(summary?.other_tax_lbp);
  const netLabel = netTax > 0 ? "Net VAT Payable" : netTax < 0 ? "Net VAT Recoverable" : "Net VAT";
  const netTrend = netTax > 0 ? "down" as const : netTax < 0 ? "up" as const : "neutral" as const;

  const tm = thisMonthRange();
  const lm = lastMonthRange();
  const tq = thisQuarterRange();
  const isThisMonth = startDate === tm.start && endDate === tm.end;
  const isLastMonth = startDate === lm.start && endDate === lm.end;
  const isThisQuarter = startDate === tq.start && endDate === tq.end;

  const columns = useMemo<ColumnDef<VatRow>[]>(() => [
    {
      id: "period",
      accessorFn: (r) => r.period,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Period" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.period}</span>,
    },
    {
      id: "direction",
      accessorFn: (r) => r.direction,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
      cell: ({ row }) => {
        const d = row.original.direction;
        const variant = d === "output" ? "destructive" : d === "input" ? "success" : "secondary";
        return <Badge variant={variant}>{row.original.direction_label || "Other"}</Badge>;
      },
      filterFn: "equals",
    },
    {
      id: "tax_name",
      accessorFn: (r) => r.tax_name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tax" />,
    },
    {
      id: "base_lbp",
      accessorFn: (r) => n(r.base_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Taxable Base (LBP)" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmtLbp(row.original.base_lbp)}</div>,
    },
    {
      id: "tax_lbp",
      accessorFn: (r) => n(r.tax_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="VAT (LBP)" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmtLbp(row.original.tax_lbp)}</div>,
    },
    {
      id: "line_count",
      accessorFn: (r) => n(r.line_count),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Lines" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm">{n(row.original.line_count)}</div>,
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="VAT Report"
        description={`Output vs input VAT by period and tax code -- ${rows.length} grouped rows`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/accounting/reports/vat/print${query}`} target="_blank" rel="noopener noreferrer">
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/exports/reports/vat/pdf${query}`} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                PDF
              </a>
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadCsv} disabled={downloadingCsv}>
              <FileDown className="mr-2 h-4 w-4" />
              {downloadingCsv ? "Downloading..." : "CSV"}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
          <Button variant="link" size="sm" className="ml-2" onClick={load}>Retry</Button>
        </div>
      )}

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Start Date</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[180px]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">End Date</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[180px]" />
          </div>
          <Button variant="outline" size="sm" onClick={() => { setStartDate(""); setEndDate(""); }}>
            All Time
          </Button>

          <div className="flex items-center gap-2 border-l pl-4">
            <span className="text-xs font-medium text-muted-foreground">Quick:</span>
            <Button size="sm" variant={isThisMonth ? "secondary" : "outline"} onClick={() => { setStartDate(tm.start); setEndDate(tm.end); }}>
              This Month
            </Button>
            <Button size="sm" variant={isLastMonth ? "secondary" : "outline"} onClick={() => { setStartDate(lm.start); setEndDate(lm.end); }}>
              Last Month
            </Button>
            <Button size="sm" variant={isThisQuarter ? "secondary" : "outline"} onClick={() => { setStartDate(tq.start); setEndDate(tq.end); }}>
              This Quarter
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          title="Output VAT (Sales)"
          value={fmtLbp(summary?.output_tax_lbp || 0)}
          description={`Base ${fmtLbp(summary?.output_base_lbp || 0)}`}
          trend="down"
        />
        <KpiCard
          title="Input VAT (Purchases)"
          value={fmtLbp(summary?.input_tax_lbp || 0)}
          description={`Base ${fmtLbp(summary?.input_base_lbp || 0)}`}
          trend="up"
        />
        <KpiCard
          title={netLabel}
          value={fmtLbp(netTax)}
          description={`${n(summary?.rows_count).toLocaleString("en-US")} rows`}
          trend={netTrend}
        />
      </div>

      {Math.abs(otherTax) > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          Other VAT sources detected: {fmtLbp(summary?.other_tax_lbp || 0)}. Review source types in CSV export.
        </div>
      )}

      {/* Data table */}
      <DataTable
        columns={columns}
        data={rows}
        isLoading={loading}
        searchPlaceholder="Search period / type / tax..."
        filterableColumns={[
          {
            id: "direction",
            title: "Type",
            options: [
              { label: "Output", value: "output" },
              { label: "Input", value: "input" },
              { label: "Other", value: "other" },
            ],
          },
        ]}
      />
    </div>
  );
}
