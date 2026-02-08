"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Supplier = { id: string; name: string };

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  supplier_id: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
};

type PaymentMethodMapping = { method: string; role_code: string; created_at: string };
type BankAccount = { id: string; name: string; currency: string; is_active: boolean };

type SupplierPaymentRow = {
  id: string;
  supplier_invoice_id: string;
  invoice_no: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  created_at: string;
};

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function SupplierPaymentsPage() {
  const [status, setStatus] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [payments, setPayments] = useState<SupplierPaymentRow[]>([]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceId, setSupplierInvoiceId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [payInvoiceId, setPayInvoiceId] = useState("");
  const [method, setMethod] = useState("bank");
  const [amountUsd, setAmountUsd] = useState("");
  const [amountLbp, setAmountLbp] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState("");

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);

  const methodChoices = useMemo(() => {
    const base = ["cash", "bank", "card", "transfer", "other"];
    const fromConfig = paymentMethods.map((m) => m.method);
    const merged = Array.from(new Set([...base, ...fromConfig])).filter(Boolean);
    merged.sort();
    return merged;
  }, [paymentMethods]);

  async function loadBase() {
    const [sup, inv, pm] = await Promise.all([
      apiGet<{ suppliers: Supplier[] }>("/suppliers"),
      apiGet<{ invoices: InvoiceRow[] }>("/purchases/invoices"),
      apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods")
    ]);
    setSuppliers(sup.suppliers || []);
    setInvoices(inv.invoices || []);
    setPaymentMethods(pm.methods || []);
    try {
      const ba = await apiGet<{ accounts: BankAccount[] }>("/banking/accounts");
      setBankAccounts((ba.accounts || []).filter((a) => a.is_active));
    } catch {
      setBankAccounts([]);
    }
  }

  async function loadPayments() {
    setStatus("Loading...");
    try {
      const qs = new URLSearchParams();
      if (supplierInvoiceId) qs.set("supplier_invoice_id", supplierInvoiceId);
      if (supplierId) qs.set("supplier_id", supplierId);
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      qs.set("limit", "500");
      const res = await apiGet<{ payments: SupplierPaymentRow[] }>(`/purchases/payments?${qs.toString()}`);
      setPayments(res.payments || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function loadAll() {
    setStatus("Loading...");
    try {
      await loadBase();
      await loadPayments();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, supplierInvoiceId, dateFrom, dateTo]);

  async function createPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payInvoiceId) return setStatus("Supplier invoice is required.");
    if (!method.trim()) return setStatus("Method is required.");
    const usd = toNum(amountUsd);
    const lbp = toNum(amountLbp);
    if (usd === 0 && lbp === 0) return setStatus("Amount is required.");

    setCreating(true);
    setStatus("Posting...");
    try {
      await apiPost<{ id: string }>("/purchases/payments", {
        supplier_invoice_id: payInvoiceId,
        method: method.trim().toLowerCase(),
        amount_usd: usd,
        amount_lbp: lbp,
        payment_date: paymentDate || undefined,
        bank_account_id: bankAccountId || undefined
      });
      setCreateOpen(false);
      setPayInvoiceId("");
      setMethod("bank");
      setAmountUsd("");
      setAmountLbp("");
      setBankAccountId("");
      await loadPayments();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
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
            <CardTitle>Filters</CardTitle>
            <CardDescription>Reduce results for faster review.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setFiltersOpen((v) => !v)}>
                {filtersOpen ? "Hide Filters" : "Show Filters"}
              </Button>
              <Button variant="outline" onClick={loadAll}>
                Refresh
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button>Record Payment</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Record Supplier Payment</DialogTitle>
                    <DialogDescription>Posts GL: Dr AP, Cr Cash/Bank. Requires AP default and payment method mapping.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createPayment} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                    <div className="space-y-1 md:col-span-4">
                      <label className="text-xs font-medium text-slate-700">Supplier Invoice</label>
                      <select
                        className="ui-select"
                        value={payInvoiceId}
                        onChange={(e) => setPayInvoiceId(e.target.value)}
                      >
                        <option value="">Select invoice...</option>
                        {invoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {(inv.invoice_no || inv.id).toString()} ·{" "}
                            {inv.supplier_id ? supplierById.get(inv.supplier_id)?.name || inv.supplier_id : "-"} ·{" "}
                            {Number(inv.total_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Method</label>
                      <select
                        className="ui-select"
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
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">Payment Date</label>
                      <Input value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} type="date" />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">Bank Account (optional)</label>
                      <select
                        className="ui-select"
                        value={bankAccountId}
                        onChange={(e) => setBankAccountId(e.target.value)}
                      >
                        <option value="">(none)</option>
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.currency})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">Amount USD</label>
                      <Input value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">Amount LBP</label>
                      <Input value={amountLbp} onChange={(e) => setAmountLbp(e.target.value)} />
                    </div>
                    <div className="flex justify-end md:col-span-6">
                      <Button type="submit" disabled={creating}>
                        {creating ? "..." : "Post Payment"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {filtersOpen ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Supplier</label>
                  <select
                    className="ui-select"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">All</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Supplier Invoice</label>
                  <select
                    className="ui-select"
                    value={supplierInvoiceId}
                    onChange={(e) => setSupplierInvoiceId(e.target.value)}
                  >
                    <option value="">All</option>
                    {invoices.slice(0, 2000).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.invoice_no || i.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">From</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">To</label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
            <CardDescription>{payments.length} rows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Method</th>
                    <th className="px-3 py-2 text-right">USD</th>
                    <th className="px-3 py-2 text-right">LBP</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{p.created_at}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.invoice_no || p.supplier_invoice_id}</td>
                      <td className="px-3 py-2">{p.supplier_name || (p.supplier_id ? supplierById.get(p.supplier_id)?.name : null) || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.method}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(p.amount_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(p.amount_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {payments.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                        No payments.
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
