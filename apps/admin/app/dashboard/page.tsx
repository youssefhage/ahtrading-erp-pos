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
  CreditCard,
  ShoppingCart,
  Truck,
  ChevronDown
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

type MeContext = {
  permissions?: string[];
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

function MetricCard({
  title,
  description,
  value,
  secondaryValue,
  icon: Icon,
  trend,
  trendValue,
  loading,
  onClick
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
}) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-24" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="transition-all duration-200 hover:border-border-strong hover:bg-bg-sunken/60 cursor-pointer group"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-sm font-medium text-fg-muted">{title}</CardTitle>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-sunken text-fg-muted transition-colors">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
          {secondaryValue && (
            <span className="text-sm text-fg-subtle tabular-nums">{secondaryValue}</span>
          )}
          {trend && trendValue && (
            <div className="flex items-center gap-1 mt-1">
              {trend === "up" ? (
                <TrendingUp className="h-3.5 w-3.5 text-success" />
              ) : trend === "down" ? (
                <TrendingDown className="h-3.5 w-3.5 text-danger" />
              ) : null}
              <span
                className={cn(
                  "text-xs",
                  trend === "up" ? "text-success" : trend === "down" ? "text-danger" : "text-fg-subtle"
                )}
              >
                {trendValue}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function QuickAction({
  icon: Icon,
  label,
  description,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-bg-elevated/60 p-3 text-left transition-all duration-200 hover:border-border-strong hover:bg-bg-sunken/60"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bg-sunken text-fg-muted">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-fg-subtle">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-fg-subtle" />
    </button>
  );
}

function QuickActionCompact({
  icon: Icon,
  label,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="h-9 justify-start gap-2 rounded-full bg-bg-elevated/40 px-3 text-xs"
    >
      <Icon className="h-4 w-4 text-fg-muted" />
      <span className="text-foreground">{label}</span>
    </Button>
  );
}

function StatusIndicator({
  label,
  value,
  status
}: {
  label: string;
  value: string | number;
  status: "good" | "warning" | "critical";
}) {
  const statusColors = {
    good: "bg-success/20 text-success border-success/30",
    warning: "bg-warning/20 text-warning border-warning/30",
    critical: "bg-danger/20 text-danger border-danger/30"
  };

  return (
    <div className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-elevated/60 px-3 py-2">
      <span className="text-sm text-fg-muted">{label}</span>
      <span
        className={cn(
          "rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums",
          statusColors[status]
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const operationalSignalsStorageKey = "dashboard.systemStatus.operationalSignalsExpanded";
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [aiSummary, setAiSummary] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string>("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null);
  const [dataIsStale, setDataIsStale] = useState(false);
  const [lastErrorRequestId, setLastErrorRequestId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoadedMetrics, setHasLoadedMetrics] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [outboxSummary, setOutboxSummary] = useState<PosOutboxSummary | null>(null);
  const hasLoadedMetricsRef = useRef(false);
  const metricsRef = useRef<Metrics | null>(null);
  const refreshingRef = useRef(false);
  const [fxLoading, setFxLoading] = useState(true);
  const [usdToLbp, setUsdToLbp] = useState("90000");
  const [savingFx, setSavingFx] = useState(false);
  const [fxStatus, setFxStatus] = useState("");
  const [showOperationalSignals, setShowOperationalSignals] = useState(false);

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

  const loadDashboard = useCallback(async () => {
    const [metricsResult, aiResult, healthResult, meResult, outboxResult] = await Promise.allSettled([
      apiGet<{ metrics: Metrics }>("/reports/metrics"),
      apiGet<{ rows: { agent_code: string; status: string; count: number }[] }>(
        "/ai/recommendations/summary?status=pending"
      ),
      apiGet<ApiHealth>("/health"),
      apiGet<MeContext>("/auth/me"),
      apiGet<PosOutboxSummary>("/pos/outbox/summary")
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
      for (const r of aiResult.value.rows || []) {
        nextAiSummary[String(r.agent_code)] = Number(r.count || 0);
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
      setPermissions(Array.isArray((meResult.value as MeContext)?.permissions) ? [...((meResult.value as MeContext).permissions || [])] : []);
    } else {
      setPermissions([]);
    }

    if (outboxResult.status === "fulfilled") {
      setOutboxSummary(outboxResult.value || null);
    } else {
      setOutboxSummary(null);
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
      await loadDashboard();
      // Best-effort: keep the rate card in sync on manual refresh.
      try {
        await loadFx();
      } catch {
      // ignore
      }
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [loadDashboard, loadFx]);

  useEffect(() => {
    async function run() {
      setStatus("Loading...");
      try {
        await loadDashboard();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(message);
      }
    }
    run();
  }, [loadDashboard]);

  useEffect(() => {
    loadFx();
  }, [loadFx]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(operationalSignalsStorageKey);
      setShowOperationalSignals(saved === "1");
    } catch {
      // ignore localStorage access issues
    }
  }, [operationalSignalsStorageKey]);

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
  const outboxQueued = Number(outboxSummary?.by_status?.processed || 0);
  const outboxTotal = Number(outboxSummary?.total || 0);
  const lowStockCount = Number(metrics?.low_stock_count || 0);
  const apiIssue = apiHealth ? !(apiHealth.status === "ok" || apiHealth.status === "ready") : false;
  const dbIssue = apiHealth ? apiHealth.db !== "ok" : false;
  const systemAttentionCount = [apiIssue, dbIssue, dataIsStale, canManagePos && outboxFailed > 0, canManagePos && outboxPending > 0, lowStockCount > 0].filter(Boolean).length;
  const summaryText = useMemo(() => {
    if (isLoading) return "Loading latest operating signals...";
    const parts: string[] = [];
    const salesUsd = Number(metrics?.sales_today_usd || 0);
    const purchasesUsd = Number(metrics?.purchases_today_usd || 0);
    const lowStock = Number(metrics?.low_stock_count || 0);

    if (salesUsd >= purchasesUsd) {
      parts.push("Sales are currently pacing ahead of purchases.");
    } else {
      parts.push("Purchases are currently pacing ahead of sales.");
    }
    if (lowStock > 0) {
      parts.push(`${fmtNumber(lowStock)} low-stock item(s) need review.`);
    } else {
      parts.push("No low-stock pressure detected.");
    }
    if (canManagePos) {
      if (outboxFailed > 0) parts.push(`${fmtNumber(outboxFailed)} POS outbox item(s) failed.`);
      else if (outboxPending > 0) parts.push(`${fmtNumber(outboxPending)} POS outbox item(s) pending.`);
      else parts.push("POS outbox is clear.");
    }
    return parts.join(" ");
  }, [isLoading, metrics, canManagePos, outboxFailed, outboxPending]);

  return (
    <div className="space-y-6">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Operations Overview</p>
            <h1 className="ui-module-title">Dashboard</h1>
            <p className="ui-module-subtitle">
              Live business health, exposure, and activity in one place
              {apiHealth?.version ? ` · v${apiHealth.version}` : ""}
            </p>
          </div>
          <div className="ui-module-actions">
            {lastUpdatedAt ? (
              <span className="text-xs text-fg-subtle">
                Updated{" "}
                <time className="tabular-nums text-fg-muted">
                  {lastUpdatedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </time>
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={refreshing}
              className="gap-2"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        <div className="mt-4 border-t border-border-subtle pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {canWriteSales ? (
              <QuickActionCompact icon={ShoppingCart} label="Sales Invoice" onClick={() => router.push("/sales/invoices")} />
            ) : null}
            {canWritePurchases ? (
              <QuickActionCompact icon={Truck} label="Purchase Order" onClick={() => router.push("/purchasing/purchase-orders")} />
            ) : null}
            {canReadInventory ? (
              <QuickActionCompact icon={Package} label="Stock" onClick={() => router.push("/inventory/stock")} />
            ) : null}
            {canReadCustomers ? (
              <QuickActionCompact icon={Users} label="Customers" onClick={() => router.push("/partners/customers")} />
            ) : null}
            {canManageConfig ? (
              <QuickActionCompact icon={Activity} label="System Config" onClick={() => router.push("/system/config")} />
            ) : null}
          </div>
        </div>
      </div>

      {status && status !== "Loading..." && (
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
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="space-y-5">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">Flow Metrics</p>
                <p className="text-sm text-fg-muted">Sales, purchasing, stock, and exposure snapshots</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              <MetricCard
                title="Today's Sales"
                description="Revenue posted today"
                value={metrics ? fmtCurrency(metrics.sales_today_usd, "USD") : "$0.00"}
                secondaryValue={metrics ? fmtCurrency(metrics.sales_today_lbp, "LBP") : undefined}
                icon={DollarSign}
                loading={isLoading}
                onClick={() => router.push("/sales/invoices")}
              />

              <MetricCard
                title="Today's Purchases"
                description="Spend posted today"
                value={metrics ? fmtCurrency(metrics.purchases_today_usd, "USD") : "$0.00"}
                secondaryValue={metrics ? fmtCurrency(metrics.purchases_today_lbp, "LBP") : undefined}
                icon={Truck}
                loading={isLoading}
                onClick={() => router.push("/purchasing/purchase-orders")}
              />

              <MetricCard
                title="Stock Value"
                description="Current inventory valuation"
                value={metrics ? fmtCurrency(metrics.stock_value_usd, "USD") : "$0.00"}
                secondaryValue={metrics ? fmtCurrency(metrics.stock_value_lbp, "LBP") : undefined}
                icon={Package}
                loading={isLoading}
                onClick={() => router.push("/inventory/stock")}
              />

              <MetricCard
                title="Accounts Receivable"
                description="Outstanding customer balance"
                value={metrics ? fmtCurrency(metrics.ar_usd, "USD") : "$0.00"}
                secondaryValue={metrics ? fmtCurrency(metrics.ar_lbp, "LBP") : undefined}
                icon={CreditCard}
                loading={isLoading}
                onClick={() => router.push("/accounting/reports/ar-aging")}
              />

              <MetricCard
                title="Accounts Payable"
                description="Outstanding supplier balance"
                value={metrics ? fmtCurrency(metrics.ap_usd, "USD") : "$0.00"}
                secondaryValue={metrics ? fmtCurrency(metrics.ap_lbp, "LBP") : undefined}
                icon={Activity}
                loading={isLoading}
                onClick={() => router.push("/accounting/reports/ap-aging")}
              />

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col gap-1">
                      <CardTitle className="text-sm font-medium text-fg-muted">Catalog & Partners</CardTitle>
                      <CardDescription className="text-xs">Entity counts and pressure points</CardDescription>
                    </div>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-sunken text-fg-muted">
                      <Users className="h-4 w-4" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {isLoading ? (
                    <>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-fg-muted">Items</span>
                        <span className="text-sm font-medium tabular-nums text-foreground">
                          {fmtNumber(metrics?.items_count || 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-fg-muted">Customers</span>
                        <span className="text-sm font-medium tabular-nums text-foreground">
                          {fmtNumber(metrics?.customers_count || 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-fg-muted">Suppliers</span>
                        <span className="text-sm font-medium tabular-nums text-foreground">
                          {fmtNumber(metrics?.suppliers_count || 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-fg-muted">Low Stock Alerts</span>
                        <span
                          className={cn(
                            "text-sm font-medium tabular-nums",
                            (metrics?.low_stock_count || 0) > 0 ? "text-danger" : "text-foreground"
                          )}
                        >
                          {fmtNumber(metrics?.low_stock_count || 0)}
                        </span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">AI & Alerts</p>
              <p className="text-sm text-fg-muted">Outstanding recommendations requiring attention</p>
            </div>
            <Card className="transition-all duration-200 hover:border-border-strong hover:bg-bg-sunken/60">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-sm font-medium text-fg-muted">AI Insights</CardTitle>
                    <CardDescription className="text-xs">
                      {canReadAi ? "Pending recommendations by agent" : "Read-only: no AI permission"}
                    </CardDescription>
                  </div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-sunken text-fg-muted">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading ? (
                  <>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-fg-muted">Data Hygiene</span>
                      <span className={cn("text-sm font-medium tabular-nums", aiCount("AI_DATA_HYGIENE") > 0 ? "text-warning" : "text-foreground")}>
                        {aiCount("AI_DATA_HYGIENE")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-fg-muted">AP Guard</span>
                      <span className={cn("text-sm font-medium tabular-nums", aiCount("AI_AP_GUARD") > 0 ? "text-warning" : "text-foreground")}>
                        {aiCount("AI_AP_GUARD")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-fg-muted">Expiry Ops</span>
                      <span className={cn("text-sm font-medium tabular-nums", aiCount("AI_EXPIRY_OPS") > 0 ? "text-warning" : "text-foreground")}>
                        {aiCount("AI_EXPIRY_OPS")}
                      </span>
                    </div>
                    <div className="pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => router.push("/automation/ai-hub")}
                        disabled={!canReadAi}
                      >
                        Open AI Hub
                      </Button>
                      {!canReadAi ? (
                        <div className="pt-1 text-center text-sm text-fg-subtle">Ask your admin for ai:read</div>
                      ) : null}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </section>
        </div>

        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle className="text-base">System Status</CardTitle>
            <CardDescription>Platform health and operational signals</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">Default FX</p>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg-muted">USD → LL</div>
                    {fxLoading ? (
                      <div className="mt-1">
                        <Skeleton className="h-7 w-24" />
                      </div>
                    ) : (
                      <div className="mt-1 font-mono text-sm tabular-nums text-foreground">{usdToLbp}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      value={usdToLbp}
                      onChange={(e) => setUsdToLbp(e.target.value)}
                      inputMode="decimal"
                      className="h-8 w-[120px] text-right font-mono text-sm"
                      disabled={fxLoading || savingFx}
                      aria-label="Default exchange rate USD to LBP"
                    />
                    <Button
                      variant="outline"
                      className="h-8 px-3"
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
                    className="ui-link text-sm"
                    onClick={() => router.push("/system/config")}
                    title="Open Admin -> Config -> Exchange Rates"
                  >
                    Manage exchange rates
                  </button>
                  {fxStatus ? <span className="text-fg-subtle">{fxStatus}</span> : <span />}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-primary/20 bg-primary/10 p-3">
              <div className="flex items-start gap-2">
                <Activity className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium text-primary">Daily Summary</p>
                  <p className="text-sm text-fg-muted">{summaryText}</p>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border-subtle bg-bg-elevated/30">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                onClick={() =>
                  setShowOperationalSignals((current) => {
                    const next = !current;
                    try {
                      window.localStorage.setItem(operationalSignalsStorageKey, next ? "1" : "0");
                    } catch {
                      // ignore localStorage access issues
                    }
                    return next;
                  })
                }
                aria-expanded={showOperationalSignals}
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">Operational Checks</p>
                  <p className="text-sm text-fg-muted">
                    {systemAttentionCount > 0 ? `${systemAttentionCount} signal(s) need attention` : "All platform and POS checks are nominal"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-xs font-medium",
                      systemAttentionCount > 0 ? "border-danger/40 bg-danger/15 text-danger" : "border-success/30 bg-success/20 text-success"
                    )}
                  >
                    {systemAttentionCount > 0 ? "attention" : "ok"}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-fg-subtle transition-transform", showOperationalSignals ? "rotate-180" : "")} />
                </div>
              </button>

              {showOperationalSignals ? (
                <div className="space-y-3 border-t border-border-subtle px-3 py-3">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">Platform</p>
                    <StatusIndicator
                      label="API"
                      value={apiHealth ? apiHealth.status : "checking"}
                      status={apiHealth?.status === "ok" || apiHealth?.status === "ready" ? "good" : "warning"}
                    />
                    <StatusIndicator
                      label="Database"
                      value={apiHealth ? apiHealth.db : "-"}
                      status={apiHealth?.db === "ok" ? "good" : "critical"}
                    />
                    <StatusIndicator
                      label="Data Freshness"
                      value={dataIsStale ? "stale" : "fresh"}
                      status={dataIsStale ? "warning" : "good"}
                    />
                  </div>

                  <div className="space-y-2 border-t border-border-subtle pt-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">POS Sync</p>
                    <StatusIndicator
                      label="POS Integration"
                      value={canManagePos ? "Active" : "No permission"}
                      status={canManagePos ? "good" : "warning"}
                    />
                    <StatusIndicator
                      label="Outbox Queue"
                      value={canManagePos ? `${outboxFailed} failed / ${outboxPending} pending` : "-"}
                      status={
                        !canManagePos ? "warning" : outboxFailed > 0 ? "critical" : outboxPending > 0 ? "warning" : "good"
                      }
                    />
                    {outboxSummary ? (
                      <StatusIndicator
                        label="Outbox Total"
                        value={fmtNumber(outboxTotal)}
                        status={outboxTotal >= 500 ? "critical" : outboxTotal > 150 ? "warning" : "good"}
                      />
                    ) : null}
                    <StatusIndicator
                      label="Low Stock Items"
                      value={metrics ? fmtNumber(metrics.low_stock_count) : "-"}
                      status={metrics && metrics.low_stock_count > 0 ? "warning" : "good"}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
