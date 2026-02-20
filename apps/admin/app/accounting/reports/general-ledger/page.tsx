"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiBase, apiGet } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

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

function fmt(n: string | number) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function GeneralLedgerPage() {
  const [rows, setRows] = useState<GlRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
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
    setStatus("");
    try {
      const qs = new URLSearchParams();
      if (startDate) qs.set("start_date", startDate);
      if (endDate) qs.set("end_date", endDate);
      qs.set("limit", String(pageSize));
      qs.set("offset", String(page * pageSize));
      const res = await apiGet<GlRes>(`/reports/gl?${qs.toString()}`);
      setRows(res.gl || []);
      setTotal(Number(res.total || 0));
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
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

  const columns = useMemo((): Array<DataTableColumn<GlRow>> => {
    return [
      { id: "journal_date", header: "Date", accessor: (r) => r.journal_date, mono: true, sortable: true, globalSearch: false },
      { id: "journal_no", header: "Journal", accessor: (r) => r.journal_no, mono: true, sortable: true },
      {
        id: "account",
        header: "Account",
        accessor: (r) => `${r.account_code} ${r.name_en || ""}`,
        cell: (r) => (
          <span>
            <span className="data-mono text-xs">{r.account_code}</span>{" "}
            <span className="text-fg-muted">{r.name_en || ""}</span>
          </span>
        ),
        sortable: true,
      },
      {
        id: "debit_usd",
        header: "Debit USD",
        accessor: (r) => Number(r.debit_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmt(r.debit_usd)}</span>,
      },
      {
        id: "credit_usd",
        header: "Credit USD",
        accessor: (r) => Number(r.credit_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmt(r.credit_usd)}</span>,
      },
      {
        id: "debit_lbp",
        header: "Debit LL",
        accessor: (r) => Number(r.debit_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmt(r.debit_lbp)}</span>,
      },
      {
        id: "credit_lbp",
        header: "Credit LL",
        accessor: (r) => Number(r.credit_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmt(r.credit_lbp)}</span>,
      },
      { id: "memo", header: "Memo", accessor: (r) => r.memo || "", cell: (r) => <span className="text-xs text-fg-muted">{r.memo || ""}</span> },
    ];
  }, []);

  async function downloadCsv() {
    setStatus("");
    setDownloadingCsv(true);
    try {
      const res = await fetch(`${apiBase()}/reports/gl${query}${query ? "&" : "?"}format=csv`, {
        credentials: "include"
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
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setDownloadingCsv(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Entries (USD + LL)</CardTitle>
            <CardDescription>
              Filter by journal date, then export CSV. Showing {rows.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")} rows
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={load}>
                  Refresh
                </Button>
                <Button asChild variant="outline">
                  <Link
                    href={`/accounting/reports/general-ledger/print${printQuery}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Print / PDF
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <a
                    href={`/exports/reports/general-ledger/pdf${printQuery}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download PDF
                  </a>
                </Button>
                <Button variant="secondary" onClick={downloadCsv} disabled={downloadingCsv}>
                  {downloadingCsv ? "Downloading..." : "Download CSV"}
                </Button>
              </div>
            </div>

            <DataTable<GlRow>
              tableId="accounting.reports.general_ledger"
              rows={rows}
              columns={columns}
              initialSort={{ columnId: "journal_date", dir: "asc" }}
              globalFilterPlaceholder="Search journal / account / memo..."
              emptyText="No GL entries yet."
              serverPagination={{
                page,
                pageSize,
                total,
                onPageChange: (nextPage) => setPage(Math.max(0, nextPage)),
                onPageSizeChange: (nextPageSize) => {
                  setPageSize(nextPageSize);
                  setPage(0);
                },
              }}
            />
          </CardContent>
        </Card>
      </div>);
}
