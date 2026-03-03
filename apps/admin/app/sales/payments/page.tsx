"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Plus } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { fmtUsd } from "@/lib/money";
import { parseNumberInput } from "@/lib/numbers";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { EmptyState } from "@/components/business/empty-state";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";
import { useToast } from "@/components/toast-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Customer = { id: string; name: string };
type InvoiceRow = { id: string; invoice_no: string; customer_id: string | null; customer_name?: string | null; status?: string; total_usd: string | number; total_lbp: string | number; exchange_rate?: string | number; settlement_currency?: string | null; created_at: string };
type PaymentMethodMapping = { method: string; role_code: string; created_at: string };
type BankAccount = { id: string; name: string; currency: string; is_active: boolean };
type SalesPaymentRow = { id: string; invoice_id: string; invoice_no: string; customer_id: string | null; customer_name: string | null; method: string; amount_usd: string | number; amount_lbp: string | number; tender_usd?: string | number | null; tender_lbp?: string | number | null; created_at: string };
type SalesPaymentsListResponse = { payments: SalesPaymentRow[]; total?: number; limit?: number; offset?: number; totals?: { applied_usd?: string | number | null; applied_lbp?: string | number | null; tender_usd?: string | number | null; tender_lbp?: string | number | null; has_tender?: boolean | null } };

const PAGE_SIZE = 200;
function toNum(v: string) { const r = parseNumberInput(v); return r.ok ? r.value : 0; }
function n(v: unknown) { const x = Number(v || 0); return Number.isFinite(x) ? x : 0; }
function hasTender(p: SalesPaymentRow) { return n(p.tender_usd) !== 0 || n(p.tender_lbp) !== 0; }
function fmtMethod(m: string) { return String(m || "").split(/[\s_-]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" "); }

function SalesPaymentsInner() {
  const toast = useToast();
  const sp = useSearchParams();
  const qsInvoiceId = sp.get("invoice_id") || "";
  const qsCustomerId = sp.get("customer_id") || "";
  const qsRecord = sp.get("record") || "";

  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodMapping[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [payments, setPayments] = useState<SalesPaymentRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState({ applied_usd: 0, applied_lbp: 0, tender_usd: 0, tender_lbp: 0, has_tender: false });
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
  const [payInvoiceOptions, setPayInvoiceOptions] = useState<SearchableSelectOption[]>([{ value: "", label: "Select invoice..." }]);
  const [payInvoicesLoading, setPayInvoicesLoading] = useState(false);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);
  const methodChoices = useMemo(() => {
    const merged = Array.from(new Set(paymentMethods.map((m) => String(m.method || "").trim().toLowerCase()).filter(Boolean)));
    merged.sort();
    return merged;
  }, [paymentMethods]);
  const methodRoleByMethod = useMemo(() => { const out = new Map<string, string>(); for (const m of paymentMethods) { const k = String(m.method || "").trim().toLowerCase(); if (k) out.set(k, String(m.role_code || "").trim().toUpperCase()); } return out; }, [paymentMethods]);
  const showBankAccount = methodRoleByMethod.get(method.trim().toLowerCase()) === "BANK";

  const loadBase = useCallback(async () => {
    const [cust, inv, pm] = await Promise.all([
      apiGet<{ customers: Customer[] }>("/customers?limit=500&offset=0&include_inactive=true"),
      apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices?limit=500&offset=0"),
      apiGet<{ methods: PaymentMethodMapping[] }>("/config/payment-methods"),
    ]);
    setCustomers(cust.customers || []); setInvoices(inv.invoices || []); setPaymentMethods(pm.methods || []);
    try { const ba = await apiGet<{ accounts: BankAccount[] }>("/banking/accounts"); setBankAccounts((ba.accounts || []).filter((a) => a.is_active)); } catch { setBankAccounts([]); }
  }, []);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (invoiceId) qs.set("invoice_id", invoiceId);
      if (customerId) qs.set("customer_id", customerId);
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      qs.set("limit", String(PAGE_SIZE));
      qs.set("offset", String((page - 1) * PAGE_SIZE));
      const res = await apiGet<SalesPaymentsListResponse>(`/sales/payments?${qs.toString()}`);
      setPayments(res.payments || []);
      setTotalRows(Number(res.total ?? (res.payments || []).length));
      if (res.totals) {
        setTotals({ applied_usd: n(res.totals.applied_usd), applied_lbp: n(res.totals.applied_lbp), tender_usd: n(res.totals.tender_usd), tender_lbp: n(res.totals.tender_lbp), has_tender: Boolean(res.totals.has_tender) });
      } else {
        const fb = { applied_usd: 0, applied_lbp: 0, tender_usd: 0, tender_lbp: 0, has_tender: false };
        for (const p of res.payments || []) { fb.applied_usd += n(p.amount_usd); fb.applied_lbp += n(p.amount_lbp); if (hasTender(p)) { fb.has_tender = true; fb.tender_usd += n(p.tender_usd); fb.tender_lbp += n(p.tender_lbp); } }
        setTotals(fb);
      }
    } catch { setPayments([]); } finally { setLoading(false); }
  }, [invoiceId, customerId, dateFrom, dateTo, page]);

  useEffect(() => { loadBase().catch(() => {}); }, [loadBase]);
  useEffect(() => { if (qsCustomerId) setCustomerId((p) => p || qsCustomerId); if (qsInvoiceId) setInvoiceId((p) => p || qsInvoiceId); if (qsRecord === "1" && qsInvoiceId) { setPayInvoiceId(qsInvoiceId); setCreateOpen(true); } }, [qsInvoiceId, qsCustomerId, qsRecord]);
  useEffect(() => { setPage(1); }, [invoiceId, customerId, dateFrom, dateTo]);
  useEffect(() => { loadPayments(); }, [loadPayments]);
  useEffect(() => { if (!methodChoices.length) { if (method) setMethod(""); return; } if (!methodChoices.includes(method.trim().toLowerCase())) setMethod(methodChoices[0]); }, [methodChoices, method]);
  useEffect(() => { if (!showBankAccount && bankAccountId) setBankAccountId(""); }, [showBankAccount, bankAccountId]);

  const searchPayableInvoices = useCallback(async (query: string) => {
    setPayInvoicesLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "120", offset: "0", status: "posted", payable_only: "true" });
      const trimmed = query.trim(); if (trimmed) qs.set("q", trimmed);
      const res = await apiGet<{ invoices: InvoiceRow[] }>(`/sales/invoices?${qs.toString()}`);
      const opts: SearchableSelectOption[] = [{ value: "", label: "Select invoice..." }, ...(res.invoices || []).map((inv) => ({ value: inv.id, label: `${inv.invoice_no} \u00b7 ${inv.customer_name || "Walk-in"} \u00b7 ${fmtUsd(inv.total_usd)}`, keywords: `${inv.invoice_no} ${inv.id} ${inv.customer_name || ""}`.trim() }))];
      setPayInvoiceOptions(opts);
    } catch {} finally { setPayInvoicesLoading(false); }
  }, []);

  useEffect(() => { if (createOpen) void searchPayableInvoices(""); }, [createOpen, searchPayableInvoices]);

  async function createPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payInvoiceId || !method.trim()) return;
    const usd = toNum(tenderUsd), lbp = toNum(tenderLbp);
    if (usd === 0 && lbp === 0) return;
    setCreating(true);
    try {
      await apiPost<{ id: string }>("/sales/payments", { invoice_id: payInvoiceId, method: method.trim().toLowerCase(), tender_usd: usd, tender_lbp: lbp, payment_date: paymentDate || undefined, bank_account_id: bankAccountId || undefined });
      toast.success("Payment recorded", "Customer payment posted successfully.");
      setCreateOpen(false); setPayInvoiceId(""); setMethod(methodChoices[0] || ""); setTenderUsd(""); setTenderLbp(""); setBankAccountId("");
      await loadPayments();
    } catch {} finally { setCreating(false); }
  }

  const columns = useMemo<ColumnDef<SalesPaymentRow>[]>(() => [
    { id: "created_at", accessorFn: (p) => p.created_at, header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />, cell: ({ row }) => <span className="text-xs">{formatDateTime(row.original.created_at)}</span> },
    { id: "invoice", accessorFn: (p) => p.invoice_no, header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />, cell: ({ row }) => <Link href={`/sales/invoices/${row.original.invoice_id}`} className="font-mono text-sm text-teal-600 underline-offset-4 hover:underline dark:text-teal-400">{row.original.invoice_no}</Link> },
    { id: "customer", accessorFn: (p) => p.customer_name || (p.customer_id ? customerById.get(p.customer_id)?.name || p.customer_id : "Walk-in"), header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />, cell: ({ row }) => row.original.customer_name || "Walk-in" },
    { id: "method", accessorFn: (p) => fmtMethod(p.method), header: ({ column }) => <DataTableColumnHeader column={column} title="Method" />, cell: ({ row }) => <span className="text-xs">{fmtMethod(row.original.method)}</span> },
    { id: "usd", accessorFn: (p) => hasTender(p) ? n(p.tender_usd) : n(p.amount_usd), header: ({ column }) => <DataTableColumnHeader column={column} title="USD" />, cell: ({ row }) => { const p = row.original; const show = hasTender(p) ? n(p.tender_usd) : n(p.amount_usd); return <CurrencyDisplay amount={show} currency="USD" />; } },
    { id: "lbp", accessorFn: (p) => hasTender(p) ? n(p.tender_lbp) : n(p.amount_lbp), header: ({ column }) => <DataTableColumnHeader column={column} title="LBP" />, cell: ({ row }) => { const p = row.original; const show = hasTender(p) ? n(p.tender_lbp) : n(p.amount_lbp); return <CurrencyDisplay amount={show} currency="LBP" />; } },
  ], [customerById]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Sales Payments"
        description={`Record and review customer payment activity \u2014 ${totalRows.toLocaleString("en-US")} payments`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => { loadBase(); loadPayments(); }} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" /> Record Payment</Button></DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Record Customer Payment</DialogTitle><DialogDescription>Posts GL: Dr Cash/Bank, Cr AR.</DialogDescription></DialogHeader>
                <form onSubmit={createPayment} className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2"><label className="text-xs font-medium text-muted-foreground">Invoice</label><SearchableSelect value={payInvoiceId} onChange={setPayInvoiceId} placeholder="Select invoice..." searchPlaceholder="Search invoices..." maxOptions={120} loading={payInvoicesLoading} onSearchQueryChange={searchPayableInvoices} options={payInvoiceOptions} /></div>
                  <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Method</label><select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={method} onChange={(e) => setMethod(e.target.value)}>{!methodChoices.length ? <option value="">(no methods)</option> : null}{methodChoices.map((m) => <option key={m} value={m}>{fmtMethod(m)}</option>)}</select></div>
                  <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Payment Date</label><Input value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} type="date" /></div>
                  {showBankAccount && <div className="space-y-1 sm:col-span-2"><label className="text-xs font-medium text-muted-foreground">Bank Account</label><select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}><option value="">(none)</option>{bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></div>}
                  <MoneyInput label="Amount Received" currency="USD" value={tenderUsd} onChange={setTenderUsd} placeholder="0" quick={[0, 1, 10]} disabled={creating} />
                  <MoneyInput label="Amount Received" currency="LBP" displayCurrency="LBP" value={tenderLbp} onChange={setTenderLbp} placeholder="0" quick={[0, 1, 10]} disabled={creating} />
                  <div className="flex justify-end sm:col-span-2"><Button type="submit" disabled={creating || !methodChoices.length}>{creating ? "..." : "Post Payment"}</Button></div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Applied USD</CardTitle></CardHeader><CardContent><CurrencyDisplay amount={totals.applied_usd} currency="USD" className="text-2xl font-semibold" /></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Applied LBP</CardTitle></CardHeader><CardContent><CurrencyDisplay amount={totals.applied_lbp} currency="LBP" className="text-2xl font-semibold" /></CardContent></Card>
        {totals.has_tender && <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Tender USD</CardTitle></CardHeader><CardContent><CurrencyDisplay amount={totals.tender_usd} currency="USD" className="text-2xl font-semibold" /></CardContent></Card>}
        {totals.has_tender && <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Tender LBP</CardTitle></CardHeader><CardContent><CurrencyDisplay amount={totals.tender_lbp} currency="LBP" className="text-2xl font-semibold" /></CardContent></Card>}
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <SearchableSelect value={customerId} onChange={setCustomerId} placeholder="All Customers" searchPlaceholder="Search customers..." options={[{ value: "", label: "All" }, ...customers.map((c) => ({ value: c.id, label: c.name }))]} />
            <SearchableSelect value={invoiceId} onChange={setInvoiceId} placeholder="All Invoices" searchPlaceholder="Search invoices..." maxOptions={120} options={[{ value: "", label: "All" }, ...invoices.slice(0, 2000).map((i) => ({ value: i.id, label: i.invoice_no, keywords: `${i.invoice_no} ${i.id}` }))]} />
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="From" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="To" />
          </div>
        </CardContent>
      </Card>

      {!loading && payments.length === 0 ? (
        <EmptyState title="No payments" description="No customer payments match your filters." action={{ label: "Refresh", onClick: loadPayments }} />
      ) : (
        <DataTable columns={columns} data={payments} isLoading={loading} searchPlaceholder="Search invoice, customer, method..." totalRows={totalRows} toolbarActions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
            <span className="text-xs text-muted-foreground">Page {page}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page * PAGE_SIZE >= totalRows}>Next</Button>
          </div>
        } />
      )}
    </div>
  );
}

export default function SalesPaymentsPage() {
  return (
    <Suspense fallback={<div className="px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <SalesPaymentsInner />
    </Suspense>
  );
}
