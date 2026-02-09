"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

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
  restocking_fee_usd?: string | number;
  restocking_fee_lbp?: string | number;
  restocking_fee_reason?: string | null;
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
  refunds: Array<{
    id: string;
    method: string;
    amount_usd: string | number;
    amount_lbp: string | number;
    bank_account_id: string | null;
    reference: string | null;
    created_at: string;
  }>;
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
    return filterAndRankByFuzzy(returns || [], q, (r) => {
      const inv = r.invoice_id ? (invoiceById.get(r.invoice_id)?.invoice_no || "") : "";
      const wh = r.warehouse_id ? (whById.get(r.warehouse_id)?.name || "") : "";
      return `${r.return_no || ""} ${inv} ${wh} ${r.id}`;
    });
  }, [returns, q, invoiceById, whById]);

  const load = useCallback(async () => {
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
  }, []);

  const loadDetail = useCallback(async (id: string) => {
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadDetail(returnId);
  }, [returnId, loadDetail]);

  const netRefund = useMemo(() => {
    if (!detail) return { usd: 0, lbp: 0 };
    const feeUsd = Number((detail.return as any).restocking_fee_usd || 0) || 0;
    const feeLbp = Number((detail.return as any).restocking_fee_lbp || 0) || 0;
    const totUsd = Number(detail.return.total_usd || 0) || 0;
    const totLbp = Number(detail.return.total_lbp || 0) || 0;
    return { usd: totUsd - feeUsd, lbp: totLbp - feeLbp };
  }, [detail]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

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
                        <th className="px-3 py-2 text-right">Total LL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => {
                        const selected = r.id === returnId;
                        return (
                          <tr
                            key={r.id}
                            className={selected ? "bg-bg-sunken/20" : "ui-tr-hover"}
                            style={{ cursor: "pointer" }}
                            onClick={() => setReturnId(r.id)}
                          >
                            <td className="px-3 py-2 font-mono text-xs">{r.return_no || r.id}</td>
                            <td className="px-3 py-2">
                              {r.invoice_id ? (
                                <ShortcutLink
                                  href={`/sales/invoices/${encodeURIComponent(r.invoice_id)}`}
                                  title="Open sales invoice"
                                  className="font-mono text-xs"
                                >
                                  {invoiceById.get(r.invoice_id)?.invoice_no || r.invoice_id.slice(0, 8)}
                                </ShortcutLink>
                              ) : (
                                <span className="text-fg-subtle">-</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {r.warehouse_id ? whById.get(r.warehouse_id)?.name || r.warehouse_id : <span className="text-fg-subtle">-</span>}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{r.refund_method || "-"}</td>
                            <td className="px-3 py-2">
                              <StatusChip value={r.status} />
                            </td>
                            <td className="px-3 py-2 text-right data-mono text-xs">{fmtUsd(r.total_usd)}</td>
                            <td className="px-3 py-2 text-right data-mono text-xs">{fmtLbp(r.total_lbp)}</td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-fg-subtle" colSpan={7}>
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
                            <span className="text-fg-subtle">Return:</span> {detail.return.return_no || detail.return.id}
                          </div>
                          <div>
                            <span className="text-fg-subtle">Invoice:</span>{" "}
                            {detail.return.invoice_id ? (
                              <ShortcutLink
                                href={`/sales/invoices/${encodeURIComponent(detail.return.invoice_id)}`}
                                title="Open sales invoice"
                                className="font-mono text-xs"
                              >
                                {invoiceById.get(detail.return.invoice_id)?.invoice_no || detail.return.invoice_id.slice(0, 8)}
                              </ShortcutLink>
                            ) : (
                              "-"
                            )}
                          </div>
                          <div>
                            <span className="text-fg-subtle">Warehouse:</span>{" "}
                            {detail.return.warehouse_id ? whById.get(detail.return.warehouse_id)?.name || detail.return.warehouse_id : "-"}
                          </div>
                          <div>
                            <span className="text-fg-subtle">Refund:</span> {detail.return.refund_method || "-"}
                          </div>
                          <div>
                            <span className="text-fg-subtle">Totals:</span>{" "}
                            <span className="data-mono">
                              {fmtUsd(detail.return.total_usd)} / {fmtLbp(detail.return.total_lbp)}
                            </span>
                          </div>
                          {(Number((detail.return as any).restocking_fee_usd || 0) || Number((detail.return as any).restocking_fee_lbp || 0)) ? (
                            <div>
                              <span className="text-fg-subtle">Restocking fee:</span>{" "}
                              <span className="data-mono">
                                {fmtUsd((detail.return as any).restocking_fee_usd || 0)} / {fmtLbp((detail.return as any).restocking_fee_lbp || 0)}
                              </span>
                              {(detail.return as any).restocking_fee_reason ? (
                                <span className="ml-2 text-xs text-fg-muted">({String((detail.return as any).restocking_fee_reason)})</span>
                              ) : null}
                            </div>
                          ) : null}
                          <div>
                            <span className="text-fg-subtle">Net refund:</span>{" "}
                            <span className="data-mono">
                              {fmtUsd(netRefund.usd)} / {fmtLbp(netRefund.lbp)}
                            </span>
                          </div>
                        </div>

                        {(detail.refunds || []).length ? (
                          <div className="rounded-md border border-border/60 bg-bg-sunken/30 p-3">
                            <div className="text-xs font-medium text-fg-muted">Refund Transactions</div>
                            <div className="mt-2 space-y-1 text-sm">
                              {(detail.refunds || []).map((r) => (
                                <div key={r.id} className="flex items-center justify-between gap-2">
                                  <div className="font-mono text-xs text-fg-muted">{r.method}</div>
                                  <div className="data-mono text-xs">
                                    {fmtUsd(r.amount_usd)} / {fmtLbp(r.amount_lbp)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

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
                                        <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item">
                                          <span className="font-mono text-xs">{it.sku}</span> · {it.name}
                                        </ShortcutLink>
                                      ) : (
                                        <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item" className="font-mono text-xs">
                                          {l.item_id}
                                        </ShortcutLink>
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
                                  <td className="px-3 py-6 text-center text-fg-subtle" colSpan={2}>
                                    No lines.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>

                        <div className="rounded-md border border-border bg-bg-elevated p-3">
                          <p className="text-sm font-medium text-foreground">Tax Lines</p>
                          <div className="mt-2 space-y-1 text-xs text-fg-muted">
                            {(detail.tax_lines || []).map((t) => (
                              <div key={t.id} className="flex items-center justify-between gap-2">
                                <span className="font-mono">{t.tax_code_id}</span>
                                <span className="data-mono">
                                  {fmtUsd(t.tax_usd)} / {fmtLbp(t.tax_lbp)}
                                </span>
                              </div>
                            ))}
                            {!(detail.tax_lines || []).length ? <p className="text-fg-subtle">No tax lines.</p> : null}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-fg-muted">Pick a return from the list to view it.</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>);
}
