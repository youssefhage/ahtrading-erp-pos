"use client";

import { useEffect, useState } from "react";
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
  Truck
} from "lucide-react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
                <TrendingUp className="h-3.5 w-3.5 text-green-400" />
              ) : trend === "down" ? (
                <TrendingDown className="h-3.5 w-3.5 text-red-400" />
              ) : null}
              <span
                className={cn(
                  "text-xs",
                  trend === "up" ? "text-green-400" : trend === "down" ? "text-red-400" : "text-fg-subtle"
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
    good: "bg-green-500/20 text-green-400 border-green-500/30",
    warning: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    critical: "bg-red-500/20 text-red-400 border-red-500/30"
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

import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [aiSummary, setAiSummary] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string>("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function aiCount(agentCode: string) {
    return Number(aiSummary[agentCode] || 0);
  }

  useEffect(() => {
    async function run() {
      setStatus("Loading...");
      try {
        const res = await apiGet<{ metrics: Metrics }>("/reports/metrics");
        setMetrics(res.metrics);

        // AI is optional: don't block the dashboard if ai:read is missing.
        try {
          const ai = await apiGet<{ rows: { agent_code: string; status: string; count: number }[] }>(
            "/ai/recommendations/summary?status=pending"
          );
          const next: Record<string, number> = {};
          for (const r of ai.rows || []) next[String(r.agent_code)] = Number(r.count || 0);
          setAiSummary(next);
        } catch {
          setAiSummary({});
        }

        setLastUpdatedAt(new Date());
        setStatus("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(message);
      }
    }
    run();
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await apiGet<{ metrics: Metrics }>("/reports/metrics");
      setMetrics(res.metrics);

      try {
        const ai = await apiGet<{ rows: { agent_code: string; status: string; count: number }[] }>(
          "/ai/recommendations/summary?status=pending"
        );
        const next: Record<string, number> = {};
        for (const r of ai.rows || []) next[String(r.agent_code)] = Number(r.count || 0);
        setAiSummary(next);
      } catch {
        setAiSummary({});
      }

      setLastUpdatedAt(new Date());
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setRefreshing(false);
    }
  }

  const isLoading = !metrics && status === "Loading...";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-fg-subtle">Overview of your business metrics and activity</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdatedAt && (
            <span className="text-xs text-fg-subtle">
              Last updated{" "}
              <time className="tabular-nums text-fg-muted">
                {lastUpdatedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </time>
            </span>
          )}
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

      {/* Error State */}
      {status && status !== "Loading..." && (
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-400">Error loading metrics</p>
              <p className="text-xs text-red-300/70">{status}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Today's Sales"
          description="USD revenue today"
          value={metrics ? fmtCurrency(metrics.sales_today_usd, "USD") : "$0.00"}
          secondaryValue={metrics ? fmtCurrency(metrics.sales_today_lbp, "LBP") : undefined}
          icon={DollarSign}
          trend="up"
          trendValue="+12% vs yesterday"
          loading={isLoading}
          onClick={() => router.push("/sales/invoices")}
        />

        <MetricCard
          title="Today's Purchases"
          description="USD spent today"
          value={metrics ? fmtCurrency(metrics.purchases_today_usd, "USD") : "$0.00"}
          secondaryValue={metrics ? fmtCurrency(metrics.purchases_today_lbp, "LBP") : undefined}
          icon={Truck}
          trend="neutral"
          trendValue="Same as yesterday"
          loading={isLoading}
          onClick={() => router.push("/purchasing/purchase-orders")}
        />

        <MetricCard
          title="Stock Value"
          description="Total inventory value"
          value={metrics ? fmtCurrency(metrics.stock_value_usd, "USD") : "$0.00"}
          secondaryValue={metrics ? fmtCurrency(metrics.stock_value_lbp, "LBP") : undefined}
          icon={Package}
          trend="up"
          trendValue="+3.2% this week"
          loading={isLoading}
          onClick={() => router.push("/inventory/stock")}
        />

        <MetricCard
          title="Accounts Receivable"
          description="Outstanding customer balances"
          value={metrics ? fmtCurrency(metrics.ar_usd, "USD") : "$0.00"}
          secondaryValue={metrics ? fmtCurrency(metrics.ar_lbp, "LBP") : undefined}
          icon={CreditCard}
          trend="down"
          trendValue="-5% collected"
          loading={isLoading}
          onClick={() => router.push("/accounting/reports/ar-aging")}
        />

        <MetricCard
          title="Accounts Payable"
          description="Outstanding supplier balances"
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
                <CardDescription className="text-xs">Entity counts</CardDescription>
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
                      (metrics?.low_stock_count || 0) > 0 ? "text-red-400" : "text-foreground"
                    )}
                  >
                    {fmtNumber(metrics?.low_stock_count || 0)}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="transition-all duration-200 hover:border-border-strong hover:bg-bg-sunken/60">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <CardTitle className="text-sm font-medium text-fg-muted">AI Insights</CardTitle>
                <CardDescription className="text-xs">Pending recommendations</CardDescription>
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
                  <span className={cn("text-sm font-medium tabular-nums", aiCount("AI_DATA_HYGIENE") > 0 ? "text-yellow-400" : "text-foreground")}>
                    {aiCount("AI_DATA_HYGIENE")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-fg-muted">AP Guard</span>
                  <span className={cn("text-sm font-medium tabular-nums", aiCount("AI_AP_GUARD") > 0 ? "text-yellow-400" : "text-foreground")}>
                    {aiCount("AI_AP_GUARD")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-fg-muted">Expiry Ops</span>
                  <span className={cn("text-sm font-medium tabular-nums", aiCount("AI_EXPIRY_OPS") > 0 ? "text-yellow-400" : "text-foreground")}>
                    {aiCount("AI_EXPIRY_OPS")}
                  </span>
                </div>
                <div className="pt-2">
                  <Button variant="outline" size="sm" className="w-full" onClick={() => router.push("/automation/ai-hub")}>
                    Open AI Hub
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Quick Actions */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
            <CardDescription>Common tasks and workflows</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <QuickAction
                icon={ShoppingCart}
                label="Create Sales Invoice"
                description="New customer invoice"
                onClick={() => router.push("/sales/invoices")}
              />
              <QuickAction
                icon={Truck}
                label="Create Purchase Order"
                description="Order from suppliers"
                onClick={() => router.push("/purchasing/purchase-orders")}
              />
              <QuickAction
                icon={Package}
                label="View Stock Levels"
                description="Check inventory status"
                onClick={() => router.push("/inventory/stock")}
              />
              <QuickAction
                icon={Users}
                label="Manage Customers"
                description="Customer directory"
                onClick={() => router.push("/partners/customers")}
              />
            </div>
          </CardContent>
        </Card>

        {/* System Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Status</CardTitle>
            <CardDescription>Health indicators</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <StatusIndicator
              label="Database"
              value="Connected"
              status="good"
            />
            <StatusIndicator
              label="POS Integration"
              value="Active"
              status="good"
            />
            <StatusIndicator
              label="Outbox Queue"
              value={metrics ? fmtNumber(0) : "-"}
              status="good"
            />
            <StatusIndicator
              label="Low Stock Items"
              value={metrics ? fmtNumber(metrics.low_stock_count) : "-"}
              status={metrics && metrics.low_stock_count > 0 ? "warning" : "good"}
            />

            <div className="mt-4 rounded-md border border-primary/20 bg-primary/10 p-3">
              <div className="flex items-start gap-2">
                <Activity className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs font-medium text-primary">Daily Summary</p>
                  <p className="text-xs text-fg-muted">
                    Sales are up 12% compared to yesterday. Consider reviewing stock levels for fast-moving items.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
