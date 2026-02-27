"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDate, formatDateLike } from "@/lib/datetime";
import { fmtLbpMaybe, fmtUsdMaybe } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

function fmtPct(v: string | number | null | undefined) {
  if (v == null) return "-";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "-";
  const pct = n * 100;
  return `${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
}

function Inner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ changes: Row[] }>("/pricing/price-changes?q=&limit=1000");
      setRows(res.changes || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    {
      id: "when",
      accessorFn: (r) => r.changed_at,
      header: ({ column }) => <DataTableColumnHeader column={column} title="When" />,
      cell: ({ row }) => <span className="font-mono text-xs">{formatDateLike(row.original.changed_at)}</span>,
    },
    {
      id: "item",
      accessorFn: (r) => `${r.sku} ${r.name}`,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <Link className="hover:underline" href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`}>
            <span className="font-medium font-mono text-xs">{row.original.sku}</span> {"\u00b7"} {row.original.name}
          </Link>
          {row.original.effective_from && <span className="mt-0.5 text-xs text-muted-foreground">Effective: {formatDate(row.original.effective_from)}</span>}
        </div>
      ),
    },
    {
      id: "usd",
      accessorFn: (r) => Number(r.new_price_usd || 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="USD" />,
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {fmtUsdMaybe(row.original.old_price_usd)} <span className="text-muted-foreground">{"\u2192"}</span> {fmtUsdMaybe(row.original.new_price_usd)}
        </span>
      ),
    },
    {
      id: "usd_pct",
      accessorFn: (r) => Number(r.pct_change_usd || 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="USD %" />,
      cell: ({ row }) => <span className="font-mono text-sm">{fmtPct(row.original.pct_change_usd)}</span>,
    },
    {
      id: "lbp",
      accessorFn: (r) => Number(r.new_price_lbp || 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="LBP" />,
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">
          {fmtLbpMaybe(row.original.old_price_lbp, { dashIfZero: Number(row.original.old_price_usd || 0) !== 0 })}{" "}
          <span className="text-muted-foreground/60">{"\u2192"}</span>{" "}
          {fmtLbpMaybe(row.original.new_price_lbp, { dashIfZero: Number(row.original.new_price_usd || 0) !== 0 })}
        </span>
      ),
    },
    {
      id: "lbp_pct",
      accessorFn: (r) => Number(r.pct_change_lbp || 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="LBP %" />,
      cell: ({ row }) => <span className="font-mono text-sm">{fmtPct(row.original.pct_change_lbp)}</span>,
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Price Changes"
        description="Sell price change log derived from item price inserts"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/catalog/items/list")}>
              Items
            </Button>
          </>
        }
      >
        <Badge variant="outline">{rows.length} changes</Badge>
      </PageHeader>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={loading}
        searchPlaceholder="Search SKU / name / source..."
      />
    </div>
  );
}

export default function PriceChangesListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
