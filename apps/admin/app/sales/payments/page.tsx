"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
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

type Customer = { id: string; name: string };

type InvoiceRow = {
  id: string;
  invoice_no: string;
  customer_id: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate?: string | number;
  settlement_currency?: string | null;
  created_at: string;
};

type PaymentMethodMapping = { method: string; role_code: string; created_at: string };
type BankAccount = { id: string; name: string; currency: string; is_active: boolean };

type SalesPaymentRow = {
  id: string;
  invoice_id: string;
  invoice_no: string;
  customer_id: string | null;
  customer_name: string | null;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  tender_usd?: string | number | null;
  tender_lbp?: string | number | null;
  created_at: string;
};

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

function n(v: unknown) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

function hasTender(p: SalesPaymentRow) {
  return n(p.tender_usd) !== 0 || n(p.tender_lbp) !== 0;
}

function SalesPaymentsPageInner() {
  const toast = useToast();
  const searchParams = useSearchParams();
  const qsInvoiceId = searchParams.get("invoice_id") || "";
  const qsCustomerId = searchParams.get("customer_id") || "";
  const qsRecord = searchParams.get("record") || "";

  const [status, setStatus] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [payments, setPayments] = useState<SalesPaymentRow[]>([]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [payInvoiceId, setPayInvoiceId] = useState("");
  const [method, setMethod] = useState("cash");
  const [tenderUsd, setTenderUsd] = useState("");
  const [tenderLbp, setTenderLbp] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState("");

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);

  const methodChoices = useMemo(() => {
    const base = ["cash", "bank", "card", "transfer", "other"];
    const fromConfig = paymentMethods.map((m) => m.method);
    const merged = Array.from(new Set([...base, ...fromConfig])).filter(Boolean);
    merged.sort();
    return merged;
  }, [paymentMethods]);

  const loadBase = useCallback(async () => {
    const [cust, inv, pm] = await Promise.all([
      apiGet<{ customers: Customer[] }>("/customers"),
      apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices"),
      apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods")
    ]);
    setCustomers(cust.customers || []);
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
      if (invoiceId) qs.set("invoice_id", invoiceId);
      if (customerId) qs.set("customer_id", customerId);
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      qs.set("limit", "500");
      const res = await apiGet<{ payments: SalesPaymentRow[] }>(`/sales/payments?${qs.toString()}`);
      setPayments(res.payments || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [invoiceId, customerId, dateFrom, dateTo]);

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

  useEffect(() => {
    // Allow deep-linking from invoice detail into payments.
    if (qsCustomerId) setCustomerId((prev) => prev || qsCustomerId);
    if (qsInvoiceId) setInvoiceId((prev) => prev || qsInvoiceId);
    if (qsRecord === "1" && qsInvoiceId) {
      setPayInvoiceId(qsInvoiceId);
      setCreateOpen(true);
    }
  }, [qsInvoiceId, qsCustomerId, qsRecord]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  async function createPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payInvoiceId) return setStatus("Invoice is required.");
    if (!method.trim()) return setStatus("Method is required.");
    const usd = toNum(tenderUsd);
    const lbp = toNum(tenderLbp);
    if (usd === 0 && lbp === 0) return setStatus("Tender is required.");

    setCreating(true);
    setStatus("Posting...");
    try {
      await apiPost<{ id: string }>("/sales/payments", {
        invoice_id: payInvoiceId,
        method: method.trim().toLowerCase(),
        tender_usd: usd,
        tender_lbp: lbp,
        payment_date: paymentDate || undefined,
        bank_account_id: bankAccountId || undefined
      });
      toast.success("Payment recorded", "Customer payment posted successfully.");
      setCreateOpen(false);
      setPayInvoiceId("");
      setMethod("cash");
      setTenderUsd("");
      setTenderLbp("");
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

  const selectedInvoice = payInvoiceId ? invoiceById.get(payInvoiceId) : null;
  const selectedRate = Number(selectedInvoice?.exchange_rate || 0);
  const tenderUsdN = toNum(tenderUsd);
  const tenderLbpN = toNum(tenderLbp);
  const appliedUsdPreview = selectedRate ? tenderUsdN + tenderLbpN / selectedRate : tenderUsdN;
  const appliedLbpPreview = selectedRate ? appliedUsdPreview * selectedRate : tenderLbpN;

  const totals = useMemo(() => {
    const out = {
      rows: payments.length,
      applied_usd: 0,
      applied_lbp: 0,
      tender_usd: 0,
      tender_lbp: 0,
      has_tender: false
    };
    for (const p of payments) {
      out.applied_usd += n(p.amount_usd);
      out.applied_lbp += n(p.amount_lbp);
      if (hasTender(p)) {
        out.has_tender = true;
        out.tender_usd += n(p.tender_usd);
        out.tender_lbp += n(p.tender_lbp);
      }
    }
    return out;
  }, [payments]);

  const columns = useMemo((): Array<DataTableColumn<SalesPaymentRow>> => {
    return [
      { id: "created_at", header: "Created", accessor: (p) => p.created_at, sortable: true, mono: true, cell: (p) => <span className="text-xs">{p.created_at}</span> },
      {
        id: "invoice",
        header: "Invoice",
        accessor: (p) => p.invoice_no,
        sortable: true,
        mono: true,
        cell: (p) => (
          <ShortcutLink href={`/sales/invoices/${encodeURIComponent(p.invoice_id)}`} title="Open invoice" className="font-mono text-xs">
            {p.invoice_no}
          </ShortcutLink>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        accessor: (p) => p.customer_name || (p.customer_id ? customerById.get(p.customer_id)?.name || p.customer_id : "Walk-in"),
        cell: (p) =>
          p.customer_id ? (
            <ShortcutLink href={`/partners/customers/${encodeURIComponent(p.customer_id)}`} title="Open customer">
              {p.customer_name || customerById.get(p.customer_id)?.name || p.customer_id}
            </ShortcutLink>
          ) : (
            "Walk-in"
          ),
      },
      { id: "method", header: "Method", accessor: (p) => p.method, sortable: true, mono: true, cell: (p) => <span className="text-xs">{p.method}</span> },
      {
        id: "usd",
        header: "USD",
        accessor: (p) => (hasTender(p) ? n(p.tender_usd) : n(p.amount_usd)),
        sortable: true,
        align: "right",
        mono: true,
        cell: (p) => {
          const show = hasTender(p) ? n(p.tender_usd) : n(p.amount_usd);
          const applied = n(p.amount_usd);
          return (
            <div className="text-right">
              <div className="text-xs">{show.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
              {hasTender(p) && Math.abs(show - applied) > 0.00005 ? (
                <div className="mt-0.5 text-[10px] text-fg-muted">Applied: {applied.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "lbp",
        header: "LL",
        accessor: (p) => (hasTender(p) ? n(p.tender_lbp) : n(p.amount_lbp)),
        sortable: true,
        align: "right",
        mono: true,
        cell: (p) => {
          const show = hasTender(p) ? n(p.tender_lbp) : n(p.amount_lbp);
          const applied = n(p.amount_lbp);
          return (
            <div className="text-right">
              <div className="text-xs">{show.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
              {hasTender(p) && Math.abs(show - applied) > 0.005 ? (
                <div className="mt-0.5 text-[10px] text-fg-muted">Applied: {applied.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
              ) : null}
            </div>
          );
        },
      },
    ];
  }, [customerById]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? <ErrorBanner error={status} onRetry={loadPayments} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Reduce results for faster review and matching.</CardDescription>
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
                    <DialogTitle>Record Customer Payment</DialogTitle>
                    <DialogDescription>
                      Posts GL: Dr Cash/Bank, Cr AR. Requires payment method mapping and AR default.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createPayment} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                    <div className="space-y-1 md:col-span-4">
                      <label className="text-xs font-medium text-fg-muted">Invoice</label>
                      <select
                        className="ui-select"
                        value={payInvoiceId}
                        onChange={(e) => setPayInvoiceId(e.target.value)}
                      >
                        <option value="">Select invoice...</option>
                        {invoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.invoice_no} ·{" "}
                            {inv.customer_id ? customerById.get(inv.customer_id)?.name || inv.customer_id : "Walk-in"} ·{" "}
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
                  label="Tender"
                  currency="USD"
                  value={tenderUsd}
                  onChange={setTenderUsd}
                  placeholder="0"
                  quick={[0, 1, 10]}
                  disabled={creating}
                />
                <MoneyInput
                  className="md:col-span-3"
                  label="Tender"
                  currency="LBP"
                  value={tenderLbp}
                  onChange={setTenderLbp}
                  placeholder="0"
                  quick={[0, 1, 10]}
                  disabled={creating}
                />
                <div className="md:col-span-6 text-xs text-fg-muted">
                  {selectedInvoice && selectedRate ? (
                    <>
                      Applied (preview at rate{" "}
                      <span className="data-mono text-foreground">{Number(selectedRate).toLocaleString("en-US")}</span>):{" "}
                      <span className="data-mono text-foreground">
                        {appliedUsdPreview.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                      </span>{" "}
                      USD{" "}
                      <span className="text-fg-subtle">/</span>{" "}
                      <span className="data-mono text-foreground">
                        {appliedLbpPreview.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </span>{" "}
                      LL.
                    </>
                  ) : (
                    "Tip: Enter USD and/or LL tender. The system applies the payment using the invoice exchange rate."
                  )}
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
                  <label className="text-xs font-medium text-fg-muted">Customer</label>
                  <SearchableSelect
                    value={customerId}
                    onChange={setCustomerId}
                    placeholder="All"
                    searchPlaceholder="Search customers..."
                    options={[
                      { value: "", label: "All" },
                      ...customers.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Invoice</label>
                  <SearchableSelect
                    value={invoiceId}
                    onChange={setInvoiceId}
                    placeholder="All"
                    searchPlaceholder="Search invoices..."
                    maxOptions={120}
                    options={[
                      { value: "", label: "All" },
                      ...invoices.slice(0, 2000).map((i) => ({ value: i.id, label: i.invoice_no, keywords: `${i.invoice_no} ${i.id}`.trim() })),
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
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Payments</CardTitle>
                <CardDescription>
                  {payments.length} rows
                  {totals.rows ? (
                    <>
                      {" "}
                      · Applied: <span className="data-mono ui-tone-usd">{Number(totals.applied_usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>{" "}
                      <span className="text-fg-subtle">/</span>{" "}
                      <span className="data-mono ui-tone-lbp">{Number(totals.applied_lbp).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                      {totals.has_tender ? (
                        <>
                          {" "}
                          · Tender: <span className="data-mono ui-tone-usd">{Number(totals.tender_usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>{" "}
                          <span className="text-fg-subtle">/</span>{" "}
                          <span className="data-mono ui-tone-lbp">{Number(totals.tender_lbp).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </CardDescription>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="ui-panel px-3 py-2">
                  <div className="ui-panel-title">Rows</div>
                  <div className="data-mono text-sm">{totals.rows.toLocaleString("en-US")}</div>
                </div>
                <div className="ui-panel px-3 py-2">
                  <div className="ui-panel-title">Applied</div>
                  <div className="data-mono text-sm ui-tone-usd">{Number(totals.applied_usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                  <div className="data-mono text-[11px] text-fg-muted ui-tone-lbp">{Number(totals.applied_lbp).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                </div>
                {totals.has_tender ? (
                  <div className="ui-panel px-3 py-2">
                    <div className="ui-panel-title">Tender</div>
                    <div className="data-mono text-sm ui-tone-usd">{Number(totals.tender_usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                    <div className="data-mono text-[11px] text-fg-muted ui-tone-lbp">{Number(totals.tender_lbp).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                  </div>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <DataTable<SalesPaymentRow>
              tableId="sales.payments"
              rows={payments}
              columns={columns}
              emptyText="No payments."
              globalFilterPlaceholder="Search invoice / customer / method..."
              initialSort={{ columnId: "created_at", dir: "desc" }}
            />
          </CardContent>
        </Card>
      </div>);
}

export default function SalesPaymentsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <SalesPaymentsPageInner />
    </Suspense>
  );
}
