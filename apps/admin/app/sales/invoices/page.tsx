"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
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

function SalesInvoicesListInner() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  const offset = page * pageSize;

  const query = useMemo(() => ({ q: q.trim(), status: statusFilter, limit: pageSize, offset }), [q, statusFilter, pageSize, offset]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(query.limit));
      params.set("offset", String(query.offset));
      if (query.q) params.set("q", query.q);
      if (query.status) params.set("status", query.status);

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
  }, [query.limit, query.offset, query.q, query.status]);

  // Reset to page 1 whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [q, statusFilter, pageSize]);

  // Debounce typing for server search.
  useEffect(() => {
    const t = window.setTimeout(() => load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const canPrev = page > 0;
  const canNext = total == null ? invoices.length === pageSize : offset + invoices.length < total;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full md:w-96">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice / customer / warehouse..." />
          </div>
          <select className="ui-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="posted">Posted</option>
            <option value="canceled">Canceled</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
          <Button onClick={() => router.push("/sales/invoices/new")}>New Draft</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sales Invoices</CardTitle>
          <CardDescription>
            {total != null ? `${total.toLocaleString("en-US")} total` : `${invoices.length} shown`}
            {loading ? " · refreshing..." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Warehouse</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Dates</th>
                  <th className="px-3 py-2 text-right">Total USD</th>
                  <th className="px-3 py-2 text-right">Total LL</th>
                </tr>
              </thead>
              <tbody className={loading ? "opacity-70" : ""}>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="ui-tr ui-tr-hover cursor-pointer"
                    onClick={() => router.push(`/sales/invoices/${inv.id}`)}
                  >
                    <td className="px-3 py-2">
                      <div className="data-mono text-xs text-foreground">
                        <ShortcutLink href={`/sales/invoices/${encodeURIComponent(inv.id)}`} title="Open invoice">
                          {inv.invoice_no || "(draft)"}
                        </ShortcutLink>
                      </div>
                      <div className="data-mono text-[10px] text-fg-subtle">{inv.id}</div>
                    </td>
                    <td className="px-3 py-2">
                      {inv.customer_id ? (
                        <ShortcutLink href={`/partners/customers/${encodeURIComponent(inv.customer_id)}`} title="Open customer">
                          {inv.customer_name || inv.customer_id}
                        </ShortcutLink>
                      ) : (
                        "Walk-in"
                      )}
                    </td>
                    <td className="px-3 py-2">{inv.warehouse_name || inv.warehouse_id || "-"}</td>
                    <td className="px-3 py-2">
                      <StatusChip value={inv.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      <div>
                        Inv: <span className="data-mono">{fmtIso(inv.invoice_date)}</span>
                      </div>
                      <div className="text-fg-subtle">
                        Due: <span className="data-mono">{fmtIso(inv.due_date)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right data-mono text-xs ui-tone-usd">
                      {fmtUsd(inv.total_usd)}
                    </td>
                    <td className="px-3 py-2 text-right data-mono text-xs ui-tone-lbp">
                      {fmtLbp(inv.total_lbp)}
                    </td>
                  </tr>
                ))}
                {invoices.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-fg-subtle" colSpan={7}>
                      No invoices.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-fg-muted">
              Page <span className="data-mono">{page + 1}</span>
              {total != null ? (
                <>
                  {" "}
                  · Showing{" "}
                  <span className="data-mono">
                    {Math.min(total, offset + 1).toLocaleString("en-US")}–{Math.min(total, offset + invoices.length).toLocaleString("en-US")}
                  </span>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <select className="ui-select" value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value || 50))}>
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </select>
              <Button variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={!canPrev || loading}>
                Prev
              </Button>
              <Button variant="outline" onClick={() => setPage((p) => p + 1)} disabled={!canNext || loading}>
                Next
              </Button>
            </div>
          </div>
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
