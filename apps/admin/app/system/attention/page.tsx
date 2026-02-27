"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, HeartPulse, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
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

function severityBadge(sev: AttentionItem["severity"]) {
  const variant = sev === "critical" ? "destructive" : sev === "warning" ? "warning" : "secondary";
  const label = sev === "critical" ? "Critical" : sev === "warning" ? "Warning" : "Info";
  return <Badge variant={variant}>{label}</Badge>;
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
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<AttentionResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await apiGet<AttentionResponse>("/reports/attention");
      setData(res);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : String(e));
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
  const workerAgeSeconds = data?.worker_age_seconds ?? null;

  const attentionColumns = useMemo<ColumnDef<AttentionItem>[]>(
    () => [
      {
        id: "severity",
        accessorFn: (it) => (it.severity === "critical" ? 0 : it.severity === "warning" ? 1 : 2),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Severity" />,
        cell: ({ row }) => severityBadge(row.original.severity),
      },
      {
        id: "label",
        accessorFn: (it) => it.label,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Signal" />,
        cell: ({ row }) => <span className="text-sm">{row.original.label}</span>,
      },
      {
        id: "count",
        accessorFn: (it) => Number(it.count || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Count" />,
        cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.count || 0)}</span>,
      },
      {
        id: "open",
        header: "Open",
        cell: ({ row }) => (
          <Button asChild variant="outline" size="sm">
            <Link href={row.original.href}>Open</Link>
          </Button>
        ),
      },
    ],
    [],
  );

  const failedJobColumns = useMemo<ColumnDef<FailedJob>[]>(
    () => [
      {
        id: "job_code",
        accessorFn: (j) => j.job_code,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Job" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.job_code}</span>,
      },
      {
        id: "count",
        accessorFn: (j) => Number(j.count || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Failures (24h)" />,
        cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.count || 0)}</span>,
      },
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Needs Attention"
        description={loading ? "Loading..." : `${sorted.length} signal(s)`}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {err && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{err}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Today */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Today
          </CardTitle>
          <CardDescription>Operational queue: resolve these before posting/cash close.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={attentionColumns} data={sorted} isLoading={loading} searchPlaceholder="Search signals..." />
        </CardContent>
      </Card>

      {/* Background Health */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4" />
            Background Health
          </CardTitle>
          <CardDescription>Worker heartbeat and failed scheduled jobs in the last 24 hours.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-4 py-3">
            <div className="text-sm text-muted-foreground">Worker last seen</div>
            <div className="font-mono text-sm font-medium">{workerAgeSeconds == null ? "-" : `${fmtAge(workerAgeSeconds)} ago`}</div>
          </div>

          <DataTable columns={failedJobColumns} data={failedJobs} isLoading={loading} searchPlaceholder="Search job code..." />
        </CardContent>
      </Card>
    </div>
  );
}

export default function AttentionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
