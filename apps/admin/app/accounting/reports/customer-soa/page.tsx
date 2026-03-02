"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Printer, Download, FileDown } from "lucide-react";

import { apiBase, apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { KpiCard } from "@/components/business/kpi-card";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { EmptyState } from "@/components/business/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CustomerTypeahead, type CustomerTypeaheadCustomer } from "@/components/customer-typeahead";

/* ---------- types ---------- */

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
  customer: { id: string; code?: string | null; name: string };
  start_date: string;
  end_date: string;
  opening_usd: string | number;
  opening_lbp: string | number;
  closing_usd: string | number;
  closing_lbp: string | number;
  rows: SoaRow[];
};

/* ---------- helpers ---------- */

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

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function kindLabel(kind: string) {
  const k = String(kind || "").toLowerCase();
  if (k === "invoice") return "Invoice";
  if (k === "payment") return "Payment";
  if (k === "return") return "Return";
  if (k === "refund") return "Refund";
  return kind || "-";
}

function docHref(kind: string, docId: string): string | null {
  if (!docId) return null;
  const k = String(kind || "").toLowerCase();
  if (k === "invoice" || k === "return") return `/sales/invoices/${docId}`;
  if (k === "payment" || k === "refund") return `/sales/payments?invoice_id=${docId}`;
  return null;
}

function debitAmount(value: string | number) { const n = toNum(value); return n > 0 ? n : 0; }
function creditAmount(value: string | number) { const n = toNum(value); return n < 0 ? Math.abs(n) : 0; }

/* ---------- page ---------- */

export default function CustomerSoaPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<SoaRes | null>(null);
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  const [customer, setCustomer] = useState<CustomerTypeaheadCustomer | null>(null);
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (customer?.id) qs.set("customer_id", customer.id);
    if (startDate) qs.set("start_date", startDate);
    if (endDate) qs.set("end_date", endDate);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [customer?.id, startDate, endDate]);

  const canLoad = Boolean(customer?.id);

  const load = useCallback(async () => {
    if (!customer?.id) return;
    setError("");
    setLoading(true);
    try {
      const res = await apiGet<SoaRes>(`/reports/customer-soa${query}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [customer?.id, query]);

  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const cid = (qs.get("customer_id") || "").trim();
      const sd = (qs.get("start_date") || "").trim();
      const ed = (qs.get("end_date") || "").trim();
      if (!customer?.id && cid) setCustomer({ id: cid, name: cid } as CustomerTypeaheadCustomer);
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
    if (!customer?.id) return;
    setError("");
    setDownloadingCsv(true);
    try {
      const res = await fetch(`${apiBase()}/reports/customer-soa${query}${query ? "&" : "?"}format=csv`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customer_soa_${customer.id}.csv`;
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

  const title = data?.customer?.name || (customer?.name && customer.name !== customer.id ? customer.name : null) || "Customer SOA";

  const columns = useMemo<ColumnDef<SoaRow>[]>(() => [
    {
      id: "tx_date",
      accessorFn: (r) => r.tx_date,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.tx_date}</span>,
    },
    {
      id: "kind",
      accessorFn: (r) => kindLabel(r.kind),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
    },
    {
      id: "ref",
      accessorFn: (r) => r.ref || "",
      header: "Ref",
      cell: ({ row }) => {
        const href = docHref(row.original.kind, row.original.doc_id);
        const label = row.original.ref || "";
        if (href && label) return <Link href={href} className="font-mono text-sm text-blue-600 underline-offset-4 hover:underline dark:text-blue-400">{label}</Link>;
        return <span className="font-mono text-sm">{label}</span>;
      },
      enableSorting: false,
    },
    {
      id: "memo",
      accessorFn: (r) => r.memo || "",
      header: "Memo",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.memo || ""}</span>,
      enableSorting: false,
    },
    {
      id: "debit_usd",
      accessorFn: (r) => debitAmount(r.delta_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Debit USD" />,
      cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={debitAmount(row.original.delta_usd)} currency="USD" className="font-mono text-sm" /></div>,
    },
    {
      id: "credit_usd",
      accessorFn: (r) => creditAmount(r.delta_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit USD" />,
      cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={creditAmount(row.original.delta_usd)} currency="USD" className="font-mono text-sm" /></div>,
    },
    {
      id: "debit_lbp",
      accessorFn: (r) => debitAmount(r.delta_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Debit LBP" />,
      cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={debitAmount(row.original.delta_lbp)} currency="LBP" className="font-mono text-sm" /></div>,
    },
    {
      id: "credit_lbp",
      accessorFn: (r) => creditAmount(r.delta_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit LBP" />,
      cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={creditAmount(row.original.delta_lbp)} currency="LBP" className="font-mono text-sm" /></div>,
    },
    {
      id: "balance_usd",
      accessorFn: (r) => toNum(r.balance_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Balance USD" />,
      cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={toNum(row.original.balance_usd)} currency="USD" className="font-mono text-sm" /></div>,
    },
    {
      id: "balance_lbp",
      accessorFn: (r) => toNum(r.balance_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Balance LBP" />,
      cell: ({ row }) => <div className="text-right"><CurrencyDisplay amount={toNum(row.original.balance_lbp)} currency="LBP" className="font-mono text-sm" /></div>,
    },
  ], []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={title}
        description="Invoices, payments, returns, and refunds for a single customer."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={!canLoad || loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/exports/reports/customer-soa/pdf${query}`} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                PDF
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/accounting/reports/customer-soa/print${query}`} target="_blank" rel="noopener noreferrer">
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Link>
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadCsv} disabled={!canLoad || downloadingCsv}>
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
          <div className="min-w-[280px] flex-1 space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Customer</label>
            <CustomerTypeahead
              value={customer}
              placeholder="Search customer..."
              onSelect={(c) => { setCustomer(c); setData(null); }}
              onClear={() => { setCustomer(null); setData(null); }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Start Date</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[180px]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">End Date</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[180px]" />
          </div>
          <Button onClick={load} disabled={!canLoad || loading}>Apply</Button>
        </CardContent>
      </Card>

      {/* Summary KPIs */}
      {data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard
            title="Opening Balance"
            value={fmtUsd(data.opening_usd)}
            description={fmtLbp(data.opening_lbp)}
          />
          <KpiCard
            title="Closing Balance"
            value={fmtUsd(data.closing_usd)}
            description={fmtLbp(data.closing_lbp)}
          />
          <KpiCard
            title="Transactions"
            value={String(data.rows?.length || 0)}
            description={data.customer?.code ? `Code: ${data.customer.code}` : undefined}
          />
        </div>
      )}

      {/* Data table */}
      {!canLoad && !data ? (
        <EmptyState title="Select a customer" description="Choose a customer above to view the statement of account." />
      ) : (
        <DataTable
          columns={columns}
          data={data?.rows || []}
          isLoading={loading}
          searchPlaceholder="Search ref / type / memo..."
        />
      )}
    </div>
  );
}
