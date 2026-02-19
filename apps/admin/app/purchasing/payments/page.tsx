"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/datetime";
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

type Supplier = { id: string; name: string };

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  status?: string;
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

type SupplierPaymentsListResponse = {
  payments: SupplierPaymentRow[];
  total?: number;
  limit?: number;
  offset?: number;
  totals?: {
    amount_usd?: string | number | null;
    amount_lbp?: string | number | null;
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

function SupplierPaymentsPageInner() {
  const searchParams = useSearchParams();
  const toast = useToast();

  const qsInvoiceId = searchParams.get("supplier_invoice_id") || "";
  const qsSupplierId = searchParams.get("supplier_id") || "";
  const qsRecord = searchParams.get("record") || "";

  const [status, setStatus] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [payments, setPayments] = useState<SupplierPaymentRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState({ amount_usd: 0, amount_lbp: 0 });

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
  const [payableInvoices, setPayableInvoices] = useState<InvoiceRow[]>([]);
  const [payInvoiceOptions, setPayInvoiceOptions] = useState<SearchableSelectOption[]>([{ value: "", label: "Select invoice..." }]);
  const [filterInvoiceOptions, setFilterInvoiceOptions] = useState<SearchableSelectOption[]>([{ value: "", label: "All" }]);
  const [payInvoicesLoading, setPayInvoicesLoading] = useState(false);
  const [filterInvoicesLoading, setFilterInvoicesLoading] = useState(false);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
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
    const [sup, inv, pm] = await Promise.all([
      apiGet<{ suppliers: Supplier[] }>("/suppliers"),
      apiGet<{ invoices: InvoiceRow[] }>("/purchases/invoices?limit=500&offset=0"),
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
      qs.set("limit", String(PAYMENTS_PAGE_SIZE));
      qs.set("offset", String((page - 1) * PAYMENTS_PAGE_SIZE));
      const res = await apiGet<SupplierPaymentsListResponse>(`/purchases/payments?${qs.toString()}`);
      setPayments(res.payments || []);
      setTotalRows(Number(res.total ?? (res.payments || []).length));
      setTotals({
        amount_usd: n(res.totals?.amount_usd),
        amount_lbp: n(res.totals?.amount_lbp),
      });
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [supplierInvoiceId, supplierId, dateFrom, dateTo, page]);

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
    if (qsSupplierId) setSupplierId((prev) => prev || qsSupplierId);
    if (qsInvoiceId) {
      setSupplierInvoiceId((prev) => prev || qsInvoiceId);
      setPayInvoiceId((prev) => prev || qsInvoiceId);
    }
    if (qsRecord === "1" && qsInvoiceId) {
      setPayInvoiceId(qsInvoiceId);
      setCreateOpen(true);
    }
  }, [qsSupplierId, qsInvoiceId, qsRecord]);

  useEffect(() => {
    setPage(1);
  }, [supplierInvoiceId, supplierId, dateFrom, dateTo]);
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
        const res = await apiGet<{ invoices: InvoiceRow[] }>(`/purchases/invoices?${qs.toString()}`);
        const rows = res.invoices || [];
        setPayableInvoices(rows);
        const opts: SearchableSelectOption[] = [
          { value: "", label: "Select invoice..." },
          ...rows.map((inv) => {
            const supplierName = inv.supplier_name || (inv.supplier_id ? supplierById.get(inv.supplier_id)?.name || inv.supplier_id : "Unknown Supplier");
            return {
              value: inv.id,
              label: `${inv.invoice_no || inv.id} · ${supplierName} · ${fmtUsd(inv.total_usd)}`,
              keywords: `${inv.invoice_no || ""} ${inv.id} ${supplierName}`.trim(),
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
            const selectedRes = await apiGet<{ invoices: InvoiceRow[] }>(`/purchases/invoices?${selectedQs.toString()}`);
            selected = (selectedRes.invoices || []).find((inv) => inv.id === payInvoiceId);
          }
          if (selected) {
            const selectedSupplier =
              selected.supplier_name || (selected.supplier_id ? supplierById.get(selected.supplier_id)?.name || selected.supplier_id : "Unknown Supplier");
            opts.push({
              value: selected.id,
              label: `${selected.invoice_no || selected.id} · ${selectedSupplier} · ${fmtUsd(selected.total_usd)}`,
              keywords: `${selected.invoice_no || ""} ${selected.id} ${selectedSupplier}`.trim(),
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
    [supplierById, invoiceById, payInvoiceId]
  );

  const searchFilterInvoices = useCallback(
    async (query: string) => {
      setFilterInvoicesLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set("limit", "120");
        qs.set("offset", "0");
        const trimmed = query.trim();
        if (trimmed) qs.set("q", trimmed);
        const res = await apiGet<{ invoices: InvoiceRow[] }>(`/purchases/invoices?${qs.toString()}`);
        const rows = res.invoices || [];
        const opts: SearchableSelectOption[] = [
          { value: "", label: "All" },
          ...rows.map((inv) => {
            const supplierName = inv.supplier_name || (inv.supplier_id ? supplierById.get(inv.supplier_id)?.name || inv.supplier_id : "Unknown Supplier");
            return {
              value: inv.id,
              label: `${inv.invoice_no || inv.id} · ${supplierName}`,
              keywords: `${inv.invoice_no || ""} ${inv.id} ${supplierName}`.trim(),
            };
          }),
        ];
        if (supplierInvoiceId && !opts.some((o) => o.value === supplierInvoiceId)) {
          let selected = invoiceById.get(supplierInvoiceId);
          if (!selected) {
            const selectedQs = new URLSearchParams();
            selectedQs.set("limit", "5");
            selectedQs.set("offset", "0");
            selectedQs.set("q", supplierInvoiceId);
            const selectedRes = await apiGet<{ invoices: InvoiceRow[] }>(`/purchases/invoices?${selectedQs.toString()}`);
            selected = (selectedRes.invoices || []).find((inv) => inv.id === supplierInvoiceId);
          }
          if (selected) {
            const selectedSupplier =
              selected.supplier_name || (selected.supplier_id ? supplierById.get(selected.supplier_id)?.name || selected.supplier_id : "Unknown Supplier");
            opts.push({
              value: selected.id,
              label: `${selected.invoice_no || selected.id} · ${selectedSupplier}`,
              keywords: `${selected.invoice_no || ""} ${selected.id} ${selectedSupplier}`.trim(),
            });
          }
        }
        setFilterInvoiceOptions(opts);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      } finally {
        setFilterInvoicesLoading(false);
      }
    },
    [supplierById, invoiceById, supplierInvoiceId]
  );

  useEffect(() => {
    if (!createOpen) return;
    void searchPayableInvoices("");
  }, [createOpen, searchPayableInvoices]);
  useEffect(() => {
    if (!filtersOpen) return;
    void searchFilterInvoices("");
  }, [filtersOpen, searchFilterInvoices]);

  async function createPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payInvoiceId) return setStatus("Supplier invoice is required.");
    if (!hasPaymentMethodMappings) return setStatus("Configure payment methods first in System Config.");
    if (!method.trim()) return setStatus("Method is required.");
    const usd = toNum(amountUsd);
    const lbp = toNum(amountLbp);
    if (usd === 0 && lbp === 0) return setStatus("Amount paid is required.");

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
      setMethod(methodChoices[0] || "");
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

  const selectedInvoice = payInvoiceId ? payableInvoiceById.get(payInvoiceId) || invoiceById.get(payInvoiceId) : null;
  const selectedInvoiceSupplier = selectedInvoice
    ? selectedInvoice.supplier_name || (selectedInvoice.supplier_id ? supplierById.get(selectedInvoice.supplier_id)?.name || selectedInvoice.supplier_id : "Unknown Supplier")
    : "";

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
      {
        id: "created_at",
        header: "Created",
        accessor: (p) => p.created_at,
        sortable: true,
        mono: true,
        defaultHidden: true,
        cell: (p) => <span className="text-xs">{formatDateTime(p.created_at)}</span>,
      },
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
            <p className="ui-module-subtitle">Record, filter, and review supplier payment activity.</p>
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
                  <DialogTitle>Record Supplier Payment</DialogTitle>
                  <DialogDescription>
                    Posts GL: Dr AP, Cr Cash/Bank. Requires payment method mapping and AP default.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={createPayment} className="ui-form-grid-6">
                  <div className="space-y-1 md:col-span-4">
                    <label className="text-xs font-medium text-fg-muted">Supplier Invoice</label>
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
                    <select className="ui-select" value={method} onChange={(e) => setMethod(e.target.value)} disabled={!hasPaymentMethodMappings}>
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
                      <select className="ui-select" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
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
                    label="Amount Paid"
                    currency="USD"
                    value={amountUsd}
                    onChange={setAmountUsd}
                    placeholder="0"
                    quick={[0, 1, 10]}
                    disabled={creating}
                  />
                  <MoneyInput
                    className="md:col-span-3"
                    label="Amount Paid"
                    currency="LBP"
                    displayCurrency="LL"
                    value={amountLbp}
                    onChange={setAmountLbp}
                    placeholder="0"
                    quick={[0, 1, 10]}
                    disabled={creating}
                  />
                  <div className="md:col-span-6 text-xs text-fg-muted">
                    {selectedInvoice ? (
                      <>
                        Selected invoice:{" "}
                        <span className="data-mono text-foreground">{selectedInvoice.invoice_no || selectedInvoice.id}</span> ·{" "}
                        <span className="text-foreground">{selectedInvoiceSupplier || "Unknown Supplier"}</span>.
                      </>
                    ) : (
                      "Tip: Enter USD and/or LL amount paid."
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
                  loading={filterInvoicesLoading}
                  onSearchQueryChange={searchFilterInvoices}
                  options={filterInvoiceOptions}
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
          <div className="grid gap-2 md:grid-cols-1 lg:max-w-2xl">
            <SummaryMoneyCard title="Amount Paid" usd={totals.amount_usd} lbp={totals.amount_lbp} />
          </div>
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
    </div>
  );
}

export default function SupplierPaymentsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <SupplierPaymentsPageInner />
    </Suspense>
  );
}
