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
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => {
    return (rows || []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, statusFilter]);

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

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<LandedCostRow>> = [
      {
        id: "landed_cost",
        header: "Landed Cost",
        sortable: true,
        accessor: (r) => r.landed_cost_no || "",
        cell: (r) => (
          <div className="flex flex-col">
            <Link className="ui-link font-medium" href={`/inventory/landed-costs/${encodeURIComponent(r.id)}`}>
              {r.landed_cost_no || "(draft)"}
            </Link>
            {r.memo ? <div className="mt-0.5 text-xs text-fg-muted">{r.memo}</div> : null}
          </div>
        ),
      },
      {
        id: "goods_receipt",
        header: "Goods Receipt",
        sortable: true,
        accessor: (r) => r.goods_receipt_no || r.goods_receipt_id || "",
        cell: (r) =>
          r.goods_receipt_id ? (
            <Link className="ui-link" href={`/purchasing/goods-receipts/${encodeURIComponent(r.goods_receipt_id)}`}>
              {r.goods_receipt_no || r.goods_receipt_id.slice(0, 8)}
            </Link>
          ) : (
            "-"
          ),
      },
      { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => <StatusChip value={r.status} /> },
      {
        id: "total_usd",
        header: "Total USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_usd || 0),
        cell: (r) => <span className="ui-tone-usd">{fmtUsd(r.total_usd)}</span>,
      },
      {
        id: "total_lbp",
        header: "Total LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_lbp || 0),
        cell: (r) => <span className="ui-tone-lbp">{fmtLbp(r.total_lbp)}</span>,
      },
    ];
    return cols;
  }, []);

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
          <DataTable<LandedCostRow>
            tableId="inventory.landed_costs.list"
            rows={filtered}
            columns={columns}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "landed_cost", dir: "desc" }}
            globalFilterPlaceholder="Search landed cost / GRN / memo"
            toolbarLeft={
              <select className="ui-select h-9 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="posted">Posted</option>
                <option value="canceled">Canceled</option>
              </select>
            }
          />
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
