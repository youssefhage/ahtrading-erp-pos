"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { RefreshCw, Printer, Download, FileDown } from "lucide-react";

import { apiBase, apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/* ---------- types ---------- */

type GlRow = {
  journal_date: string;
  journal_no: string;
  account_code: string;
  name_en: string | null;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
  memo: string | null;
};

type GlRes = {
  gl: GlRow[];
  total?: number;
  limit?: number;
  offset?: number;
};

/* ---------- helpers ---------- */

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/* ---------- page ---------- */

export default function GeneralLedgerPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<GlRow[]>([]);
  const [total, setTotal] = useState(0);
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("start_date", startDate);
    if (endDate) qs.set("end_date", endDate);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [startDate, endDate]);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (startDate) qs.set("start_date", startDate);
      if (endDate) qs.set("end_date", endDate);
      qs.set("limit", String(pageSize));
      qs.set("offset", String(page * pageSize));
      const res = await apiGet<GlRes>(`/reports/gl?${qs.toString()}`);
      setRows(res.gl || []);
      setTotal(Number(res.total || 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [endDate, page, pageSize, startDate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [startDate, endDate]);

  const printQuery = useMemo(() => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("start_date", startDate);
    if (endDate) qs.set("end_date", endDate);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [endDate, startDate]);

  const pageCount = Math.ceil(total / pageSize) || 1;

  const columns = useMemo<ColumnDef<GlRow>[]>(() => [
    {
      id: "journal_date",
      accessorFn: (r) => r.journal_date,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.journal_date}</span>,
    },
    {
      id: "journal_no",
      accessorFn: (r) => r.journal_no,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Journal" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.journal_no}</span>,
    },
    {
      id: "account",
      accessorFn: (r) => `${r.account_code} ${r.name_en || ""}`,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
      cell: ({ row }) => (
        <div>
          <span className="font-mono text-sm">{row.original.account_code}</span>{" "}
          <span className="text-sm text-muted-foreground">{row.original.name_en || ""}</span>
        </div>
      ),
    },
    {
      id: "debit_usd",
      accessorFn: (r) => toNum(r.debit_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Debit USD" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums">{fmt(toNum(row.original.debit_usd))}</div>,
    },
    {
      id: "credit_usd",
      accessorFn: (r) => toNum(r.credit_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit USD" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums">{fmt(toNum(row.original.credit_usd))}</div>,
    },
    {
      id: "debit_lbp",
      accessorFn: (r) => toNum(r.debit_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Debit LBP" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(toNum(row.original.debit_lbp))}</div>,
    },
    {
      id: "credit_lbp",
      accessorFn: (r) => toNum(r.credit_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit LBP" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(toNum(row.original.credit_lbp))}</div>,
    },
    {
      id: "memo",
      accessorFn: (r) => r.memo || "",
      header: "Memo",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.memo || ""}</span>,
      enableSorting: false,
    },
  ], []);

  async function downloadCsv() {
    setError("");
    setDownloadingCsv(true);
    try {
      const res = await fetch(`${apiBase()}/reports/gl${query}${query ? "&" : "?"}format=csv`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "general_ledger.csv";
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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="General Ledger"
        description={`Showing ${rows.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} entries`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/accounting/reports/general-ledger/print${printQuery}`} target="_blank" rel="noopener noreferrer">
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/exports/reports/general-ledger/pdf${printQuery}`} target="_blank" rel="noopener noreferrer">
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
          <Button onClick={load} disabled={loading}>Apply</Button>
        </CardContent>
      </Card>

      {/* Data table with server-side pagination */}
      <DataTable
        columns={columns}
        data={rows}
        isLoading={loading}
        searchPlaceholder="Search journal / account / memo..."
        manualPagination
        pageCount={pageCount}
        totalRows={total}
        pageSize={pageSize}
        onPaginationChange={(p: PaginationState) => {
          setPage(p.pageIndex);
          setPageSize(p.pageSize);
        }}
      />
    </div>
  );
}
