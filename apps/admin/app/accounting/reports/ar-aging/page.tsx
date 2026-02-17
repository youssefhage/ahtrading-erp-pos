"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ShortcutLink } from "@/components/shortcut-link";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

type AgingRow = {
  invoice_id: string;
  invoice_no: string;
  customer_id: string | null;
  customer_name: string | null;
  invoice_date: string;
  due_date: string;
  total_usd: string | number;
  total_lbp: string | number;
  paid_usd: string | number;
  paid_lbp: string | number;
  balance_usd: string | number;
  balance_lbp: string | number;
  days_past_due: string | number;
  bucket: string;
};

type AgingRes = { as_of: string; rows: AgingRow[] };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function bucketTone(bucket: string): "success" | "info" | "warning" | "danger" {
  switch (bucket) {
    case "current":
      return "success";
    case "1-30":
      return "info";
    case "31-60":
      return "warning";
    case "61-90":
    case "90+":
      return "danger";
    default:
      return "info";
  }
}

export default function ArAgingPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<AgingRes | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [asOf, setAsOf] = useState(todayIso());

  const bucketTotals = useMemo(() => {
    const totals = new Map<string, { usd: number; lbp: number }>();
    for (const r of data?.rows || []) {
      const b = r.bucket || "unknown";
      const t = totals.get(b) || { usd: 0, lbp: 0 };
      t.usd += Number(r.balance_usd || 0);
      t.lbp += Number(r.balance_lbp || 0);
      totals.set(b, t);
    }
    const order: Record<string, number> = { current: 0, "1-30": 1, "31-60": 2, "61-90": 3, "90+": 4 };
    return Array.from(totals.entries()).sort((a, b) => (order[a[0]] ?? 99) - (order[b[0]] ?? 99));
  }, [data]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const params = new URLSearchParams();
      if (asOf) params.set("as_of", asOf);
      const res = await apiGet<AgingRes>(`/reports/ar-aging?${params.toString()}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [asOf]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo((): Array<DataTableColumn<AgingRow>> => {
    return [
      { id: "bucket", header: "Bucket", accessor: (r) => r.bucket, sortable: true, globalSearch: false },
      {
        id: "invoice_no",
        header: "Invoice",
        accessor: (r) => r.invoice_no,
        mono: true,
        sortable: true,
        cell: (r) => (
          <ShortcutLink href={`/sales/invoices/${encodeURIComponent(r.invoice_id)}`} title="Open sales invoice" className="data-mono text-xs">
            {r.invoice_no}
          </ShortcutLink>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        accessor: (r) => r.customer_name || r.customer_id || "",
        cell: (r) =>
          r.customer_id ? (
            <ShortcutLink href={`/partners/customers/${encodeURIComponent(r.customer_id)}`} title="Open customer">
              {r.customer_name || r.customer_id}
            </ShortcutLink>
          ) : (
            r.customer_name || "-"
          ),
        sortable: true,
      },
      {
        id: "due",
        header: "Due",
        accessor: (r) => `${r.due_date} ${r.days_past_due}`,
        mono: true,
        sortable: true,
        globalSearch: false,
        cell: (r) => (
          <span className="data-mono text-xs">
            {r.due_date} <span className="text-fg-subtle">({Number(r.days_past_due || 0)}d)</span>
          </span>
        ),
      },
      {
        id: "balance_usd",
        header: "Balance USD",
        accessor: (r) => Number(r.balance_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.balance_usd)}</span>,
      },
      {
        id: "balance_lbp",
        header: "Balance LL",
        accessor: (r) => Number(r.balance_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.balance_lbp)}</span>,
      },
    ];
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>As Of</CardTitle>
          <CardDescription>
            <span className="font-mono text-xs">{data?.as_of || asOf}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
          <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Filters</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Report Filters</DialogTitle>
                <DialogDescription>Select an as-of date.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">As Of</label>
                  <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                </div>
                <div className="flex items-end justify-end">
                  <Button
                    onClick={async () => {
                      setFiltersOpen(false);
                      await load();
                    }}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bucket Totals</CardTitle>
          <CardDescription>Outstanding receivables by bucket.</CardDescription>
        </CardHeader>
        <CardContent className="ui-kpi-grid ui-kpi-grid-dense">
          {bucketTotals.map(([bucket, t]) => (
            <div key={bucket} className="ui-kpi-card" data-tone={bucketTone(bucket)}>
              <div className="ui-kpi-label">{bucket}</div>
              <div className="ui-kpi-value">{fmtUsd(t.usd)}</div>
              <div className="ui-kpi-subvalue">{fmtLbp(t.lbp)}</div>
            </div>
          ))}
          {bucketTotals.length === 0 ? (
            <div className="text-sm text-fg-muted">No outstanding invoices.</div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>{data?.rows?.length || 0} outstanding invoices</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<AgingRow>
            tableId="accounting.reports.ar_aging"
            rows={data?.rows || []}
            columns={columns}
            initialSort={{ columnId: "balance_usd", dir: "desc" }}
            globalFilterPlaceholder="Search invoice / customer..."
            emptyText="No outstanding invoices."
          />
        </CardContent>
      </Card>
    </div>
  );
}
