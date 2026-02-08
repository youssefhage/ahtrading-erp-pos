"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  return `LBP ${fmtNumber(n)}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [status, setStatus] = useState<string>("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    async function run() {
      setStatus("Loading...");
      try {
        const res = await apiGet<{ metrics: Metrics }>("/reports/metrics");
        setMetrics(res.metrics);
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
      setLastUpdatedAt(new Date());
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={refresh} disabled={refreshing}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
            {lastUpdatedAt ? (
              <p className="text-xs text-slate-600">
                Updated{" "}
                <span className="font-medium text-slate-800">
                  {lastUpdatedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => router.push("/sales/invoices")}>
              Sales Invoices
            </Button>
            <Button variant="outline" onClick={() => router.push("/inventory/stock")}>
              Stock
            </Button>
            <Button variant="outline" onClick={() => router.push("/catalog/items")}>
              Items
            </Button>
          </div>
        </div>

        {status && status !== "Loading..." ? (
          <Card className="border-red-200/70 bg-red-50/60">
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        {!metrics && status === "Loading..." ? (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-28" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-7 w-32" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))}
          </section>
        ) : null}

        {metrics ? (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Today Sales</CardTitle>
                <CardDescription>USD + LBP</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-xl font-semibold">
                  {fmtCurrency(metrics.sales_today_usd, "USD")}
                </div>
                <div className="text-sm text-slate-600">
                  {fmtCurrency(metrics.sales_today_lbp, "LBP")}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Today Purchases</CardTitle>
                <CardDescription>USD + LBP</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-xl font-semibold">
                  {fmtCurrency(metrics.purchases_today_usd, "USD")}
                </div>
                <div className="text-sm text-slate-600">
                  {fmtCurrency(metrics.purchases_today_lbp, "LBP")}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Stock Value</CardTitle>
                <CardDescription>Based on stock_moves valuation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-xl font-semibold">
                  {fmtCurrency(metrics.stock_value_usd, "USD")}
                </div>
                <div className="text-sm text-slate-600">
                  {fmtCurrency(metrics.stock_value_lbp, "LBP")}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Accounts Receivable</CardTitle>
                <CardDescription>Outstanding customer balances</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-xl font-semibold">
                  {fmtCurrency(metrics.ar_usd, "USD")}
                </div>
                <div className="text-sm text-slate-600">
                  {fmtCurrency(metrics.ar_lbp, "LBP")}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Accounts Payable</CardTitle>
                <CardDescription>Outstanding supplier balances</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-xl font-semibold">
                  {fmtCurrency(metrics.ap_usd, "USD")}
                </div>
                <div className="text-sm text-slate-600">
                  {fmtCurrency(metrics.ap_lbp, "LBP")}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Catalog & Partners</CardTitle>
                <CardDescription>Counts</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Items</span>
                  <span className="font-medium">{fmtNumber(metrics.items_count)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Customers</span>
                  <span className="font-medium">{fmtNumber(metrics.customers_count)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Suppliers</span>
                  <span className="font-medium">{fmtNumber(metrics.suppliers_count)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Low Stock</span>
                  <span className="font-medium">{fmtNumber(metrics.low_stock_count)}</span>
                </div>
              </CardContent>
            </Card>
          </section>
        ) : null}
      </div>);
}
