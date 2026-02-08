"use client";

import { useEffect, useState } from "react";

import { apiBase, apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

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

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Value USD</th>
                    <th className="px-3 py-2 text-right">Value LBP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                      <td className="px-3 py-2">{r.name || ""}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.qty_on_hand)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.value_usd)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.value_lbp)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                        No items / moves yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>);
}

