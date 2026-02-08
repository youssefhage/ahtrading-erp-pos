"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
type Item = { id: string; sku: string; name: string };

type ReturnLine = {
  id: string;
  item_id: string;
  qty: string | number;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  base_usd: string | number;
  base_lbp: string | number;
  tax_usd: string | number;
  tax_lbp: string | number;
  tax_date: string | null;
  created_at: string;
};

type ReturnDetail = {
  return: ReturnRow & { exchange_rate: string | number };
  lines: ReturnLine[];
  tax_lines: TaxLine[];
};

export default function SalesReturnsPage() {
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [returnId, setReturnId] = useState("");
  const [detail, setDetail] = useState<ReturnDetail | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return returns;
    return returns.filter((r) => {
      const rn = (r.return_no || "").toLowerCase();
      const inv = r.invoice_id ? (invoiceById.get(r.invoice_id)?.invoice_no || "").toLowerCase() : "";
      const wh = r.warehouse_id ? (whById.get(r.warehouse_id)?.name || "").toLowerCase() : "";
      return rn.includes(needle) || inv.includes(needle) || wh.includes(needle) || r.id.toLowerCase().includes(needle);
    });
  }, [returns, q, invoiceById, whById]);

  async function load() {
    setStatus("Loading...");
    try {
      const [r, inv, wh, it] = await Promise.all([
        apiGet<{ returns: ReturnRow[] }>("/sales/returns"),
        apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
        apiGet<{ items: Item[] }>("/items")
      ]);
      setReturns(r.returns || []);
      setInvoices(inv.invoices || []);
      setWarehouses(wh.warehouses || []);
      setItems(it.items || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function loadDetail(id: string) {
    if (!id) {
      setDetail(null);
      return;
    }
    setStatus("Loading return...");
    try {
      const res = await apiGet<ReturnDetail>(`/sales/returns/${id}`);
      setDetail(res);
      setStatus("");
    } catch (err) {
      setDetail(null);
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadDetail(returnId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnId]);

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
            <CardTitle>Returns</CardTitle>
            <CardDescription>{filtered.length} returns</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-96">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search return / invoice / warehouse..." />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={load}>
                  Refresh
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead className="ui-thead">
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
                      {filtered.map((r) => {
                        const selected = r.id === returnId;
                        return (
                          <tr
                            key={r.id}
                            className={selected ? "bg-slate-50" : "ui-tr-hover"}
                            style={{ cursor: "pointer" }}
                            onClick={() => setReturnId(r.id)}
                          >
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
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {Number(r.total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {Number(r.total_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                            No returns.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="md:col-span-1">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Return Detail</CardTitle>
                    <CardDescription>{detail ? `Status: ${detail.return.status}` : "Select a return"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail ? (
                      <>
                        <div className="space-y-1 text-sm">
                          <div>
                            <span className="text-slate-500">Return:</span> {detail.return.return_no || detail.return.id}
                          </div>
                          <div>
                            <span className="text-slate-500">Invoice:</span>{" "}
                            {detail.return.invoice_id ? invoiceById.get(detail.return.invoice_id)?.invoice_no || detail.return.invoice_id : "-"}
                          </div>
                          <div>
                            <span className="text-slate-500">Warehouse:</span>{" "}
                            {detail.return.warehouse_id ? whById.get(detail.return.warehouse_id)?.name || detail.return.warehouse_id : "-"}
                          </div>
                          <div>
                            <span className="text-slate-500">Refund:</span> {detail.return.refund_method || "-"}
                          </div>
                          <div>
                            <span className="text-slate-500">Totals:</span>{" "}
                            {Number(detail.return.total_usd || 0).toFixed(2)} USD / {Number(detail.return.total_lbp || 0).toFixed(0)} LBP
                          </div>
                        </div>

                        <div className="ui-table-wrap">
                          <table className="ui-table">
                            <thead className="ui-thead">
                              <tr>
                                <th className="px-3 py-2">Item</th>
                                <th className="px-3 py-2 text-right">Qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(detail.lines || []).map((l) => {
                                const it = itemById.get(l.item_id);
                                return (
                                  <tr key={l.id} className="ui-tr-hover">
                                    <td className="px-3 py-2">
                                      {it ? (
                                        <span>
                                          <span className="font-mono text-xs">{it.sku}</span> · {it.name}
                                        </span>
                                      ) : (
                                        <span className="font-mono text-xs">{l.item_id}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-xs">
                                      {Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                                    </td>
                                  </tr>
                                );
                              })}
                              {!(detail.lines || []).length ? (
                                <tr>
                                  <td className="px-3 py-6 text-center text-slate-500" colSpan={2}>
                                    No lines.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>

                        <div className="rounded-md border border-slate-200 bg-white p-3">
                          <p className="text-sm font-medium text-slate-900">Tax Lines</p>
                          <div className="mt-2 space-y-1 text-xs text-slate-700">
                            {(detail.tax_lines || []).map((t) => (
                              <div key={t.id} className="flex items-center justify-between gap-2">
                                <span className="font-mono">{t.tax_code_id}</span>
                                <span className="font-mono">
                                  {Number(t.tax_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD /{" "}
                                  {Number(t.tax_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} LBP
                                </span>
                              </div>
                            ))}
                            {!(detail.tax_lines || []).length ? <p className="text-slate-500">No tax lines.</p> : null}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-slate-600">Pick a return from the list to view it.</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>);
}
