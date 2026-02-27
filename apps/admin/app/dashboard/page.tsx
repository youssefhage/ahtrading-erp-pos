"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DollarSign, FileText, Package, ShoppingCart, Plus, Boxes,
  BarChart3, RefreshCw, Lightbulb, CheckCircle2, AlertCircle,
  XCircle, ArrowRight,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer } from "recharts";
import { motion } from "motion/react";
import { ApiError, apiGet } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { fmtUsd } from "@/lib/money";
import { cn } from "@/lib/utils";
import { FALLBACK_FX_RATE_USD_LBP } from "@/lib/constants";
import { PageHeader } from "@/components/business/page-header";
import { KpiCard } from "@/components/business/kpi-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type Metrics = {
  sales_today_usd: string | number; sales_today_lbp: string | number;
  purchases_today_usd: string | number; purchases_today_lbp: string | number;
  ar_usd: string | number; ar_lbp: string | number;
  ap_usd: string | number; ap_lbp: string | number;
  stock_value_usd: string | number; stock_value_lbp: string | number;
  items_count: number; customers_count: number; suppliers_count: number; low_stock_count: number;
};
type ApiHealth = { status: "ok" | "ready" | "degraded"; env: string; db: "ok" | "down"; service: string; version?: string; error?: string };
type AiRow = { agent_code: string; status: string; count: number };
type DailyPoint = { date: string; sales: number; purchases: number };

const fmtNum = (v: string | number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(v || 0));

const AI_LABELS: Record<string, string> = {
  AI_DATA_HYGIENE: "Review data hygiene recommendations",
  AI_AP_GUARD: "Check accounts-payable guard alerts",
  AI_EXPIRY_OPS: "Act on upcoming expiry warnings",
};

const AI_BORDER_COLOR: Record<string, string> = {
  AI_DATA_HYGIENE: "border-l-blue-500",
  AI_AP_GUARD: "border-l-amber-500",
  AI_EXPIRY_OPS: "border-l-red-500",
};

function QuickActionCard({ icon: Icon, label, href }: { icon: React.ComponentType<{ className?: string }>; label: string; href: string }) {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.push(href)}
      className="group flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-all duration-200 hover:bg-accent hover:shadow-md">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
        <Icon className="h-5 w-5" />
      </div>
      <span className="text-sm font-medium">{label}</span>
      <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
    </button>
  );
}

function StatusRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" /> : <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />}
        <span className="text-sm">{label}</span>
      </div>
      <Badge variant={ok ? "success" : "destructive"} className="text-xs">{value}</Badge>
    </div>
  );
}

function KpiSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-4 rounded" />
      </CardHeader>
      <CardContent><Skeleton className="h-7 w-28" /><Skeleton className="mt-2 h-3 w-20" /></CardContent>
    </Card>
  );
}

/* Simple chart tooltip styled with shadcn tokens */
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-sm font-semibold tabular-nums">
          {p.dataKey === "sales" ? "Sales" : "Purchases"}: {fmtUsd(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [aiRows, setAiRows] = useState<AiRow[]>([]);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [dailyData, setDailyData] = useState<DailyPoint[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [fxRate, setFxRate] = useState(FALLBACK_FX_RATE_USD_LBP);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    const [mRes, aiRes, hRes, meRes, fxRes, dailyRes] = await Promise.allSettled([
      apiGet<{ metrics: Metrics }>("/reports/metrics"),
      apiGet<{ rows: AiRow[] }>("/ai/recommendations/summary?status=pending"),
      apiGet<ApiHealth>("/health"),
      apiGet<{ permissions?: string[] }>("/auth/me"),
      getFxRateUsdToLbp(),
      apiGet<{ data: DailyPoint[] }>("/reports/daily-summary?days=7"),
    ]);
    if (mRes.status === "fulfilled") { setMetrics(mRes.value.metrics); setError(""); }
    else {
      const r = mRes.reason;
      setError(r instanceof ApiError ? `${r.message}${r.requestId ? ` (${r.requestId})` : ""}` : r instanceof Error ? r.message : String(r));
    }
    if (aiRes.status === "fulfilled") setAiRows(aiRes.value.rows || []);
    if (hRes.status === "fulfilled") setHealth(hRes.value);
    else setHealth({ status: "degraded", env: "unknown", db: "down", service: "backend" });
    if (meRes.status === "fulfilled") setPermissions(Array.isArray(meRes.value?.permissions) ? meRes.value.permissions : []);
    if (fxRes.status === "fulfilled") { const n = Number(fxRes.value?.usd_to_lbp || 0); if (Number.isFinite(n) && n > 0) setFxRate(n); }
    if (dailyRes.status === "fulfilled" && Array.isArray(dailyRes.value?.data)) setDailyData(dailyRes.value.data);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setRefreshing(true);
    try { await load(); } finally { busy.current = false; setRefreshing(false); }
  }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden && !busy.current) void refresh(); }, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const perm = { permissions };
  const canSales = hasPermission(perm, "sales:write");
  const canCatalog = hasPermission(perm, "catalog:write") || hasPermission(perm, "inventory:write");
  const canInventory = hasPermission(perm, "inventory:read");
  const canReports = hasPermission(perm, "accounting:read") || hasPermission(perm, "reports:read");

  const apiOk = health?.status === "ok" || health?.status === "ready";
  const dbOk = health?.db === "ok";
  const lowStock = Number(metrics?.low_stock_count ?? 0);
  const topInsights = aiRows.filter((r) => Number(r.count) > 0).sort((a, b) => Number(b.count) - Number(a.count)).slice(0, 3);

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" description="Welcome back. Here's what's happening today."
        badge={health?.version ? <Badge variant="outline" className="font-mono text-xs">v{health.version}</Badge> : undefined}
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        }
      />

      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>Retry</Button>
        </div>
      )}

      {/* KPI Grid — staggered animation */}
      <motion.div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        initial="hidden"
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
      >
        {loading ? Array.from({ length: 4 }, (_, i) => (
          <motion.div key={i} variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
            <KpiSkeleton />
          </motion.div>
        )) : (
          <>
            <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
              <KpiCard title="Today's Sales" value={fmtUsd(metrics?.sales_today_usd ?? 0)} description={`FX rate: ${fmtNum(fxRate)} LBP`} icon={DollarSign} />
            </motion.div>
            <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
              <KpiCard title="Active Invoices" value={fmtNum(metrics?.customers_count ?? 0)} description="Outstanding customer count" icon={FileText} />
            </motion.div>
            <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
              <KpiCard title="Items in Stock" value={fmtNum(metrics?.items_count ?? 0)} icon={Package}
                description={lowStock > 0 ? `${fmtNum(lowStock)} low stock` : "No low-stock alerts"}
                trend={lowStock > 0 ? "down" : undefined} trendValue={lowStock > 0 ? `${fmtNum(lowStock)} need reorder` : undefined} />
            </motion.div>
            <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
              <KpiCard title="Pending Orders" value={fmtUsd(metrics?.ap_usd ?? 0)} description="Accounts payable (USD)" icon={ShoppingCart} />
            </motion.div>
          </>
        )}
      </motion.div>

      {/* Two-column: wide left + narrow right */}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Revenue Overview</CardTitle>
            <CardDescription>
              Sales vs purchases {dailyData.length > 0 ? `(last ${dailyData.length} days)` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-4 w-4 rounded" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            ) : dailyData.length > 0 ? (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                    <defs>
                      <linearGradient id="fillSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="fillPurchases" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtUsd(v)} />
                    <RTooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="sales" stroke="hsl(var(--chart-1))" fill="url(#fillSales)" strokeWidth={2} />
                    <Area type="monotone" dataKey="purchases" stroke="hsl(var(--chart-2))" fill="url(#fillPurchases)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <BarChart3 className="mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">No data available yet</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Sales: {fmtUsd(metrics?.sales_today_usd ?? 0)} &middot; Purchases: {fmtUsd(metrics?.purchases_today_usd ?? 0)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* AI Insights */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><Lightbulb className="h-4 w-4" />AI Insights</CardTitle>
                  <CardDescription className="mt-1">Top pending recommendations</CardDescription>
                </div>
                {topInsights.length > 0 && <Badge variant="warning">{topInsights.reduce((s, r) => s + Number(r.count), 0)}</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : topInsights.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No pending recommendations</p>
              ) : (
                <div className="space-y-2">
                  {topInsights.map((row) => (
                    <div key={row.agent_code} className={cn(
                      "flex items-start gap-3 rounded-md border border-l-[3px] bg-muted/40 px-3 py-2.5",
                      AI_BORDER_COLOR[row.agent_code] || "border-l-muted-foreground"
                    )}>
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
                      <div className="flex-1 text-sm">
                        <p className="font-medium">{AI_LABELS[row.agent_code] ?? row.agent_code}</p>
                        <p className="text-xs text-muted-foreground">{row.count} pending {row.count === 1 ? "item" : "items"}</p>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => router.push("/automation/ai-hub")}>Open AI Hub</Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* System Status */}
          <Card>
            <CardHeader><CardTitle>System Status</CardTitle><CardDescription>Platform health indicators</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <StatusRow label="API" ok={apiOk} value={health?.status ?? "checking"} />
              <StatusRow label="Database" ok={dbOk} value={health?.db ?? "checking"} />
              <StatusRow label="FX Rate" ok={fxRate > 0} value={`${fmtNum(fxRate)} LBP/USD`} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Quick Actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {canSales && <QuickActionCard icon={Plus} label="New Invoice" href="/sales/invoices" />}
          {canCatalog && <QuickActionCard icon={Package} label="Add Item" href="/catalog/items/new" />}
          {canInventory && <QuickActionCard icon={Boxes} label="View Stock" href="/inventory/stock" />}
          {canReports && <QuickActionCard icon={BarChart3} label="View Reports" href="/accounting/reports/trial-balance" />}
        </div>
      </div>
    </div>
  );
}
