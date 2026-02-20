"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiBase, apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";

type SoaRow = {
  tx_date: string;
  ts: string;
  kind: string;
  doc_id: string;
  ref: string | null;
  memo: string | null;
  delta_usd: string | number;
  delta_lbp: string | number;
  balance_usd: string | number;
  balance_lbp: string | number;
};

type SoaRes = {
  supplier: { id: string; code?: string | null; name: string };
  start_date: string;
  end_date: string;
  opening_usd: string | number;
  opening_lbp: string | number;
  closing_usd: string | number;
  closing_lbp: string | number;
  rows: SoaRow[];
};

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthStartIso() {
  const d = new Date();
  d.setDate(1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function kindLabel(kind: string) {
  const k = String(kind || "").toLowerCase();
  if (k === "invoice") return "Invoice";
  if (k === "payment") return "Payment";
  if (k === "credit_note") return "Credit Note";
  return kind || "-";
}

export default function SupplierSoaPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<SoaRes | null>(null);
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [supplier, setSupplier] = useState<SupplierTypeaheadSupplier | null>(null);
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());

  const columns = useMemo((): Array<DataTableColumn<SoaRow>> => {
    return [
      { id: "tx_date", header: "Date", accessor: (r) => r.tx_date, mono: true, sortable: true, globalSearch: false },
      { id: "kind", header: "Type", accessor: (r) => kindLabel(r.kind), sortable: true },
      { id: "ref", header: "Ref", accessor: (r) => r.ref || "", mono: true },
      { id: "memo", header: "Memo", accessor: (r) => r.memo || "" },
      {
        id: "delta_usd",
        header: "Delta USD",
        accessor: (r) => Number(r.delta_usd || 0),
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.delta_usd)}</span>,
        align: "right",
        mono: true,
        sortable: true,
      },
      {
        id: "delta_lbp",
        header: "Delta LL",
        accessor: (r) => Number(r.delta_lbp || 0),
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.delta_lbp)}</span>,
        align: "right",
        mono: true,
        sortable: true,
      },
      {
        id: "balance_usd",
        header: "Balance USD",
        accessor: (r) => Number(r.balance_usd || 0),
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.balance_usd)}</span>,
        align: "right",
        mono: true,
        sortable: true,
      },
      {
        id: "balance_lbp",
        header: "Balance LL",
        accessor: (r) => Number(r.balance_lbp || 0),
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.balance_lbp)}</span>,
        align: "right",
        mono: true,
        sortable: true,
      },
    ];
  }, []);

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (supplier?.id) qs.set("supplier_id", supplier.id);
    if (startDate) qs.set("start_date", startDate);
    if (endDate) qs.set("end_date", endDate);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [supplier?.id, startDate, endDate]);

  const canLoad = Boolean(supplier?.id);

  const load = useCallback(async () => {
    if (!supplier?.id) return;
    setStatus("");
    try {
      const res = await apiGet<SoaRes>(`/reports/supplier-soa${query}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [supplier?.id, query]);

  useEffect(() => {
    // Support direct deep-linking without useSearchParams() (avoids Suspense requirements in Next builds).
    try {
      const qs = new URLSearchParams(window.location.search);
      const sid = (qs.get("supplier_id") || "").trim();
      const sd = (qs.get("start_date") || "").trim();
      const ed = (qs.get("end_date") || "").trim();
      if (!supplier?.id && sid) setSupplier({ id: sid, name: sid } as any);
      if (sd) setStartDate(sd);
      if (ed) setEndDate(ed);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canLoad) return;
    load();
  }, [canLoad, load]);

  async function downloadCsv() {
    if (!supplier?.id) return;
    setStatus("");
    setDownloadingCsv(true);
    try {
      const res = await fetch(`${apiBase()}/reports/supplier-soa${query}${query ? "&" : "?"}format=csv`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `supplier_soa_${supplier.id}.csv`;
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

  const title = data?.supplier?.name || (supplier?.name && supplier.name !== supplier.id ? supplier.name : null) || "Supplier SOA";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Supplier Statement of Account</CardTitle>
          <CardDescription>Supplier invoices, payments, and credit notes for a single supplier.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[320px] flex-1 space-y-1">
            <label className="text-xs font-medium text-fg-muted">Supplier</label>
            <SupplierTypeahead
              value={supplier}
              placeholder="Search supplier..."
              onSelect={(s) => {
                setSupplier(s);
                setData(null);
              }}
              onClear={() => {
                setSupplier(null);
                setData(null);
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={load} disabled={!canLoad}>
              Refresh
            </Button>
            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={!canLoad}>
                  Filters
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Report Filters</DialogTitle>
                  <DialogDescription>Select a date range.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Start</label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">End</label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                  <div className="flex items-end justify-end md:col-span-2">
                    <Button
                      onClick={async () => {
                        setFiltersOpen(false);
                        await load();
                      }}
                      disabled={!canLoad}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Button asChild variant="outline" disabled={!canLoad}>
              <a href={`/exports/reports/supplier-soa/pdf${query}`} target="_blank" rel="noopener noreferrer">
                Download PDF
              </a>
            </Button>
            <Button asChild variant="outline" disabled={!canLoad}>
              <Link href={`/accounting/reports/supplier-soa/print${query}`} target="_blank" rel="noopener noreferrer">
                Print / PDF
              </Link>
            </Button>
            <Button variant="secondary" onClick={downloadCsv} disabled={!canLoad || downloadingCsv}>
              {downloadingCsv ? "Downloading..." : "Download CSV"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data ? (
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              <span className="font-mono text-xs">
                {data.start_date} to {data.end_date}
              </span>
              {data.supplier?.code ? (
                <>
                  {" "}
                  · <span className="font-mono text-xs">{data.supplier.code}</span>
                </>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
              <div className="text-xs text-fg-muted">Opening</div>
              <div className="data-mono text-sm">{fmtUsd(data.opening_usd)}</div>
              <div className="data-mono text-xs text-fg-muted">{fmtLbp(data.opening_lbp)}</div>
            </div>
            <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
              <div className="text-xs text-fg-muted">Closing</div>
              <div className="data-mono text-sm">{fmtUsd(data.closing_usd)}</div>
              <div className="data-mono text-xs text-fg-muted">{fmtLbp(data.closing_lbp)}</div>
            </div>
            <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
              <div className="text-xs text-fg-muted">Rows</div>
              <div className="data-mono text-sm">{Number(data.rows?.length || 0).toLocaleString("en-US")}</div>
              <div className="text-xs text-fg-muted">Use search to find refs or types.</div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>Running balance is shown after each transaction.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            tableId="reports.supplier-soa.v1"
            rows={data?.rows || []}
            columns={columns}
            getRowId={(r, idx) => `${r.doc_id}:${idx}`}
            emptyText={supplier?.id ? "No transactions in range." : "Select a supplier to view the statement."}
            enablePagination={true}
            initialSort={{ columnId: "tx_date", dir: "asc" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
