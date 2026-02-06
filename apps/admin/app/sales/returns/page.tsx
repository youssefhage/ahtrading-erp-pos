"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ReturnRow = {
  id: string;
  return_no: string | null;
  invoice_id: string | null;
  warehouse_id: string | null;
  device_id: string | null;
  shift_id: string | null;
  refund_method: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
};

type InvoiceRow = { id: string; invoice_no: string };
type Warehouse = { id: string; name: string };

export default function SalesReturnsPage() {
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [status, setStatus] = useState("");

  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function load() {
    setStatus("Loading...");
    try {
      const [r, inv, wh] = await Promise.all([
        apiGet<{ returns: ReturnRow[] }>("/sales/returns"),
        apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses")
      ]);
      setReturns(r.returns || []);
      setInvoices(inv.invoices || []);
      setWarehouses(wh.warehouses || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <AppShell title="Sales Returns">
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
            <CardTitle>Returns</CardTitle>
            <CardDescription>{returns.length} returns</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Return</th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Warehouse</th>
                    <th className="px-3 py-2">Refund</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Total USD</th>
                    <th className="px-3 py-2 text-right">Total LBP</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 font-mono text-xs">{r.return_no || r.id}</td>
                      <td className="px-3 py-2">
                        {r.invoice_id ? (
                          <span className="font-mono text-xs">{invoiceById.get(r.invoice_id)?.invoice_no || r.invoice_id}</span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.warehouse_id ? whById.get(r.warehouse_id)?.name || r.warehouse_id : <span className="text-slate-500">-</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.refund_method || "-"}</td>
                      <td className="px-3 py-2">{r.status}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(r.total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(r.total_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {returns.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                        No returns.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

