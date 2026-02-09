"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ExceptionRow = {
  id: string;
  invoice_no: string | null;
  supplier_ref: string | null;
  supplier_id: string;
  supplier_name?: string | null;
  goods_receipt_id: string | null;
  goods_receipt_no?: string | null;
  hold_reason?: string | null;
  held_at?: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  invoice_date?: string | null;
  due_date?: string | null;
  summary?: { flags_total: number; unit_cost_flags: number; qty_flags: number; tax_flags: number };
};

function fmtIso(iso: string | null | undefined) {
  const s = String(iso || "");
  return s ? s.replace("T", " ").slice(0, 19) : "-";
}

function Inner() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return filterAndRankByFuzzy(
      rows || [],
      q,
      (r) =>
        `${r.invoice_no || ""} ${r.supplier_ref || ""} ${r.supplier_name || ""} ${r.goods_receipt_no || ""} ${r.hold_reason || ""} ${r.id}`
    );
  }, [rows, q]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ exceptions: ExceptionRow[] }>(
        `/purchases/invoices/exceptions?q=${encodeURIComponent(q.trim())}&limit=500`
      );
      setRows(res.exceptions || []);
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
          <h1 className="text-xl font-semibold text-foreground">3-Way Match Exceptions</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${filtered.length} invoice(s) on hold`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button asChild variant="outline">
            <Link href="/system/attention">Needs Attention</Link>
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
          <CardDescription>Supplier invoices automatically held due to quantity, unit cost, or tax variance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="w-full md:w-96">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice / supplier / GRN / ref..." />
          </div>

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Receipt</th>
                  <th className="px-3 py-2">Flags</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Held</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="ui-tr-hover">
                    <td className="px-3 py-2 font-medium">
                      <Link className="focus-ring text-primary hover:underline" href={`/purchasing/supplier-invoices/${encodeURIComponent(r.id)}`}>
                        {r.invoice_no || "(draft)"}
                      </Link>
                      {r.supplier_ref ? <div className="mt-0.5 text-xs text-fg-muted">Ref: {r.supplier_ref}</div> : null}
                      {r.hold_reason ? <div className="mt-0.5 text-xs text-fg-subtle">{r.hold_reason}</div> : null}
                    </td>
                    <td className="px-3 py-2">{r.supplier_name || r.supplier_id.slice(0, 8)}</td>
                    <td className="px-3 py-2">
                      {r.goods_receipt_id ? (
                        <Link className="focus-ring text-primary hover:underline" href={`/purchasing/goods-receipts/${encodeURIComponent(r.goods_receipt_id)}`}>
                          {r.goods_receipt_no || r.goods_receipt_id.slice(0, 8)}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded bg-bg-sunken px-2 py-1 text-fg-muted">Total: {r.summary?.flags_total ?? 0}</span>
                        <span className="rounded bg-bg-sunken px-2 py-1 text-fg-muted">Unit: {r.summary?.unit_cost_flags ?? 0}</span>
                        <span className="rounded bg-bg-sunken px-2 py-1 text-fg-muted">Qty: {r.summary?.qty_flags ?? 0}</span>
                        <span className="rounded bg-bg-sunken px-2 py-1 text-fg-muted">Tax: {r.summary?.tax_flags ?? 0}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right data-mono">
                      {fmtUsd(r.total_usd)} · {fmtLbp(r.total_lbp)}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-fg-muted">{fmtIso(r.held_at)}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
                      No held invoices.
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

export default function ThreeWayMatchExceptionsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}

