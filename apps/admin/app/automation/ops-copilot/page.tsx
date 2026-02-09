"use client";

import { useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { AiSetupGate } from "@/components/ai-setup-gate";
import { ViewRaw } from "@/components/view-raw";
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

function pill(label: string, value: string) {
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">{label}</div>
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

  async function load() {
    setErr(null);
    try {
      const res = await apiGet<CopilotOverview>("/ai/copilot/overview");
      setData(res);
    } catch (err) {
      setErr(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const aiActions = data?.ai.actions_by_status || {};
  const recs = data?.ai.recommendations_by_status || {};
  const pendingByAgent = data?.ai.pending_recommendations_by_agent || {};
  const outbox = data?.pos.outbox_by_status || {};
  const heartbeats = data?.workers.heartbeats || [];
  const overdue = data?.jobs.overdue_schedules || [];
  const recentJobFailures = data?.jobs.recent_failed_runs || [];

  return (
    <Page>
        {err ? <AiSetupGate error={err} /> : null}
        {err ? <ErrorBanner error={err} onRetry={load} /> : null}

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-fg-muted">
              Read-only operational snapshot (safe by default). Generated:{" "}
              <span className="font-mono text-xs text-foreground">{data?.generated_at || "-"}</span>
            </p>
          </div>
          <Button variant="outline" onClick={load}>
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
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">
                  Pending By Agent
                </div>
                <div className="mt-2">
                  {Object.keys(pendingByAgent).length ? (
                    <div className="space-y-2">
                      <div className="ui-table-wrap">
                        <table className="ui-table">
                          <thead className="ui-thead">
                            <tr>
                              <th className="px-3 py-2">Agent</th>
                              <th className="px-3 py-2 text-right">Pending</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(pendingByAgent)
                              .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
                              .slice(0, 12)
                              .map(([k, v]) => (
                                <tr key={k} className="ui-tr ui-tr-hover">
                                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">{k}</td>
                                  <td className="px-3 py-2 text-right data-mono">{String(v || 0)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      <ViewRaw value={pendingByAgent} label="View raw pending by agent" />
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
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th>Status</th>
                      <th className="text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(outbox).length ? (
                      Object.entries(outbox).map(([k, v]) => (
                        <tr key={k} className="ui-tr ui-tr-hover">
                          <td className="text-fg-muted">{k}</td>
                          <td className="text-right data-mono">{String(v || 0)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="ui-tr">
                        <td colSpan={2} className="text-fg-subtle">
                          No outbox data.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th>Start</th>
                      <th>End</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.accounting.period_locks || []).length ? (
                      (data?.accounting.period_locks || []).map((l) => (
                        <tr key={l.id} className="ui-tr ui-tr-hover">
                          <td className="text-fg-muted">{l.start_date}</td>
                          <td className="text-fg-muted">{l.end_date}</td>
                          <td className="text-fg-subtle">{l.reason || "-"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="ui-tr">
                        <td colSpan={3} className="text-fg-subtle">
                          No active locks.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th>Worker</th>
                      <th>Last Seen</th>
                      <th className="text-right">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heartbeats.length ? (
                      heartbeats.map((hb) => (
                        <tr key={hb.worker_name} className="ui-tr ui-tr-hover">
                          <td className="text-fg-muted">{hb.worker_name}</td>
                          <td className="text-fg-muted">{hb.last_seen_at}</td>
                          <td className="text-right data-mono">{fmtAge(hb.last_seen_at)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="ui-tr">
                        <td colSpan={3} className="text-fg-subtle">
                          No worker heartbeat rows yet (worker may be offline).
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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

              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th>Job</th>
                      <th>Interval</th>
                      <th>Next</th>
                      <th className="text-right">Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.jobs.schedules || []).length ? (
                      (data?.jobs.schedules || []).map((s) => (
                        <tr key={s.job_code} className="ui-tr ui-tr-hover">
                          <td className="text-fg-muted">{s.job_code}</td>
                          <td className="text-fg-muted data-mono">{fmtInterval(s.interval_seconds)}</td>
                          <td className="text-fg-subtle">{s.next_run_at || "-"}</td>
                          <td className="text-right data-mono">{s.is_overdue ? "yes" : "no"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="ui-tr">
                        <td colSpan={4} className="text-fg-subtle">
                          No schedules found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th>Recent Failures</th>
                      <th>When</th>
                      <th className="text-right">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobFailures.length ? (
                      recentJobFailures.map((r) => (
                        <tr key={r.id} className="ui-tr ui-tr-hover">
                          <td className="text-fg-muted">{r.job_code}</td>
                          <td className="text-fg-subtle">{fmtAge(r.started_at)}</td>
                          <td className="text-right text-fg-subtle">{r.error_message || "-"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="ui-tr">
                        <td colSpan={3} className="text-fg-subtle">
                          No recent failed runs.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </Page>);
}
