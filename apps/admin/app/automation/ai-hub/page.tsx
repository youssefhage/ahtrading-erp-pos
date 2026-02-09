"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { ViewRaw } from "@/components/view-raw";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type RecommendationRow = {
  id: string;
  agent_code: string;
  status: string;
  recommendation_json: unknown;
  created_at: string;
};

type AgentSettingRow = {
  agent_code: string;
  auto_execute: boolean;
  max_amount_usd: number;
  max_actions_per_day: number;
};

type ActionRow = {
  id: string;
  agent_code: string;
  recommendation_id: string | null;
  status: string;
  attempt_count: number;
  error_message: string | null;
  action_json: unknown;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  queued_by_user_id?: string | null;
  queued_at?: string | null;
  executed_by_user_id?: string | null;
  created_at: string;
  executed_at: string | null;
  updated_at: string;
};

type JobScheduleRow = {
  job_code: string;
  enabled: boolean;
  interval_seconds: number;
  options_json: unknown;
  last_run_at: string | null;
  next_run_at: string | null;
  updated_at: string;
};

type JobRunRow = {
  id: string;
  job_code: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  details_json: unknown;
};

const recStatusChoices = ["", "pending", "approved", "rejected", "executed"] as const;
const actionStatusChoices = ["", "approved", "queued", "blocked", "executed", "failed", "canceled"] as const;

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function describeRec(j: any): { kind: string; why: string; next: string; link?: string } {
  const kind = String(j?.kind || "");
  if (kind === "purchase_invoice_insights") {
    const changes = Array.isArray(j?.price_changes) ? j.price_changes.length : 0;
    const invId = String(j?.invoice_id || "");
    const link = invId ? `/purchasing/supplier-invoices/${encodeURIComponent(invId)}` : undefined;
    return {
      kind,
      why: changes ? `Detected cost increases on ${changes} item(s).` : "Detected purchase invoice pricing signals.",
      next: "Review margins and selling prices for impacted items.",
      link
    };
  }
  if (kind === "supplier_invoice_hold") {
    const invId = String(j?.invoice_id || "");
    const link = invId ? `/purchasing/supplier-invoices/${encodeURIComponent(invId)}` : undefined;
    return { kind, why: String(j?.hold_reason || "Invoice on hold."), next: "Open the invoice and resolve the hold reason.", link };
  }
  if (kind === "supplier_invoice_due_soon") {
    const invId = String(j?.invoice_id || "");
    const link = invId ? `/purchasing/supplier-invoices/${encodeURIComponent(invId)}` : undefined;
    return { kind, why: `Due soon (${String(j?.due_date || "").slice(0, 10) || "-"})`, next: "Plan payment or confirm terms.", link };
  }
  const key = String(j?.key || "");
  return { kind: kind || "recommendation", why: key || "Triggered by an internal rule.", next: "Open raw details and decide." };
}

export default function AiHubPage() {
  const [err, setErr] = useState<unknown>(null);

  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterAgent, setFilterAgent] = useState<string>("");
  const [recommendations, setRecommendations] = useState<RecommendationRow[]>([]);
  const [settings, setSettings] = useState<AgentSettingRow[]>([]);
  const [actionFilterStatus, setActionFilterStatus] = useState<string>("");
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [schedules, setSchedules] = useState<JobScheduleRow[]>([]);
  const [runs, setRuns] = useState<JobRunRow[]>([]);

  const [newAgentCode, setNewAgentCode] = useState("");
  const [newAutoExecute, setNewAutoExecute] = useState(false);
  const [newMaxAmountUsd, setNewMaxAmountUsd] = useState("0");
  const [newMaxActionsPerDay, setNewMaxActionsPerDay] = useState("0");
  const [settingOpen, setSettingOpen] = useState(false);
  const [settingEditMode, setSettingEditMode] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleJobCode, setScheduleJobCode] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleIntervalSeconds, setScheduleIntervalSeconds] = useState("3600");
  const [scheduleOptionsJson, setScheduleOptionsJson] = useState("{}");
  const [savingSchedule, setSavingSchedule] = useState(false);

  async function load() {
    setErr(null);
    try {
      const recQs = new URLSearchParams();
      if (filterStatus) recQs.set("status", filterStatus);
      if (filterAgent) recQs.set("agent_code", filterAgent);
      recQs.set("limit", "500");

      const actQs = new URLSearchParams();
      if (actionFilterStatus) actQs.set("status", actionFilterStatus);

      const [rec, set, act, sch, run] = await Promise.all([
        apiGet<{ recommendations: RecommendationRow[] }>(
          `/ai/recommendations${recQs.toString() ? `?${recQs.toString()}` : ""}`
        ),
        apiGet<{ settings: AgentSettingRow[] }>("/ai/settings"),
        apiGet<{ actions: ActionRow[] }>(`/ai/actions${actQs.toString() ? `?${actQs.toString()}` : ""}`),
        apiGet<{ schedules: JobScheduleRow[] }>("/ai/jobs/schedules"),
        apiGet<{ runs: JobRunRow[] }>("/ai/jobs/runs?limit=50")
      ]);
      setRecommendations(rec.recommendations || []);
      setSettings(set.settings || []);
      setActions(act.actions || []);
      setSchedules(sch.schedules || []);
      setRuns(run.runs || []);
    } catch (err) {
      setErr(err);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(recId: string, nextStatus: "approved" | "rejected" | "executed") {
    setErr(null);
    try {
      await apiPost(`/ai/recommendations/${recId}/decide`, { status: nextStatus });
      await load();
    } catch (err) {
      setErr(err);
    }
  }

  async function saveSetting(row: AgentSettingRow) {
    setErr(null);
    try {
      await apiPost("/ai/settings", row);
      await load();
    } catch (err) {
      setErr(err);
    }
  }

  async function createOrUpdateSetting(e: React.FormEvent) {
    e.preventDefault();
    if (!newAgentCode.trim()) {
      setErr(new Error("agent_code is required"));
      return;
    }
    const payload: AgentSettingRow = {
      agent_code: newAgentCode.trim(),
      auto_execute: newAutoExecute,
      max_amount_usd: toNum(newMaxAmountUsd),
      max_actions_per_day: Math.floor(toNum(newMaxActionsPerDay))
    };
    await saveSetting(payload);
    setNewAgentCode("");
    setNewAutoExecute(false);
    setNewMaxAmountUsd("0");
    setNewMaxActionsPerDay("0");
    setSettingOpen(false);
    setSettingEditMode(false);
  }

  async function cancelAction(actionId: string) {
    setErr(null);
    try {
      await apiPost(`/ai/actions/${actionId}/cancel`, {});
      await load();
    } catch (err) {
      setErr(err);
    }
  }

  async function requeueAction(actionId: string) {
    setErr(null);
    try {
      await apiPost(`/ai/actions/${actionId}/requeue`, {});
      await load();
    } catch (err) {
      setErr(err);
    }
  }

  async function queueAction(actionId: string) {
    setErr(null);
    try {
      await apiPost(`/ai/actions/${actionId}/queue`, {});
      await load();
    } catch (err) {
      setErr(err);
    }
  }

  function openScheduleEditor(row: JobScheduleRow) {
    setScheduleJobCode(row.job_code);
    setScheduleEnabled(Boolean(row.enabled));
    setScheduleIntervalSeconds(String(row.interval_seconds ?? 3600));
    setScheduleOptionsJson(JSON.stringify(row.options_json ?? {}, null, 2));
    setScheduleOpen(true);
  }

  async function saveSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduleJobCode.trim()) {
      setErr(new Error("job_code is required"));
      return;
    }
    const interval = Math.floor(toNum(scheduleIntervalSeconds));
    if (interval <= 0) {
      setErr(new Error("interval_seconds must be > 0"));
      return;
    }
    let options: unknown = {};
    try {
      options = JSON.parse(scheduleOptionsJson || "{}");
    } catch {
      setErr(new Error("options_json must be valid JSON"));
      return;
    }

    setSavingSchedule(true);
    setErr(null);
    try {
      await apiPost("/ai/jobs/schedules", {
        job_code: scheduleJobCode.trim(),
        enabled: Boolean(scheduleEnabled),
        interval_seconds: interval,
        options_json: options
      });
      setScheduleOpen(false);
      await load();
    } catch (err) {
      setErr(err);
    } finally {
      setSavingSchedule(false);
    }
  }

  async function runJobNow(jobCode: string) {
    if (!jobCode) return;
    setErr(null);
    try {
      await apiPost(`/ai/jobs/${encodeURIComponent(jobCode)}/run-now`, {});
      await load();
    } catch (err) {
      setErr(err);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {err ? <ErrorBanner error={err} onRetry={load} /> : null}

        <div className="flex items-center justify-end">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>

        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Edit Job Schedule</DialogTitle>
              <DialogDescription>
                Used by the on-prem worker service. Setting `next_run_at` is handled by “Run now”.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={saveSchedule} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-fg-muted">Job Code</label>
                <Input value={scheduleJobCode} disabled />
              </div>
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-fg-muted">Interval (seconds)</label>
                <Input value={scheduleIntervalSeconds} onChange={(e) => setScheduleIntervalSeconds(e.target.value)} />
              </div>
              <div className="md:col-span-6">
                <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                  <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />
                  Enabled
                </label>
              </div>
              <div className="space-y-1 md:col-span-6">
                <label className="text-xs font-medium text-fg-muted">Options JSON</label>
                <textarea
                  className="min-h-40 w-full rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-xs text-foreground"
                  value={scheduleOptionsJson}
                  onChange={(e) => setScheduleOptionsJson(e.target.value)}
                />
              </div>
              <div className="md:col-span-6 flex justify-end">
                <Button type="submit" disabled={savingSchedule}>
                  {savingSchedule ? "..." : "Save Schedule"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
            <CardDescription>Review and approve/reject recommendations. v1 is recommendation-first (no auto-execution by default).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-fg-muted">Status</label>
                <select
                  className="ui-select"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  {recStatusChoices.map((s) => (
                    <option key={s || "all"} value={s}>
                      {s ? s : "all"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-fg-muted">Agent</label>
                <Input value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)} placeholder="e.g. AI_DEMAND" />
              </div>
              <div className="md:col-span-2 flex items-end justify-end">
                <Button variant="outline" onClick={load}>
                  Apply Filter
                </Button>
              </div>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Recommendation</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendations.map((r) => (
                    <tr key={r.id} className="border-t border-border-subtle align-top">
                      <td className="px-3 py-2 font-mono text-xs">{r.created_at}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.agent_code}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.status}</td>
                      <td className="px-3 py-2">
                        {(() => {
                          const j: any = (r as any).recommendation_json || {};
                          const d = describeRec(j);
                          return (
                            <div className="max-w-[560px] space-y-1">
                              <div className="font-mono text-xs text-fg-muted">{d.kind}</div>
                              <div className="text-sm text-foreground">{d.why}</div>
                              <div className="text-sm text-fg-muted">{d.next}</div>
                              {d.link ? (
                                <div>
                                  <a className="ui-link text-xs" href={d.link}>
                                    Open related document
                                  </a>
                                </div>
                              ) : null}
                              <ViewRaw value={j} className="pt-1" />
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-col items-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => decide(r.id, "approved")}>
                            Approve
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => decide(r.id, "rejected")}>
                            Reject
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => decide(r.id, "executed")}>
                            Mark Executed
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {recommendations.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                        No recommendations.
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
            <CardTitle>Actions</CardTitle>
            <CardDescription>Queued actions are executed by the worker’s AI executor job. {actions.length} rows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-fg-muted">Status</label>
                <select
                  className="ui-select"
                  value={actionFilterStatus}
                  onChange={(e) => setActionFilterStatus(e.target.value)}
                >
                  {actionStatusChoices.map((s) => (
                    <option key={s || "all"} value={s}>
                      {s ? s : "all"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 flex items-end justify-end">
                <Button variant="outline" onClick={load}>
                  Apply Filter
                </Button>
              </div>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Approval</th>
                    <th className="px-3 py-2 text-right">Attempts</th>
                    <th className="px-3 py-2">Error</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2 text-right">Controls</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a) => (
                    <tr key={a.id} className="border-t border-border-subtle align-top">
                      <td className="px-3 py-2 font-mono text-xs">{a.created_at}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.agent_code}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.status}</td>
                      <td className="px-3 py-2">
                        <div className="text-xs text-fg-muted">
                          <div className="font-mono">{a.approved_at ? `approved ${a.approved_at}` : ""}</div>
                          <div className="font-mono text-fg-subtle">
                            {a.queued_at ? `queued ${a.queued_at}` : ""}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(a.attempt_count || 0)}</td>
                      <td className="px-3 py-2">
                        <span className="text-xs text-fg-muted">{a.error_message || ""}</span>
                      </td>
                      <td className="px-3 py-2">
                        <ViewRaw value={a.action_json} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-col items-end gap-2">
                          {a.status === "approved" || a.status === "blocked" ? (
                            <Button variant="outline" size="sm" onClick={() => queueAction(a.id)}>
                              Queue
                            </Button>
                          ) : null}
                          {a.status === "queued" ? (
                            <Button variant="outline" size="sm" onClick={() => cancelAction(a.id)}>
                              Cancel
                            </Button>
                          ) : null}
                          {a.status === "failed" || a.status === "canceled" || a.status === "blocked" ? (
                            <Button variant="outline" size="sm" onClick={() => requeueAction(a.id)}>
                              Requeue
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {actions.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={8}>
                        No actions.
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
            <CardTitle>Background Jobs</CardTitle>
            <CardDescription>Schedules are stored in Postgres. Runs are logged. {schedules.length} schedules</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">Enabled</th>
                    <th className="px-3 py-2 text-right">Interval (s)</th>
                    <th className="px-3 py-2">Next</th>
                    <th className="px-3 py-2">Last</th>
                    <th className="px-3 py-2">Options</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((s) => (
                    <tr key={s.job_code} className="border-t border-border-subtle align-top">
                      <td className="px-3 py-2 font-mono text-xs">{s.job_code}</td>
                      <td className="px-3 py-2">{s.enabled ? "yes" : "no"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(s.interval_seconds || 0)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{s.next_run_at || ""}</td>
                      <td className="px-3 py-2 font-mono text-xs">{s.last_run_at || ""}</td>
                      <td className="px-3 py-2">
                        <ViewRaw value={s.options_json} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-col items-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => runJobNow(s.job_code)}>
                            Run Now
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => openScheduleEditor(s)}>
                            Edit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {schedules.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={7}>
                        No schedules found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Finished</th>
                    <th className="px-3 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{r.started_at}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.job_code}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.status}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.finished_at || ""}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{r.error_message || ""}</td>
                    </tr>
                  ))}
                  {runs.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                        No runs yet.
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
            <CardTitle>Agent Settings</CardTitle>
            <CardDescription>Configure whether an agent can auto-execute and define safety caps.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-end">
              <Dialog open={settingOpen} onOpenChange={setSettingOpen}>
                <DialogTrigger asChild>
                  <Button
                    onClick={() => {
                      setSettingEditMode(false);
                      setNewAgentCode("");
                      setNewAutoExecute(false);
                      setNewMaxAmountUsd("0");
                      setNewMaxActionsPerDay("0");
                      setSettingOpen(true);
                    }}
                  >
                    New Setting
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>{settingEditMode ? "Edit Agent Setting" : "New Agent Setting"}</DialogTitle>
                    <DialogDescription>
                      Auto-execute is gated by max amount and actions/day. Keep caps tight in production.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createOrUpdateSetting} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Agent Code</label>
                      <Input
                        value={newAgentCode}
                        onChange={(e) => setNewAgentCode(e.target.value)}
                        placeholder="AI_PURCHASE"
                        disabled={settingEditMode}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Max Amount USD</label>
                      <Input value={newMaxAmountUsd} onChange={(e) => setNewMaxAmountUsd(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Max/Day</label>
                      <Input value={newMaxActionsPerDay} onChange={(e) => setNewMaxActionsPerDay(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-3 flex items-end justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                        <input
                          type="checkbox"
                          checked={newAutoExecute}
                          onChange={(e) => setNewAutoExecute(e.target.checked)}
                        />
                        Auto Execute
                      </label>
                      <Button type="submit">Save</Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Auto</th>
                    <th className="px-3 py-2 text-right">Max USD</th>
                    <th className="px-3 py-2 text-right">Max/Day</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.map((s) => (
                    <tr key={s.agent_code} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{s.agent_code}</td>
                      <td className="px-3 py-2">
                        {s.auto_execute ? "yes" : "no"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(s.max_amount_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(s.max_actions_per_day || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSettingEditMode(true);
                            setNewAgentCode(s.agent_code);
                            setNewAutoExecute(Boolean(s.auto_execute));
                            setNewMaxAmountUsd(String(s.max_amount_usd ?? 0));
                            setNewMaxActionsPerDay(String(s.max_actions_per_day ?? 0));
                            setSettingOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {settings.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                        No settings yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>);
}
