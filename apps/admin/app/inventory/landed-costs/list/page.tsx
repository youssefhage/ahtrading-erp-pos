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
import { StatusChip } from "@/components/ui/status-chip";

type LandedCostRow = {
  id: string;
  landed_cost_no: string | null;
  goods_receipt_id: string | null;
  goods_receipt_no?: string | null;
  status: string;
  memo?: string | null;
  exchange_rate: string | number;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
  posted_at?: string | null;
};

function Inner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [rows, setRows] = useState<LandedCostRow[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => {
    const base = (rows || []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
    return filterAndRankByFuzzy(base, q, (r) => `${r.landed_cost_no || ""} ${r.goods_receipt_no || ""} ${r.memo || ""} ${r.id}`);
  }, [rows, q, statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ landed_costs: LandedCostRow[] }>("/inventory/landed-costs");
      setRows(res.landed_costs || []);
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
          <h1 className="text-xl font-semibold text-foreground">Landed Costs</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${filtered.length} document(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button type="button" onClick={() => router.push("/inventory/landed-costs/new")}>
            New Draft
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Allocate freight/customs/handling to a posted goods receipt.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="w-full md:w-96">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search landed cost / GRN / memo..." />
            </div>
            <div className="flex items-center gap-2">
              <select className="ui-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="posted">Posted</option>
                <option value="canceled">Canceled</option>
              </select>
            </div>
          </div>

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Landed Cost</th>
                  <th className="px-3 py-2">Goods Receipt</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Total USD</th>
                  <th className="px-3 py-2 text-right">Total LBP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="ui-tr-hover">
                    <td className="px-3 py-2 font-medium">
                      <Link className="focus-ring text-primary hover:underline" href={`/inventory/landed-costs/${encodeURIComponent(r.id)}`}>
                        {r.landed_cost_no || "(draft)"}
                      </Link>
                      {r.memo ? <div className="mt-0.5 text-xs text-fg-muted">{r.memo}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      {r.goods_receipt_id ? (
                        <Link className="focus-ring text-primary hover:underline" href={`/purchasing/goods-receipts/${encodeURIComponent(r.goods_receipt_id)}`}>
                          {r.goods_receipt_no || r.goods_receipt_id.slice(0, 8)}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip value={r.status} />
                    </td>
                    <td className="px-3 py-2 text-right data-mono">{fmtUsd(r.total_usd)}</td>
                    <td className="px-3 py-2 text-right data-mono">{fmtLbp(r.total_lbp)}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                      No landed costs.
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

export default function LandedCostsListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
