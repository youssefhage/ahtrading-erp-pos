"use client";

import { useEffect, useMemo, useState } from "react";

import { apiBase, apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";

type Row = {
  id: string;
  sku: string;
  name: string | null;
  qty_on_hand: string | number;
  value_usd: string | number;
  value_lbp: string | number;
};

function fmt(n: string | number) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function InventoryValuationPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");

  const columns = useMemo((): Array<DataTableColumn<Row>> => {
    return [
      { id: "sku", header: "SKU", accessor: (r) => r.sku, mono: true, sortable: true },
      { id: "name", header: "Item", accessor: (r) => r.name || "", sortable: true },
      {
        id: "qty_on_hand",
        header: "Qty",
        accessor: (r) => Number(r.qty_on_hand || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-qty">{fmt(r.qty_on_hand)}</span>,
      },
      {
        id: "value_usd",
        header: "Value USD",
        accessor: (r) => Number(r.value_usd || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-usd">{fmt(r.value_usd)}</span>,
      },
      {
        id: "value_lbp",
        header: "Value LL",
        accessor: (r) => Number(r.value_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmt(r.value_lbp)}</span>,
      },
    ];
  }, []);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ inventory: Row[] }>("/reports/inventory-valuation");
      setRows(res.inventory || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function downloadCsv() {
    setStatus("Downloading CSV...");
    try {
      const res = await fetch(`${apiBase()}/reports/inventory-valuation?format=csv`, {
        credentials: "include"
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
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>On-hand + Value</CardTitle>
            <CardDescription>Computed from stock_moves. {rows.length} items</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Button variant="secondary" onClick={downloadCsv}>
                Download CSV
              </Button>
            </div>

            <DataTable<Row>
              tableId="accounting.reports.inventory_valuation"
              rows={rows}
              columns={columns}
              initialSort={{ columnId: "value_usd", dir: "desc" }}
              globalFilterPlaceholder="Search SKU / item..."
              emptyText="No items / moves yet."
            />
          </CardContent>
        </Card>
      </div>);
}
