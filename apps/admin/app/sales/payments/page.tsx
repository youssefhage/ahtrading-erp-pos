"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { fmtUsd } from "@/lib/money";
import { parseNumberInput } from "@/lib/numbers";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";
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
  customer_name?: string | null;
  status?: string;
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

type SalesPaymentsListResponse = {
  payments: SalesPaymentRow[];
  total?: number;
  limit?: number;
  offset?: number;
  totals?: {
    applied_usd?: string | number | null;
    applied_lbp?: string | number | null;
    tender_usd?: string | number | null;
    tender_lbp?: string | number | null;
    has_tender?: boolean | null;
  };
};

const PAYMENTS_PAGE_SIZE = 200;

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

function formatMethodLabel(method: string) {
  const s = String(method || "").trim();
  if (!s) return "";
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function SummaryMoneyCard(props: { title: string; usd: number; lbp: number }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated/70 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">{props.title}</div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="text-xs text-fg-subtle">USD</span>
        <span className="data-mono text-sm ui-tone-usd">{props.usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-3">
        <span className="text-xs text-fg-subtle">LL</span>
        <span className="data-mono text-sm ui-tone-lbp">{props.lbp.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
      </div>
    </div>
  );
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
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState({
    applied_usd: 0,
    applied_lbp: 0,
    tender_usd: 0,
    tender_lbp: 0,
    has_tender: false,
  });

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
  const [payableInvoices, setPayableInvoices] = useState<InvoiceRow[]>([]);
  const [payInvoiceOptions, setPayInvoiceOptions] = useState<SearchableSelectOption[]>([{ value: "", label: "Select invoice..." }]);
  const [payInvoicesLoading, setPayInvoicesLoading] = useState(false);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);
  const payableInvoiceById = useMemo(() => new Map(payableInvoices.map((i) => [i.id, i])), [payableInvoices]);

  const methodChoices = useMemo(() => {
    const fromConfig = paymentMethods.map((m) => String(m.method || "").trim().toLowerCase()).filter(Boolean);
    const merged = Array.from(new Set(fromConfig));
    merged.sort();
    return merged;
  }, [paymentMethods]);
  const methodRoleByMethod = useMemo(() => {
    const out = new Map<string, string>();
    for (const m of paymentMethods) {
      const methodKey = String(m.method || "").trim().toLowerCase();
      const roleCode = String(m.role_code || "").trim().toUpperCase();
      if (methodKey) out.set(methodKey, roleCode);
    }
    return out;
  }, [paymentMethods]);
  const hasPaymentMethodMappings = methodChoices.length > 0;
  const normalizedMethod = method.trim().toLowerCase();
  const showBankAccount = methodRoleByMethod.get(normalizedMethod) === "BANK";

  const loadBase = useCallback(async () => {
    const [cust, inv, pm] = await Promise.all([
      apiGet<{ customers: Customer[] }>("/customers?limit=500&offset=0&include_inactive=true"),
      apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices?limit=500&offset=0"),
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
      qs.set("limit", String(PAYMENTS_PAGE_SIZE));
      qs.set("offset", String((page - 1) * PAYMENTS_PAGE_SIZE));
      const res = await apiGet<SalesPaymentsListResponse>(`/sales/payments?${qs.toString()}`);
      setPayments(res.payments || []);
      setTotalRows(Number(res.total ?? (res.payments || []).length));
      if (res.totals) {
        setTotals({
          applied_usd: n(res.totals.applied_usd),
          applied_lbp: n(res.totals.applied_lbp),
          tender_usd: n(res.totals.tender_usd),
          tender_lbp: n(res.totals.tender_lbp),
          has_tender: Boolean(res.totals.has_tender),
        });
      } else {
        const fallback = {
          applied_usd: 0,
          applied_lbp: 0,
          tender_usd: 0,
          tender_lbp: 0,
          has_tender: false,
        };
        for (const p of res.payments || []) {
          fallback.applied_usd += n(p.amount_usd);
          fallback.applied_lbp += n(p.amount_lbp);
          if (hasTender(p)) {
            fallback.has_tender = true;
            fallback.tender_usd += n(p.tender_usd);
            fallback.tender_lbp += n(p.tender_lbp);
          }
        }
        setTotals(fallback);
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [invoiceId, customerId, dateFrom, dateTo, page]);

  const refreshAll = useCallback(async () => {
    try {
      await loadBase();
      await loadPayments();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [loadBase, loadPayments]);

  useEffect(() => {
    loadBase().catch((err) => setStatus(err instanceof Error ? err.message : String(err)));
  }, [loadBase]);

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
    setPage(1);
  }, [invoiceId, customerId, dateFrom, dateTo]);
  useEffect(() => {
    loadPayments();
  }, [loadPayments]);
  useEffect(() => {
    if (!methodChoices.length) {
      if (method) setMethod("");
      return;
    }
    if (!methodChoices.includes(normalizedMethod)) {
      setMethod(methodChoices[0]);
    }
  }, [methodChoices, normalizedMethod, method]);
  useEffect(() => {
    if (!showBankAccount && bankAccountId) setBankAccountId("");
  }, [showBankAccount, bankAccountId]);

  const searchPayableInvoices = useCallback(
    async (query: string) => {
      setPayInvoicesLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set("limit", "120");
        qs.set("offset", "0");
        qs.set("status", "posted");
        qs.set("payable_only", "true");
        const trimmed = query.trim();
        if (trimmed) qs.set("q", trimmed);
        const res = await apiGet<{ invoices: InvoiceRow[] }>(`/sales/invoices?${qs.toString()}`);
        const rows = res.invoices || [];
        setPayableInvoices(rows);
        const opts: SearchableSelectOption[] = [
          { value: "", label: "Select invoice..." },
          ...rows.map((inv) => {
            const customerName = inv.customer_name || (inv.customer_id ? customerById.get(inv.customer_id)?.name || inv.customer_id : "Walk-in");
            return {
              value: inv.id,
              label: `${inv.invoice_no} · ${customerName} · ${fmtUsd(inv.total_usd)}`,
              keywords: `${inv.invoice_no} ${inv.id} ${customerName}`.trim(),
            };
          }),
        ];
        if (payInvoiceId && !opts.some((o) => o.value === payInvoiceId)) {
          let selected = invoiceById.get(payInvoiceId);
          if (!selected) {
            const selectedQs = new URLSearchParams();
            selectedQs.set("limit", "5");
            selectedQs.set("offset", "0");
            selectedQs.set("status", "posted");
            selectedQs.set("payable_only", "true");
            selectedQs.set("q", payInvoiceId);
            const selectedRes = await apiGet<{ invoices: InvoiceRow[] }>(`/sales/invoices?${selectedQs.toString()}`);
            selected = (selectedRes.invoices || []).find((inv) => inv.id === payInvoiceId);
          }
          if (selected) {
            const selectedCustomer =
              selected.customer_name || (selected.customer_id ? customerById.get(selected.customer_id)?.name || selected.customer_id : "Walk-in");
            opts.push({
              value: selected.id,
              label: `${selected.invoice_no} · ${selectedCustomer} · ${fmtUsd(selected.total_usd)}`,
              keywords: `${selected.invoice_no} ${selected.id} ${selectedCustomer}`.trim(),
            });
          }
        }
        setPayInvoiceOptions(opts);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      } finally {
        setPayInvoicesLoading(false);
      }
    },
    [customerById, invoiceById, payInvoiceId]
  );

  useEffect(() => {
    if (!createOpen) return;
    void searchPayableInvoices("");
  }, [createOpen, searchPayableInvoices]);

  async function createPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payInvoiceId) return setStatus("Invoice is required.");
    if (!hasPaymentMethodMappings) return setStatus("Configure payment methods first in System Config.");
    if (!method.trim()) return setStatus("Method is required.");
    const usd = toNum(tenderUsd);
    const lbp = toNum(tenderLbp);
    if (usd === 0 && lbp === 0) return setStatus("Amount received is required.");

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
      setMethod(methodChoices[0] || "");
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

  const selectedInvoice = payInvoiceId ? payableInvoiceById.get(payInvoiceId) || invoiceById.get(payInvoiceId) : null;
  const selectedRate = Number(selectedInvoice?.exchange_rate || 0);
  const tenderUsdN = toNum(tenderUsd);
  const tenderLbpN = toNum(tenderLbp);
  const appliedUsdPreview = selectedRate ? tenderUsdN + tenderLbpN / selectedRate : tenderUsdN;
  const appliedLbpPreview = selectedRate ? appliedUsdPreview * selectedRate : tenderLbpN;

  const columns = useMemo((): Array<DataTableColumn<SalesPaymentRow>> => {
    return [
      { id: "created_at", header: "Created", accessor: (p) => p.created_at, sortable: true, mono: true, cell: (p) => <span className="text-xs">{formatDateTime(p.created_at)}</span> },
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
      {
        id: "method",
        header: "Method",
        accessor: (p) => formatMethodLabel(p.method),
        sortable: true,
        mono: true,
        cell: (p) => <span className="text-xs">{formatMethodLabel(p.method)}</span>,
      },
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
                <div className="mt-0.5 text-xs text-fg-muted">Applied: {applied.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
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
                <div className="mt-0.5 text-xs text-fg-muted">Applied: {applied.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
              ) : null}
            </div>
          );
        },
      },
    ];
  }, [customerById]);

  return (
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Sales</p>
            <h1 className="ui-module-title">Customer Payments</h1>
            <p className="ui-module-subtitle">Record, filter, and review customer payment activity.</p>
          </div>
        </div>
      </div>
        {status ? <ErrorBanner error={status} onRetry={refreshAll} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Reduce results for faster review and matching.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="ui-actions-inline">
              <Button variant="outline" onClick={() => setFiltersOpen((v) => !v)}>
                {filtersOpen ? "Hide Filters" : "Show Filters"}
              </Button>
              <Button variant="outline" onClick={refreshAll}>
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
                  <form onSubmit={createPayment} className="ui-form-grid-6">
                    <div className="space-y-1 md:col-span-4">
                      <label className="text-xs font-medium text-fg-muted">Invoice</label>
                      <SearchableSelect
                        value={payInvoiceId}
                        onChange={setPayInvoiceId}
                        placeholder="Select invoice..."
                        searchPlaceholder="Search invoices..."
                        maxOptions={120}
                        loading={payInvoicesLoading}
                        onSearchQueryChange={searchPayableInvoices}
                        options={payInvoiceOptions}
                      />
                    </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">Method</label>
                  <select
                        className="ui-select"
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                        disabled={!hasPaymentMethodMappings}
                      >
                        {!methodChoices.length ? <option value="">(no methods)</option> : null}
                        {methodChoices.map((m) => (
                          <option key={m} value={m}>
                            {formatMethodLabel(m)}
                          </option>
                        ))}
                  </select>
                </div>
                {!hasPaymentMethodMappings ? (
                  <div className="md:col-span-6 text-xs text-warning">
                    No payment methods are configured. Add at least one in System Config before posting payments.
                  </div>
                ) : null}
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Payment Date</label>
                  <Input value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} type="date" />
                </div>
                {showBankAccount ? (
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
                ) : null}
                <MoneyInput
                  className="md:col-span-3"
                  label="Amount Received"
                  currency="USD"
                  value={tenderUsd}
                  onChange={setTenderUsd}
                  placeholder="0"
                  quick={[0, 1, 10]}
                  disabled={creating}
                />
                <MoneyInput
                  className="md:col-span-3"
                  label="Amount Received"
                  currency="LBP"
                  displayCurrency="LL"
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
                    "Tip: Enter USD and/or LL amount received. The system applies the payment using the invoice exchange rate."
                  )}
                </div>
                    <div className="flex justify-end md:col-span-6">
                      <Button type="submit" disabled={creating || !hasPaymentMethodMappings}>
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
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Payments</CardTitle>
                <CardDescription>
                  Showing {payments.length.toLocaleString("en-US")} of {totalRows.toLocaleString("en-US")} matching rows.
                </CardDescription>
              </div>
              <div className="min-w-[110px] rounded-xl border border-border-subtle bg-bg-elevated/70 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">Rows</div>
                <div className="mt-1 data-mono text-lg leading-none text-foreground">{totalRows.toLocaleString("en-US")}</div>
              </div>
            </div>
            <div className={`grid gap-2 ${totals.has_tender ? "md:grid-cols-2" : "md:grid-cols-1"} lg:max-w-2xl`}>
              <SummaryMoneyCard title="Applied" usd={totals.applied_usd} lbp={totals.applied_lbp} />
              {totals.has_tender ? <SummaryMoneyCard title="Amount Received" usd={totals.tender_usd} lbp={totals.tender_lbp} /> : null}
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
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-fg-muted">
                Page {page.toLocaleString("en-US")} · {payments.length.toLocaleString("en-US")} rows loaded
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * PAYMENTS_PAGE_SIZE >= totalRows}
                >
                  Next
                </Button>
              </div>
            </div>
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
