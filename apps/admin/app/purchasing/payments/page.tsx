"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Plus } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { fmtUsd } from "@/lib/money";
import { parseNumberInput } from "@/lib/numbers";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";
import { useToast } from "@/components/toast-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  totals?: { amount_usd?: string | number | null; amount_lbp?: string | number | null };
};

function toNum(v: string) { const r = parseNumberInput(v); return r.ok ? r.value : 0; }
function n(v: unknown) { const x = Number(v || 0); return Number.isFinite(x) ? x : 0; }
function fmtMethod(s: string) {
  return String(s || "").trim().split(/[\s_-]+/).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

const PAGE_SIZE = 200;

function SupplierPaymentsInner() {
  const searchParams = useSearchParams();
  const toast = useToast();

  const qsInvoiceId = searchParams.get("supplier_invoice_id") || "";
  const qsSupplierId = searchParams.get("supplier_id") || "";
  const qsRecord = searchParams.get("record") || "";

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [payments, setPayments] = useState<SupplierPaymentRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState({ amount_usd: 0, amount_lbp: 0 });

  // Filters
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceId, setSupplierInvoiceId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Create dialog
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
  const [payInvoicesLoading, setPayInvoicesLoading] = useState(false);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);
  const payableInvoiceById = useMemo(() => new Map(payableInvoices.map((i) => [i.id, i])), [payableInvoices]);

  const methodChoices = useMemo(() => {
    const set = new Set(paymentMethods.map((m) => String(m.method || "").trim().toLowerCase()).filter(Boolean));
    return Array.from(set).sort();
  }, [paymentMethods]);
  const methodRoleByMethod = useMemo(() => {
    const out = new Map<string, string>();
    for (const m of paymentMethods) {
      const key = String(m.method || "").trim().toLowerCase();
      if (key) out.set(key, String(m.role_code || "").trim().toUpperCase());
    }
    return out;
  }, [paymentMethods]);
  const hasPaymentMethods = methodChoices.length > 0;
  const showBankAccount = methodRoleByMethod.get(method.trim().toLowerCase()) === "BANK";

  const loadBase = useCallback(async () => {
    const [sup, inv, pm] = await Promise.all([
      apiGet<{ suppliers: Supplier[] }>("/suppliers"),
      apiGet<{ invoices: InvoiceRow[] }>("/purchases/invoices?limit=500&offset=0"),
      apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods"),
    ]);
    setSuppliers(sup.suppliers || []);
    setInvoices(inv.invoices || []);
    setPaymentMethods(pm.methods || []);
    try {
      const ba = await apiGet<{ accounts: BankAccount[] }>("/banking/accounts");
      setBankAccounts((ba.accounts || []).filter((a) => a.is_active));
    } catch { setBankAccounts([]); }
  }, []);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (supplierInvoiceId) qs.set("supplier_invoice_id", supplierInvoiceId);
      if (supplierId) qs.set("supplier_id", supplierId);
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      qs.set("limit", String(PAGE_SIZE));
      qs.set("offset", String((page - 1) * PAGE_SIZE));
      const res = await apiGet<SupplierPaymentsListResponse>(`/purchases/payments?${qs}`);
      setPayments(res.payments || []);
      setTotalRows(Number(res.total ?? (res.payments || []).length));
      setTotals({ amount_usd: n(res.totals?.amount_usd), amount_lbp: n(res.totals?.amount_lbp) });
    } catch { /* noop */ } finally { setLoading(false); }
  }, [supplierInvoiceId, supplierId, dateFrom, dateTo, page]);

  useEffect(() => { loadBase().catch(() => {}); }, [loadBase]);
  useEffect(() => {
    if (qsSupplierId) setSupplierId((p) => p || qsSupplierId);
    if (qsInvoiceId) {
      setSupplierInvoiceId((p) => p || qsInvoiceId);
      setPayInvoiceId((p) => p || qsInvoiceId);
    }
    if (qsRecord === "1" && qsInvoiceId) { setPayInvoiceId(qsInvoiceId); setCreateOpen(true); }
  }, [qsSupplierId, qsInvoiceId, qsRecord]);
  useEffect(() => { setPage(1); }, [supplierInvoiceId, supplierId, dateFrom, dateTo]);
  useEffect(() => { loadPayments(); }, [loadPayments]);
  useEffect(() => {
    if (!methodChoices.length) { if (method) setMethod(""); return; }
    if (!methodChoices.includes(method.trim().toLowerCase())) setMethod(methodChoices[0]);
  }, [methodChoices, method]);
  useEffect(() => { if (!showBankAccount && bankAccountId) setBankAccountId(""); }, [showBankAccount, bankAccountId]);

  const searchPayableInvoices = useCallback(async (query: string) => {
    setPayInvoicesLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "120", offset: "0", status: "posted", payable_only: "true" });
      if (query.trim()) qs.set("q", query.trim());
      const res = await apiGet<{ invoices: InvoiceRow[] }>(`/purchases/invoices?${qs}`);
      const rows = res.invoices || [];
      setPayableInvoices(rows);
      const opts: SearchableSelectOption[] = [
        { value: "", label: "Select invoice..." },
        ...rows.map((inv) => ({
          value: inv.id,
          label: `${inv.invoice_no || inv.id} \u00b7 ${inv.supplier_name || "Unknown"} \u00b7 ${fmtUsd(inv.total_usd)}`,
        })),
      ];
      setPayInvoiceOptions(opts);
    } catch { /* noop */ } finally { setPayInvoicesLoading(false); }
  }, []);

  useEffect(() => { if (createOpen) void searchPayableInvoices(""); }, [createOpen, searchPayableInvoices]);

  async function createPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payInvoiceId || !hasPaymentMethods || !method.trim()) return;
    const usd = toNum(amountUsd);
    const lbp = toNum(amountLbp);
    if (usd === 0 && lbp === 0) return;
    setCreating(true);
    try {
      await apiPost<{ id: string }>("/purchases/payments", {
        supplier_invoice_id: payInvoiceId,
        method: method.trim().toLowerCase(),
        amount_usd: usd, amount_lbp: lbp,
        payment_date: paymentDate || undefined,
        bank_account_id: bankAccountId || undefined,
      });
      toast.success("Payment recorded", "Supplier payment posted successfully.");
      setCreateOpen(false); setPayInvoiceId(""); setAmountUsd(""); setAmountLbp(""); setBankAccountId("");
      await loadPayments();
    } catch { /* noop */ } finally { setCreating(false); }
  }

  const selectedInvoice = payInvoiceId ? payableInvoiceById.get(payInvoiceId) || invoiceById.get(payInvoiceId) : null;

  const columns = useMemo<ColumnDef<SupplierPaymentRow>[]>(() => [
    {
      id: "payment_date",
      accessorFn: (r) => r.payment_date || r.created_at,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.payment_date || row.original.created_at)}</span>,
    },
    {
      id: "invoice",
      accessorFn: (r) => r.invoice_no || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.invoice_no || row.original.supplier_invoice_id.slice(0, 8)}</span>
      ),
    },
    {
      id: "supplier",
      accessorFn: (r) => r.supplier_name || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => row.original.supplier_name || row.original.supplier_id || "-",
    },
    {
      id: "method",
      accessorFn: (r) => fmtMethod(r.method),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Method" />,
      cell: ({ row }) => <span className="text-sm">{fmtMethod(row.original.method)}</span>,
    },
    {
      id: "usd",
      accessorFn: (r) => n(r.amount_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="USD" />,
      cell: ({ row }) => <CurrencyDisplay amount={n(row.original.amount_usd)} currency="USD" />,
    },
    {
      id: "lbp",
      accessorFn: (r) => n(r.amount_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="LBP" />,
      cell: ({ row }) => <CurrencyDisplay amount={n(row.original.amount_lbp)} currency="LBP" />,
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Supplier Payments"
        description="Record, filter, and review supplier payment activity"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={async () => { await loadBase(); await loadPayments(); }} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Record Payment
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Record Supplier Payment</DialogTitle>
                  <DialogDescription>Posts GL: Dr AP, Cr Cash/Bank.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createPayment} className="grid grid-cols-6 gap-4">
                  <div className="col-span-4 space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Supplier Invoice</label>
                    <SearchableSelect value={payInvoiceId} onChange={setPayInvoiceId} placeholder="Select invoice..."
                      searchPlaceholder="Search invoices..." maxOptions={120} loading={payInvoicesLoading}
                      onSearchQueryChange={searchPayableInvoices} options={payInvoiceOptions} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Method</label>
                    <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      value={method} onChange={(e) => setMethod(e.target.value)} disabled={!hasPaymentMethods}>
                      {!methodChoices.length && <option value="">(no methods)</option>}
                      {methodChoices.map((m) => <option key={m} value={m}>{fmtMethod(m)}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3 space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Payment Date</label>
                    <Input value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} type="date" />
                  </div>
                  {showBankAccount && (
                    <div className="col-span-3 space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Bank Account</label>
                      <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                        value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                        <option value="">(none)</option>
                        {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                      </select>
                    </div>
                  )}
                  <MoneyInput className="col-span-3" label="Amount Paid" currency="USD" value={amountUsd}
                    onChange={setAmountUsd} placeholder="0" quick={[0, 1, 10]} disabled={creating} />
                  <MoneyInput className="col-span-3" label="Amount Paid" currency="LBP" displayCurrency="LL"
                    value={amountLbp} onChange={setAmountLbp} placeholder="0" quick={[0, 1, 10]} disabled={creating} />
                  {selectedInvoice && (
                    <div className="col-span-6 text-xs text-muted-foreground">
                      Selected: <span className="font-mono font-medium">{selectedInvoice.invoice_no || selectedInvoice.id}</span>
                      {" \u00b7 "}{selectedInvoice.supplier_name || "Unknown"}
                    </div>
                  )}
                  <div className="col-span-6 flex justify-end">
                    <Button type="submit" disabled={creating || !hasPaymentMethods}>
                      {creating ? "Posting..." : "Post Payment"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Paid USD</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{fmtUsd(totals.amount_usd)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Paid LBP</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {totals.amount_lbp.toLocaleString("en-US", { maximumFractionDigits: 0 })} LL
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Supplier</label>
              <SearchableSelect value={supplierId} onChange={setSupplierId} placeholder="All"
                searchPlaceholder="Search suppliers..."
                options={[{ value: "", label: "All" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" size="sm" onClick={() => { setSupplierId(""); setSupplierInvoiceId(""); setDateFrom(""); setDateTo(""); }}>
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={payments}
        isLoading={loading}
        searchPlaceholder="Search invoice, supplier, method..."
        totalRows={totalRows}
      />

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Page {page} \u00b7 {payments.length} of {totalRows.toLocaleString("en-US")} rows
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page * PAGE_SIZE >= totalRows}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SupplierPaymentsPage() {
  return (
    <Suspense fallback={<div className="px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <SupplierPaymentsInner />
    </Suspense>
  );
}
