"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Clock,
  Cpu,
  Database,
  Inbox,
  Lock,
  RefreshCw,
  Server,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { apiGet } from "@/lib/api";
import {
  hasAnyPermission,
  permissionsToStringArray,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { AiSetupGate } from "@/components/ai-setup-gate";
import { ErrorBanner } from "@/components/error-banner";

import { PageHeader } from "@/components/business/page-header";
import { KpiCard } from "@/components/business/kpi-card";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Section components                                                 */
/* ------------------------------------------------------------------ */

function MetricPill({
  label,
  value,
  variant,
}: {
  label: string;
  value: string | number;
  variant?: "default" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        variant === "warning" && "border-warning/30 bg-warning/5",
        variant === "danger" && "border-destructive/30 bg-destructive/5",
        !variant || variant === "default"
          ? "border-border bg-muted/50"
          : ""
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function OpsCopilotPage() {
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<CopilotOverview | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setErr("");
    setPermissionsLoaded(false);
    setLoading(true);
    try {
      const me = await apiGet<MeContext>("/auth/me");
      const nextPermissions = permissionsToStringArray(me);
      setPermissions(nextPermissions);

      if (
        !hasAnyPermission({ permissions: nextPermissions }, [
          "ai:read",
          "ai:write",
        ])
      ) {
        setData(null);
        setErr("");
        return;
      }
      const res = await apiGet<CopilotOverview>(
        "/ai/copilot/overview"
      );
      setData(res);
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    } finally {
      setPermissionsLoaded(true);
      setLoading(false);
    }
  }

  const canReadAi = hasAnyPermission({ permissions }, [
    "ai:read",
    "ai:write",
  ]);

  useEffect(() => {
    load();
  }, []);

  /* ---------- Derived data ---------- */

  const aiActions = useMemo(
    () => data?.ai.actions_by_status || {},
    [data]
  );
  const recs = useMemo(
    () => data?.ai.recommendations_by_status || {},
    [data]
  );
  const pendingByAgent = useMemo(
    () => data?.ai.pending_recommendations_by_agent || {},
    [data]
  );
  const outbox = useMemo(
    () => data?.pos.outbox_by_status || {},
    [data]
  );
  const heartbeats = useMemo(
    () => data?.workers.heartbeats || [],
    [data]
  );
  const overdue = useMemo(
    () => data?.jobs.overdue_schedules || [],
    [data]
  );
  const recentJobFailures = useMemo(
    () => data?.jobs.recent_failed_runs || [],
    [data]
  );

  const pendingByAgentEntries = useMemo(
    () =>
      Object.entries(pendingByAgent)
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
        .slice(0, 12),
    [pendingByAgent]
  );

  const totalOutbox = useMemo(
    () => Object.values(outbox).reduce((a, b) => a + (b || 0), 0),
    [outbox]
  );

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-8">
      {err ? <AiSetupGate error={err} /> : null}
      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <PageHeader
        title="Operations Copilot"
        description="Read-only operational snapshot. Safe to view at any time."
        badge={
          data?.generated_at ? (
            <Badge variant="outline" className="font-mono text-xs">
              {fmtAge(data.generated_at)}
            </Badge>
          ) : undefined
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={!canReadAi || loading}
          >
            <RefreshCw
              className={cn(
                "mr-2 h-3.5 w-3.5",
                loading && "animate-spin"
              )}
            />
            Refresh
          </Button>
        }
      />

      {/* Permission gate */}
      {permissionsLoaded && !canReadAi && (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={ShieldAlert}
              title="AI Ops Copilot Access Required"
              description="Request ai:read from your administrator to view the AI ops snapshot."
            />
          </CardContent>
        </Card>
      )}

      {canReadAi && data && (
        <>
          {/* Top-level KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Pending Recommendations"
              value={String(recs["pending"] || 0)}
              icon={Bot}
              trend={
                Number(recs["pending"] || 0) > 0 ? "up" : "neutral"
              }
              trendValue={
                Number(recs["pending"] || 0) > 0
                  ? "needs review"
                  : ""
              }
            />
            <KpiCard
              title="POS Outbox Total"
              value={String(totalOutbox)}
              icon={Inbox}
            />
            <KpiCard
              title="Failed Jobs (24h)"
              value={String(data.jobs.failed_runs_24h || 0)}
              icon={XCircle}
              trend={
                Number(data.jobs.failed_runs_24h || 0) > 0
                  ? "down"
                  : "neutral"
              }
              trendValue={
                Number(data.jobs.failed_runs_24h || 0) > 0
                  ? "investigate"
                  : ""
              }
            />
            <KpiCard
              title="Overdue Jobs"
              value={String(overdue.length)}
              icon={AlertTriangle}
              trend={overdue.length > 0 ? "down" : "neutral"}
              trendValue={
                overdue.length > 0 ? "behind schedule" : ""
              }
            />
          </div>

          {/* Dashboard grid */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* AI card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">AI</CardTitle>
                </div>
                <CardDescription>
                  Recommendations and actions lifecycle.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <MetricPill
                    label="Recs Pending"
                    value={String(recs["pending"] || 0)}
                    variant={
                      Number(recs["pending"] || 0) > 0
                        ? "warning"
                        : "default"
                    }
                  />
                  <MetricPill
                    label="Recs Approved"
                    value={String(recs["approved"] || 0)}
                  />
                  <MetricPill
                    label="Actions Queued"
                    value={String(aiActions["queued"] || 0)}
                  />
                  <MetricPill
                    label="Actions Failed"
                    value={String(aiActions["failed"] || 0)}
                    variant={
                      Number(aiActions["failed"] || 0) > 0
                        ? "danger"
                        : "default"
                    }
                  />
                  <MetricPill
                    label="Actions Approved"
                    value={String(aiActions["approved"] || 0)}
                  />
                  <MetricPill
                    label="Actions Blocked"
                    value={String(aiActions["blocked"] || 0)}
                    variant={
                      Number(aiActions["blocked"] || 0) > 0
                        ? "warning"
                        : "default"
                    }
                  />
                </div>

                {/* Pending by agent */}
                {pendingByAgentEntries.length > 0 && (
                  <div>
                    <Separator className="mb-3" />
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Pending by Agent
                    </p>
                    <div className="space-y-1.5">
                      {pendingByAgentEntries.map(
                        ([agent, count]) => (
                          <div
                            key={agent}
                            className="flex items-center justify-between rounded-md border px-3 py-1.5"
                          >
                            <span className="font-mono text-xs">
                              {agent}
                            </span>
                            <Badge
                              variant="warning"
                              className="font-mono text-xs"
                            >
                              {String(count)}
                            </Badge>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* POS card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">POS</CardTitle>
                </div>
                <CardDescription>
                  Outbox queue health.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <MetricPill
                    label="Pending"
                    value={String(outbox["pending"] || 0)}
                  />
                  <MetricPill
                    label="Processed"
                    value={String(outbox["processed"] || 0)}
                  />
                  <MetricPill
                    label="Failed"
                    value={String(data.pos.outbox_failed || 0)}
                    variant={
                      Number(data.pos.outbox_failed || 0) > 0
                        ? "danger"
                        : "default"
                    }
                  />
                  <MetricPill
                    label="Total"
                    value={String(totalOutbox)}
                  />
                </div>

                {/* Status breakdown */}
                {Object.keys(outbox).length > 0 && (
                  <div>
                    <Separator className="mb-3" />
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Status Breakdown
                    </p>
                    <div className="space-y-1.5">
                      {Object.entries(outbox)
                        .sort(
                          (a, b) =>
                            Number(b[1] || 0) - Number(a[1] || 0)
                        )
                        .map(([status, count]) => (
                          <div
                            key={status}
                            className="flex items-center justify-between rounded-md border px-3 py-1.5"
                          >
                            <span className="text-xs text-muted-foreground capitalize">
                              {status}
                            </span>
                            <span className="font-mono text-xs font-medium">
                              {String(count)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Integrity card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">
                    Integrity & Close
                  </CardTitle>
                </div>
                <CardDescription>
                  Negative stock and accounting period locks.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <MetricPill
                    label="Negative Rows"
                    value={String(
                      data.inventory.negative_on_hand_rows || 0
                    )}
                    variant={
                      Number(
                        data.inventory.negative_on_hand_rows || 0
                      ) > 0
                        ? "danger"
                        : "default"
                    }
                  />
                  <MetricPill
                    label="Neg Value USD"
                    value={String(
                      data.inventory.approx_value_usd || "0"
                    )}
                  />
                  <MetricPill
                    label="Neg Value LBP"
                    value={String(
                      data.inventory.approx_value_lbp || "0"
                    )}
                  />
                  <MetricPill
                    label="Period Locks"
                    value={String(
                      data.accounting.period_locks?.length || 0
                    )}
                  />
                </div>

                {/* Period locks */}
                {(data.accounting.period_locks || []).length > 0 && (
                  <div>
                    <Separator className="mb-3" />
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Active Locks
                    </p>
                    <div className="space-y-2">
                      {data.accounting.period_locks.map((lock) => (
                        <div
                          key={lock.id}
                          className="flex items-start justify-between rounded-md border px-3 py-2"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <Lock className="h-3 w-3 text-muted-foreground" />
                              <span className="font-mono text-xs">
                                {lock.start_date} to {lock.end_date}
                              </span>
                            </div>
                            {lock.reason && (
                              <p className="text-xs text-muted-foreground">
                                {lock.reason}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Bottom row: Workers + Jobs */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Workers card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">Workers</CardTitle>
                </div>
                <CardDescription>
                  Background worker liveness (per company).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <MetricPill
                    label="Heartbeats"
                    value={String(heartbeats.length)}
                  />
                  <MetricPill
                    label="Overdue Jobs"
                    value={String(overdue.length)}
                    variant={overdue.length > 0 ? "warning" : "default"}
                  />
                </div>

                {heartbeats.length > 0 ? (
                  <div className="space-y-2">
                    {heartbeats.map((hb) => {
                      const age = fmtAge(hb.last_seen_at);
                      const isStale =
                        Date.now() - new Date(hb.last_seen_at).getTime() >
                        5 * 60 * 1000;
                      return (
                        <div
                          key={hb.worker_name}
                          className="flex items-center justify-between rounded-md border px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={cn(
                                "h-2 w-2 rounded-full",
                                isStale
                                  ? "bg-destructive"
                                  : "bg-success"
                              )}
                            />
                            <span className="text-sm">
                              {hb.worker_name}
                            </span>
                          </div>
                          <span className="font-mono text-xs text-muted-foreground">
                            {age}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No worker heartbeat rows yet (worker may be
                    offline).
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Jobs card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">Jobs</CardTitle>
                </div>
                <CardDescription>
                  Background schedules and recent failures.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <MetricPill
                    label="Failed 24h"
                    value={String(data.jobs.failed_runs_24h || 0)}
                    variant={
                      Number(data.jobs.failed_runs_24h || 0) > 0
                        ? "danger"
                        : "default"
                    }
                  />
                  <MetricPill
                    label="Schedules"
                    value={String(data.jobs.schedules.length || 0)}
                  />
                </div>

                {/* Schedules */}
                {(data.jobs.schedules || []).length > 0 && (
                  <div>
                    <Separator className="mb-3" />
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Schedules
                    </p>
                    <div className="space-y-1.5">
                      {data.jobs.schedules.map((s) => (
                        <div
                          key={s.job_code}
                          className="flex items-center justify-between rounded-md border px-3 py-2"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-medium">
                                {s.job_code}
                              </span>
                              <Badge
                                variant={
                                  s.enabled ? "success" : "secondary"
                                }
                                className="text-[10px]"
                              >
                                {s.enabled ? "On" : "Off"}
                              </Badge>
                              {s.is_overdue && (
                                <Badge
                                  variant="destructive"
                                  className="text-[10px]"
                                >
                                  Overdue
                                </Badge>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Every {fmtInterval(s.interval_seconds)}
                              {s.next_run_at &&
                                ` \u2022 Next: ${fmtAge(s.next_run_at)}`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent failures */}
                {recentJobFailures.length > 0 && (
                  <div>
                    <Separator className="mb-3" />
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Recent Failures
                    </p>
                    <div className="space-y-1.5">
                      {recentJobFailures.map((f) => (
                        <div
                          key={f.id}
                          className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <XCircle className="h-3 w-3 text-destructive" />
                              <span className="font-mono text-xs font-medium">
                                {f.job_code}
                              </span>
                            </div>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {fmtAge(f.started_at)}
                            </span>
                          </div>
                          {f.error_message && (
                            <p className="mt-1 text-xs text-destructive">
                              {f.error_message}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
