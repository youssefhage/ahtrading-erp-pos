"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Filter, ClipboardCheck, ExternalLink } from "lucide-react";

import { apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { KpiCard } from "@/components/business/kpi-card";
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const levelStatusMap: Record<string, string> = {
  ok: "active",
  warn: "pending",
  error: "overdue",
  info: "draft",
};

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function CloseChecklistPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Res | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [asOf, setAsOf] = useState(todayIso());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const params = new URLSearchParams();
      if (asOf) params.set("as_of", asOf);
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      const res = await apiGet<Res>(`/accounting/close-checklist?${params.toString()}`);
      setData(res);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [asOf, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const checks = data?.checks || [];
    return {
      total: checks.length,
      ok: checks.filter((c) => c.level === "ok").length,
      warn: checks.filter((c) => c.level === "warn").length,
      error: checks.filter((c) => c.level === "error").length,
    };
  }, [data]);

  const columns = useMemo<ColumnDef<CheckRow>[]>(
    () => [
      {
        id: "level",
        accessorFn: (c) => c.level,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusBadge status={levelStatusMap[row.original.level] || row.original.level} />
        ),
      },
      {
        id: "title",
        accessorFn: (c) => c.title,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Check" />,
        cell: ({ row }) => <span className="text-sm">{row.original.title}</span>,
      },
      {
        id: "count",
        accessorFn: (c) => Number(c.count || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Count" className="justify-end" />,
        cell: ({ row }) => (
          <div className="text-right font-mono text-sm">{Number(row.original.count || 0)}</div>
        ),
      },
      {
        id: "href",
        accessorFn: (c) => c.href || "",
        header: "Link",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.href ? (
            <a href={row.original.href} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              Open
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
      },
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Period Close Checklist"
        description="Surface close blockers early before period lock."
        actions={
          <>
            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="mr-2 h-4 w-4" />
                  Filters
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Checklist Filters</DialogTitle>
                  <DialogDescription>Use as-of or override with a custom date range.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>As Of</Label>
                    <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                  <div className="flex justify-end sm:col-span-3">
                    <Button onClick={async () => { setFiltersOpen(false); await load(); }}>Apply</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
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

      {/* KPI Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Total Checks" value={summary.total} icon={ClipboardCheck} />
        <KpiCard title="Passed" value={summary.ok} trend="up" />
        <KpiCard title="Warnings" value={summary.warn} trend={summary.warn > 0 ? "down" : "neutral"} />
        <KpiCard title="Errors" value={summary.error} trend={summary.error > 0 ? "down" : "neutral"} />
      </div>

      {/* Checks */}
      <Card>
        <CardHeader>
          <CardTitle>Checks</CardTitle>
          <p className="text-sm text-muted-foreground">
            Period: {data?.start_date || "-"} to {data?.end_date || "-"}
          </p>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data?.checks || []}
            isLoading={loading}
            searchPlaceholder="Search checks..."
          />
        </CardContent>
      </Card>
    </div>
  );
}
