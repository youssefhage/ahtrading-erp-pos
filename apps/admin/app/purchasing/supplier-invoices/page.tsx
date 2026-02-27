"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Plus, RefreshCw, Paperclip } from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtUsd, fmtLbp } from "@/lib/money";
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
  invoice_no: string;
  supplier_ref?: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  goods_receipt_id?: string | null;
  goods_receipt_no?: string | null;
  is_on_hold?: boolean;
  hold_reason?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  tax_code_id?: string | null;
  invoice_date: string;
  due_date: string;
  created_at: string;
  attachment_count?: number;
};

function toNum(v: unknown, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "canceled", label: "Canceled" },
] as const;

function SupplierInvoicesInner() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(pagination.pageSize));
      params.set("offset", String(pagination.pageIndex * pagination.pageSize));
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await apiGet<{ invoices: InvoiceRow[]; total?: number }>(`/purchases/invoices?${params}`);
      setInvoices(res.invoices || []);
      setTotal(typeof res.total === "number" ? res.total : null);
    } catch {
      setInvoices([]);
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, pagination]);

  useEffect(() => { setPagination((p) => ({ ...p, pageIndex: 0 })); }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  const pageCount = total != null ? Math.ceil(total / pagination.pageSize) : undefined;
  const subtitle = total != null
    ? `${total.toLocaleString("en-US")} invoices`
    : `${invoices.length} invoices`;

  const columns = useMemo<ColumnDef<InvoiceRow>[]>(() => [
    {
      accessorKey: "invoice_no",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice #" />,
      cell: ({ row }) => {
        const inv = row.original;
        return (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium">{inv.invoice_no || "(draft)"}</span>
              {Number(inv.attachment_count || 0) > 0 && (
                <Badge variant="outline" className="gap-1 px-1.5 py-0 text-xs">
                  <Paperclip className="h-3 w-3" />
                  {inv.attachment_count}
                </Badge>
              )}
            </div>
            {inv.supplier_ref && (
              <div className="font-mono text-xs text-muted-foreground">Ref: {inv.supplier_ref}</div>
            )}
          </div>
        );
      },
    },
    {
      id: "supplier",
      accessorFn: (r) => r.supplier_name || r.supplier_id || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => row.original.supplier_name || row.original.supplier_id || "-",
    },
    {
      id: "gr",
      accessorFn: (r) => r.goods_receipt_no || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="GR" />,
      cell: ({ row }) => {
        const inv = row.original;
        return inv.goods_receipt_no || inv.goods_receipt_id?.slice(0, 8) || "-";
      },
    },
    {
      id: "status",
      accessorFn: (r) => r.status,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => {
        const inv = row.original;
        return (
          <div className="flex flex-col gap-1">
            <StatusBadge status={inv.status} />
            {inv.is_on_hold && (
              <Badge variant="warning" className="text-xs">
                HOLD{inv.hold_reason ? `: ${inv.hold_reason}` : ""}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      id: "dates",
      accessorFn: (r) => r.invoice_date || "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Dates" />,
      cell: ({ row }) => {
        const inv = row.original;
        return (
          <div className="text-xs text-muted-foreground">
            <div>Inv: {formatDate(inv.invoice_date)}</div>
            <div>Due: {formatDate(inv.due_date)}</div>
          </div>
        );
      },
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Supplier Invoices"
        description={subtitle}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => router.push("/purchasing/supplier-invoices/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Draft
            </Button>
          </>
        }
      />

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {STATUS_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            <DataTable
              columns={columns}
              data={invoices}
              isLoading={loading}
              searchPlaceholder="Search invoice, supplier, GR..."
              onRowClick={(row) => router.push(`/purchasing/supplier-invoices/${row.id}`)}
              manualPagination
              pageCount={pageCount}
              totalRows={total ?? undefined}
              pageSize={pagination.pageSize}
              onPaginationChange={setPagination}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default function SupplierInvoicesPage() {
  return (
    <Suspense fallback={<div className="px-6 py-10 text-sm text-muted-foreground">Loading...</div>}>
      <SupplierInvoicesInner />
    </Suspense>
  );
}
