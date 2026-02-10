"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      const res = await apiGet<{ transfers: TransferRow[] }>(
        `/inventory/transfers?q=&status=${encodeURIComponent(statusFilter)}&limit=2000`
      );
      setRows(res.transfers || []);
    } catch (e) {
      setRows([]);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<TransferRow>> = [
      {
        id: "transfer",
        header: "Transfer",
        sortable: true,
        accessor: (r) => r.transfer_no || "",
        cell: (r) => (
          <div className="flex flex-col">
            <Link className="ui-link font-medium" href={`/inventory/transfers/${encodeURIComponent(r.id)}`}>
              {r.transfer_no || r.id.slice(0, 8)}
            </Link>
            {r.memo ? <div className="mt-0.5 text-xs text-fg-muted">{r.memo}</div> : null}
          </div>
        ),
      },
      {
        id: "from_to",
        header: "From -> To",
        sortable: true,
        accessor: (r) => `${r.from_warehouse_name || ""} ${r.to_warehouse_name || ""}`,
        cell: (r) => (
          <span className="text-sm">
            <span className="font-medium">{r.from_warehouse_name || r.from_warehouse_id.slice(0, 8)}</span>
            <span className="mx-2 text-fg-subtle">{"->"}</span>
            <span className="font-medium">{r.to_warehouse_name || r.to_warehouse_id.slice(0, 8)}</span>
          </span>
        ),
      },
      { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => <StatusChip value={r.status} /> },
      { id: "created", header: "Created", sortable: true, mono: true, accessor: (r) => r.created_at, cell: (r) => fmtIso(r.created_at) },
      { id: "picked", header: "Picked", sortable: true, mono: true, accessor: (r) => r.picked_at || "", cell: (r) => fmtIso(r.picked_at) },
      { id: "posted", header: "Posted", sortable: true, mono: true, accessor: (r) => r.posted_at || "", cell: (r) => fmtIso(r.posted_at) },
    ];
    return cols;
  }, []);

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
          <DataTable<TransferRow>
            tableId="inventory.transfers.list"
            rows={filtered}
            columns={columns}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "created", dir: "desc" }}
            globalFilterPlaceholder="Search transfer no / memo / warehouses"
            toolbarLeft={
              <select className="ui-select h-9 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="picked">Picked</option>
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

export default function TransfersListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
