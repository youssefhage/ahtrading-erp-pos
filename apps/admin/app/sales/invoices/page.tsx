"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type InvoiceRow = {
  id: string;
  invoice_no: string;
  customer_id: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
};

type Customer = { id: string; name: string };
type Item = { id: string; sku: string; name: string };
type PaymentMethodMapping = { method: string; role_code: string; created_at: string };

type InvoiceLine = {
  id: string;
  item_id: string;
  qty: string | number;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

type SalesPayment = {
  id: string;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  created_at: string;
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

type InvoiceDetail = {
  invoice: InvoiceRow & {
    exchange_rate: string | number;
    pricing_currency: string;
    settlement_currency: string;
  };
  lines: InvoiceLine[];
  payments: SalesPayment[];
  tax_lines: TaxLine[];
};

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function SalesInvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);

  const [status, setStatus] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);

  const [method, setMethod] = useState("cash");
  const [amountUsd, setAmountUsd] = useState("0");
  const [amountLbp, setAmountLbp] = useState("0");
  const [posting, setPosting] = useState(false);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const methodChoices = useMemo(() => {
    const base = ["cash", "bank", "card", "transfer", "other"];
    const fromConfig = paymentMethods.map((m) => m.method);
    const merged = Array.from(new Set([...base, ...fromConfig])).filter(Boolean);
    merged.sort();
    return merged;
  }, [paymentMethods]);

  async function load() {
    setStatus("Loading...");
    try {
      const [inv, cust, it, pm] = await Promise.all([
        apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices"),
        apiGet<{ customers: Customer[] }>("/customers"),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods")
      ]);
      setInvoices(inv.invoices || []);
      setCustomers(cust.customers || []);
      setItems(it.items || []);
      setPaymentMethods(pm.methods || []);
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
    setStatus("Loading invoice...");
    try {
      const res = await apiGet<InvoiceDetail>(`/sales/invoices/${id}`);
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
    loadDetail(invoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  async function postPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceId) return setStatus("invoice is required");
    if (!method.trim()) return setStatus("method is required");
    const usd = toNum(amountUsd);
    const lbp = toNum(amountLbp);
    if (usd === 0 && lbp === 0) return setStatus("amount is required");

    setPosting(true);
    setStatus("Posting payment...");
    try {
      await apiPost("/sales/payments", {
        invoice_id: invoiceId,
        method: method.trim().toLowerCase(),
        amount_usd: usd,
        amount_lbp: lbp
      });
      setAmountUsd("0");
      setAmountLbp("0");
      await load();
      await loadDetail(invoiceId);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <AppShell title="Sales Invoices">
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
            <CardTitle>Record Customer Payment</CardTitle>
            <CardDescription>Posts GL: Dr Cash/Bank, Cr AR. Requires payment method mapping and AR default.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={postPayment} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-slate-700">Invoice</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={invoiceId}
                  onChange={(e) => setInvoiceId(e.target.value)}
                >
                  <option value="">Select invoice...</option>
                  {invoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_no} · {inv.customer_id ? customerById.get(inv.customer_id)?.name || inv.customer_id : "Walk-in"} · {Number(inv.total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Method</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {methodChoices.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Amount USD</label>
                <Input value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Amount LBP</label>
                <Input value={amountLbp} onChange={(e) => setAmountLbp(e.target.value)} />
              </div>
              <div className="md:col-span-6">
                <Button type="submit" disabled={posting}>
                  {posting ? "..." : "Post Payment"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {detail ? (
          <Card>
            <CardHeader>
              <CardTitle>Invoice Detail</CardTitle>
              <CardDescription>
                <span className="font-mono text-xs">{detail.invoice.invoice_no}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Customer</p>
                  <p className="text-sm font-medium text-slate-900">
                    {detail.invoice.customer_id ? customerById.get(detail.invoice.customer_id)?.name || detail.invoice.customer_id : "Walk-in"}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Totals</p>
                  <p className="text-sm font-mono text-slate-900">
                    {Number(detail.invoice.total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD
                  </p>
                  <p className="text-sm font-mono text-slate-900">
                    {Number(detail.invoice.total_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} LBP
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Status</p>
                  <p className="text-sm font-medium text-slate-900">{detail.invoice.status}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Total USD</th>
                      <th className="px-3 py-2 text-right">Total LBP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => {
                      const it = itemById.get(l.item_id);
                      return (
                        <tr key={l.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            {it ? (
                              <span>
                                <span className="font-mono text-xs">{it.sku}</span> · {it.name}
                              </span>
                            ) : (
                              <span className="font-mono text-xs">{l.item_id}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.line_total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.line_total_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                    {detail.lines.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                          No lines.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-sm font-medium text-slate-900">Payments</p>
                  <div className="mt-2 space-y-1 text-xs text-slate-700">
                    {detail.payments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{p.method}</span>
                        <span className="font-mono">
                          {Number(p.amount_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD /{" "}
                          {Number(p.amount_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} LBP
                        </span>
                      </div>
                    ))}
                    {detail.payments.length === 0 ? <p className="text-slate-500">No payments.</p> : null}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-sm font-medium text-slate-900">Tax Lines</p>
                  <div className="mt-2 space-y-1 text-xs text-slate-700">
                    {detail.tax_lines.map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{t.tax_code_id}</span>
                        <span className="font-mono">
                          {Number(t.tax_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD /{" "}
                          {Number(t.tax_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} LBP
                        </span>
                      </div>
                    ))}
                    {detail.tax_lines.length === 0 ? <p className="text-slate-500">No tax lines.</p> : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>{invoices.length} invoices</CardDescription>
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
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Total USD</th>
                    <th className="px-3 py-2 text-right">Total LBP</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                      onClick={() => setInvoiceId(inv.id)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{inv.invoice_no}</td>
                      <td className="px-3 py-2">
                        {inv.customer_id ? customerById.get(inv.customer_id)?.name || inv.customer_id : "Walk-in"}
                      </td>
                      <td className="px-3 py-2">{inv.status}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(inv.total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(inv.total_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                  {invoices.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                        No invoices.
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

