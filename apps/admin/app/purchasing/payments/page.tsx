"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { fmtUsd } from "@/lib/money";
import { parseNumberInput } from "@/lib/numbers";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { ShortcutLink } from "@/components/shortcut-link";
import { useToast } from "@/components/toast-provider";
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
  payment_date?: string | null;
  bank_account_id?: string | null;
  created_at: string;
};

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

export default function SupplierPaymentsPage() {
  const searchParams = useSearchParams();
  const toast = useToast();
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

  const loadBase = useCallback(async () => {
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
  }, []);

  const loadPayments = useCallback(async () => {
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
  }, [supplierInvoiceId, supplierId, dateFrom, dateTo]);

  const loadAll = useCallback(async () => {
    setStatus("Loading...");
    try {
      await loadBase();
      await loadPayments();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [loadBase, loadPayments]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Support deep-linking from invoice pages.
  useEffect(() => {
    const invId = String(searchParams.get("supplier_invoice_id") || "").trim();
    const record = String(searchParams.get("record") || "").trim();
    if (invId) {
      setSupplierInvoiceId(invId);
      setPayInvoiceId(invId);
    }
    if (record === "1") {
      setCreateOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

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
      toast.success("Payment recorded", "Supplier payment posted successfully.");
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

  const columns = useMemo((): Array<DataTableColumn<SupplierPaymentRow>> => {
    return [
      {
        id: "payment_date",
        header: "Date",
        accessor: (p) => p.payment_date || "",
        sortable: true,
        mono: true,
        cell: (p) => <span className="text-xs">{formatDate(p.payment_date || p.created_at)}</span>,
      },
      { id: "created_at", header: "Created", accessor: (p) => p.created_at, sortable: true, mono: true, defaultHidden: true, cell: (p) => <span className="text-xs">{formatDateTime(p.created_at)}</span> },
      {
        id: "invoice",
        header: "Invoice",
        accessor: (p) => p.invoice_no || "",
        sortable: true,
        mono: true,
        cell: (p) => (
          <ShortcutLink
            href={`/purchasing/supplier-invoices/${encodeURIComponent(p.supplier_invoice_id)}`}
            title="Open supplier invoice"
            className="font-mono text-xs"
          >
            {p.invoice_no || p.supplier_invoice_id.slice(0, 8)}
          </ShortcutLink>
        ),
      },
      {
        id: "supplier",
        header: "Supplier",
        accessor: (p) => p.supplier_name || (p.supplier_id ? supplierById.get(p.supplier_id)?.name || p.supplier_id : ""),
        cell: (p) =>
          p.supplier_id ? (
            <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(p.supplier_id)}`} title="Open supplier">
              {p.supplier_name || supplierById.get(p.supplier_id)?.name || p.supplier_id}
            </ShortcutLink>
          ) : (
            "-"
          ),
      },
      { id: "method", header: "Method", accessor: (p) => p.method, sortable: true, mono: true, cell: (p) => <span className="text-xs">{p.method}</span> },
      {
        id: "usd",
        header: "USD",
        accessor: (p) => Number(p.amount_usd || 0),
        sortable: true,
        align: "right",
        mono: true,
        cell: (p) => <span className="text-xs">{Number(p.amount_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>,
      },
      {
        id: "lbp",
        header: "LL",
        accessor: (p) => Number(p.amount_lbp || 0),
        sortable: true,
        align: "right",
        mono: true,
        cell: (p) => <span className="text-xs">{Number(p.amount_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>,
      },
    ];
  }, [supplierById]);

  return (
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Purchasing</p>
            <h1 className="ui-module-title">Supplier Payments</h1>
            <p className="ui-module-subtitle">Record and reconcile outgoing payments to supplier invoices.</p>
          </div>
        </div>
      </div>
        {status ? <ErrorBanner error={status} onRetry={loadAll} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Reduce results for faster review.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="ui-actions-inline">
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
                  <form onSubmit={createPayment} className="ui-form-grid-6">
                    <div className="space-y-1 md:col-span-4">
                      <label className="text-xs font-medium text-fg-muted">Supplier Invoice</label>
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
                            {fmtUsd(inv.total_usd)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">Method</label>
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
                      <label className="text-xs font-medium text-fg-muted">Payment Date</label>
                      <Input value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} type="date" />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Bank Account (optional)</label>
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
                <MoneyInput
                  className="md:col-span-3"
                  label="Amount"
                  currency="USD"
                  value={amountUsd}
                  onChange={setAmountUsd}
                  placeholder="0"
                  quick={[0, 1, 10]}
                  disabled={creating}
                />
                <MoneyInput
                  className="md:col-span-3"
                  label="Amount"
                  currency="LBP"
                  value={amountLbp}
                  onChange={setAmountLbp}
                  placeholder="0"
                  quick={[0, 1, 10]}
                  disabled={creating}
                />
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
              <div className="ui-form-grid-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Supplier</label>
                  <SearchableSelect
                    value={supplierId}
                    onChange={setSupplierId}
                    placeholder="All"
                    searchPlaceholder="Search suppliers..."
                    options={[
                      { value: "", label: "All" },
                      ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Supplier Invoice</label>
                  <SearchableSelect
                    value={supplierInvoiceId}
                    onChange={setSupplierInvoiceId}
                    placeholder="All"
                    searchPlaceholder="Search invoices..."
                    maxOptions={120}
                    options={[
                      { value: "", label: "All" },
                      ...invoices.slice(0, 2000).map((i) => ({ value: i.id, label: i.invoice_no || i.id, keywords: `${i.invoice_no || ""} ${i.id}`.trim() })),
                    ]}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">From</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">To</label>
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
            <DataTable<SupplierPaymentRow>
              tableId="purchasing.payments"
              rows={payments}
              columns={columns}
              emptyText="No payments."
              globalFilterPlaceholder="Search invoice / supplier / method..."
              initialSort={{ columnId: "created_at", dir: "desc" }}
            />
          </CardContent>
        </Card>
      </div>);
}
