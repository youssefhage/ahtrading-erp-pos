"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { hasAnyPermission, hasPermission, permissionsToStringArray } from "@/lib/permissions";
import { DataTable } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { AiSetupGate } from "@/components/ai-setup-gate";
import { ViewRaw } from "@/components/view-raw";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type RecommendationRow = {
  id: string;
  agent_code: string;
  status: string;
  recommendation_json: unknown;
  recommendation_view?: RecommendationView;
  created_at: string;
  is_executable?: boolean;
  execution_mode?: string;
  decided_at?: string | null;
  decision_reason?: string | null;
  decision_notes?: string | null;
  decided_by_user_id?: string | null;
};

type AgentSettingRow = {
  agent_code: string;
  auto_execute: boolean;
  max_amount_usd: number;
  max_actions_per_day: number;
  is_executable?: boolean;
  execution_mode?: string;
};

type ActionRow = {
  id: string;
  agent_code: string;
  recommendation_id: string | null;
  status: string;
  attempt_count: number;
  error_message: string | null;
  result_entity_type?: string | null;
  result_entity_id?: string | null;
  result_json?: unknown;
  action_json: unknown;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  queued_by_user_id?: string | null;
  queued_at?: string | null;
  executed_by_user_id?: string | null;
  created_at: string;
  executed_at: string | null;
  updated_at: string;
  is_executable?: boolean;
  execution_mode?: string;
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
};

type DecisionDraft = {
  recId: string;
  status: "approved" | "rejected" | "executed";
  agentCode: string;
  reason: string;
  notes: string;
};

type MeContext = {
  permissions?: string[];
};

type RecommendationView = {
  kind?: string;
  kind_label?: string;
  title?: string;
  summary?: string;
  next_step?: string;
  severity?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  link_href?: string | null;
  link_label?: string | null;
  details?: string[];
};

const recStatusChoices = ["", "pending", "approved", "rejected", "executed"] as const;
const actionStatusChoices = ["", "approved", "queued", "blocked", "executed", "failed", "canceled"] as const;
const executableAgentCodes = new Set(["AI_PURCHASE", "AI_DEMAND", "AI_PRICING"]);

type ExecutionAware = {
  agent_code: string;
  execution_mode?: string;
  is_executable?: boolean;
};

type ExecutionMode = "executable" | "review_only";

function normalizeAgentCode(agentCode: string) {
  return String(agentCode || "").trim().toUpperCase();
}

function isExecutableAgent(agentCode: string) {
  return executableAgentCodes.has(normalizeAgentCode(agentCode));
}

function normalizeExecutionMode(raw?: string): ExecutionMode {
  const normalized = String(raw || "").trim().toLowerCase();
  return normalized === "executable" || normalized === "review_only" ? normalized : "review_only";
}

function executionModeFromRow(row?: ExecutionAware) {
  if (!row) return "review_only";
  if (row.is_executable === true) return "executable";
  if (row.is_executable === false) return "review_only";
  const normalized = normalizeExecutionMode(row.execution_mode);
  if (normalized === "executable" || normalized === "review_only") {
    return normalized;
  }
  return isExecutableAgent(row.agent_code) ? "executable" : "review_only";
}

function isRowExecutable(row?: ExecutionAware) {
  return executionModeFromRow(row) === "executable";
}

function executionModeLabel(row?: ExecutionAware) {
  return executionModeFromRow(row) === "executable" ? "Auto-executable" : "Review only";
}

function toCountMap<T extends { status: string }>(rows: T[]) {
  const map: Record<string, number> = {};
  for (const r of rows) map[r.status] = (map[r.status] || 0) + 1;
  return map;
}

function stat(value: number | undefined | null, fallback = "0") {
  return String(Number.isFinite(Number(value)) ? Number(value) : fallback);
}

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function summarizeRecFallback(j: any): { kind: string; title: string; summary: string; nextStep: string; link?: string } {
  const kind = String(j?.kind || j?.type || "recommendation");
  const title = kind.replace(/[_-]+/g, " ");
  const invoiceId = String(j?.invoice_id || "");
  const link = invoiceId ? `/purchasing/supplier-invoices/${encodeURIComponent(invoiceId)}` : undefined;
  return {
    kind,
    title: title || "recommendation",
    summary: String(j?.explain?.why || j?.key || "Triggered by an internal rule."),
    nextStep: "Review recommendation details and decide.",
    link,
  };
}

function normalizedRecommendationView(row: RecommendationRow): {
  kind: string;
  title: string;
  summary: string;
  nextStep: string;
  severity: string;
  details: string[];
  linkHref?: string;
  linkLabel?: string;
} {
  const fallback = summarizeRecFallback((row as any).recommendation_json || {});
  const view = (row.recommendation_view || {}) as RecommendationView;
  const details = Array.isArray(view.details) ? view.details.filter((d) => String(d || "").trim()).map((d) => String(d)) : [];
  return {
    kind: String(view.kind_label || view.kind || fallback.kind || "recommendation"),
    title: String(view.title || fallback.title || "Recommendation"),
    summary: String(view.summary || fallback.summary || "Triggered by an internal rule."),
    nextStep: String(view.next_step || fallback.nextStep || "Review recommendation details and decide."),
    severity: String(view.severity || "medium").toLowerCase(),
    details: details.slice(0, 4),
    linkHref: String(view.link_href || fallback.link || "") || undefined,
    linkLabel: String(view.link_label || "Open related document"),
  };
}

function statusLabel(raw: string) {
  const normalized = String(raw || "pending").trim().toLowerCase();
  return normalized.replace(/_/g, " ");
}

function statusChipClass(status: string) {
  switch (status) {
    case "approved":
      return "ui-chip-success";
    case "executed":
      return "ui-chip-primary";
    case "rejected":
    case "failed":
    case "canceled":
      return "ui-chip-danger";
    case "blocked":
      return "ui-chip-warning";
    case "pending":
      return "ui-chip-default";
    default:
      return "ui-chip-default";
  }
}

function splitTimestamp(rawValue: string): { date: string; time: string } {
  const text = formatDateLike(rawValue);
  const idx = text.indexOf(", ");
  if (idx === -1) return { date: text || "-", time: "" };
  return { date: text.slice(0, idx), time: text.slice(idx + 2) };
}

function formatDecisionSummary(status: string) {
  const normalized = String(status || "pending").trim().toLowerCase();
  return (
    <span className={cn("ui-chip px-2 py-0.5 text-[11px] capitalize", statusChipClass(normalized))}>
      {statusLabel(normalized)}
    </span>
  );
}

function actionResultHref(entityType: string, entityId: string) {
  if (!entityType || !entityId) return null;
  const id = encodeURIComponent(entityId);
  switch (entityType) {
    case "purchase_order":
      return `/purchasing/purchase-orders/${id}`;
    case "item_price":
      return `/pricing/item-prices/${id}`;
    case "sales_invoice":
      return `/sales/invoices/${id}`;
    default:
      return null;
  }
}

export default function AiHubPage() {
  const [err, setErr] = useState<unknown>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [deciding, setDeciding] = useState<DecisionDraft | null>(null);
  const [submittingDecision, setSubmittingDecision] = useState(false);

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

  const canReadAi = hasAnyPermission({ permissions }, ["ai:read", "ai:write"]);
  const canWriteAi = hasPermission({ permissions }, "ai:write");

  const recommendationStatusCounts = useMemo(() => toCountMap(recommendations), [recommendations]);
  const actionStatusCounts = useMemo(() => toCountMap(actions), [actions]);
  const recommendationTotal = useMemo(
    () => Object.values(recommendationStatusCounts).reduce((a, b) => a + b, 0),
    [recommendationStatusCounts]
  );
  const scheduledJobCount = schedules.length;

  function ensureWriteAccess(operation: string): boolean {
    if (!canWriteAi) {
      setErr(new Error(`Missing ai:write permission for ${operation}.`));
      return false;
    }
    return true;
  }

  const load = useCallback(async () => {
    setErr(null);
    setIsLoading(true);
    setPermissionsLoaded(false);
    try {
      const me = await apiGet<MeContext>("/auth/me");
      const nextPermissions = permissionsToStringArray(me);
      setPermissions(nextPermissions);

      if (!hasAnyPermission({ permissions: nextPermissions }, ["ai:read", "ai:write"])) {
        setErr(null);
        setRecommendations([]);
        setSettings([]);
        setActions([]);
        setSchedules([]);
        setRuns([]);
        return;
      }

      const recQs = new URLSearchParams();
      if (filterStatus) recQs.set("status", filterStatus);
      if (filterAgent) recQs.set("agent_code", filterAgent);
      recQs.set("limit", "500");

      const actQs = new URLSearchParams();
      if (actionFilterStatus) actQs.set("status", actionFilterStatus);

      const [rec, cfg, act, sch, run] = await Promise.all([
        apiGet<{ recommendations: RecommendationRow[] }>(
          `/ai/recommendations${recQs.toString() ? `?${recQs.toString()}` : ""}`
        ),
        apiGet<{ settings: AgentSettingRow[] }>("/ai/settings"),
        apiGet<{ actions: ActionRow[] }>(`/ai/actions${actQs.toString() ? `?${actQs.toString()}` : ""}`),
        apiGet<{ schedules: JobScheduleRow[] }>("/ai/jobs/schedules"),
        apiGet<{ runs: JobRunRow[] }>("/ai/jobs/runs?limit=50"),
      ]);
      setRecommendations(rec.recommendations || []);
      setSettings((cfg?.settings || []) as AgentSettingRow[]);
      setActions(act.actions || []);
      setSchedules(sch.schedules || []);
      setRuns(run.runs || []);
    } catch (err) {
      setErr(err);
    } finally {
      setPermissionsLoaded(true);
      setIsLoading(false);
    }
  }, [filterStatus, filterAgent, actionFilterStatus]);

  useEffect(() => {
    load();
    // Initial load only. Filters are applied explicitly via the "Apply Filter" actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openDecision(recId: string, status: DecisionDraft["status"], agentCode: string) {
    if (!canWriteAi) {
      setErr(new Error("Missing ai:write permission to make decisions."));
      return;
    }
    setDeciding({ recId, status, agentCode, reason: "", notes: "" });
  }

  async function submitDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!deciding) return;
    if (!ensureWriteAccess("decide")) return;
    setSubmittingDecision(true);
    try {
      await apiPost(`/ai/recommendations/${deciding.recId}/decide`, {
        status: deciding.status,
        reason: deciding.reason.trim() || undefined,
        notes: deciding.notes.trim() || undefined,
      });
      setDeciding(null);
      await load();
    } catch (err) {
      setErr(err);
    } finally {
      setSubmittingDecision(false);
    }
  }

  async function saveSetting(e: React.FormEvent) {
    e.preventDefault();
    if (!ensureWriteAccess("save settings")) return;
    const normalizedAgentCode = normalizeAgentCode(newAgentCode);
    if (!normalizedAgentCode) {
      setErr(new Error("agent_code is required"));
      return;
    }
    if (newAutoExecute && !isExecutableAgent(normalizedAgentCode)) {
      setErr(new Error(`${normalizedAgentCode} is review-only in this version and cannot auto-execute.`));
      return;
    }
    setErr(null);
    try {
      await apiPost("/ai/settings", {
        agent_code: normalizedAgentCode,
        auto_execute: newAutoExecute,
        max_amount_usd: toNum(newMaxAmountUsd),
        max_actions_per_day: Math.floor(toNum(newMaxActionsPerDay)),
      });
      setSettingOpen(false);
      setSettingEditMode(false);
      setNewAgentCode("");
      setNewAutoExecute(false);
      setNewMaxAmountUsd("0");
      setNewMaxActionsPerDay("0");
      await load();
    } catch (err) {
      setErr(err);
    }
  }

  async function cancelAction(actionId: string) {
    if (!ensureWriteAccess("cancel action")) return;
    try {
      await apiPost(`/ai/actions/${actionId}/cancel`, {});
      await load();
    } catch (err) {
      setErr(err);
    }
  }

  async function requeueAction(actionId: string) {
    if (!ensureWriteAccess("requeue action")) return;
    try {
      await apiPost(`/ai/actions/${actionId}/requeue`, {});
      await load();
    } catch (err) {
      setErr(err);
    }
  }

  async function queueAction(actionId: string) {
    if (!ensureWriteAccess("queue action")) return;
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
    if (!ensureWriteAccess("save schedule")) return;
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
    try {
      await apiPost("/ai/jobs/schedules", {
        job_code: scheduleJobCode.trim(),
        enabled: Boolean(scheduleEnabled),
        interval_seconds: interval,
        options_json: options,
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
    if (!ensureWriteAccess("run job now")) return;
    if (!jobCode) return;
    try {
      await apiPost(`/ai/jobs/${encodeURIComponent(jobCode)}/run-now`, {});
      await load();
    } catch (err) {
      setErr(err);
    }
  }

  return (
    <Page>
      {err ? <AiSetupGate error={err} /> : null}
      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      {permissionsLoaded && !canReadAi ? (
        <Card>
          <CardHeader>
            <CardTitle>AI Hub Access Required</CardTitle>
            <CardDescription>
              You do not have AI read permissions for the active company.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-fg-muted">
              Ask your administrator to grant <span className="font-mono text-xs">ai:read</span> and
              optionally <span className="font-mono text-xs">ai:write</span> from Roles &amp; Permissions.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <div className="rounded-md border border-border bg-bg-elevated p-2">
            <div className="text-[11px] text-fg-muted">Recommendations</div>
            <div className="mt-1 text-sm font-mono">{stat(recommendationTotal)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-2">
            <div className="text-[11px] text-fg-muted">Pending Recommendations</div>
            <div className="mt-1 text-sm font-mono">{stat(recommendationStatusCounts.pending)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-2">
            <div className="text-[11px] text-fg-muted">Queued Actions</div>
            <div className="mt-1 text-sm font-mono">{stat(actionStatusCounts.queued)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-2">
            <div className="text-[11px] text-fg-muted">Failed Actions</div>
            <div className="mt-1 text-sm font-mono">{stat(actionStatusCounts.failed)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-2">
            <div className="text-[11px] text-fg-muted">Blocked Actions</div>
            <div className="mt-1 text-sm font-mono">{stat(actionStatusCounts.blocked)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated p-2">
            <div className="text-[11px] text-fg-muted">Scheduled Jobs</div>
            <div className="mt-1 text-sm font-mono">{stat(scheduledJobCount)}</div>
          </div>
        </div>
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            onClick={load}
            disabled={!canReadAi || isLoading}
            title={canReadAi ? "Reload all sections" : "Requires ai:read"}
          >
            {isLoading ? "Loading..." : "Refresh"}
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-bg-elevated to-bg-sunken/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Recommendations</CardTitle>
              <CardDescription>Review and process AI recommendations.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="ui-chip ui-chip-default text-[11px]">Total {stat(recommendationTotal)}</span>
              <span className="ui-chip ui-chip-warning text-[11px]">Pending {stat(recommendationStatusCounts.pending)}</span>
              <span className="ui-chip ui-chip-success text-[11px]">Approved {stat(recommendationStatusCounts.approved)}</span>
              <span className="ui-chip ui-chip-primary text-[11px]">Executed {stat(recommendationStatusCounts.executed)}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable<RecommendationRow>
            tableId="automation.ai_hub.recommendations"
            rows={recommendations}
            className="space-y-4"
            toolbarLeft={
              <div className="flex flex-1 flex-wrap items-end gap-2">
                <div className="w-full max-w-[170px] space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Status</label>
                  <select className="ui-select h-9 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    {recStatusChoices.map((s) => (
                      <option key={s || "all"} value={s}>
                        {s ? s : "all"}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-full max-w-[260px] space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Agent</label>
                  <Input
                    className="h-9"
                    value={filterAgent}
                    onChange={(e) => setFilterAgent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") load();
                    }}
                    placeholder="e.g. AI_DEMAND"
                  />
                </div>
              </div>
            }
            actions={
              <Button
                size="sm"
                onClick={load}
                disabled={!canReadAi || isLoading}
                title={canReadAi ? "Reload using filters" : "Requires ai:read"}
              >
                {isLoading ? "..." : "Apply Filter"}
              </Button>
            }
            columns={[
              {
                id: "created_at",
                header: "Created",
                sortable: true,
                mono: true,
                cellClassName: "align-top",
                accessor: (r) => r.created_at,
                cell: (r) => {
                  const ts = splitTimestamp(r.created_at);
                  return (
                    <div className="space-y-0.5">
                      <div className="data-mono text-xs text-foreground">{ts.date}</div>
                      {ts.time ? <div className="data-mono text-[11px] text-fg-subtle">{ts.time}</div> : null}
                    </div>
                  );
                },
              },
              {
                id: "agent_code",
                header: "Agent",
                sortable: true,
                mono: true,
                cellClassName: "align-top",
                accessor: (r) => r.agent_code,
                cell: (r) => <span className="data-mono text-xs text-foreground">{r.agent_code}</span>,
              },
              {
                id: "mode",
                header: "Execution",
                cellClassName: "align-top",
                accessor: (r) => executionModeLabel(r),
                cell: (r) => (
                  <span className={cn("ui-chip px-2 py-0.5 text-[11px]", isRowExecutable(r) ? "ui-chip-success" : "ui-chip-warning")}>
                    {executionModeLabel(r)}
                  </span>
                ),
              },
              {
                id: "status",
                header: "Status",
                sortable: true,
                mono: true,
                cellClassName: "align-top",
                accessor: (r) => r.status,
                cell: (r) => formatDecisionSummary(r.status),
              },
              {
                id: "decision",
                header: "Decision",
                cellClassName: "align-top",
                accessor: (r) => String(r.decision_reason || ""),
                cell: (r) => {
                  if (!r.decision_reason && !r.decision_notes) return <span className="text-xs text-fg-subtle">-</span>;
                  return (
                    <div className="max-w-[290px] space-y-1 rounded-md border border-border-subtle bg-bg-sunken/20 p-2 text-xs">
                      <div className="font-mono text-fg-muted">{r.decision_reason || "-"}</div>
                      {r.decision_notes ? <div className="text-fg-muted">{r.decision_notes}</div> : null}
                      {r.decided_at ? <div className="text-fg-subtle">at {formatDateLike(r.decided_at)}</div> : null}
                    </div>
                  );
                },
              },
              {
                id: "recommendation",
                header: "Recommendation",
                cellClassName: "align-top",
                accessor: (r) => JSON.stringify(r.recommendation_json || {}),
                cell: (r) => {
                  const j: any = r.recommendation_json || {};
                  const view = normalizedRecommendationView(r);
                  const severityClass =
                    view.severity === "critical" || view.severity === "high"
                      ? "ui-chip-danger"
                      : view.severity === "low" || view.severity === "info"
                        ? "ui-chip-default"
                        : "ui-chip-warning";
                  return (
                    <div className="max-w-[620px] space-y-2 rounded-lg border border-border-subtle bg-bg-sunken/20 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-fg-muted">{view.kind}</span>
                        <span className={cn("ui-chip px-2 py-0.5 text-[10px]", severityClass)}>{view.severity}</span>
                      </div>
                      <div className="text-sm font-medium text-foreground">{view.title}</div>
                      <div className="text-sm text-foreground">{view.summary}</div>
                      <div className="text-sm text-fg-muted">{view.nextStep}</div>
                      {view.details.length ? (
                        <ul className="space-y-1 text-xs text-fg-muted">
                          {view.details.map((line, idx) => (
                            <li key={`${r.id}-detail-${idx}`}>- {line}</li>
                          ))}
                        </ul>
                      ) : null}
                      {view.linkHref ? (
                        <div>
                          <a className="ui-link text-xs" href={view.linkHref}>
                            {view.linkLabel || "Open related document"}
                          </a>
                        </div>
                      ) : null}
                      <ViewRaw
                        value={j}
                        className="pt-1"
                        label="Technical Details (JSON)"
                        downloadName={`recommendation-${r.id}.json`}
                      />
                    </div>
                  );
                },
              },
              {
                id: "actions",
                header: "Decision",
                align: "right",
                cellClassName: "align-top",
                cell: (r) => (
                  <div className="flex max-w-[220px] flex-wrap justify-end gap-2">
                    {r.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => openDecision(r.id, "approved", r.agent_code)}
                          disabled={!canWriteAi || isLoading}
                          title={canWriteAi ? "Approve" : "Requires ai:write"}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openDecision(r.id, "rejected", r.agent_code)}
                          disabled={!canWriteAi || isLoading}
                          title={canWriteAi ? "Reject" : "Requires ai:write"}
                        >
                          Reject
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openDecision(r.id, "executed", r.agent_code)}
                      disabled={!canWriteAi || isLoading || (r.status !== "pending" && r.status !== "approved")}
                      title={canWriteAi ? "Mark as reviewed / executed" : "Requires ai:write"}
                    >
                      {isRowExecutable(r) ? "Mark Executed" : "Mark Reviewed"}
                    </Button>
                  </div>
                ),
              },
            ]}
            rowClassName={(r) => (r.status === "pending" ? "bg-warning/5" : undefined)}
            getRowId={(r) => r.id}
            emptyText="No recommendations."
            enableGlobalFilter={false}
            initialSort={{ columnId: "created_at", dir: "desc" }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>Actions queued for worker execution and execution outcomes.</CardDescription>
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
              <Button
                variant="outline"
                onClick={load}
                disabled={!canReadAi || isLoading}
                title={canReadAi ? "Reload using filters" : "Requires ai:read"}
              >
                {isLoading ? "..." : "Apply Filter"}
              </Button>
            </div>
          </div>

          <DataTable<ActionRow>
            tableId="automation.ai_hub.actions"
            rows={actions}
            columns={[
              {
                id: "created_at",
                header: "Created",
                sortable: true,
                mono: true,
                accessor: (a) => a.created_at,
                cell: (a) => <span className="font-mono text-xs">{formatDateLike(a.created_at)}</span>,
              },
              {
                id: "agent_code",
                header: "Agent",
                sortable: true,
                mono: true,
                accessor: (a) => a.agent_code,
                cell: (a) => <span className="font-mono text-xs">{a.agent_code}</span>,
              },
              {
                id: "mode",
                header: "Execution",
                accessor: (a) => executionModeLabel(a),
                cell: (a) => (
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] ${
                      isRowExecutable(a)
                        ? "border-success/40 text-success"
                        : "border-warning/40 text-warning"
                    }`}
                  >
                    {executionModeLabel(a)}
                  </span>
                ),
              },
              {
                id: "status",
                header: "Status",
                sortable: true,
                mono: true,
                accessor: (a) => a.status,
                cell: (a) => <span className="font-mono text-xs">{a.status}</span>,
              },
              {
                id: "approval",
                header: "Approval Queue",
                accessor: (a) => `${a.approved_at || ""} ${a.queued_at || ""}`,
                cell: (a) => (
                  <div className="text-xs text-fg-muted">
                    <div className="font-mono">{a.approved_at ? `approved ${formatDateLike(a.approved_at)}` : ""}</div>
                    <div className="font-mono text-fg-subtle">{a.queued_at ? `queued ${formatDateLike(a.queued_at)}` : ""}</div>
                  </div>
                ),
              },
              {
                id: "attempt_count",
                header: "Attempts",
                sortable: true,
                align: "right",
                mono: true,
                accessor: (a) => Number(a.attempt_count || 0),
                cell: (a) => <span className="font-mono text-xs">{Number(a.attempt_count || 0)}</span>,
              },
              {
                id: "error",
                header: "Error",
                accessor: (a) => a.error_message || "",
                cell: (a) => <span className="text-xs text-fg-muted">{a.error_message || ""}</span>,
              },
              {
                id: "action_json",
                header: "Action",
                accessor: (a) => JSON.stringify(a.action_json || {}),
                cell: (a) => (
                  <ViewRaw value={a.action_json} downloadName={`action-${a.id}.json`} />
                ),
              },
              {
                id: "result",
                header: "Result",
                accessor: (a) => String(a.result_entity_type || ""),
                cell: (a) => {
                  if (!a.result_entity_type || !a.result_entity_id) {
                    return <span className="text-xs text-fg-subtle">-</span>;
                  }
                  const href = a.result_entity_type && a.result_entity_id ? actionResultHref(a.result_entity_type, a.result_entity_id) : null;
                  if (!href) return <span className="text-xs text-fg-subtle">Recorded result</span>;
                  return (
                    <a className="ui-link text-xs" href={href}>
                      Open {a.result_entity_type}
                    </a>
                  );
                },
              },
              {
                id: "result_json",
                header: "Result JSON",
                accessor: (a) => JSON.stringify(a.result_json || {}),
                cell: (a) => <ViewRaw value={a.result_json} downloadName={`action-result-${a.id}.json`} />,
              },
              {
                id: "controls",
                header: "Controls",
                align: "right",
                cell: (a) => (
                  <div className="flex flex-col items-end gap-2">
                    {(a.status === "approved" || a.status === "blocked") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => queueAction(a.id)}
                        disabled={!canWriteAi || isLoading || !isRowExecutable(a)}
                        title={
                          isRowExecutable(a)
                            ? canWriteAi
                              ? "Queue"
                              : "Requires ai:write"
                            : "This agent is review-only in this version"
                        }
                      >
                        Queue
                      </Button>
                    )}
                    {a.status === "queued" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => cancelAction(a.id)}
                        disabled={!canWriteAi || isLoading}
                        title={canWriteAi ? "Cancel" : "Requires ai:write"}
                      >
                        Cancel
                      </Button>
                    )}
                    {(a.status === "failed" || a.status === "canceled" || a.status === "blocked") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => requeueAction(a.id)}
                        disabled={!canWriteAi || isLoading || !isRowExecutable(a)}
                        title={
                          isRowExecutable(a)
                            ? canWriteAi
                              ? "Requeue"
                              : "Requires ai:write"
                            : "This agent is review-only in this version"
                        }
                      >
                        Requeue
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
            getRowId={(a) => a.id}
            emptyText="No actions."
            enableGlobalFilter={false}
            initialSort={{ columnId: "created_at", dir: "desc" }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Background Jobs</CardTitle>
          <CardDescription>Schedules are stored in Postgres. Runs are logged.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <DataTable<JobScheduleRow>
            tableId="automation.ai_hub.schedules"
            rows={schedules}
            columns={[
              {
                id: "job_code",
                header: "Job",
                sortable: true,
                mono: true,
                accessor: (s) => s.job_code,
                cell: (s) => <span className="font-mono text-xs">{s.job_code}</span>,
              },
              {
                id: "enabled",
                header: "Enabled",
                sortable: true,
                accessor: (s) => (s.enabled ? "yes" : "no"),
                cell: (s) => (s.enabled ? "yes" : "no"),
              },
              {
                id: "interval_seconds",
                header: "Interval (s)",
                sortable: true,
                align: "right",
                mono: true,
                accessor: (s) => Number(s.interval_seconds || 0),
                cell: (s) => <span className="font-mono text-xs">{Number(s.interval_seconds || 0)}</span>,
              },
              {
                id: "next_run_at",
                header: "Next",
                sortable: true,
                mono: true,
                accessor: (s) => s.next_run_at || "",
                cell: (s) => <span className="font-mono text-xs">{formatDateLike(s.next_run_at)}</span>,
              },
              {
                id: "last_run_at",
                header: "Last",
                sortable: true,
                mono: true,
                accessor: (s) => s.last_run_at || "",
                cell: (s) => <span className="font-mono text-xs">{formatDateLike(s.last_run_at)}</span>,
              },
              {
                id: "options_json",
                header: "Options",
                accessor: (s) => JSON.stringify(s.options_json || {}),
                cell: (s) => <ViewRaw value={s.options_json} downloadName={`job-${s.job_code}.json`} />,
              },
              {
                id: "actions",
                header: "Actions",
                align: "right",
                cell: (s) => (
                  <div className="flex flex-col items-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runJobNow(s.job_code)}
                      disabled={!canWriteAi || isLoading}
                      title={canWriteAi ? "Run now" : "Requires ai:write"}
                    >
                      Run Now
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openScheduleEditor(s)}
                      disabled={!canWriteAi || isLoading}
                      title={canWriteAi ? "Edit schedule" : "Requires ai:write"}
                    >
                      Edit
                    </Button>
                  </div>
                ),
              },
            ]}
            getRowId={(s) => s.job_code}
            emptyText="No schedules found."
            enableGlobalFilter={false}
            initialSort={{ columnId: "job_code", dir: "asc" }}
          />

          <DataTable<JobRunRow>
            tableId="automation.ai_hub.runs"
            rows={runs}
            columns={[
              {
                id: "started_at",
                header: "Started",
                sortable: true,
                mono: true,
                accessor: (r) => r.started_at,
                cell: (r) => <span className="font-mono text-xs">{formatDateLike(r.started_at)}</span>,
              },
              {
                id: "job_code",
                header: "Job",
                sortable: true,
                mono: true,
                accessor: (r) => r.job_code,
                cell: (r) => <span className="font-mono text-xs">{r.job_code}</span>,
              },
              {
                id: "status",
                header: "Status",
                sortable: true,
                mono: true,
                accessor: (r) => r.status,
                cell: (r) => <span className="font-mono text-xs">{r.status}</span>,
              },
              {
                id: "finished_at",
                header: "Finished",
                sortable: true,
                mono: true,
                accessor: (r) => r.finished_at || "",
                cell: (r) => <span className="font-mono text-xs">{formatDateLike(r.finished_at)}</span>,
              },
              {
                id: "error_message",
                header: "Error",
                sortable: true,
                accessor: (r) => r.error_message || "",
                cell: (r) => <span className="text-xs text-fg-muted">{r.error_message || ""}</span>,
              },
            ]}
            getRowId={(r) => r.id}
            emptyText="No runs yet."
            enableGlobalFilter={false}
            initialSort={{ columnId: "started_at", dir: "desc" }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent Settings</CardTitle>
          <CardDescription>Configure whether an agent can auto-execute and set safety caps.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-end">
            <Dialog open={settingOpen} onOpenChange={setSettingOpen}>
              <DialogTrigger asChild>
                <Button
                  disabled={!canWriteAi}
                  title={canWriteAi ? "Add setting" : "Requires ai:write"}
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
                <form onSubmit={saveSetting} className="grid grid-cols-1 gap-3 md:grid-cols-6">
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
                    <Input
                      value={newMaxAmountUsd}
                      onChange={(e) => setNewMaxAmountUsd(e.target.value)}
                      disabled={!canWriteAi}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-fg-muted">Max/Day</label>
                    <Input
                      value={newMaxActionsPerDay}
                      onChange={(e) => setNewMaxActionsPerDay(e.target.value)}
                      disabled={!canWriteAi}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-3 flex items-end justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                      <input
                        type="checkbox"
                        checked={newAutoExecute}
                        disabled={!canWriteAi}
                        onChange={(e) => setNewAutoExecute(e.target.checked)}
                      />
                      Auto Execute
                    </label>
                    <Button type="submit" disabled={!canWriteAi}>
                      Save
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <DataTable<AgentSettingRow>
            tableId="automation.ai_hub.agent_settings"
            rows={settings}
            columns={[
              {
                id: "agent_code",
                header: "Agent",
                sortable: true,
                mono: true,
                accessor: (s) => s.agent_code,
                cell: (s) => <span className="font-mono text-xs">{s.agent_code}</span>,
              },
              {
                id: "auto_execute",
                header: "Auto",
                sortable: true,
                accessor: (s) => (s.auto_execute ? "yes" : "no"),
                cell: (s) => (s.auto_execute ? "yes" : "no"),
              },
              {
                id: "max_amount_usd",
                header: "Max USD",
                sortable: true,
                align: "right",
                mono: true,
                accessor: (s) => Number(s.max_amount_usd || 0),
                cell: (s) => (
                  <span className="font-mono text-xs">
                    {Number(s.max_amount_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </span>
                ),
              },
              {
                id: "max_actions_per_day",
                header: "Max/Day",
                sortable: true,
                align: "right",
                mono: true,
                accessor: (s) => Number(s.max_actions_per_day || 0),
                cell: (s) => (
                  <span className="font-mono text-xs">
                    {Number(s.max_actions_per_day || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </span>
                ),
              },
              {
                id: "actions",
                header: "Actions",
                align: "right",
                cell: (s) => (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canWriteAi}
                    title={canWriteAi ? "Edit setting" : "Requires ai:write"}
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
                ),
              },
              {
                id: "mode",
                header: "Execution Mode",
                accessor: (s) => executionModeLabel(s),
                cell: (s) => (
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] ${
                      isRowExecutable(s)
                        ? "border-success/40 text-success"
                        : "border-warning/40 text-warning"
                    }`}
                  >
                    {executionModeLabel(s)}
                  </span>
                ),
              },
            ]}
            getRowId={(s) => s.agent_code}
            emptyText="No settings yet."
            enableGlobalFilter={false}
            initialSort={{ columnId: "agent_code", dir: "asc" }}
          />
        </CardContent>
      </Card>

      <Dialog open={Boolean(deciding)} onOpenChange={(open) => {
        if (!open) {
          setDeciding(null);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review AI Recommendation</DialogTitle>
            <DialogDescription>
              {deciding
                ? `${deciding.status.toUpperCase()} for ${deciding.agentCode} recommendation`
                : "Decision"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitDecision} className="grid gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
              <textarea
                className="min-h-24 w-full rounded-md border border-border bg-bg-elevated p-3 font-mono text-xs text-fg-muted"
                value={deciding?.reason || ""}
                placeholder="e.g., Reviewed manually, business confirmed."
                onChange={(e) =>
                  setDeciding((d) => (d ? { ...d, reason: e.target.value } : d))
                }
                disabled={!canWriteAi || submittingDecision}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Notes (optional)</label>
              <textarea
                className="min-h-24 w-full rounded-md border border-border bg-bg-elevated p-3 font-mono text-xs text-fg-muted"
                value={deciding?.notes || ""}
                placeholder="Add extra context, links, or follow-up notes."
                onChange={(e) =>
                  setDeciding((d) => (d ? { ...d, notes: e.target.value } : d))
                }
                disabled={!canWriteAi || submittingDecision}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeciding(null)}
                disabled={submittingDecision}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submittingDecision || !canWriteAi}>
                {submittingDecision ? "Saving..." : "Submit decision"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
              <Input
                value={scheduleIntervalSeconds}
                onChange={(e) => setScheduleIntervalSeconds(e.target.value)}
                disabled={!canWriteAi}
              />
            </div>
            <div className="space-y-1 md:col-span-6">
              <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                  disabled={!canWriteAi}
                />
                Enabled
              </label>
            </div>
            <div className="space-y-1 md:col-span-6">
              <label className="text-xs font-medium text-fg-muted">Options JSON</label>
              <textarea
                className="min-h-40 w-full rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-xs text-fg-muted"
                value={scheduleOptionsJson}
                onChange={(e) => setScheduleOptionsJson(e.target.value)}
                disabled={!canWriteAi}
              />
            </div>
            <div className="md:col-span-6 flex justify-end">
              <Button type="submit" disabled={savingSchedule || !canWriteAi}>
                {savingSchedule ? "..." : "Save Schedule"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
