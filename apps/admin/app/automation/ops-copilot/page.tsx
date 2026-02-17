"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { hasAnyPermission, permissionsToStringArray } from "@/lib/permissions";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { AiSetupGate } from "@/components/ai-setup-gate";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type CopilotOverview = {
  generated_at: string;
  ai: {
    actions_by_status: Record<string, number>;
    recommendations_by_status: Record<string, number>;
    pending_recommendations_by_agent: Record<string, number>;
  };
  pos: {
    outbox_by_status: Record<string, number>;
    outbox_failed: number;
  };
  inventory: {
    negative_on_hand_rows: number;
    approx_value_usd: string;
    approx_value_lbp: string;
  };
  accounting: {
    period_locks: Array<{
      id: string;
      start_date: string;
      end_date: string;
      reason: string | null;
      locked: boolean;
      created_at: string;
    }>;
  };
  workers: {
    heartbeats: Array<{
      worker_name: string;
      last_seen_at: string;
      details: Record<string, unknown>;
    }>;
  };
  jobs: {
    failed_runs_24h: number;
    recent_failed_runs: Array<{
      id: string;
      job_code: string;
      status: string;
      started_at: string;
      finished_at: string | null;
      error_message: string | null;
    }>;
    schedules: Array<{
      job_code: string;
      enabled: boolean;
      interval_seconds: number;
      last_run_at: string | null;
      next_run_at: string | null;
      updated_at: string;
      is_overdue: boolean;
    }>;
    overdue_schedules: Array<{
      job_code: string;
      enabled: boolean;
      interval_seconds: number;
      last_run_at: string | null;
      next_run_at: string | null;
      updated_at: string;
      is_overdue: boolean;
    }>;
  };
};

type MeContext = {
  permissions?: string[];
};

function pill(label: string, value: string) {
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-subtle">{label}</div>
      <div className="mt-1 font-mono text-xs text-foreground">{value}</div>
    </div>
  );
}

function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "-";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "-";
  const ms = Date.now() - dt.getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtInterval(seconds: number): string {
  const s = Number(seconds || 0);
  if (!Number.isFinite(s) || s <= 0) return "-";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function OpsCopilotPage() {
  const [err, setErr] = useState<unknown>(null);
  const [data, setData] = useState<CopilotOverview | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  async function load() {
    setErr(null);
    setPermissionsLoaded(false);
    try {
      const me = await apiGet<MeContext>("/auth/me");
      const nextPermissions = permissionsToStringArray(me);
      setPermissions(nextPermissions);

      if (!hasAnyPermission({ permissions: nextPermissions }, ["ai:read", "ai:write"])) {
        setData(null);
        setErr(null);
        return;
      }
      const res = await apiGet<CopilotOverview>("/ai/copilot/overview");
      setData(res);
    } catch (err) {
      setErr(err);
    } finally {
      setPermissionsLoaded(true);
    }
  }

  const canReadAi = hasAnyPermission({ permissions }, ["ai:read", "ai:write"]);

  useEffect(() => {
    load();
  }, []);

  const aiActions = useMemo(() => data?.ai.actions_by_status || {}, [data]);
  const recs = useMemo(() => data?.ai.recommendations_by_status || {}, [data]);
  const pendingByAgent = useMemo(() => data?.ai.pending_recommendations_by_agent || {}, [data]);
  const outbox = useMemo(() => data?.pos.outbox_by_status || {}, [data]);
  const heartbeats = useMemo(() => data?.workers.heartbeats || [], [data]);
  const overdue = useMemo(() => data?.jobs.overdue_schedules || [], [data]);
  const recentJobFailures = useMemo(() => data?.jobs.recent_failed_runs || [], [data]);
  const pendingByAgentRows = useMemo(
    () =>
      Object.entries(pendingByAgent)
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
        .slice(0, 12)
        .map(([agent, pending]) => ({ agent, pending: Number(pending || 0) })),
    [pendingByAgent],
  );
  const pendingByAgentColumns = useMemo((): Array<DataTableColumn<{ agent: string; pending: number }>> => {
    return [
      {
        id: "agent",
        header: "Agent",
        sortable: true,
        mono: true,
        accessor: (r) => r.agent,
        cell: (r) => <span className="font-mono text-xs text-fg-muted">{r.agent}</span>,
      },
      {
        id: "pending",
        header: "Pending",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => r.pending,
        cell: (r) => <span className="data-mono">{r.pending}</span>,
      },
    ];
  }, []);
  const outboxRows = useMemo(
    () => Object.entries(outbox).map(([status, count]) => ({ status, count: Number(count || 0) })),
    [outbox],
  );
  const outboxColumns = useMemo((): Array<DataTableColumn<{ status: string; count: number }>> => {
    return [
      { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => <span className="text-fg-muted">{r.status}</span> },
      { id: "count", header: "Count", sortable: true, align: "right", mono: true, accessor: (r) => r.count, cell: (r) => <span className="data-mono">{r.count}</span> },
    ];
  }, []);
  const periodLockColumns = useMemo(
    (): Array<DataTableColumn<CopilotOverview["accounting"]["period_locks"][number]>> => [
      { id: "start", header: "Start", sortable: true, accessor: (l) => l.start_date, cell: (l) => <span className="text-fg-muted">{l.start_date}</span> },
      { id: "end", header: "End", sortable: true, accessor: (l) => l.end_date, cell: (l) => <span className="text-fg-muted">{l.end_date}</span> },
      { id: "reason", header: "Reason", sortable: true, accessor: (l) => l.reason || "", cell: (l) => <span className="text-fg-subtle">{l.reason || "-"}</span> },
    ],
    [],
  );
  const heartbeatColumns = useMemo((): Array<DataTableColumn<CopilotOverview["workers"]["heartbeats"][number]>> => {
    return [
      { id: "worker", header: "Worker", sortable: true, accessor: (h) => h.worker_name, cell: (h) => <span className="text-fg-muted">{h.worker_name}</span> },
      { id: "last_seen", header: "Last Seen", sortable: true, mono: true, accessor: (h) => h.last_seen_at, cell: (h) => <span className="text-fg-muted">{h.last_seen_at}</span> },
      { id: "age", header: "Age", sortable: true, align: "right", mono: true, accessor: (h) => fmtAge(h.last_seen_at), cell: (h) => <span className="data-mono">{fmtAge(h.last_seen_at)}</span> },
    ];
  }, []);
  const scheduleColumns = useMemo((): Array<DataTableColumn<CopilotOverview["jobs"]["schedules"][number]>> => {
    return [
      { id: "job", header: "Job", sortable: true, accessor: (s) => s.job_code, cell: (s) => <span className="text-fg-muted">{s.job_code}</span> },
      { id: "interval", header: "Interval", sortable: true, mono: true, accessor: (s) => s.interval_seconds, cell: (s) => <span className="data-mono text-fg-muted">{fmtInterval(s.interval_seconds)}</span> },
      { id: "next", header: "Next", sortable: true, mono: true, accessor: (s) => s.next_run_at || "", cell: (s) => <span className="text-fg-subtle">{s.next_run_at || "-"}</span> },
      { id: "overdue", header: "Overdue", sortable: true, align: "right", mono: true, accessor: (s) => (s.is_overdue ? 1 : 0), cell: (s) => <span className="data-mono">{s.is_overdue ? "yes" : "no"}</span> },
    ];
  }, []);
  const failureColumns = useMemo((): Array<DataTableColumn<CopilotOverview["jobs"]["recent_failed_runs"][number]>> => {
    return [
      { id: "job", header: "Recent Failures", sortable: true, accessor: (r) => r.job_code, cell: (r) => <span className="text-fg-muted">{r.job_code}</span> },
      { id: "when", header: "When", sortable: true, mono: true, accessor: (r) => r.started_at, cell: (r) => <span className="text-fg-subtle">{fmtAge(r.started_at)}</span> },
      { id: "message", header: "Message", sortable: true, align: "right", accessor: (r) => r.error_message || "", cell: (r) => <span className="text-fg-subtle">{r.error_message || "-"}</span> },
    ];
  }, []);

  return (
    <Page>
        {err ? <AiSetupGate error={err} /> : null}
        {err ? <ErrorBanner error={err} onRetry={load} /> : null}
        {permissionsLoaded && !canReadAi ? (
          <Card>
            <CardHeader>
              <CardTitle>AI Ops Copilot Access Required</CardTitle>
              <CardDescription>Request ai:read from your administrator to view the AI ops snapshot.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-fg-muted">
                You’re currently missing the AI permission for the active company.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-fg-muted">
              Read-only operational snapshot (safe by default). Generated:{" "}
              <span className="font-mono text-xs text-foreground">{data?.generated_at || "-"}</span>
            </p>
          </div>
          <Button variant="outline" onClick={load} disabled={!canReadAi} title={canReadAi ? "Refresh" : "Requires ai:read"}>
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>AI</CardTitle>
              <CardDescription>Recommendations + actions lifecycle.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {pill("recs pending", String(recs["pending"] || 0))}
                {pill("recs approved", String(recs["approved"] || 0))}
                {pill("actions approved", String(aiActions["approved"] || 0))}
                {pill("actions queued", String(aiActions["queued"] || 0))}
                {pill("actions blocked", String(aiActions["blocked"] || 0))}
                {pill("actions failed", String(aiActions["failed"] || 0))}
              </div>
              <div className="rounded-md border border-border bg-bg-elevated p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-subtle">
                  Pending By Agent
                </div>
                <div className="mt-2">
                  {Object.keys(pendingByAgent).length ? (
                    <div className="space-y-2">
                      <DataTable<{ agent: string; pending: number }>
                        tableId="automation.ops.pending_by_agent"
                        rows={pendingByAgentRows}
                        columns={pendingByAgentColumns}
                        getRowId={(r) => r.agent}
                        emptyText="No pending recommendations."
                        enableGlobalFilter={false}
                        enablePagination={false}
                        initialSort={{ columnId: "pending", dir: "desc" }}
                      />
                    </div>
                  ) : (
                    <div className="text-xs text-fg-subtle">No pending recommendations.</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>POS</CardTitle>
              <CardDescription>Outbox queue health.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {pill("pending", String(outbox["pending"] || 0))}
                {pill("processed", String(outbox["processed"] || 0))}
                {pill("failed", String(data?.pos.outbox_failed || 0))}
                {pill("total", String(Object.values(outbox).reduce((a, b) => a + (b || 0), 0)))}
              </div>
              <DataTable<{ status: string; count: number }>
                tableId="automation.ops.outbox_status"
                rows={outboxRows}
                columns={outboxColumns}
                getRowId={(r) => r.status}
                emptyText="No outbox data."
                enableGlobalFilter={false}
                enablePagination={false}
                initialSort={{ columnId: "count", dir: "desc" }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Integrity + Close</CardTitle>
              <CardDescription>Negative stock + accounting period locks.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {pill("negative rows", String(data?.inventory.negative_on_hand_rows || 0))}
                {pill("neg value USD", String(data?.inventory.approx_value_usd || "0"))}
                {pill("neg value LL", String(data?.inventory.approx_value_lbp || "0"))}
                {pill("locks", String(data?.accounting.period_locks?.length || 0))}
              </div>
              <DataTable<CopilotOverview["accounting"]["period_locks"][number]>
                tableId="automation.ops.period_locks"
                rows={data?.accounting.period_locks || []}
                columns={periodLockColumns}
                getRowId={(l) => l.id}
                emptyText="No active locks."
                enableGlobalFilter={false}
                initialSort={{ columnId: "start", dir: "desc" }}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Worker</CardTitle>
              <CardDescription>Background worker liveness (per company).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {pill("heartbeats", String(heartbeats.length))}
                {pill("overdue jobs", String(overdue.length))}
              </div>
              <DataTable<CopilotOverview["workers"]["heartbeats"][number]>
                tableId="automation.ops.heartbeats"
                rows={heartbeats}
                columns={heartbeatColumns}
                getRowId={(h) => h.worker_name}
                emptyText="No worker heartbeat rows yet (worker may be offline)."
                enableGlobalFilter={false}
                initialSort={{ columnId: "last_seen", dir: "desc" }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Jobs</CardTitle>
              <CardDescription>Background schedules and recent failures.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {pill("failed 24h", String(data?.jobs.failed_runs_24h || 0))}
                {pill("schedules", String(data?.jobs.schedules.length || 0))}
              </div>

              <DataTable<CopilotOverview["jobs"]["schedules"][number]>
                tableId="automation.ops.schedules"
                rows={data?.jobs.schedules || []}
                columns={scheduleColumns}
                getRowId={(s) => s.job_code}
                emptyText="No schedules found."
                enableGlobalFilter={false}
                initialSort={{ columnId: "job", dir: "asc" }}
              />

              <DataTable<CopilotOverview["jobs"]["recent_failed_runs"][number]>
                tableId="automation.ops.failed_runs"
                rows={recentJobFailures}
                columns={failureColumns}
                getRowId={(r) => r.id}
                emptyText="No recent failed runs."
                enableGlobalFilter={false}
                initialSort={{ columnId: "when", dir: "desc" }}
              />
            </CardContent>
          </Card>
        </div>
      </Page>);
}
