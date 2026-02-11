"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type CheckRow = {
  code: string;
  title: string;
  level: "ok" | "warn" | "error" | "info";
  count: number;
  href?: string | null;
};

type Res = {
  start_date: string;
  end_date: string;
  checks: CheckRow[];
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function CloseChecklistPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<Res | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [asOf, setAsOf] = useState(todayIso());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const params = new URLSearchParams();
      if (asOf) params.set("as_of", asOf);
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      const res = await apiGet<Res>(`/accounting/close-checklist?${params.toString()}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [asOf, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo((): Array<DataTableColumn<CheckRow>> => {
    return [
      { id: "level", header: "Status", accessor: (c) => c.level, sortable: true, globalSearch: false, cell: (c) => <StatusChip value={c.level} /> },
      { id: "title", header: "Check", accessor: (c) => c.title, sortable: true, cell: (c) => <span className="text-xs">{c.title}</span> },
      { id: "count", header: "Count", accessor: (c) => Number(c.count || 0), sortable: true, align: "right", mono: true, globalSearch: false, cell: (c) => <span className="data-mono text-xs">{Number(c.count || 0)}</span> },
      {
        id: "href",
        header: "Link",
        accessor: (c) => c.href || "",
        sortable: false,
        globalSearch: false,
        cell: (c) =>
          c.href ? (
            <a className="ui-link text-xs" href={c.href}>
              Open
            </a>
          ) : (
            <span className="text-xs text-fg-subtle">-</span>
          ),
      },
    ];
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Period Close Checklist</CardTitle>
          <CardDescription>Review blockers before locking a period.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
          <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Filters</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Checklist Filters</DialogTitle>
                <DialogDescription>Use as-of or override with a custom date range.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">As Of</label>
                  <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Start Date</label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">End Date</label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
                <div className="flex justify-end md:col-span-3">
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
          <CardTitle>Checks</CardTitle>
          <CardDescription>
            Period: {data?.start_date || "-"} → {data?.end_date || "-"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<CheckRow>
            tableId="accounting.closeChecklist"
            rows={data?.checks || []}
            columns={columns}
            initialSort={{ columnId: "level", dir: "asc" }}
            globalFilterPlaceholder="Search checks..."
            emptyText="No checks found."
          />
        </CardContent>
      </Card>
    </div>
  );
}
