"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRightLeft, FileCheck2, FilePenLine, Package, Plus, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { KpiCard } from "@/components/business/kpi-card";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

function Inner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => rows.filter((r) => !statusFilter || r.status === statusFilter), [rows, statusFilter]);

  const summary = useMemo(() => {
    let draft = 0, picked = 0, posted = 0;
    for (const r of rows) {
      if (r.status === "draft") draft++;
      else if (r.status === "picked") picked++;
      else if (r.status === "posted") posted++;
    }
    return { total: rows.length, draft, picked, posted };
  }, [rows]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ transfers: TransferRow[] }>(`/inventory/transfers?q=&status=${encodeURIComponent(statusFilter)}&limit=1000`);
      setRows(res.transfers || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo<ColumnDef<TransferRow>[]>(() => [
    {
      accessorKey: "transfer_no",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Transfer" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <Link className="font-medium text-primary hover:underline" href={`/inventory/transfers/${encodeURIComponent(row.original.id)}`}>
            {row.original.transfer_no || row.original.id.slice(0, 8)}
          </Link>
          {row.original.memo && <span className="mt-0.5 text-xs text-muted-foreground">{row.original.memo}</span>}
        </div>
      ),
    },
    {
      id: "from_to",
      accessorFn: (r) => `${r.from_warehouse_name || ""} ${r.to_warehouse_name || ""}`,
      header: ({ column }) => <DataTableColumnHeader column={column} title="From \u2192 To" />,
      cell: ({ row }) => (
        <span className="text-sm">
          <span className="font-medium">{row.original.from_warehouse_name || row.original.from_warehouse_id.slice(0, 8)}</span>
          <span className="mx-2 text-muted-foreground">{"\u2192"}</span>
          <span className="font-medium">{row.original.to_warehouse_name || row.original.to_warehouse_id.slice(0, 8)}</span>
        </span>
      ),
    },
    {
      id: "status",
      accessorFn: (r) => r.status,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "created_at",
      accessorFn: (r) => r.created_at,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
      cell: ({ row }) => <span className="font-mono text-xs">{formatDateLike(row.original.created_at)}</span>,
    },
    {
      id: "picked_at",
      accessorFn: (r) => r.picked_at || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Picked" />,
      cell: ({ row }) => <span className="font-mono text-xs">{formatDateLike(row.original.picked_at)}</span>,
    },
    {
      id: "posted_at",
      accessorFn: (r) => r.posted_at || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Posted" />,
      cell: ({ row }) => <span className="font-mono text-xs">{formatDateLike(row.original.posted_at)}</span>,
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Stock Transfers"
        description="Document-first transfers with pick allocations and posting"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => router.push("/inventory/transfers/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Draft
            </Button>
          </>
        }
      >
        <Badge variant="outline">{filtered.length} transfers</Badge>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Total" value={summary.total} icon={ArrowRightLeft} />
        <KpiCard title="Draft" value={summary.draft} icon={FilePenLine} trend={summary.draft > 0 ? "neutral" : undefined} />
        <KpiCard title="Picked" value={summary.picked} icon={Package} trend={summary.picked > 0 ? "neutral" : undefined} />
        <KpiCard title="Posted" value={summary.posted} icon={FileCheck2} trend={summary.posted > 0 ? "up" : "neutral"} />
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={loading}
        searchPlaceholder="Search transfer no / memo / warehouses..."
        toolbarActions={
          <select className="h-9 rounded-md border bg-background px-3 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="picked">Picked</option>
            <option value="posted">Posted</option>
            <option value="canceled">Canceled</option>
          </select>
        }
      />
    </div>
  );
}

export default function TransfersListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
