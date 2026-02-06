"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Supplier = { id: string; name: string };
type Item = { id: string; sku: string; name: string };
type TaxCode = { id: string; name: string; rate: string | number; tax_type: string; reporting_currency: string };
type PaymentMethodMapping = { method: string; role_code: string; created_at: string };

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  supplier_id: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
};

type LineDraft = {
  item_id: string;
  qty: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
};

type PaymentDraft = {
  method: string;
  amount_usd: string;
  amount_lbp: string;
};

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function SupplierInvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);
  const [status, setStatus] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [exchangeRate, setExchangeRate] = useState("90000");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { item_id: "", qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0" }
  ]);
  const [payments, setPayments] = useState<PaymentDraft[]>([
    { method: "bank", amount_usd: "0", amount_lbp: "0" }
  ]);
  const [creating, setCreating] = useState(false);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const taxById = useMemo(() => new Map(taxCodes.map((t) => [t.id, t])), [taxCodes]);

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
      const [inv, s, i, tc, pm] = await Promise.all([
        apiGet<{ invoices: InvoiceRow[] }>("/purchases/invoices"),
        apiGet<{ suppliers: Supplier[] }>("/suppliers"),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes"),
        apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods")
      ]);
      setInvoices(inv.invoices || []);
      setSuppliers(s.suppliers || []);
      setItems(i.items || []);
      setTaxCodes(tc.tax_codes || []);
      setPaymentMethods(pm.methods || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function addLine() {
    setLines((prev) => [
      ...prev,
      { item_id: "", qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0" }
    ]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addPayment() {
    setPayments((prev) => [
      ...prev,
      { method: "bank", amount_usd: "0", amount_lbp: "0" }
    ]);
  }

  function removePayment(idx: number) {
    setPayments((prev) => prev.filter((_, i) => i !== idx));
  }

  function updatePayment(idx: number, patch: Partial<PaymentDraft>) {
    setPayments((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) {
      setStatus("supplier is required");
      return;
    }
    const rate = toNum(exchangeRate);
    if (!rate) {
      setStatus("exchange_rate is required");
      return;
    }
    const validLines = lines.filter((l) => l.item_id && toNum(l.qty) > 0);
    if (validLines.length === 0) {
      setStatus("at least one line is required");
      return;
    }

    setCreating(true);
    setStatus("Posting supplier invoice...");
    try {
      const normalizedLines = validLines.map((l) => {
        const qty = toNum(l.qty);
        let unitUsd = toNum(l.unit_cost_usd);
        let unitLbp = toNum(l.unit_cost_lbp);
        if (rate && unitUsd === 0 && unitLbp !== 0) unitUsd = unitLbp / rate;
        if (rate && unitLbp === 0 && unitUsd !== 0) unitLbp = unitUsd * rate;
        return {
          item_id: l.item_id,
          qty,
          unit_cost_usd: unitUsd,
          unit_cost_lbp: unitLbp,
          line_total_usd: qty * unitUsd,
          line_total_lbp: qty * unitLbp
        };
      });

      const baseUsd = normalizedLines.reduce((acc, l) => acc + (Number(l.line_total_usd) || 0), 0);
      const baseLbp = normalizedLines.reduce((acc, l) => acc + (Number(l.line_total_lbp) || 0), 0);

      let tax: unknown = undefined;
      if (taxCodeId) {
        const code = taxById.get(taxCodeId);
        const pct = code ? Number(code.rate || 0) : 0;
        const taxUsd = (baseUsd * pct) / 100;
        const taxLbp = (baseLbp * pct) / 100;
        tax = {
          tax_code_id: taxCodeId,
          base_usd: baseUsd,
          base_lbp: baseLbp,
          tax_usd: taxUsd,
          tax_lbp: taxLbp
        };
      }

      const normalizedPayments = (payments || [])
        .map((p) => {
          const method = (p.method || "bank").trim().toLowerCase();
          let amountUsd = toNum(p.amount_usd);
          let amountLbp = toNum(p.amount_lbp);
          if (rate && amountUsd === 0 && amountLbp !== 0) amountUsd = amountLbp / rate;
          if (rate && amountLbp === 0 && amountUsd !== 0) amountLbp = amountUsd * rate;
          return { method, amount_usd: amountUsd, amount_lbp: amountLbp };
        })
        .filter((p) => p.amount_usd !== 0 || p.amount_lbp !== 0);

      const payload = {
        supplier_id: supplierId,
        invoice_no: invoiceNo.trim() || undefined,
        exchange_rate: rate,
        lines: normalizedLines,
        tax,
        payments: normalizedPayments.length ? normalizedPayments : undefined
      };

      await apiPost("/purchases/invoices/direct", payload);
      setSupplierId("");
      setInvoiceNo("");
      setTaxCodeId("");
      setLines([{ item_id: "", qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0" }]);
      setPayments([{ method: "bank", amount_usd: "0", amount_lbp: "0" }]);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Supplier Invoices">
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
            <CardTitle>Post Supplier Invoice</CardTitle>
            <CardDescription>
              Posts GL: Dr GRNI (net) + Dr VAT (optional) / Cr AP (gross). Optional immediate payments post separate journals.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createInvoice} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Supplier</label>
                  <select
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-slate-700">Invoice No (optional)</label>
                  <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Supplier invoice ref" />
                </div>

                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-slate-700">Exchange Rate (USD→LBP)</label>
                  <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit USD</th>
                      <th className="px-3 py-2 text-right">Unit LBP</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <select
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                            value={l.item_id}
                            onChange={(e) => updateLine(idx, { item_id: e.target.value })}
                          >
                            <option value="">Select item...</option>
                            {items.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.sku} · {it.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input value={l.qty} onChange={(e) => updateLine(idx, { qty: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input value={l.unit_cost_usd} onChange={(e) => updateLine(idx, { unit_cost_usd: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input value={l.unit_cost_lbp} onChange={(e) => updateLine(idx, { unit_cost_lbp: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button type="button" variant="outline" size="sm" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-slate-700">VAT Tax Code (optional)</label>
                  <select
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={taxCodeId}
                    onChange={(e) => setTaxCodeId(e.target.value)}
                  >
                    <option value="">No VAT</option>
                    {taxCodes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {Number(t.rate || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}%
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <p className="text-xs text-slate-600">
                    Note: ensure <code className="rounded bg-slate-100 px-1 py-0.5">AP</code>, <code className="rounded bg-slate-100 px-1 py-0.5">GRNI</code>, and optionally{" "}
                    <code className="rounded bg-slate-100 px-1 py-0.5">VAT_RECOVERABLE</code> account defaults exist in Config.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Immediate Payments (optional)</p>
                    <p className="text-xs text-slate-600">If you enter payments, you must configure payment method mappings.</p>
                  </div>
                  <Button type="button" variant="outline" onClick={addPayment}>
                    Add Payment
                  </Button>
                </div>

                <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Method</th>
                        <th className="px-3 py-2 text-right">Amount USD</th>
                        <th className="px-3 py-2 text-right">Amount LBP</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p, idx) => (
                        <tr key={idx} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            <select
                              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                              value={p.method}
                              onChange={(e) => updatePayment(idx, { method: e.target.value })}
                            >
                              {methodChoices.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input value={p.amount_usd} onChange={(e) => updatePayment(idx, { amount_usd: e.target.value })} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input value={p.amount_lbp} onChange={(e) => updatePayment(idx, { amount_lbp: e.target.value })} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button type="button" variant="outline" size="sm" onClick={() => removePayment(idx)} disabled={payments.length <= 1}>
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={addLine}>
                  Add Line
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "..." : "Post Invoice"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

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
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Total USD</th>
                    <th className="px-3 py-2 text-right">Total LBP</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{inv.invoice_no || inv.id}</td>
                      <td className="px-3 py-2">
                        {(inv.supplier_id && supplierById.get(inv.supplier_id)?.name) || inv.supplier_id || "-"}
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

