"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Package,
  Boxes,
  BarChart3,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { ApiError, apiGet } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { cn } from "@/lib/utils";
import { FALLBACK_FX_RATE_USD_LBP } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

import { GreetingHero } from "@/components/dashboard/greeting-hero";
import { PriorityCards, type RecommendationRow } from "@/components/dashboard/priority-cards";
import { AttentionStrip, type AttentionItem } from "@/components/dashboard/attention-strip";
import { KpiSummary } from "@/components/dashboard/kpi-summary";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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
  error?: string;
};

type DailyPoint = { date: string; sales: number; purchases: number };

/* ------------------------------------------------------------------ */
/*  Quick Action Card                                                  */
/* ------------------------------------------------------------------ */

function QuickActionCard({
  icon: Icon,
  label,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="group flex items-center gap-3 rounded-lg border bg-card p-3.5 text-left transition-all duration-200 hover:bg-accent hover:shadow-md"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
        <Icon className="h-4 w-4" />
      </div>
      <span className="text-sm font-medium">{label}</span>
      <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Status Row                                                         */
/* ------------------------------------------------------------------ */

function StatusRow({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-1.5">
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-destructive" />
        )}
        <span className="text-xs">{label}</span>
      </div>
      <Badge variant={ok ? "success" : "destructive"} className="text-[10px]">
        {value}
      </Badge>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard Page                                                     */
/* ------------------------------------------------------------------ */

const fmtNum = (v: string | number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number(v || 0)
  );

export default function DashboardPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [dailyData, setDailyData] = useState<DailyPoint[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationRow[]>(
    []
  );
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [fxRate, setFxRate] = useState(FALLBACK_FX_RATE_USD_LBP);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    const [mRes, hRes, meRes, fxRes, dailyRes, recRes, attRes] =
      await Promise.allSettled([
        apiGet<{ metrics: Metrics }>("/reports/metrics"),
        apiGet<ApiHealth>("/health"),
        apiGet<{ permissions?: string[] }>("/auth/me"),
        getFxRateUsdToLbp(),
        apiGet<{ data: DailyPoint[] }>("/reports/daily-summary?days=7"),
        apiGet<{ recommendations?: RecommendationRow[] }>(
          "/ai/recommendations?status=pending&limit=10"
        ),
        apiGet<{ items?: AttentionItem[] }>("/reports/attention"),
      ]);

    if (mRes.status === "fulfilled") {
      setMetrics(mRes.value.metrics);
      setError("");
    } else {
      const r = mRes.reason;
      setError(
        r instanceof ApiError
          ? `${r.message}${r.requestId ? ` (${r.requestId})` : ""}`
          : r instanceof Error
            ? r.message
            : String(r)
      );
    }
    if (hRes.status === "fulfilled") setHealth(hRes.value);
    else
      setHealth({
        status: "degraded",
        env: "unknown",
        db: "down",
        service: "backend",
      });
    if (meRes.status === "fulfilled")
      setPermissions(
        Array.isArray(meRes.value?.permissions)
          ? meRes.value.permissions
          : []
      );
    if (fxRes.status === "fulfilled") {
      const n = Number(fxRes.value?.usd_to_lbp || 0);
      if (Number.isFinite(n) && n > 0) setFxRate(n);
    }
    if (dailyRes.status === "fulfilled" && Array.isArray(dailyRes.value?.data))
      setDailyData(dailyRes.value.data);
    if (recRes.status === "fulfilled" && Array.isArray(recRes.value?.recommendations))
      setRecommendations(recRes.value.recommendations);
    if (attRes.status === "fulfilled" && Array.isArray(attRes.value?.items))
      setAttentionItems(attRes.value.items);

    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      await load();
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden && !busy.current) void refresh();
    }, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const perm = { permissions };
  const canSales = hasPermission(perm, "sales:write");
  const canCatalog =
    hasPermission(perm, "catalog:write") ||
    hasPermission(perm, "inventory:write");
  const canInventory = hasPermission(perm, "inventory:read");
  const canReports =
    hasPermission(perm, "accounting:read") ||
    hasPermission(perm, "reports:read");

  const apiOk = health?.status === "ok" || health?.status === "ready";
  const dbOk = health?.db === "ok";

  return (
    <div className="space-y-6">
      {/* 1. Greeting Hero */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <GreetingHero />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={refreshing}
          className="mt-1 gap-2 shrink-0"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
          />
          <span className="hidden sm:inline">
            {refreshing ? "Refreshing..." : "Refresh"}
          </span>
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
          >
            Retry
          </Button>
        </div>
      )}

      {/* 2. AI Priority Cards */}
      <PriorityCards rows={recommendations} loading={loading} />

      {/* 3. Attention Strip */}
      <AttentionStrip items={attentionItems} loading={loading} />

      {/* 4. KPI Summary + Revenue Chart */}
      <KpiSummary
        metrics={metrics}
        dailyData={dailyData}
        fxRate={fxRate}
        loading={loading}
      />

      {/* Quick Actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Quick Actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {canSales && (
            <QuickActionCard
              icon={Plus}
              label="New Invoice"
              href="/sales/invoices"
            />
          )}
          {canCatalog && (
            <QuickActionCard
              icon={Package}
              label="Add Item"
              href="/catalog/items/new"
            />
          )}
          {canInventory && (
            <QuickActionCard
              icon={Boxes}
              label="View Stock"
              href="/inventory/stock"
            />
          )}
          {canReports && (
            <QuickActionCard
              icon={BarChart3}
              label="View Reports"
              href="/accounting/reports/trial-balance"
            />
          )}
        </div>
      </div>

      {/* 5. System Health (collapsed) */}
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground select-none">
          <span className="transition-transform group-open:rotate-90">
            &#9654;
          </span>
          System Health
          {apiOk && dbOk ? (
            <Badge variant="success" className="text-[10px]">
              All systems operational
            </Badge>
          ) : (
            <Badge variant="destructive" className="text-[10px]">
              Issues detected
            </Badge>
          )}
        </summary>
        <Card className="mt-3">
          <CardContent className="space-y-2 pt-4">
            <StatusRow
              label="API"
              ok={apiOk}
              value={health?.status ?? "checking"}
            />
            <StatusRow
              label="Database"
              ok={dbOk}
              value={health?.db ?? "checking"}
            />
            <StatusRow
              label="FX Rate"
              ok={fxRate > 0}
              value={`${fmtNum(fxRate)} LBP/USD`}
            />
          </CardContent>
        </Card>
      </details>
    </div>
  );
}
