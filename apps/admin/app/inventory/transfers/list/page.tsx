"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type TransferRow = {
  id: string;
  transfer_no: string;
  status: string;
  from_warehouse_id: string;
  from_warehouse_name?: string | null;
  to_warehouse_id: string;
  to_warehouse_name?: string | null;
  memo?: string | null;
  created_at: string;
  picked_at?: string | null;
  posted_at?: string | null;
};

function fmtIso(iso: string | null | undefined) {
  const s = String(iso || "");
  return s ? s.replace("T", " ").slice(0, 19) : "-";
}

function Inner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => {
    const base = (rows || []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
    return filterAndRankByFuzzy(
      base,
      q,
      (r) =>
        `${r.transfer_no || ""} ${r.status || ""} ${r.from_warehouse_name || ""} ${r.to_warehouse_name || ""} ${r.memo || ""} ${r.id}`
    );
  }, [rows, q, statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qq = q.trim();
      const res = await apiGet<{ transfers: TransferRow[] }>(
        `/inventory/transfers?q=${encodeURIComponent(qq)}&status=${encodeURIComponent(statusFilter)}&limit=500`
      );
      setRows(res.transfers || []);
    } catch (e) {
      setRows([]);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Stock Transfers</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${filtered.length} document(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button type="button" onClick={() => router.push("/inventory/transfers/new")}>
            New Draft
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Document-first transfers with pick allocations (FEFO) and posting to stock moves.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="w-full md:w-96">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transfer no / memo..." />
            </div>
            <div className="flex items-center gap-2">
              <select className="ui-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="picked">Picked</option>
                <option value="posted">Posted</option>
                <option value="canceled">Canceled</option>
              </select>
            </div>
          </div>

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Transfer</th>
                  <th className="px-3 py-2">From → To</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Picked</th>
                  <th className="px-3 py-2">Posted</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="ui-tr-hover">
                    <td className="px-3 py-2 font-medium">
                      <Link className="focus-ring text-primary hover:underline" href={`/inventory/transfers/${encodeURIComponent(r.id)}`}>
                        {r.transfer_no || r.id.slice(0, 8)}
                      </Link>
                      {r.memo ? <div className="mt-0.5 text-xs text-fg-muted">{r.memo}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <span className="font-medium">{r.from_warehouse_name || r.from_warehouse_id.slice(0, 8)}</span>
                      <span className="mx-2 text-fg-subtle">→</span>
                      <span className="font-medium">{r.to_warehouse_name || r.to_warehouse_id.slice(0, 8)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip value={r.status} />
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-fg-muted">{fmtIso(r.created_at)}</td>
                    <td className="px-3 py-2 text-xs font-mono text-fg-muted">{fmtIso(r.picked_at)}</td>
                    <td className="px-3 py-2 text-xs font-mono text-fg-muted">{fmtIso(r.posted_at)}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
                      No transfers.
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

export default function TransfersListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}

