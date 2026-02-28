"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  payment_status?: string | null;
  paid_usd?: string | number;
  paid_lbp?: string | number;
  credited_usd?: string | number;
  credited_lbp?: string | number;
  outstanding_usd?: string | number;
  outstanding_lbp?: string | number;
  sales_channel?: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  invoice_date?: string;
  due_date?: string | null;
  created_at: string;
};

function toNum(v: unknown, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function derivePaymentStatus(inv: InvoiceRow): string {
  const raw = String(inv.payment_status || "").trim().toLowerCase();
  if (["paid", "unpaid", "partially_paid", "canceled", "not_posted"].includes(raw)) return raw;
  const doc = inv.status?.toLowerCase();
  if (doc === "canceled") return "canceled";
  if (doc !== "posted") return "not_posted";
  if (toNum(inv.outstanding_usd) <= 0.00005 && toNum(inv.outstanding_lbp) <= 0.005) return "paid";
  const hasPayment = toNum(inv.paid_usd) > 0.00005 || toNum(inv.paid_lbp) > 0.005
    || toNum(inv.credited_usd) > 0.00005 || toNum(inv.credited_lbp) > 0.005;
  return hasPayment ? "partially_paid" : "unpaid";
}

function sourceLabel(ch: unknown) {
  const v = String(ch || "").trim().toLowerCase();
  return v === "pos" ? "POS" : v === "import" ? "Import" : v === "api" ? "API" : "Admin";
}

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "canceled", label: "Cancelled" },
] as const;

export default function SalesInvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await apiGet<{ invoices: InvoiceRow[]; total?: number }>(`/sales/invoices?${params}`);
      setInvoices(res.invoices || []);
      setTotal(typeof res.total === "number" ? res.total : null);
    } catch {
      setInvoices([]);
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo<ColumnDef<InvoiceRow>[]>(() => [
    {
      accessorKey: "invoice_no",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice #" />,
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.invoice_no || "(draft)"}</span>
      ),
    },
    {
      id: "customer",
      accessorFn: (r) => r.customer_name || r.customer_id || "Walk-in",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
      cell: ({ row }) => row.original.customer_name || "Walk-in",
    },
    {
      id: "invoice_date",
      accessorFn: (r) => r.invoice_date || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
      cell: ({ row }) => formatDate(row.original.invoice_date),
    },
    {
      id: "due_date",
      accessorFn: (r) => r.due_date || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Due Date" />,
      cell: ({ row }) => formatDate(row.original.due_date),
    },
    {
      id: "status",
      accessorFn: (r) => r.status,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "payment_status",
      accessorFn: (r) => derivePaymentStatus(r),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Payment" />,
      cell: ({ row }) => <StatusBadge status={derivePaymentStatus(row.original)} />,
    },
    {
      id: "source",
      accessorFn: (r) => sourceLabel(r.sales_channel),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">{sourceLabel(row.original.sales_channel)}</Badge>
      ),
    },
    {
      id: "total_usd",
      accessorFn: (r) => toNum(r.total_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total USD" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.total_usd)} currency="USD" />,
    },
    {
      id: "total_lbp",
      accessorFn: (r) => toNum(r.total_lbp),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total LBP" />,
      cell: ({ row }) => <CurrencyDisplay amount={toNum(row.original.total_lbp)} currency="LBP" />,
    },
  ], []);

  const subtitle = total != null
    ? `${total.toLocaleString("en-US")} invoices`
    : `${invoices.length} invoices`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Sales Invoices"
        description={`Manage and track sales invoices \u2014 ${subtitle}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => router.push("/sales/invoices/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Draft
            </Button>
          </>
        }
      />

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {t.value === statusFilter && total != null ? (
                <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-medium">
                  {total.toLocaleString("en-US")}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {STATUS_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            <DataTable
              columns={columns}
              data={invoices}
              isLoading={loading}
              searchPlaceholder="Search invoice #, customer..."
              onRowClick={(row) => router.push(`/sales/invoices/${row.id}`)}
              totalRows={total ?? undefined}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
