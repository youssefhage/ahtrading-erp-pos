"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
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
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Signal</th>
                  <th className="px-3 py-2 text-right">Count</th>
                  <th className="px-3 py-2 text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((it) => (
                  <tr key={it.key} className="ui-tr-hover">
                    <td className="px-3 py-2">{severityChip(it.severity)}</td>
                    <td className="px-3 py-2 text-sm">{it.label}</td>
                    <td className="px-3 py-2 text-right data-mono">{String(it.count || 0)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={it.href}>Open</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
                {!loading && sorted.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                      All clear.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
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

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-3 py-2 text-right">Failures (24h)</th>
                </tr>
              </thead>
              <tbody>
                {failedJobs.map((j) => (
                  <tr key={j.job_code} className="ui-tr-hover">
                    <td className="px-3 py-2 text-sm">{j.job_code}</td>
                    <td className="px-3 py-2 text-right data-mono">{String(j.count || 0)}</td>
                  </tr>
                ))}
                {!loading && failedJobs.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={2}>
                      No failed jobs in the last 24 hours.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
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
