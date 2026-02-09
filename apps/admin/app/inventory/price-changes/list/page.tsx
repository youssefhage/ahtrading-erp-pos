"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { fmtLbp, fmtUsd } from "@/lib/money";
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
  effective_from?: string | null;
  old_price_usd?: string | number | null;
  new_price_usd?: string | number | null;
  pct_change_usd?: string | number | null;
  old_price_lbp?: string | number | null;
  new_price_lbp?: string | number | null;
  pct_change_lbp?: string | number | null;
  source_type?: string | null;
};

function fmtIso(iso: string) {
  const s = String(iso || "");
  return s ? s.replace("T", " ").slice(0, 19) : "-";
}

function fmtPct(v: string | number | null | undefined) {
  if (v == null) return "-";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "-";
  const pct = n * 100;
  const s = pct.toFixed(Math.abs(pct) < 10 ? 1 : 0);
  return `${s}%`;
}

function Inner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return filterAndRankByFuzzy(rows || [], q, (r) => `${r.sku} ${r.name} ${r.source_type || ""} ${r.id}`);
  }, [rows, q]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qq = q.trim();
      const res = await apiGet<{ changes: Row[] }>(`/pricing/price-changes?q=${encodeURIComponent(qq)}&limit=500`);
      setRows(res.changes || []);
    } catch (e) {
      setRows([]);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Price Changes</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${filtered.length} change(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")}>
            Items
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Log</CardTitle>
          <CardDescription>Sell price changes derived from item price inserts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="w-full md:w-96">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU / name..." />
          </div>

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">USD</th>
                  <th className="px-3 py-2 text-right">USD %</th>
                  <th className="px-3 py-2 text-right">LBP</th>
                  <th className="px-3 py-2 text-right">LBP %</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="ui-tr-hover">
                    <td className="px-3 py-2 text-xs font-mono text-fg-muted">{fmtIso(r.changed_at)}</td>
                    <td className="px-3 py-2">
                      <Link className="focus-ring text-primary hover:underline" href={`/catalog/items/${encodeURIComponent(r.item_id)}`}>
                        <span className="font-medium data-mono">{r.sku}</span> · {r.name}
                      </Link>
                      {r.effective_from ? <div className="mt-0.5 text-xs text-fg-subtle">Effective: {String(r.effective_from).slice(0, 10)}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-right data-mono">
                      {fmtUsd(r.old_price_usd || 0)} <span className="text-fg-subtle">→</span> {fmtUsd(r.new_price_usd || 0)}
                    </td>
                    <td className="px-3 py-2 text-right data-mono">{fmtPct(r.pct_change_usd)}</td>
                    <td className="px-3 py-2 text-right data-mono">
                      {fmtLbp(r.old_price_lbp || 0)} <span className="text-fg-subtle">→</span> {fmtLbp(r.new_price_lbp || 0)}
                    </td>
                    <td className="px-3 py-2 text-right data-mono">{fmtPct(r.pct_change_lbp)}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
                      No price changes.
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

export default function PriceChangesListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}

