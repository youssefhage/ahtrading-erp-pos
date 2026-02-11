"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AttentionItem = {
  key: string;
  severity: "info" | "warning" | "critical";
  label: string;
  count: number;
  href: string;
};

type FailedJob = { job_code: string; count: number };

type AttentionResponse = {
  items: AttentionItem[];
  failed_jobs: FailedJob[];
  worker_age_seconds?: number | null;
};

function severityChip(sev: AttentionItem["severity"]) {
  const cls =
    sev === "critical"
      ? "bg-danger/15 text-danger border-danger/25"
      : sev === "warning"
        ? "bg-warning/15 text-warning border-warning/25"
        : "bg-info/15 text-info border-info/25";
  const label = sev === "critical" ? "Critical" : sev === "warning" ? "Warning" : "Info";
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}

function fmtAge(s?: number | null) {
  if (s === null || s === undefined) return "-";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function Inner() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [data, setData] = useState<AttentionResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<AttentionResponse>("/reports/attention");
      setData(res);
    } catch (e) {
      setData(null);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(() => {
    const items = data?.items || [];
    const rank = (s: AttentionItem["severity"]) => (s === "critical" ? 0 : s === "warning" ? 1 : 2);
    return [...items].sort((a, b) => rank(a.severity) - rank(b.severity) || b.count - a.count || a.label.localeCompare(b.label));
  }, [data]);

  const failedJobs = data?.failed_jobs || [];

  const attentionColumns = useMemo((): Array<DataTableColumn<AttentionItem>> => {
    return [
      {
        id: "severity",
        header: "Severity",
        sortable: true,
        accessor: (it) => (it.severity === "critical" ? 0 : it.severity === "warning" ? 1 : 2),
        cell: (it) => severityChip(it.severity),
      },
      {
        id: "label",
        header: "Signal",
        sortable: true,
        accessor: (it) => it.label,
        cell: (it) => <span className="text-sm">{it.label}</span>,
      },
      {
        id: "count",
        header: "Count",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (it) => Number(it.count || 0),
        cell: (it) => <span className="data-mono">{String(it.count || 0)}</span>,
      },
      {
        id: "open",
        header: "Open",
        align: "right",
        sortable: false,
        accessor: (it) => it.href,
        cell: (it) => (
          <Button asChild variant="outline" size="sm">
            <Link href={it.href}>Open</Link>
          </Button>
        ),
      },
    ];
  }, []);

  const failedJobColumns = useMemo((): Array<DataTableColumn<FailedJob>> => {
    return [
      {
        id: "job_code",
        header: "Job",
        sortable: true,
        accessor: (j) => j.job_code,
        cell: (j) => <span className="text-sm">{j.job_code}</span>,
      },
      {
        id: "count",
        header: "Failures (24h)",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (j) => Number(j.count || 0),
        cell: (j) => <span className="data-mono">{String(j.count || 0)}</span>,
      },
    ];
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Needs Attention</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${sorted.length} signal(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
          <CardDescription>Operational queue: resolve these before posting/cash close.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable<AttentionItem>
            tableId="system.attention.today"
            rows={sorted}
            columns={attentionColumns}
            getRowId={(r) => r.key}
            isLoading={loading}
            emptyText={loading ? "Loading..." : "All clear."}
            enablePagination
            enableGlobalFilter={false}
            initialSort={{ columnId: "severity", dir: "asc" }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Background Health</CardTitle>
          <CardDescription>Worker heartbeat and any failed scheduled jobs in the last 24 hours.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-elevated/60 px-3 py-2">
            <div className="text-fg-muted">Worker last seen</div>
            <div className="data-mono font-medium">{fmtAge(data?.worker_age_seconds ?? null)} ago</div>
          </div>

          <DataTable<FailedJob>
            tableId="system.attention.failed_jobs"
            rows={failedJobs}
            columns={failedJobColumns}
            getRowId={(r) => r.job_code}
            isLoading={loading}
            emptyText={loading ? "Loading..." : "No failed jobs in the last 24 hours."}
            enablePagination
            enableGlobalFilter={false}
            initialSort={{ columnId: "count", dir: "desc" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function AttentionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
