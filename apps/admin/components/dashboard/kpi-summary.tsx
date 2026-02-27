"use client";

import { motion } from "motion/react";
import {
  DollarSign,
  FileText,
  Package,
  ShoppingCart,
  BarChart3,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from "recharts";

import { fmtUsd } from "@/lib/money";
import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/business/kpi-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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

type DailyPoint = { date: string; sales: number; purchases: number };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const fmtNum = (v: string | number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number(v || 0)
  );

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}) {
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

/* ------------------------------------------------------------------ */
/*  KpiSummary                                                         */
/* ------------------------------------------------------------------ */

interface KpiSummaryProps {
  metrics: Metrics | null;
  dailyData: DailyPoint[];
  fxRate: number;
  loading: boolean;
}

function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <Skeleton className="h-3 w-16 mb-2" />
        <Skeleton className="h-6 w-24" />
      </CardContent>
    </Card>
  );
}

export function KpiSummary({
  metrics,
  dailyData,
  fxRate,
  loading,
}: KpiSummaryProps) {
  const lowStock = Number(metrics?.low_stock_count ?? 0);

  return (
    <div className="space-y-4">
      {/* KPI Row — key forces remount so stagger replays after loading */}
      <motion.div
        key={loading ? "kpi-loading" : "kpi-loaded"}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.05 } },
        }}
      >
        {loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <motion.div
              key={i}
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0 },
              }}
            >
              <KpiSkeleton />
            </motion.div>
          ))
        ) : (
          <>
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0 },
              }}
            >
              <KpiCard
                title="Today's Sales"
                value={fmtUsd(metrics?.sales_today_usd ?? 0)}
                description={`FX: ${fmtNum(fxRate)} LBP`}
                icon={DollarSign}
              />
            </motion.div>
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0 },
              }}
            >
              <KpiCard
                title="Customers"
                value={fmtNum(metrics?.customers_count ?? 0)}
                description="Active customer count"
                icon={FileText}
              />
            </motion.div>
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0 },
              }}
            >
              <KpiCard
                title="Items in Stock"
                value={fmtNum(metrics?.items_count ?? 0)}
                icon={Package}
                description={
                  lowStock > 0
                    ? `${fmtNum(lowStock)} low stock`
                    : "No low-stock alerts"
                }
                trend={lowStock > 0 ? "down" : undefined}
                trendValue={
                  lowStock > 0
                    ? `${fmtNum(lowStock)} need reorder`
                    : undefined
                }
              />
            </motion.div>
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0 },
              }}
            >
              <KpiCard
                title="Accounts Payable"
                value={fmtUsd(metrics?.ap_usd ?? 0)}
                description="Outstanding AP (USD)"
                icon={ShoppingCart}
              />
            </motion.div>
          </>
        )}
      </motion.div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue Overview</CardTitle>
          <CardDescription className="text-xs">
            Sales vs purchases
            {dailyData.length > 0 ? ` (last ${dailyData.length} days)` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : dailyData.length > 0 ? (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={dailyData}
                  margin={{ top: 4, right: 4, bottom: 0, left: -10 }}
                >
                  <defs>
                    <linearGradient
                      id="fillSales"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="hsl(var(--chart-1))"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="hsl(var(--chart-1))"
                        stopOpacity={0}
                      />
                    </linearGradient>
                    <linearGradient
                      id="fillPurchases"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="hsl(var(--chart-2))"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="hsl(var(--chart-2))"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border/40"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => fmtUsd(v)}
                  />
                  <RTooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    stroke="hsl(var(--chart-1))"
                    fill="url(#fillSales)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="purchases"
                    stroke="hsl(var(--chart-2))"
                    fill="url(#fillPurchases)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <BarChart3 className="mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                No chart data yet
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
