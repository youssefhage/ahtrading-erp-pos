"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtUsd } from "@/lib/money";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

  const columns = useMemo((): Array<DataTableColumn<Row>> => {
    return [
      { id: "changed_at", header: "When", accessor: (r) => r.changed_at || "", mono: true, sortable: true, cell: (r) => <span className="data-mono text-xs text-fg-muted">{fmtIso(r.changed_at)}</span> },
      {
        id: "item",
        header: "Item",
        accessor: (r) => `${r.sku || ""} ${r.name || ""}`.trim(),
        sortable: true,
        cell: (r) => (
          <Link className="ui-link inline-flex flex-col items-start" href={`/catalog/items/${encodeURIComponent(r.item_id)}`}>
            <div className="flex flex-col gap-0.5">
              <div className="font-medium">{r.sku}</div>
              <div className="text-xs text-fg-muted">{r.name}</div>
            </div>
          </Link>
        ),
      },
      { id: "warehouse_name", header: "Warehouse", accessor: (r) => r.warehouse_name || "", sortable: true },
      {
        id: "old_avg_cost_usd",
        header: "Old USD",
        accessor: (r) => Number(r.old_avg_cost_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        globalSearch: false,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.old_avg_cost_usd)}</span>,
      },
      {
        id: "new_avg_cost_usd",
        header: "New USD",
        accessor: (r) => Number(r.new_avg_cost_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        globalSearch: false,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmtUsd(r.new_avg_cost_usd)}</span>,
      },
      { id: "pct_change_usd", header: "Change", accessor: (r) => Number(r.pct_change_usd || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (r) => <span className="data-mono">{pct(r.pct_change_usd)}</span> },
      { id: "on_hand_qty", header: "On Hand", accessor: (r) => Number(r.on_hand_qty || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (r) => <span className="data-mono">{String(r.on_hand_qty || 0)}</span> },
      { id: "source", header: "Source", accessor: (r) => r.source || "-", sortable: true, cell: (r) => <span className="text-xs text-fg-muted">{r.source || "-"}</span> },
    ];
  }, []);

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
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${rows.length} change(s)`}</p>
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
        <CardContent>
          <DataTable<Row>
            tableId="inventory.costChanges"
            rows={rows}
            columns={columns}
            isLoading={loading}
            initialSort={{ columnId: "changed_at", dir: "desc" }}
            globalFilterPlaceholder="Search SKU / item / warehouse / source..."
            emptyText="No cost changes yet."
          />
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
