"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Filter,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import {
  hasAnyPermission,
  hasPermission,
  permissionsToStringArray,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { AiSetupGate } from "@/components/ai-setup-gate";
import { ErrorBanner } from "@/components/error-banner";
import { ViewRaw } from "@/components/view-raw";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const recStatusChoices = [
  "",
  "pending",
  "approved",
  "rejected",
  "executed",
] as const;
const actionStatusChoices = [
  "",
  "approved",
  "queued",
  "blocked",
  "executed",
  "failed",
  "canceled",
] as const;
const executableAgentCodes = new Set(["AI_PURCHASE", "AI_DEMAND", "AI_PRICING"]);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type ExecutionAware = {
  agent_code: string;
  execution_mode?: string;
  is_executable?: boolean;
};

function normalizeAgentCode(agentCode: string) {
  return String(agentCode || "").trim().toUpperCase();
}

function isExecutableAgent(agentCode: string) {
  return executableAgentCodes.has(normalizeAgentCode(agentCode));
}

function normalizeExecutionMode(
  raw?: string
): "executable" | "review_only" {
  const normalized = String(raw || "").trim().toLowerCase();
  return normalized === "executable" || normalized === "review_only"
    ? normalized
    : "review_only";
}

function executionModeFromRow(row?: ExecutionAware) {
  if (!row) return "review_only";
  if (row.is_executable === true) return "executable";
  if (row.is_executable === false) return "review_only";
  const normalized = normalizeExecutionMode(row.execution_mode);
  if (normalized === "executable" || normalized === "review_only")
    return normalized;
  return isExecutableAgent(row.agent_code) ? "executable" : "review_only";
}

function isRowExecutable(row?: ExecutionAware) {
  return executionModeFromRow(row) === "executable";
}

function executionModeLabel(row?: ExecutionAware) {
  return executionModeFromRow(row) === "executable"
    ? "Auto-executable"
    : "Review only";
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

function summarizeRecFallback(j: Record<string, unknown>): {
  kind: string;
  title: string;
  summary: string;
  nextStep: string;
  link?: string;
} {
  const kind = String(
    (j?.kind as string) || (j?.type as string) || "recommendation"
  );
  const title = kind.replace(/[_-]+/g, " ");
  const invoiceId = String((j?.invoice_id as string) || "");
  const link = invoiceId
    ? `/purchasing/supplier-invoices/${encodeURIComponent(invoiceId)}`
    : undefined;
  return {
    kind,
    title: title || "recommendation",
    summary: String(
      (j?.explain as Record<string, unknown>)?.why ||
        (j?.key as string) ||
        "Triggered by an internal rule."
    ),
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
  const fallback = summarizeRecFallback(
    (row.recommendation_json as Record<string, unknown>) || {}
  );
  const view = (row.recommendation_view || {}) as RecommendationView;
  const details = Array.isArray(view.details)
    ? view.details
        .filter((d) => String(d || "").trim())
        .map((d) => String(d))
    : [];
  return {
    kind: String(
      view.kind_label || view.kind || fallback.kind || "recommendation"
    ),
    title: String(view.title || fallback.title || "Recommendation"),
    summary: String(
      view.summary || fallback.summary || "Triggered by an internal rule."
    ),
    nextStep: String(
      view.next_step ||
        fallback.nextStep ||
        "Review recommendation details and decide."
    ),
    severity: String(view.severity || "medium").toLowerCase(),
    details: details.slice(0, 4),
    linkHref: String(view.link_href || fallback.link || "") || undefined,
    linkLabel: String(view.link_label || "Open related document"),
  };
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

function severityVariant(
  severity: string
): "destructive" | "warning" | "secondary" | "info" {
  switch (severity) {
    case "critical":
    case "high":
      return "destructive";
    case "medium":
      return "warning";
    case "low":
    case "info":
      return "info";
    default:
      return "secondary";
  }
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

/* ------------------------------------------------------------------ */
/*  Recommendation Card                                                */
/* ------------------------------------------------------------------ */

function RecommendationCard({
  row,
  onApprove,
  onReject,
  onExecute,
  canWrite,
  isLoading,
}: {
  row: RecommendationRow;
  onApprove: () => void;
  onReject: () => void;
  onExecute: () => void;
  canWrite: boolean;
  isLoading: boolean;
}) {
  const view = normalizedRecommendationView(row);
  const [expanded, setExpanded] = useState(false);
  const isPending = row.status === "pending";

  return (
    <Card
      className={cn(
        "transition-shadow hover:shadow-md",
        isPending && "border-yellow-500/30 dark:border-yellow-400/20"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={severityVariant(view.severity)} className="text-xs capitalize">
                {view.severity}
              </Badge>
              <Badge variant="outline" className="font-mono text-xs">
                {view.kind}
              </Badge>
              <Badge
                variant={
                  isRowExecutable(row) ? "success" : "secondary"
                }
                className="text-xs"
              >
                {executionModeLabel(row)}
              </Badge>
            </div>
            <CardTitle className="text-lg leading-snug">
              {view.title}
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              {view.summary}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <StatusBadge status={row.status} />
            <span className="text-xs text-muted-foreground">
              {fmtAge(row.created_at)}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Primary issue detail */}
        {view.details.length > 0 && (
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Primary issue
            </p>
            <p className="mt-1 text-sm">{view.details[0]}</p>
          </div>
        )}

        {/* Next step */}
        <p className="text-sm text-muted-foreground">{view.nextStep}</p>

        {/* Additional details (collapsible) */}
        {(view.details.length > 1 || view.linkHref || row.decision_reason) && (
          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {expanded ? "Less details" : "More details"}
            </button>

            {expanded && (
              <div className="mt-3 space-y-3">
                {view.details.length > 1 && (
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {view.details.slice(1).map((line, idx) => (
                      <li key={`${row.id}-d-${idx}`} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                        {line}
                      </li>
                    ))}
                  </ul>
                )}

                {view.linkHref && (
                  <Link
                    href={view.linkHref}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {view.linkLabel || "Open related document"}
                  </Link>
                )}

                {/* Decision info */}
                {row.decision_reason && (
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Decision reason
                    </p>
                    <p className="mt-1 text-sm">{row.decision_reason}</p>
                    {row.decision_notes && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.decision_notes}
                      </p>
                    )}
                    {row.decided_at && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Decided {formatDateLike(row.decided_at)}
                      </p>
                    )}
                  </div>
                )}

                <ViewRaw
                  value={row.recommendation_json}
                  label="Technical Details (JSON)"
                  downloadName={`recommendation-${row.id}.json`}
                />
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        {isPending && (
          <>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-green-500/30 bg-green-500/5 hover:bg-green-500/10 text-green-700 dark:text-green-400"
                onClick={onApprove}
                disabled={!canWrite || isLoading}
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-500/30 bg-red-500/5 hover:bg-red-500/10 text-red-700 dark:text-red-400"
                onClick={onReject}
                disabled={!canWrite || isLoading}
              >
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                Reject
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={onExecute}
                disabled={!canWrite || isLoading}
              >
                {isRowExecutable(row) ? "Mark Executed" : "Mark Reviewed"}
              </Button>
            </div>
          </>
        )}

        {/* Non-pending: still allow mark-executed for approved recs */}
        {row.status === "approved" && (
          <>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={onExecute}
                disabled={!canWrite || isLoading}
              >
                {isRowExecutable(row) ? "Mark Executed" : "Mark Reviewed"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Action Card                                                        */
/* ------------------------------------------------------------------ */

function ActionCard({
  action,
  onQueue,
  onCancel,
  onRequeue,
  canWrite,
  isLoading,
}: {
  action: ActionRow;
  onQueue: () => void;
  onCancel: () => void;
  onRequeue: () => void;
  canWrite: boolean;
  isLoading: boolean;
}) {
  const resultHref =
    action.result_entity_type && action.result_entity_id
      ? actionResultHref(action.result_entity_type, action.result_entity_id)
      : null;

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {action.agent_code}
              </Badge>
              <StatusBadge status={action.status} />
              <Badge
                variant={isRowExecutable(action) ? "success" : "secondary"}
                className="text-xs"
              >
                {executionModeLabel(action)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Created {formatDateLike(action.created_at)}
              {action.approved_at &&
                ` \u2022 Approved ${formatDateLike(action.approved_at)}`}
              {action.queued_at &&
                ` \u2022 Queued ${formatDateLike(action.queued_at)}`}
            </p>
            {action.error_message && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {action.error_message}
              </p>
            )}
            {resultHref && (
              <Link
                href={resultHref}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Open {action.result_entity_type}
              </Link>
            )}
          </div>

          <div className="flex items-center gap-2">
            {action.attempt_count > 0 && (
              <span className="font-mono text-xs text-muted-foreground">
                {action.attempt_count} attempt{action.attempt_count !== 1 ? "s" : ""}
              </span>
            )}
            <ViewRaw
              value={action.action_json}
              downloadName={`action-${action.id}.json`}
            />
          </div>
        </div>

        {/* Control buttons */}
        <div className="mt-3 flex flex-wrap gap-2">
          {(action.status === "approved" || action.status === "blocked") && (
            <Button
              variant="outline"
              size="sm"
              onClick={onQueue}
              disabled={!canWrite || isLoading || !isRowExecutable(action)}
              title={
                isRowExecutable(action)
                  ? canWrite
                    ? "Queue for execution"
                    : "Requires ai:write"
                  : "This agent is review-only"
              }
            >
              <Play className="mr-1.5 h-3 w-3" />
              Queue
            </Button>
          )}
          {action.status === "queued" && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={!canWrite || isLoading}
            >
              <XCircle className="mr-1.5 h-3 w-3" />
              Cancel
            </Button>
          )}
          {(action.status === "failed" ||
            action.status === "canceled" ||
            action.status === "blocked") && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRequeue}
              disabled={!canWrite || isLoading || !isRowExecutable(action)}
              title={
                isRowExecutable(action)
                  ? canWrite
                    ? "Requeue"
                    : "Requires ai:write"
                  : "This agent is review-only"
              }
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              Requeue
            </Button>
          )}
          {action.result_json != null && (
            <ViewRaw
              value={action.result_json}
              downloadName={`action-result-${action.id}.json`}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function AiHubPage() {
  const [err, setErr] = useState<string>("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [deciding, setDeciding] = useState<DecisionDraft | null>(null);
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // Recommendation filters
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterAgent, setFilterAgent] = useState<string>("");
  const [recommendations, setRecommendations] = useState<
    RecommendationRow[]
  >([]);

  // Agent settings
  const [settings, setSettings] = useState<AgentSettingRow[]>([]);

  // Actions
  const [actionFilterStatus, setActionFilterStatus] = useState<string>("");
  const [actions, setActions] = useState<ActionRow[]>([]);

  // Jobs
  const [schedules, setSchedules] = useState<JobScheduleRow[]>([]);
  const [runs, setRuns] = useState<JobRunRow[]>([]);

  // Agent setting dialog
  const [newAgentCode, setNewAgentCode] = useState("");
  const [newAutoExecute, setNewAutoExecute] = useState(false);
  const [newMaxAmountUsd, setNewMaxAmountUsd] = useState("0");
  const [newMaxActionsPerDay, setNewMaxActionsPerDay] = useState("0");
  const [settingOpen, setSettingOpen] = useState(false);
  const [settingEditMode, setSettingEditMode] = useState(false);

  // Schedule dialog
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleJobCode, setScheduleJobCode] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleIntervalSeconds, setScheduleIntervalSeconds] =
    useState("3600");
  const [scheduleOptionsJson, setScheduleOptionsJson] = useState("{}");
  const [savingSchedule, setSavingSchedule] = useState(false);

  const canReadAi = hasAnyPermission({ permissions }, [
    "ai:read",
    "ai:write",
  ]);
  const canWriteAi = hasPermission({ permissions }, "ai:write");

  const recommendationStatusCounts = useMemo(
    () => toCountMap(recommendations),
    [recommendations]
  );
  const actionStatusCounts = useMemo(
    () => toCountMap(actions),
    [actions]
  );
  const recommendationTotal = useMemo(
    () =>
      Object.values(recommendationStatusCounts).reduce(
        (a, b) => a + b,
        0
      ),
    [recommendationStatusCounts]
  );

  function ensureWriteAccess(operation: string): boolean {
    if (!canWriteAi) {
      setErr(`Missing ai:write permission for ${operation}.`);
      return false;
    }
    return true;
  }

  /* ---------- Data loading ---------- */

  const load = useCallback(async () => {
    setErr("");
    setIsLoading(true);
    setPermissionsLoaded(false);
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
        setErr("");
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
        apiGet<{ actions: ActionRow[] }>(
          `/ai/actions${actQs.toString() ? `?${actQs.toString()}` : ""}`
        ),
        apiGet<{ schedules: JobScheduleRow[] }>("/ai/jobs/schedules"),
        apiGet<{ runs: JobRunRow[] }>("/ai/jobs/runs?limit=50"),
      ]);
      setRecommendations(rec.recommendations || []);
      setSettings((cfg?.settings || []) as AgentSettingRow[]);
      setActions(act.actions || []);
      setSchedules(sch.schedules || []);
      setRuns(run.runs || []);
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    } finally {
      setPermissionsLoaded(true);
      setIsLoading(false);
    }
  }, [filterStatus, filterAgent, actionFilterStatus]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Decision flow ---------- */

  function openDecision(
    recId: string,
    status: DecisionDraft["status"],
    agentCode: string
  ) {
    if (!canWriteAi) {
      setErr("Missing ai:write permission to make decisions.");
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
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    } finally {
      setSubmittingDecision(false);
    }
  }

  /* ---------- Agent settings ---------- */

  async function saveSetting(e: React.FormEvent) {
    e.preventDefault();
    if (!ensureWriteAccess("save settings")) return;
    const normalizedCode = normalizeAgentCode(newAgentCode);
    if (!normalizedCode) {
      setErr("agent_code is required");
      return;
    }
    if (newAutoExecute && !isExecutableAgent(normalizedCode)) {
      setErr(`${normalizedCode} is review-only in this version and cannot auto-execute.`);
      return;
    }
    setErr("");
    try {
      await apiPost("/ai/settings", {
        agent_code: normalizedCode,
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
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    }
  }

  /* ---------- Action controls ---------- */

  async function cancelAction(actionId: string) {
    if (!ensureWriteAccess("cancel action")) return;
    try {
      await apiPost(`/ai/actions/${actionId}/cancel`, {});
      await load();
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    }
  }

  async function requeueAction(actionId: string) {
    if (!ensureWriteAccess("requeue action")) return;
    try {
      await apiPost(`/ai/actions/${actionId}/requeue`, {});
      await load();
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    }
  }

  async function queueAction(actionId: string) {
    if (!ensureWriteAccess("queue action")) return;
    try {
      await apiPost(`/ai/actions/${actionId}/queue`, {});
      await load();
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    }
  }

  /* ---------- Job schedule ---------- */

  function openScheduleEditor(row: JobScheduleRow) {
    setScheduleJobCode(row.job_code);
    setScheduleEnabled(Boolean(row.enabled));
    setScheduleIntervalSeconds(String(row.interval_seconds ?? 3600));
    setScheduleOptionsJson(
      JSON.stringify(row.options_json ?? {}, null, 2)
    );
    setScheduleOpen(true);
  }

  async function saveSchedule(e: React.FormEvent) {
    if (!ensureWriteAccess("save schedule")) return;
    e.preventDefault();
    if (!scheduleJobCode.trim()) {
      setErr("job_code is required");
      return;
    }
    const interval = Math.floor(toNum(scheduleIntervalSeconds));
    if (interval <= 0) {
      setErr("interval_seconds must be > 0");
      return;
    }
    let options: unknown = {};
    try {
      options = JSON.parse(scheduleOptionsJson || "{}");
    } catch {
      setErr("options_json must be valid JSON");
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
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    } finally {
      setSavingSchedule(false);
    }
  }

  async function runJobNow(jobCode: string) {
    if (!ensureWriteAccess("run job now")) return;
    if (!jobCode) return;
    try {
      await apiPost(
        `/ai/jobs/${encodeURIComponent(jobCode)}/run-now`,
        {}
      );
      await load();
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    }
  }

  /* ---------- Derived data ---------- */

  const pendingRecs = useMemo(
    () => recommendations.filter((r) => r.status === "pending"),
    [recommendations]
  );
  const decidedRecs = useMemo(
    () => recommendations.filter((r) => r.status !== "pending"),
    [recommendations]
  );

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-8">
      {err ? <AiSetupGate error={err} /> : null}
      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      {/* Header */}
      <PageHeader
        title="AI Hub"
        description="Manage AI recommendations, agent settings, background jobs, and execution actions."
        badge={
          isLoading ? (
            <Badge variant="secondary" className="gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading
            </Badge>
          ) : undefined
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={!canReadAi || isLoading}
          >
            <RefreshCw
              className={cn("mr-2 h-3.5 w-3.5", isLoading && "animate-spin")}
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
              title="AI Hub Access Required"
              description="Ask your administrator to grant ai:read and optionally ai:write permissions from Roles & Permissions."
            />
          </CardContent>
        </Card>
      )}

      {/* KPI cards */}
      {canReadAi && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Total Recommendations"
            value={stat(recommendationTotal)}
            icon={BrainCircuit}
          />
          <KpiCard
            title="Pending Review"
            value={stat(recommendationStatusCounts.pending)}
            icon={Clock}
            trend={
              Number(recommendationStatusCounts.pending || 0) > 0
                ? "up"
                : "neutral"
            }
            trendValue={
              Number(recommendationStatusCounts.pending || 0) > 0
                ? "needs attention"
                : ""
            }
          />
          <KpiCard
            title="Queued Actions"
            value={stat(actionStatusCounts.queued)}
            icon={Zap}
          />
          <KpiCard
            title="Failed Actions"
            value={stat(actionStatusCounts.failed)}
            icon={XCircle}
            trend={
              Number(actionStatusCounts.failed || 0) > 0 ? "down" : "neutral"
            }
            trendValue={
              Number(actionStatusCounts.failed || 0) > 0
                ? `${stat(actionStatusCounts.failed)} need review`
                : ""
            }
          />
        </div>
      )}

      {/* Main tabs */}
      {canReadAi && (
        <Tabs defaultValue="recommendations" className="space-y-6">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="recommendations" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Recommendations
              {Number(recommendationStatusCounts.pending || 0) > 0 && (
                <Badge variant="warning" className="ml-1 h-5 px-1.5 text-xs">
                  {stat(recommendationStatusCounts.pending)}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="actions" className="gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              Actions
            </TabsTrigger>
            <TabsTrigger value="jobs" className="gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Jobs
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5">
              <Settings2 className="h-3.5 w-3.5" />
              Agent Settings
            </TabsTrigger>
          </TabsList>

          {/* ===== RECOMMENDATIONS TAB ===== */}
          <TabsContent value="recommendations" className="space-y-6">
            {/* Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="w-44 space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Status
                    </label>
                    <Select
                      value={filterStatus || "all"}
                      onValueChange={(v) =>
                        setFilterStatus(v === "all" ? "" : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {recStatusChoices.map((s) => (
                          <SelectItem key={s || "all"} value={s || "all"}>
                            {s || "All statuses"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-56 space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Agent
                    </label>
                    <Input
                      value={filterAgent}
                      onChange={(e) => setFilterAgent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") load();
                      }}
                      placeholder="e.g. AI_DEMAND"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={load}
                    disabled={!canReadAi || isLoading}
                  >
                    <Filter className="mr-1.5 h-3.5 w-3.5" />
                    Apply Filter
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Pending section */}
            {pendingRecs.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">
                    Pending Review
                  </h2>
                  <Badge variant="warning">{pendingRecs.length}</Badge>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {pendingRecs.map((rec) => (
                    <RecommendationCard
                      key={rec.id}
                      row={rec}
                      onApprove={() =>
                        openDecision(rec.id, "approved", rec.agent_code)
                      }
                      onReject={() =>
                        openDecision(rec.id, "rejected", rec.agent_code)
                      }
                      onExecute={() =>
                        openDecision(rec.id, "executed", rec.agent_code)
                      }
                      canWrite={canWriteAi}
                      isLoading={isLoading}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Decided section */}
            {decidedRecs.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-muted-foreground">
                  Previously Decided
                </h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {decidedRecs.map((rec) => (
                    <RecommendationCard
                      key={rec.id}
                      row={rec}
                      onApprove={() =>
                        openDecision(rec.id, "approved", rec.agent_code)
                      }
                      onReject={() =>
                        openDecision(rec.id, "rejected", rec.agent_code)
                      }
                      onExecute={() =>
                        openDecision(rec.id, "executed", rec.agent_code)
                      }
                      canWrite={canWriteAi}
                      isLoading={isLoading}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {recommendations.length === 0 && !isLoading && (
              <Card>
                <CardContent className="py-12">
                  <EmptyState
                    icon={Sparkles}
                    title="No recommendations"
                    description="AI agents have not generated any recommendations yet. Check that your agents are scheduled and running."
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ===== ACTIONS TAB ===== */}
          <TabsContent value="actions" className="space-y-6">
            {/* Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="w-44 space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Status
                    </label>
                    <Select
                      value={actionFilterStatus || "all"}
                      onValueChange={(v) =>
                        setActionFilterStatus(v === "all" ? "" : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {actionStatusChoices.map((s) => (
                          <SelectItem key={s || "all"} value={s || "all"}>
                            {s || "All statuses"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    onClick={load}
                    disabled={!canReadAi || isLoading}
                  >
                    <Filter className="mr-1.5 h-3.5 w-3.5" />
                    Apply Filter
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Action summary chips */}
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(actionStatusCounts).map(
                  ([status, count]) => (
                    <Badge key={status} variant="outline" className="gap-1">
                      <span className="capitalize">{status}</span>
                      <span className="font-mono">{count}</span>
                    </Badge>
                  )
                )}
              </div>
            )}

            {/* Action cards */}
            <div className="space-y-3">
              {actions.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  onQueue={() => queueAction(action.id)}
                  onCancel={() => cancelAction(action.id)}
                  onRequeue={() => requeueAction(action.id)}
                  canWrite={canWriteAi}
                  isLoading={isLoading}
                />
              ))}
            </div>

            {actions.length === 0 && !isLoading && (
              <Card>
                <CardContent className="py-12">
                  <EmptyState
                    icon={Zap}
                    title="No actions"
                    description="No actions have been generated from recommendations yet."
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ===== JOBS TAB ===== */}
          <TabsContent value="jobs" className="space-y-6">
            {/* Schedules */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Job Schedules</CardTitle>
                <CardDescription>
                  Background schedules stored in Postgres, executed by the
                  on-prem worker.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {schedules.length === 0 ? (
                  <EmptyState
                    icon={Clock}
                    title="No schedules"
                    description="No job schedules have been configured."
                  />
                ) : (
                  <div className="space-y-3">
                    {schedules.map((s) => (
                      <div
                        key={s.job_code}
                        className="flex items-center justify-between rounded-lg border p-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">
                              {s.job_code}
                            </span>
                            <Badge
                              variant={s.enabled ? "success" : "secondary"}
                              className="text-xs"
                            >
                              {s.enabled ? "Enabled" : "Disabled"}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>
                              Interval:{" "}
                              <span className="font-mono">
                                {fmtInterval(s.interval_seconds)}
                              </span>
                            </span>
                            <span>
                              Next:{" "}
                              <span className="font-mono">
                                {s.next_run_at
                                  ? formatDateLike(s.next_run_at)
                                  : "-"}
                              </span>
                            </span>
                            <span>
                              Last:{" "}
                              <span className="font-mono">
                                {s.last_run_at
                                  ? formatDateLike(s.last_run_at)
                                  : "-"}
                              </span>
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <ViewRaw
                            value={s.options_json}
                            downloadName={`job-${s.job_code}.json`}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => runJobNow(s.job_code)}
                            disabled={!canWriteAi || isLoading}
                          >
                            <Play className="mr-1.5 h-3 w-3" />
                            Run Now
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openScheduleEditor(s)}
                            disabled={!canWriteAi || isLoading}
                          >
                            Edit
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent runs */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Runs</CardTitle>
                <CardDescription>
                  Last 50 job executions across all scheduled jobs.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {runs.length === 0 ? (
                  <EmptyState
                    icon={Clock}
                    title="No runs yet"
                    description="No jobs have been executed yet."
                  />
                ) : (
                  <div className="space-y-2">
                    {runs.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="font-mono text-xs">
                            {r.job_code}
                          </Badge>
                          <StatusBadge status={r.status} />
                          <span className="text-xs text-muted-foreground">
                            Started {formatDateLike(r.started_at)}
                          </span>
                          {r.finished_at && (
                            <span className="text-xs text-muted-foreground">
                              Finished {formatDateLike(r.finished_at)}
                            </span>
                          )}
                        </div>
                        {r.error_message && (
                          <p className="max-w-sm truncate text-xs text-red-600 dark:text-red-400">
                            {r.error_message}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== SETTINGS TAB ===== */}
          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">
                      Agent Settings
                    </CardTitle>
                    <CardDescription>
                      Configure whether an agent can auto-execute and set
                      safety caps.
                    </CardDescription>
                  </div>
                  <Dialog
                    open={settingOpen}
                    onOpenChange={setSettingOpen}
                  >
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        disabled={!canWriteAi}
                        onClick={() => {
                          setSettingEditMode(false);
                          setNewAgentCode("");
                          setNewAutoExecute(false);
                          setNewMaxAmountUsd("0");
                          setNewMaxActionsPerDay("0");
                          setSettingOpen(true);
                        }}
                      >
                        <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                        New Setting
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>
                          {settingEditMode
                            ? "Edit Agent Setting"
                            : "New Agent Setting"}
                        </DialogTitle>
                        <DialogDescription>
                          Auto-execute is gated by max amount and
                          actions/day. Keep caps tight in production.
                        </DialogDescription>
                      </DialogHeader>
                      <form
                        onSubmit={saveSetting}
                        className="space-y-4"
                      >
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">
                              Agent Code
                            </label>
                            <Input
                              value={newAgentCode}
                              onChange={(e) =>
                                setNewAgentCode(e.target.value)
                              }
                              placeholder="AI_PURCHASE"
                              disabled={settingEditMode}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">
                              Max Amount USD
                            </label>
                            <Input
                              value={newMaxAmountUsd}
                              onChange={(e) =>
                                setNewMaxAmountUsd(e.target.value)
                              }
                              disabled={!canWriteAi}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">
                              Max/Day
                            </label>
                            <Input
                              value={newMaxActionsPerDay}
                              onChange={(e) =>
                                setNewMaxActionsPerDay(e.target.value)
                              }
                              disabled={!canWriteAi}
                            />
                          </div>
                          <div className="flex items-end">
                            <label className="flex items-center gap-2 text-sm font-medium">
                              <input
                                type="checkbox"
                                checked={newAutoExecute}
                                disabled={!canWriteAi}
                                onChange={(e) =>
                                  setNewAutoExecute(e.target.checked)
                                }
                                className="h-4 w-4 rounded border-input"
                              />
                              Auto Execute
                            </label>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setSettingOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            disabled={!canWriteAi}
                          >
                            Save
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {settings.length === 0 ? (
                  <EmptyState
                    icon={Bot}
                    title="No agent settings"
                    description='No agents have been configured yet. Click "New Setting" to add one.'
                  />
                ) : (
                  <div className="space-y-3">
                    {settings.map((s) => (
                      <div
                        key={s.agent_code}
                        className="flex items-center justify-between rounded-lg border p-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">
                              {s.agent_code}
                            </span>
                            <Badge
                              variant={
                                isRowExecutable(s)
                                  ? "success"
                                  : "secondary"
                              }
                              className="text-xs"
                            >
                              {executionModeLabel(s)}
                            </Badge>
                            {s.auto_execute && (
                              <Badge variant="info" className="text-xs">
                                Auto Execute
                              </Badge>
                            )}
                          </div>
                          <div className="flex gap-4 text-xs text-muted-foreground">
                            <span>
                              Max USD:{" "}
                              <span className="font-mono">
                                {Number(
                                  s.max_amount_usd || 0
                                ).toLocaleString("en-US", {
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </span>
                            <span>
                              Max/Day:{" "}
                              <span className="font-mono">
                                {Number(
                                  s.max_actions_per_day || 0
                                ).toLocaleString("en-US", {
                                  maximumFractionDigits: 0,
                                })}
                              </span>
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!canWriteAi}
                          onClick={() => {
                            setSettingEditMode(true);
                            setNewAgentCode(s.agent_code);
                            setNewAutoExecute(
                              Boolean(s.auto_execute)
                            );
                            setNewMaxAmountUsd(
                              String(s.max_amount_usd ?? 0)
                            );
                            setNewMaxActionsPerDay(
                              String(s.max_actions_per_day ?? 0)
                            );
                            setSettingOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* ===== DECISION DIALOG ===== */}
      <Dialog
        open={Boolean(deciding)}
        onOpenChange={(open) => {
          if (!open) setDeciding(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review AI Recommendation</DialogTitle>
            <DialogDescription>
              {deciding
                ? `${deciding.status.toUpperCase()} for ${deciding.agentCode} recommendation`
                : "Decision"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitDecision} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Reason (optional)
              </label>
              <Textarea
                value={deciding?.reason || ""}
                placeholder="e.g., Reviewed manually, business confirmed."
                onChange={(e) =>
                  setDeciding((d) =>
                    d ? { ...d, reason: e.target.value } : d
                  )
                }
                disabled={!canWriteAi || submittingDecision}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Notes (optional)
              </label>
              <Textarea
                value={deciding?.notes || ""}
                placeholder="Add extra context, links, or follow-up notes."
                onChange={(e) =>
                  setDeciding((d) =>
                    d ? { ...d, notes: e.target.value } : d
                  )
                }
                disabled={!canWriteAi || submittingDecision}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeciding(null)}
                disabled={submittingDecision}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submittingDecision || !canWriteAi}
              >
                {submittingDecision && (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                )}
                Submit Decision
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== SCHEDULE EDIT DIALOG ===== */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Job Schedule</DialogTitle>
            <DialogDescription>
              Used by the on-prem worker service. Setting next_run_at is
              handled by &ldquo;Run now&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveSchedule} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Job Code</label>
                <Input value={scheduleJobCode} disabled />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Interval (seconds)
                </label>
                <Input
                  value={scheduleIntervalSeconds}
                  onChange={(e) =>
                    setScheduleIntervalSeconds(e.target.value)
                  }
                  disabled={!canWriteAi}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
                disabled={!canWriteAi}
                className="h-4 w-4 rounded border-input"
              />
              Enabled
            </label>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Options JSON</label>
              <Textarea
                value={scheduleOptionsJson}
                onChange={(e) => setScheduleOptionsJson(e.target.value)}
                disabled={!canWriteAi}
                rows={6}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setScheduleOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingSchedule || !canWriteAi}
              >
                {savingSchedule && (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                )}
                Save Schedule
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
