"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DataTableTabs } from "@/components/data-table-tabs";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  sales_channel?: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  invoice_date?: string;
  due_date?: string | null;
  created_at: string;
};

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

function normalizeSalesChannel(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "pos" || raw === "admin" || raw === "import" || raw === "api") return raw;
  return "admin";
}

function salesChannelLabel(value: unknown) {
  const channel = normalizeSalesChannel(value);
  if (channel === "pos") return "POS";
  if (channel === "import") return "Import";
  if (channel === "api") return "API";
  return "Admin";
}

function salesChannelTone(value: unknown) {
  const channel = normalizeSalesChannel(value);
  if (channel === "pos") return "ui-chip-primary";
  if (channel === "import") return "ui-chip-warning";
  if (channel === "api") return "ui-chip-success";
  return "ui-chip-default";
}

function SalesInvoicesListInner() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [salesChannelFilter, setSalesChannelFilter] = useState<string>("");

  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  const offset = page * pageSize;

  const query = useMemo(
    () => ({ q: q.trim(), status: statusFilter, sales_channel: salesChannelFilter, limit: pageSize, offset }),
    [q, statusFilter, salesChannelFilter, pageSize, offset]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(query.limit));
      params.set("offset", String(query.offset));
      if (query.q) params.set("q", query.q);
      if (query.status) params.set("status", query.status);
      if (query.sales_channel) params.set("sales_channel", query.sales_channel);

      const res = await apiGet<{ invoices: InvoiceRow[]; total?: number }>(`/sales/invoices?${params.toString()}`);
      setInvoices(res.invoices || []);
      setTotal(typeof res.total === "number" ? res.total : null);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [query.limit, query.offset, query.q, query.status, query.sales_channel]);

  // Reset to page 1 whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [q, statusFilter, salesChannelFilter, pageSize]);

  // Debounce typing for server search.
  useEffect(() => {
    const t = window.setTimeout(() => load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const canPrev = page > 0;
  const canNext = total == null ? invoices.length === pageSize : offset + invoices.length < total;

  const columns = useMemo((): Array<DataTableColumn<InvoiceRow>> => {
    return [
      {
        id: "invoice",
        header: "Invoice",
        globalSearch: true,
        cell: (inv) => (
          <div>
            <div className="data-mono text-sm text-foreground">
              <ShortcutLink href={`/sales/invoices/${encodeURIComponent(inv.id)}`} title="Open invoice">
                {inv.invoice_no || "(draft)"}
              </ShortcutLink>
            </div>
          </div>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        accessor: (inv) => inv.customer_name || inv.customer_id || "",
        cell: (inv) =>
          inv.customer_id ? (
            <ShortcutLink href={`/partners/customers/${encodeURIComponent(inv.customer_id)}`} title="Open customer">
              {inv.customer_name || inv.customer_id}
            </ShortcutLink>
          ) : (
            "Walk-in"
          ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        accessor: (inv) => inv.warehouse_name || inv.warehouse_id || "",
        cell: (inv) => inv.warehouse_name || inv.warehouse_id || "-",
      },
      {
        id: "status",
        header: "Status",
        accessor: (inv) => inv.status,
        cell: (inv) => <StatusChip value={inv.status} />,
      },
      {
        id: "source",
        header: "Source",
        accessor: (inv) => normalizeSalesChannel(inv.sales_channel),
        cell: (inv) => (
          <span className={`ui-chip px-2 py-0.5 text-xs uppercase tracking-wide ${salesChannelTone(inv.sales_channel)}`}>
            {salesChannelLabel(inv.sales_channel)}
          </span>
        ),
      },
      {
        id: "dates",
        header: "Dates",
        accessor: (inv) => `${inv.invoice_date || ""} ${inv.due_date || ""}`,
        cell: (inv) => (
          <div className="text-sm text-fg-muted">
            <div>
              Inv: <span className="data-mono">{fmtIso(inv.invoice_date)}</span>
            </div>
            <div className="text-fg-subtle">
              Due: <span className="data-mono">{fmtIso(inv.due_date)}</span>
            </div>
          </div>
        ),
      },
      {
        id: "total_usd",
        header: "Total USD",
        accessor: (inv) => inv.total_usd,
        sortable: true,
        align: "right",
        mono: true,
        cellClassName: "ui-tone-usd",
        cell: (inv) => fmtUsd(inv.total_usd),
      },
      {
        id: "total_lbp",
        header: "Total LL",
        accessor: (inv) => inv.total_lbp,
        sortable: true,
        align: "right",
        mono: true,
        cellClassName: "ui-tone-lbp",
        cell: (inv) => fmtLbp(inv.total_lbp),
      },
    ];
  }, []);

  return (
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Sales</p>
            <h1 className="ui-module-title">Sales Invoices</h1>
            <p className="ui-module-subtitle">
              {total != null ? `${total.toLocaleString("en-US")} total invoices` : `${invoices.length} invoices shown`}
              {loading ? " · refreshing..." : ""}
            </p>
          </div>
          <div className="ui-module-actions">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </Button>
            <Button size="sm" onClick={() => router.push("/sales/invoices/new")}>
              New Draft
            </Button>
          </div>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>
            {total != null ? `${total.toLocaleString("en-US")} total` : `${invoices.length} shown`}
            {loading ? " · refreshing..." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable
            tableId="sales.invoices"
            rows={invoices}
            columns={columns}
            onRowClick={(inv) => router.push(`/sales/invoices/${inv.id}`)}
            emptyText="No invoices."
            isLoading={loading}
            headerSlot={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <DataTableTabs
                  value={statusFilter || "all"}
                  onChange={(v) => setStatusFilter(v === "all" ? "" : v)}
                  tabs={[
                    { value: "all", label: "All" },
                    { value: "draft", label: "Draft" },
                    { value: "posted", label: "Posted" },
                    { value: "canceled", label: "Canceled" },
                  ]}
                />
                <select
                  className="ui-select h-9 min-w-[140px]"
                  value={salesChannelFilter || "all"}
                  onChange={(e) => setSalesChannelFilter(e.target.value === "all" ? "" : e.target.value)}
                  title="Invoice source"
                >
                  <option value="all">All Sources</option>
                  <option value="pos">POS</option>
                  <option value="admin">Admin</option>
                  <option value="import">Import</option>
                  <option value="api">API</option>
                </select>
              </div>
            }
            globalFilterPlaceholder="Search invoice / customer / warehouse..."
            globalFilterValue={q}
            onGlobalFilterValueChange={setQ}
            serverPagination={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: setPageSize,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function SalesInvoicesListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <SalesInvoicesListInner />
    </Suspense>
  );
}
