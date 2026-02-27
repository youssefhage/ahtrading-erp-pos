"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, FileDown } from "lucide-react";

import { apiBase, apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";

/* ---------- types ---------- */

type Row = {
  id: string;
  sku: string;
  name: string | null;
  qty_on_hand: string | number;
  value_usd: string | number;
  value_lbp: string | number;
};

/* ---------- helpers ---------- */

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number, frac = 2) {
  return n.toLocaleString("en-US", { maximumFractionDigits: frac });
}

/* ---------- page ---------- */

export default function InventoryValuationPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await apiGet<{ inventory: Row[] }>("/reports/inventory-valuation");
      setRows(res.inventory || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadCsv() {
    setError("");
    setDownloadingCsv(true);
    try {
      const res = await fetch(`${apiBase()}/reports/inventory-valuation?format=csv`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "inventory_valuation.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingCsv(false);
    }
  }

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    {
      id: "sku",
      accessorFn: (r) => r.sku,
      header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.sku}</span>,
    },
    {
      id: "name",
      accessorFn: (r) => r.name || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
    },
    {
      id: "qty_on_hand",
      accessorFn: (r) => toNum(r.qty_on_hand),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Qty" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums">{fmt(toNum(row.original.qty_on_hand))}</div>,
    },
    {
      id: "value_usd",
      accessorFn: (r) => toNum(r.value_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Value USD" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums">{fmt(toNum(row.original.value_usd))}</div>,
    },
    {
      id: "value_lbp",
      accessorFn: (r) => toNum(r.value_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Value LBP" />,
      cell: ({ row }) => <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">{fmt(toNum(row.original.value_lbp))}</div>,
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Inventory Valuation"
        description={`On-hand quantities and values computed from stock moves -- ${rows.length} items`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadCsv} disabled={downloadingCsv}>
              <FileDown className="mr-2 h-4 w-4" />
              {downloadingCsv ? "Downloading..." : "CSV"}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
          <Button variant="link" size="sm" className="ml-2" onClick={load}>Retry</Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        isLoading={loading}
        searchPlaceholder="Search SKU / item..."
      />
    </div>
  );
}
