"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Row = {
  id: string;
  changed_at: string;
  item_id: string;
  sku: string;
  name: string;
  warehouse_id: string;
  warehouse_name: string;
  on_hand_qty: string | number;
  old_avg_cost_usd: string | number;
  new_avg_cost_usd: string | number;
  pct_change_usd: string | number | null;
  source: string | null;
};

function fmtIso(iso: string) {
  const s = String(iso || "");
  return s.replace("T", " ").slice(0, 19);
}

function pct(v: unknown) {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function Inner() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return (rows || []).filter((r) => (r.sku || "").toLowerCase().includes(needle) || (r.name || "").toLowerCase().includes(needle));
  }, [rows, q]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ changes: Row[] }>(`/pricing/cost-changes?limit=200`);
      setRows(res.changes || []);
    } catch (e) {
      setRows([]);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cost Changes</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${filtered.length} change(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Recent Avg-Cost Changes</CardTitle>
          <CardDescription>Used by the AI price-impact agent to generate review tasks.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="w-full md:w-96">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by SKU or item name..." />
            </div>
          </div>

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Warehouse</th>
                  <th className="px-3 py-2 text-right">Old USD</th>
                  <th className="px-3 py-2 text-right">New USD</th>
                  <th className="px-3 py-2 text-right">Change</th>
                  <th className="px-3 py-2 text-right">On Hand</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="ui-tr-hover">
                    <td className="px-3 py-2 text-xs font-mono text-fg-muted">{fmtIso(r.changed_at)}</td>
                    <td className="px-3 py-2">
                      <Link className="ui-link inline-flex flex-col items-start" href={`/catalog/items/${encodeURIComponent(r.item_id)}`}>
                        <div className="flex flex-col gap-0.5">
                          <div className="font-medium">{r.sku}</div>
                          <div className="text-xs text-fg-muted">{r.name}</div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.warehouse_name}</td>
                    <td className="px-3 py-2 text-right data-mono">{fmtUsd(r.old_avg_cost_usd)}</td>
                    <td className="px-3 py-2 text-right data-mono">{fmtUsd(r.new_avg_cost_usd)}</td>
                    <td className="px-3 py-2 text-right data-mono">{pct(r.pct_change_usd)}</td>
                    <td className="px-3 py-2 text-right data-mono">{String(r.on_hand_qty || 0)}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{r.source || "-"}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={8}>
                      No cost changes yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CostChangesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
