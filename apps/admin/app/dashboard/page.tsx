"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  Users,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Activity,
  ShoppingCart,
  Truck,
  CalendarRange,
  Search,
  SlidersHorizontal
} from "lucide-react";

import { ApiError, apiGet } from "@/lib/api";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";
import { getFxRateUsdToLbp, upsertFxRateUsdToLbp } from "@/lib/fx";
import { cn } from "@/lib/utils";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Metrics = {
  sales_today_usd: string | number;
  sales_today_lbp: string | number;
  purchases_today_usd: string | number;
  purchases_today_lbp: string | number;
  ar_usd: string | number;
  ar_lbp: string | number;
  ap_usd: string | number;
  ap_lbp: string | number;
  stock_value_usd: string | number;
  stock_value_lbp: string | number;
  items_count: number;
  customers_count: number;
  suppliers_count: number;
  low_stock_count: number;
};

type ApiHealth = {
  status: "ok" | "ready" | "degraded";
  env: string;
  db: "ok" | "down";
  service: string;
  version?: string;
  request_id?: string;
  error?: string;
};

type PosOutboxSummary = {
  total: number;
  by_status: Record<string, number>;
  by_device?: Record<string, Record<string, number>>;
  oldest_by_status?: Record<string, string | null>;
};

type AttentionItem = {
  key: string;
  severity: "info" | "warning" | "critical";
  label: string;
  count: number;
  href: string;
};

type AttentionSummary = {
  items?: AttentionItem[];
  failed_jobs?: { job_code: string; count: number }[];
  worker_age_seconds?: number | null;
};

type ProfitLossSlice = {
  start_date?: string;
  end_date?: string;
  revenue_usd: string | number;
  expense_usd: string | number;
  net_profit_usd?: string | number;
};

type MeContext = {
  permissions?: string[];
};

type DashboardTone = "default" | "dark";
type DashboardStatus = "good" | "warning" | "critical";
type ActivitySeverity = "critical" | "warning" | "info";
type PulseStatus = "ok" | "partial" | "error";

type ActivityRow = {
  id: string;
  label: string;
  source: string;
  severity: ActivitySeverity;
  count: number;
  href: string;
  note: string;
};

type MonthlyPulsePoint = {
  label: string;
  received: number;
  spent: number;
};

type MonthRange = {
  label: string;
  start: string;
  end: string;
};

function fmtNumber(value: string | number) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}

function fmtCurrency(value: string | number, currency: "USD" | "LBP") {
  const n = Number(value || 0);
  if (currency === "USD") return `$${fmtNumber(n)}`;
  return `LL ${fmtNumber(n)}`;
}

function toIsoDateLocal(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTrailingMonthRanges(months: number, now = new Date()): MonthRange[] {
  const ranges: MonthRange[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const anchor = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = i === 0 ? now : new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    ranges.push({
      label: anchor.toLocaleDateString("en-US", { month: "short" }),
      start: toIsoDateLocal(start),
      end: toIsoDateLocal(end)
    });
  }
  return ranges;
}

function toTrendText(current: number, previous: number): { trend: "up" | "down" | "neutral"; text: string } {
  if (!Number.isFinite(previous) || previous <= 0) {
    return { trend: "neutral", text: "No previous month baseline" };
  }
  const delta = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(delta) < 0.1) {
    return { trend: "neutral", text: "Flat vs previous month" };
  }
  return {
    trend: delta > 0 ? "up" : "down",
    text: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% vs previous month`
  };
}

function buildPolylinePath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

function buildAreaPath(points: Array<{ x: number; y: number }>, bottomY: number) {
  if (!points.length) return "";
  const line = buildPolylinePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L${last.x},${bottomY} L${first.x},${bottomY} Z`;
}

function MetricCard({
  title,
  description,
  value,
  secondaryValue,
  icon: Icon,
  trend,
  trendValue,
  loading,
  onClick,
  tone = "default"
}: {
  title: string;
  description: string;
  value: string;
  secondaryValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  loading?: boolean;
  onClick?: () => void;
  tone?: DashboardTone;
}) {
  const dark = tone === "dark";

  if (loading) {
    return (
      <Card className={cn(dark && "border-zinc-800 bg-zinc-900/80")}>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </CardHeader>
        <CardContent>
          <Skeleton className="mb-2 h-8 w-32" />
          <Skeleton className="h-4 w-24" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "group cursor-pointer transition-all duration-200",
        dark
          ? "border-zinc-800 bg-zinc-900/80 shadow-[0_1px_0_rgba(255,255,255,0.05),0_16px_30px_rgba(0,0,0,0.35)] hover:border-zinc-700 hover:bg-zinc-900"
          : "hover:border-border-strong hover:bg-bg-sunken/60"
      )}
      onClick={onClick}
    >
      <CardHeader className={cn("pb-2", dark && "border-zinc-800/90 bg-transparent")}>
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle className={cn("text-sm font-medium", dark ? "text-zinc-300" : "text-fg-muted")}>{title}</CardTitle>
            <CardDescription className={cn("text-xs", dark ? "text-zinc-500" : "")}>{description}</CardDescription>
          </div>
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              dark ? "bg-zinc-800 text-zinc-300" : "bg-bg-sunken text-fg-muted"
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          <span className={cn("text-2xl font-semibold tabular-nums", dark ? "text-zinc-100" : "text-foreground")}>
            {value}
          </span>
          {secondaryValue ? (
            <span className={cn("text-sm tabular-nums", dark ? "text-zinc-400" : "text-fg-subtle")}>{secondaryValue}</span>
          ) : null}
          {trend && trendValue ? (
            <div className="mt-1 flex items-center gap-1">
              {trend === "up" ? (
                <TrendingUp className="h-3.5 w-3.5 text-success" />
              ) : trend === "down" ? (
                <TrendingDown className="h-3.5 w-3.5 text-danger" />
              ) : null}
              <span
                className={cn(
                  "text-xs",
                  trend === "up" ? "text-success" : trend === "down" ? "text-danger" : dark ? "text-zinc-400" : "text-fg-subtle"
                )}
              >
                {trendValue}
              </span>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function QuickAction({
  icon: Icon,
  label,
  description,
  onClick,
  tone = "default"
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  onClick: () => void;
  tone?: DashboardTone;
}) {
  const dark = tone === "dark";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all duration-200",
        dark
          ? "border-zinc-800 bg-zinc-900/80 hover:border-zinc-700 hover:bg-zinc-900"
          : "border-border-subtle bg-bg-elevated/60 hover:border-border-strong hover:bg-bg-sunken/60"
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
          dark ? "bg-zinc-800 text-zinc-300" : "bg-bg-sunken text-fg-muted"
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", dark ? "text-zinc-100" : "text-foreground")}>{label}</p>
        <p className={cn("text-xs", dark ? "text-zinc-500" : "text-fg-subtle")}>{description}</p>
      </div>
      <ArrowRight className={cn("h-4 w-4 shrink-0", dark ? "text-zinc-500" : "text-fg-subtle")} />
    </button>
  );
}

function QuickActionCompact({
  icon: Icon,
  label,
  onClick,
  tone = "default"
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  tone?: DashboardTone;
}) {
  const dark = tone === "dark";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn(
        "h-9 justify-start gap-2 rounded-full px-3 text-xs",
        dark
          ? "border-zinc-700 bg-zinc-900/80 text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800"
          : "bg-bg-elevated/40"
      )}
    >
      <Icon className={cn("h-4 w-4", dark ? "text-zinc-300" : "text-fg-muted")} />
      <span className={cn(dark ? "text-zinc-100" : "text-foreground")}>{label}</span>
    </Button>
  );
}

function StatusIndicator({
  label,
  value,
  status,
  tone = "default"
}: {
  label: string;
  value: string | number;
  status: DashboardStatus;
  tone?: DashboardTone;
}) {
  const dark = tone === "dark";

  const statusColorsDefault = {
    good: "bg-success/20 text-success border-success/30",
    warning: "bg-warning/20 text-warning border-warning/30",
    critical: "bg-danger/20 text-danger border-danger/30"
  };

  const statusColorsDark = {
    good: "border-success/30 bg-success/20 text-success",
    warning: "border-warning/30 bg-warning/20 text-warning",
    critical: "border-danger/30 bg-danger/20 text-danger"
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md border px-3 py-2",
        dark ? "border-zinc-800 bg-zinc-900/70" : "border-border-subtle bg-bg-elevated/60"
      )}
    >
      <span className={cn("text-sm", dark ? "text-zinc-400" : "text-fg-muted")}>{label}</span>
      <span
        className={cn(
          "rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums",
          dark ? statusColorsDark[status] : statusColorsDefault[status]
        )}
      >
        {value}
      </span>
    </div>
  );
}

function TrendChartCard({
  title,
  subtitle,
  labels,
  currentSeries,
  baselineSeries,
  currentLegend,
  baselineLegend,
  valueLabel,
  trend,
  color = "sky",
  loading
}: {
  title: string;
  subtitle: string;
  labels: string[];
  currentSeries: number[];
  baselineSeries: number[];
  currentLegend: string;
  baselineLegend: string;
  valueLabel: string;
  trend: { trend: "up" | "down" | "neutral"; text: string };
  color?: "sky" | "amber";
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-2 h-3 w-60" />
        <Skeleton className="mt-4 h-44 w-full" />
      </div>
    );
  }

  const width = 620;
  const height = 210;
  const padX = 26;
  const padY = 16;
  const bottomY = height - 20;
  const chartHeight = bottomY - padY;
  const maxValue = Math.max(...currentSeries, ...baselineSeries, 1);
  const stepX = currentSeries.length > 1 ? (width - padX * 2) / (currentSeries.length - 1) : 0;

  const toPoints = (values: number[]) =>
    values.map((value, index) => {
      const x = padX + index * stepX;
      const ratio = value <= 0 ? 0 : value / maxValue;
      const y = bottomY - ratio * chartHeight;
      return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
    });

  const currentPoints = toPoints(currentSeries);
  const baselinePoints = toPoints(baselineSeries);
  const currentPath = buildPolylinePath(currentPoints);
  const baselinePath = buildPolylinePath(baselinePoints);
  const areaPath = buildAreaPath(currentPoints, bottomY);

  const palette =
    color === "amber"
      ? {
          primary: "rgb(var(--warning))",
          baseline: "rgba(var(--warning), 0.75)",
          grid: "rgba(var(--warning), 0.14)",
          fillStart: "rgba(var(--warning), 0.30)",
          fillEnd: "rgba(var(--warning), 0.00)",
          trendUp: "text-warning"
        }
      : {
          primary: "rgb(var(--info))",
          baseline: "rgba(var(--info), 0.75)",
          grid: "rgba(var(--info), 0.14)",
          fillStart: "rgba(var(--info), 0.28)",
          fillEnd: "rgba(var(--info), 0.00)",
          trendUp: "text-info"
        };

  const gradientId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-fill`;

  if (!currentSeries.length || !labels.length) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
        <p className="text-lg font-semibold text-zinc-100">{title}</p>
        <p className="mt-2 text-sm text-zinc-400">Trend data unavailable for this period.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-zinc-100">{title}</p>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-zinc-100">{valueLabel}</p>
          <p
            className={cn(
              "text-xs",
              trend.trend === "up"
                ? palette.trendUp
                : trend.trend === "down"
                  ? "text-danger"
                  : "text-fg-subtle"
            )}
          >
            {trend.text}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-zinc-400">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: palette.primary }} />
          {currentLegend}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full border border-zinc-600" style={{ backgroundColor: palette.baseline }} />
          {baselineLegend}
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-44 w-full">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={palette.fillStart} />
            <stop offset="100%" stopColor={palette.fillEnd} />
          </linearGradient>
        </defs>

        {Array.from({ length: 5 }).map((_, idx) => {
          const y = padY + (chartHeight / 4) * idx;
          return <line key={`grid-${idx}`} x1={padX} y1={y} x2={width - padX} y2={y} stroke={palette.grid} />;
        })}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={baselinePath} fill="none" stroke={palette.baseline} strokeWidth="2" strokeDasharray="5 5" opacity="0.9" />
        <path d={currentPath} fill="none" stroke={palette.primary} strokeWidth="3" />

        {currentPoints.length ? (
          <circle
            cx={currentPoints[currentPoints.length - 1].x}
            cy={currentPoints[currentPoints.length - 1].y}
            r="4"
            fill={palette.primary}
            stroke="rgba(var(--bg), 0.95)"
            strokeWidth="2"
          />
        ) : null}
      </svg>

      <div
        className="mt-2 grid gap-1 text-[11px] uppercase tracking-[0.08em] text-zinc-500"
        style={{ gridTemplateColumns: `repeat(${Math.max(labels.length, 1)}, minmax(0, 1fr))` }}
      >
        {labels.map((label) => (
          <span key={`${title}-${label}`} className="truncate text-center">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [aiSummary, setAiSummary] = useState<Record<string, number>>({});
  const [attention, setAttention] = useState<AttentionSummary | null>(null);
  const [monthlyPulse, setMonthlyPulse] = useState<MonthlyPulsePoint[]>([]);
  const [pulseLoading, setPulseLoading] = useState(true);
  const [pulseStatus, setPulseStatus] = useState<PulseStatus>("ok");

  const [status, setStatus] = useState<string>("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null);
  const [dataIsStale, setDataIsStale] = useState(false);
  const [lastErrorRequestId, setLastErrorRequestId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoadedMetrics, setHasLoadedMetrics] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [outboxSummary, setOutboxSummary] = useState<PosOutboxSummary | null>(null);

  const [activityQuery, setActivityQuery] = useState("");
  const [activityFilter, setActivityFilter] = useState<"all" | ActivitySeverity>("all");

  const hasLoadedMetricsRef = useRef(false);
  const metricsRef = useRef<Metrics | null>(null);
  const refreshingRef = useRef(false);

  const [fxLoading, setFxLoading] = useState(true);
  const [usdToLbp, setUsdToLbp] = useState("90000");
  const [savingFx, setSavingFx] = useState(false);
  const [fxStatus, setFxStatus] = useState("");

  function aiCount(agentCode: string) {
    return Number(aiSummary[agentCode] || 0);
  }

  const loadFx = useCallback(async () => {
    setFxLoading(true);
    try {
      const r = await getFxRateUsdToLbp();
      const n = Number(r?.usd_to_lbp || 0);
      if (Number.isFinite(n) && n > 0) setUsdToLbp(String(n));
    } finally {
      setFxLoading(false);
    }
  }, []);

  const loadMonthlyPulse = useCallback(async () => {
    setPulseLoading(true);
    try {
      const ranges = buildTrailingMonthRanges(6);
      const results = await Promise.allSettled(
        ranges.map((range) => apiGet<ProfitLossSlice>(`/reports/profit-loss?start_date=${range.start}&end_date=${range.end}`))
      );
      const points: MonthlyPulsePoint[] = [];
      let failedCount = 0;

      for (let index = 0; index < ranges.length; index += 1) {
        const range = ranges[index];
        const result = results[index];
        if (result.status === "fulfilled") {
          points.push({
            label: range.label,
            received: Number(result.value.revenue_usd || 0),
            spent: Number(result.value.expense_usd || 0)
          });
        } else {
          failedCount += 1;
        }
      }

      setMonthlyPulse(points);
      if (failedCount === 0) {
        setPulseStatus("ok");
      } else {
        setPulseStatus(points.length > 0 ? "partial" : "error");
      }
    } catch {
      setMonthlyPulse([]);
      setPulseStatus("error");
    } finally {
      setPulseLoading(false);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    const [metricsResult, aiResult, healthResult, meResult, outboxResult, attentionResult] = await Promise.allSettled([
      apiGet<{ metrics: Metrics }>("/reports/metrics"),
      apiGet<{ rows: { agent_code: string; status: string; count: number }[] }>(
        "/ai/recommendations/summary?status=pending"
      ),
      apiGet<ApiHealth>("/health"),
      apiGet<MeContext>("/auth/me"),
      apiGet<PosOutboxSummary>("/pos/outbox/summary"),
      apiGet<AttentionSummary>("/reports/attention")
    ]);

    const nextAiSummary: Record<string, number> = {};
    let metricLoadFailed = false;

    if (metricsResult.status === "fulfilled") {
      setMetrics(metricsResult.value.metrics);
      setHasLoadedMetrics(true);
      hasLoadedMetricsRef.current = true;
      setDataIsStale(false);
    } else {
      metricLoadFailed = true;
      setDataIsStale(Boolean(metricsRef.current));
      setLastErrorRequestId(metricsResult.reason instanceof ApiError ? metricsResult.reason.requestId || null : null);
      if (!hasLoadedMetricsRef.current) setMetrics(null);
      const msg = metricsResult.reason instanceof Error ? metricsResult.reason.message : String(metricsResult.reason);
      setStatus(msg);
    }

    if (aiResult.status === "fulfilled") {
      for (const row of aiResult.value.rows || []) {
        nextAiSummary[String(row.agent_code)] = Number(row.count || 0);
      }
      setAiSummary(nextAiSummary);
    } else {
      setAiSummary({});
    }

    if (healthResult.status === "fulfilled") {
      setApiHealth(healthResult.value);
    } else {
      setApiHealth({
        status: "degraded",
        env: "unknown",
        db: "down",
        service: "ahtrading-backend",
        error: healthResult.reason instanceof Error ? healthResult.reason.message : String(healthResult.reason)
      });
    }

    if (meResult.status === "fulfilled") {
      setPermissions(
        Array.isArray((meResult.value as MeContext)?.permissions)
          ? [...((meResult.value as MeContext).permissions || [])]
          : []
      );
    } else {
      setPermissions([]);
    }

    if (outboxResult.status === "fulfilled") {
      setOutboxSummary(outboxResult.value || null);
    } else {
      setOutboxSummary(null);
    }

    if (attentionResult.status === "fulfilled") {
      setAttention(attentionResult.value || null);
    } else {
      setAttention(null);
    }

    setLastUpdatedAt(new Date());
    if (!metricLoadFailed) {
      setStatus("");
      setLastErrorRequestId(null);
    }
  }, []);

  useEffect(() => {
    metricsRef.current = metrics;
    hasLoadedMetricsRef.current = hasLoadedMetrics;
  }, [metrics, hasLoadedMetrics]);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    setRefreshing(true);
    refreshingRef.current = true;
    try {
      await Promise.all([
        loadDashboard(),
        loadFx().catch(() => {
          // ignore
        }),
        loadMonthlyPulse().catch(() => {
          // ignore
        })
      ]);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [loadDashboard, loadFx, loadMonthlyPulse]);

  useEffect(() => {
    async function run() {
      setStatus("Loading...");
      try {
        await Promise.all([loadDashboard(), loadFx(), loadMonthlyPulse()]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(message);
      }
    }
    run();
  }, [loadDashboard, loadFx, loadMonthlyPulse]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden || refreshingRef.current) return;
      void refresh();
    }, 60000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const isLoading = !hasLoadedMetrics && status === "Loading...";

  const canWriteSales = hasPermission({ permissions }, "sales:write");
  const canWritePurchases = hasPermission({ permissions }, "purchases:write");
  const canReadInventory = hasPermission({ permissions }, "inventory:read");
  const canReadCustomers = hasPermission({ permissions }, "customers:read");
  const canReadAi = hasAnyPermission({ permissions }, ["ai:read", "ai:write"]);
  const canManagePos = hasPermission({ permissions }, "pos:manage");
  const canManageConfig = hasPermission({ permissions }, "config:read");

  const outboxPending = Number(outboxSummary?.by_status?.pending || 0);
  const outboxFailed = Number(outboxSummary?.by_status?.failed || 0) + Number(outboxSummary?.by_status?.dead || 0);
  const outboxProcessed = Number(outboxSummary?.by_status?.processed || 0);
  const outboxTotal = Number(outboxSummary?.total || 0);

  const receivedSeries = useMemo(() => monthlyPulse.map((point) => point.received), [monthlyPulse]);
  const spentSeries = useMemo(() => monthlyPulse.map((point) => point.spent), [monthlyPulse]);
  const monthLabels = useMemo(() => monthlyPulse.map((point) => point.label), [monthlyPulse]);
  const hasPulseData = receivedSeries.length > 0 && spentSeries.length > 0;

  const receivedBaseline = useMemo(
    () => receivedSeries.map((value, index) => (index === 0 ? value : receivedSeries[index - 1])),
    [receivedSeries]
  );

  const spentBaseline = useMemo(
    () => spentSeries.map((value, index) => (index === 0 ? value : spentSeries[index - 1])),
    [spentSeries]
  );

  const latestReceived = hasPulseData ? receivedSeries[receivedSeries.length - 1] : null;
  const latestSpent = hasPulseData ? spentSeries[spentSeries.length - 1] : null;
  const prevReceived = hasPulseData
    ? (receivedSeries.length > 1 ? receivedSeries[receivedSeries.length - 2] : receivedSeries[receivedSeries.length - 1])
    : null;
  const prevSpent = hasPulseData
    ? (spentSeries.length > 1 ? spentSeries[spentSeries.length - 2] : spentSeries[spentSeries.length - 1])
    : null;

  const receivedTrend =
    latestReceived !== null && prevReceived !== null
      ? toTrendText(latestReceived, prevReceived)
      : { trend: "neutral" as const, text: "Trend unavailable" };
  const spentTrend =
    latestSpent !== null && prevSpent !== null
      ? toTrendText(latestSpent, prevSpent)
      : { trend: "neutral" as const, text: "Trend unavailable" };

  const periodLabel =
    monthLabels.length >= 2
      ? `${monthLabels[0]} - ${monthLabels[monthLabels.length - 1]}`
      : pulseStatus === "error"
        ? "No monthly data"
        : "Partial period";

  const activityRows = useMemo(() => {
    const rows: ActivityRow[] = [];

    for (const item of attention?.items || []) {
      rows.push({
        id: item.key,
        label: item.label,
        source: "Attention Center",
        severity: item.severity,
        count: Number(item.count || 0),
        href: item.href,
        note: "Action recommended"
      });
    }

    rows.push({
      id: "outbox-failed",
      label: "POS outbox failures",
      source: "POS Sync",
      severity: outboxFailed > 0 ? "critical" : "info",
      count: outboxFailed,
      href: "/system/outbox",
      note: outboxFailed > 0 ? "Investigate failed events" : "No failed events"
    });

    rows.push({
      id: "outbox-pending",
      label: "POS outbox pending",
      source: "POS Sync",
      severity: outboxPending > 0 ? "warning" : "info",
      count: outboxPending,
      href: "/system/outbox",
      note: outboxPending > 0 ? "Queue has pending events" : "Queue is clear"
    });

    rows.push({
      id: "low-stock",
      label: "Low stock alerts",
      source: "Inventory",
      severity: Number(metrics?.low_stock_count || 0) > 0 ? "warning" : "info",
      count: Number(metrics?.low_stock_count || 0),
      href: "/inventory/alerts",
      note: Number(metrics?.low_stock_count || 0) > 0 ? "Replenishment needed" : "Inventory healthy"
    });

    for (const job of attention?.failed_jobs || []) {
      rows.push({
        id: `job-${job.job_code}`,
        label: `Background job ${job.job_code}`,
        source: "Worker",
        severity: "critical",
        count: Number(job.count || 0),
        href: "/system/attention",
        note: "Latest run failed"
      });
    }

    const severityRank: Record<ActivitySeverity, number> = { critical: 3, warning: 2, info: 1 };
    return rows.sort((a, b) => {
      const rankDelta = severityRank[b.severity] - severityRank[a.severity];
      if (rankDelta !== 0) return rankDelta;
      return b.count - a.count;
    });
  }, [attention, metrics?.low_stock_count, outboxFailed, outboxPending]);

  const filteredActivityRows = useMemo(() => {
    const needle = activityQuery.trim().toLowerCase();
    return activityRows.filter((row) => {
      if (activityFilter !== "all" && row.severity !== activityFilter) return false;
      if (!needle) return true;
      const haystack = `${row.label} ${row.source} ${row.note}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [activityFilter, activityQuery, activityRows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-fg-subtle">
            Overview of your business metrics and activity
            {apiHealth?.version ? ` · v${apiHealth.version}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdatedAt ? (
            <span className="text-xs text-fg-subtle">
              Last updated{" "}
              <time className="tabular-nums text-fg-muted">
                {lastUpdatedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </time>
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {status && status !== "Loading..." ? (
        <Banner
          variant="danger"
          title="Error loading metrics"
          description={lastErrorRequestId ? `${status} (request ${lastErrorRequestId})` : status}
          actions={
            <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing} className="gap-2">
              <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Retry
            </Button>
          }
        />
      ) : null}

      <section className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-0 opacity-40">
          <div className="absolute -left-16 -top-20 h-52 w-52 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute -bottom-24 right-0 h-64 w-64 rounded-full bg-warning/15 blur-3xl" />
        </div>

        <div className="relative space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-zinc-100">Ledger Overview</h2>
              <p className="text-xs text-zinc-400">Inspired analytics board with live operational pulse</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300">
                <CalendarRange className="h-3.5 w-3.5" />
                <span>{periodLabel}</span>
              </div>
              {canWriteSales ? (
                <QuickActionCompact
                  icon={ShoppingCart}
                  label="Sales Invoice"
                  tone="dark"
                  onClick={() => router.push("/sales/invoices")}
                />
              ) : null}
              {canWritePurchases ? (
                <QuickActionCompact
                  icon={Truck}
                  label="Purchase Order"
                  tone="dark"
                  onClick={() => router.push("/purchasing/purchase-orders")}
                />
              ) : null}
              {canReadInventory ? (
                <QuickActionCompact
                  icon={Package}
                  label="Stock"
                  tone="dark"
                  onClick={() => router.push("/inventory/stock")}
                />
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Total money received"
              description="Sales revenue today"
              value={metrics ? fmtCurrency(metrics.sales_today_usd, "USD") : "$0.00"}
              secondaryValue={metrics ? fmtCurrency(metrics.sales_today_lbp, "LBP") : undefined}
              icon={DollarSign}
              trend={receivedTrend.trend}
              trendValue={receivedTrend.text}
              loading={isLoading}
              tone="dark"
              onClick={() => router.push("/sales/invoices")}
            />

            <MetricCard
              title="Total money spent"
              description="Purchases posted today"
              value={metrics ? fmtCurrency(metrics.purchases_today_usd, "USD") : "$0.00"}
              secondaryValue={metrics ? fmtCurrency(metrics.purchases_today_lbp, "LBP") : undefined}
              icon={Truck}
              trend={spentTrend.trend}
              trendValue={spentTrend.text}
              loading={isLoading}
              tone="dark"
              onClick={() => router.push("/purchasing/supplier-invoices")}
            />

            <MetricCard
              title="Total net position"
              description="Today sales minus purchases"
              value={fmtCurrency(Number(metrics?.sales_today_usd || 0) - Number(metrics?.purchases_today_usd || 0), "USD")}
              secondaryValue={fmtCurrency(Number(metrics?.sales_today_lbp || 0) - Number(metrics?.purchases_today_lbp || 0), "LBP")}
              icon={TrendingUp}
              trend={Number(metrics?.sales_today_usd || 0) >= Number(metrics?.purchases_today_usd || 0) ? "up" : "down"}
              trendValue={
                Number(metrics?.sales_today_usd || 0) >= Number(metrics?.purchases_today_usd || 0)
                  ? "Positive daily spread"
                  : "Spend exceeds sales"
              }
              loading={isLoading}
              tone="dark"
              onClick={() => router.push("/accounting/reports/profit-loss")}
            />

            <MetricCard
              title="Total net profit"
              description="Latest monthly P&L"
              value={latestReceived !== null && latestSpent !== null ? fmtCurrency(latestReceived - latestSpent, "USD") : "—"}
              secondaryValue={
                latestReceived !== null && latestSpent !== null && metrics
                  ? `${fmtCurrency(metrics.stock_value_usd, "USD")} stock value`
                  : undefined
              }
              icon={Activity}
              trend={latestReceived !== null && latestSpent !== null ? (latestReceived >= latestSpent ? "up" : "down") : "neutral"}
              trendValue={
                latestReceived !== null && latestSpent !== null
                  ? (latestReceived >= latestSpent ? "Profitable trend" : "Negative trend")
                  : "Monthly trend unavailable"
              }
              loading={isLoading || pulseLoading}
              tone="dark"
              onClick={() => router.push("/accounting/reports/profit-loss")}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              {pulseStatus !== "ok" ? (
                <div
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs",
                    pulseStatus === "error"
                      ? "border-danger/40 bg-danger/10 text-danger"
                      : "border-warning/40 bg-warning/10 text-warning"
                  )}
                >
                  {pulseStatus === "error"
                    ? "Monthly trend data is unavailable. Charts are hidden until reporting data is reachable."
                    : "Some monthly trend slices could not be loaded. Showing available months only."}
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                <TrendChartCard
                  title="Overall money received"
                  subtitle="Monthly recognized revenue (USD)"
                  labels={monthLabels}
                  currentSeries={receivedSeries}
                  baselineSeries={receivedBaseline}
                  currentLegend="Monthly totals"
                  baselineLegend="Prior-month baseline"
                  valueLabel={latestReceived !== null ? fmtCurrency(latestReceived, "USD") : "—"}
                  trend={receivedTrend}
                  loading={pulseLoading}
                  color="sky"
                />

                <TrendChartCard
                  title="Overall money spent"
                  subtitle="Monthly expenses (USD)"
                  labels={monthLabels}
                  currentSeries={spentSeries}
                  baselineSeries={spentBaseline}
                  currentLegend="Monthly totals"
                  baselineLegend="Prior-month baseline"
                  valueLabel={latestSpent !== null ? fmtCurrency(latestSpent, "USD") : "—"}
                  trend={spentTrend}
                  loading={pulseLoading}
                  color="amber"
                />
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
              <div>
                <p className="text-base font-semibold text-zinc-100">System Pulse</p>
                <p className="text-xs text-zinc-500">Health, queue, and AI watchlist</p>
              </div>

              <StatusIndicator
                tone="dark"
                label="API"
                value={apiHealth ? apiHealth.status : "checking"}
                status={apiHealth?.status === "ok" || apiHealth?.status === "ready" ? "good" : "warning"}
              />
              <StatusIndicator tone="dark" label="Database" value={apiHealth ? apiHealth.db : "-"} status={apiHealth?.db === "ok" ? "good" : "critical"} />
              <StatusIndicator tone="dark" label="Data Freshness" value={dataIsStale ? "stale" : "fresh"} status={dataIsStale ? "warning" : "good"} />
              <StatusIndicator
                tone="dark"
                label="Outbox"
                value={`${outboxFailed} failed / ${outboxPending} pending`}
                status={outboxFailed > 0 ? "critical" : outboxPending > 0 ? "warning" : "good"}
              />
              <StatusIndicator
                tone="dark"
                label="Processed"
                value={fmtNumber(outboxProcessed)}
                status={outboxProcessed > 0 ? "good" : "warning"}
              />
              <StatusIndicator
                tone="dark"
                label="Low Stock"
                value={metrics ? fmtNumber(metrics.low_stock_count) : "-"}
                status={metrics && metrics.low_stock_count > 0 ? "warning" : "good"}
              />

              <div className="rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-300">Default FX (USD→LL)</div>
                    {fxLoading ? (
                      <div className="mt-1">
                        <Skeleton className="h-7 w-24" />
                      </div>
                    ) : (
                      <div className="mt-1 font-mono text-sm tabular-nums text-zinc-100">{usdToLbp}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      value={usdToLbp}
                      onChange={(event) => setUsdToLbp(event.target.value)}
                      inputMode="decimal"
                      className="h-8 w-[120px] border-zinc-700 bg-zinc-900 text-right font-mono text-sm text-zinc-100"
                      disabled={fxLoading || savingFx}
                      aria-label="Default exchange rate USD to LBP"
                    />
                    <Button
                      variant="outline"
                      className="h-8 border-zinc-700 bg-zinc-900 px-3 text-zinc-100 hover:bg-zinc-800"
                      disabled={fxLoading || savingFx}
                      onClick={async () => {
                        const n = Number(usdToLbp || 0);
                        if (!Number.isFinite(n) || n <= 0) {
                          setFxStatus("Rate must be > 0");
                          return;
                        }
                        setSavingFx(true);
                        setFxStatus("");
                        try {
                          await upsertFxRateUsdToLbp({ usdToLbp: n });
                          setFxStatus("Saved");
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : String(err);
                          setFxStatus(msg);
                        } finally {
                          setSavingFx(false);
                          window.setTimeout(() => setFxStatus(""), 2500);
                        }
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                    onClick={() => router.push("/system/config")}
                    title="Open Admin -> Config -> Exchange Rates"
                  >
                    Manage exchange rates
                  </button>
                  {fxStatus ? <span className="text-zinc-500">{fxStatus}</span> : <span />}
                </div>
              </div>

              <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-200">AI Insights</p>
                  <AlertTriangle className="h-4 w-4 text-zinc-500" />
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Data Hygiene</span>
                    <span className={cn("tabular-nums", aiCount("AI_DATA_HYGIENE") > 0 ? "text-warning" : "text-zinc-300")}>
                      {aiCount("AI_DATA_HYGIENE")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">AP Guard</span>
                    <span className={cn("tabular-nums", aiCount("AI_AP_GUARD") > 0 ? "text-warning" : "text-zinc-300")}>
                      {aiCount("AI_AP_GUARD")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Expiry Ops</span>
                    <span className={cn("tabular-nums", aiCount("AI_EXPIRY_OPS") > 0 ? "text-warning" : "text-zinc-300")}>
                      {aiCount("AI_EXPIRY_OPS")}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                  onClick={() => router.push("/automation/ai-hub")}
                  disabled={!canReadAi}
                >
                  Open AI Hub
                </Button>
                {!canReadAi ? <div className="pt-1 text-center text-xs text-zinc-500">Ask your admin for ai:read</div> : null}
              </div>

              <div className="space-y-2">
                {canReadCustomers ? (
                  <QuickAction
                    tone="dark"
                    icon={Users}
                    label="Customers"
                    description="Review active customer records"
                    onClick={() => router.push("/partners/customers")}
                  />
                ) : null}
                {canReadInventory ? (
                  <QuickAction
                    tone="dark"
                    icon={Package}
                    label="Inventory"
                    description="Inspect stock and replenishment"
                    onClick={() => router.push("/inventory/stock")}
                  />
                ) : null}
                {canManageConfig ? (
                  <QuickAction
                    tone="dark"
                    icon={Activity}
                    label="System Config"
                    description="Adjust platform-level settings"
                    onClick={() => router.push("/system/config")}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Operations Feed</h3>
            <p className="text-xs text-zinc-500">Search and triage recent operational signals</p>
          </div>
          <div className="text-xs text-zinc-500">{fmtNumber(filteredActivityRows.length)} signals</div>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={activityQuery}
              onChange={(event) => setActivityQuery(event.target.value)}
              placeholder="Search signal, source, or note"
              className="border-zinc-700 bg-zinc-900 pl-9 text-zinc-100 placeholder:text-zinc-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1">
            <SlidersHorizontal className="h-4 w-4 text-zinc-500" />
            {(["all", "critical", "warning", "info"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={activityFilter === option}
                onClick={() => setActivityFilter(option)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs capitalize transition-colors",
                  activityFilter === option
                    ? "bg-zinc-100 text-zinc-900"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[720px]">
            <thead className="bg-zinc-900/90">
              <tr className="text-left text-xs uppercase tracking-[0.08em] text-zinc-500">
                <th className="px-4 py-3 font-medium">Signal</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium text-right">Count</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950">
              {filteredActivityRows.length ? (
                filteredActivityRows.map((row) => {
                  const severityClass =
                    row.severity === "critical"
                      ? "border-danger/30 bg-danger/20 text-danger"
                      : row.severity === "warning"
                        ? "border-warning/30 bg-warning/20 text-warning"
                        : "border-info/30 bg-info/20 text-info";

                  return (
                    <tr key={row.id} className="text-sm text-zinc-300">
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-100">{row.label}</div>
                        <div className="text-xs text-zinc-500">{row.note}</div>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{row.source}</td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs capitalize", severityClass)}>
                          {row.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-zinc-100">{fmtNumber(row.count)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                          onClick={() => router.push(row.href)}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">
                    No matching signals for your current search/filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-zinc-500">
          Outbox total: {fmtNumber(outboxTotal)} · POS integration: {canManagePos ? "active" : "limited by permissions"}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Catalog & Partners</CardTitle>
            <CardDescription>Entity counts and inventory pressure</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {isLoading ? (
              <>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </>
            ) : (
              <>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 px-3 py-2">
                  <div className="text-xs text-fg-subtle">Items</div>
                  <div className="text-lg font-semibold tabular-nums text-foreground">{fmtNumber(metrics?.items_count || 0)}</div>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 px-3 py-2">
                  <div className="text-xs text-fg-subtle">Customers</div>
                  <div className="text-lg font-semibold tabular-nums text-foreground">{fmtNumber(metrics?.customers_count || 0)}</div>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 px-3 py-2">
                  <div className="text-xs text-fg-subtle">Suppliers</div>
                  <div className="text-lg font-semibold tabular-nums text-foreground">{fmtNumber(metrics?.suppliers_count || 0)}</div>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-elevated/60 px-3 py-2">
                  <div className="text-xs text-fg-subtle">Low stock alerts</div>
                  <div className={cn("text-lg font-semibold tabular-nums", Number(metrics?.low_stock_count || 0) > 0 ? "text-danger" : "text-foreground")}>
                    {fmtNumber(metrics?.low_stock_count || 0)}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Receivables & Payables</CardTitle>
            <CardDescription>Current balance exposure</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border border-border-subtle bg-bg-elevated/60 px-3 py-2">
              <div className="text-xs text-fg-subtle">Accounts Receivable</div>
              <div className="text-lg font-semibold tabular-nums text-foreground">{fmtCurrency(metrics?.ar_usd || 0, "USD")}</div>
              <div className="text-xs tabular-nums text-fg-subtle">{fmtCurrency(metrics?.ar_lbp || 0, "LBP")}</div>
            </div>
            <div className="rounded-md border border-border-subtle bg-bg-elevated/60 px-3 py-2">
              <div className="text-xs text-fg-subtle">Accounts Payable</div>
              <div className="text-lg font-semibold tabular-nums text-foreground">{fmtCurrency(metrics?.ap_usd || 0, "USD")}</div>
              <div className="text-xs tabular-nums text-fg-subtle">{fmtCurrency(metrics?.ap_lbp || 0, "LBP")}</div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => router.push("/accounting/reports/ar-aging")}>View Aging Reports</Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
