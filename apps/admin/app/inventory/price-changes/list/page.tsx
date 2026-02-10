"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ changes: Row[] }>(`/pricing/price-changes?q=&limit=2000`);
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

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<Row>> = [
      { id: "when", header: "When", sortable: true, mono: true, accessor: (r) => r.changed_at, cell: (r) => fmtIso(r.changed_at) },
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (r) => `${r.sku} ${r.name}`,
        cell: (r) => (
          <div className="flex flex-col">
            <Link className="ui-link" href={`/catalog/items/${encodeURIComponent(r.item_id)}`}>
              <span className="font-medium data-mono">{r.sku}</span> · {r.name}
            </Link>
            {r.effective_from ? <div className="mt-0.5 text-xs text-fg-subtle">Effective: {String(r.effective_from).slice(0, 10)}</div> : null}
          </div>
        ),
      },
      {
        id: "usd",
        header: "USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.new_price_usd || 0),
        cell: (r) => (
          <span className="data-mono">
            {fmtUsd(r.old_price_usd || 0)} <span className="text-fg-subtle">→</span> {fmtUsd(r.new_price_usd || 0)}
          </span>
        ),
      },
      { id: "usd_pct", header: "USD %", sortable: true, align: "right", mono: true, accessor: (r) => Number(r.pct_change_usd || 0), cell: (r) => fmtPct(r.pct_change_usd) },
      {
        id: "lbp",
        header: "LBP",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.new_price_lbp || 0),
        cell: (r) => (
          <span className="data-mono">
            {fmtLbp(r.old_price_lbp || 0)} <span className="text-fg-subtle">→</span> {fmtLbp(r.new_price_lbp || 0)}
          </span>
        ),
      },
      { id: "lbp_pct", header: "LBP %", sortable: true, align: "right", mono: true, accessor: (r) => Number(r.pct_change_lbp || 0), cell: (r) => fmtPct(r.pct_change_lbp) },
    ];
    return cols;
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Price Changes</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${rows.length} change(s)`}</p>
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
          <DataTable<Row>
            tableId="inventory.price_changes.list"
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "when", dir: "desc" }}
            globalFilterPlaceholder="Search SKU / name / source"
            actions={
              <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")}>
                Items
              </Button>
            }
          />
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
