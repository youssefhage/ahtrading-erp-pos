"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

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
};

type AiRecRow = {
  id: string;
  agent_code: string;
  status: string;
  recommendation_json: any;
  created_at: string;
};

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

function SupplierInvoicesListInner() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiApGuard, setAiApGuard] = useState<AiRecRow[]>([]);

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

      const res = await apiGet<{ invoices: InvoiceRow[]; total?: number }>(`/purchases/invoices?${params.toString()}`);
      setInvoices(res.invoices || []);
      setTotal(typeof res.total === "number" ? res.total : null);

      // AI is optional: don't block the list if the user lacks ai:read.
      try {
        const ai = await apiGet<{ recommendations: AiRecRow[] }>("/ai/recommendations?status=pending&agent_code=AI_AP_GUARD&limit=12");
        setAiApGuard(ai.recommendations || []);
      } catch {
        setAiApGuard([]);
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [query.limit, query.offset, query.q, query.status]);

  useEffect(() => {
    setPage(0);
  }, [q, statusFilter, pageSize]);

  useEffect(() => {
    const t = window.setTimeout(() => load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const canPrev = page > 0;
  const canNext = total == null ? invoices.length === pageSize : offset + invoices.length < total;

  const aiHold = aiApGuard.filter((r) => (r as any)?.recommendation_json?.kind === "supplier_invoice_hold");
  const aiDue = aiApGuard.filter((r) => (r as any)?.recommendation_json?.kind === "supplier_invoice_due_soon");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>API errors will show here.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
          </CardContent>
        </Card>
      ) : null}

      {aiApGuard.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI: AP Guard</CardTitle>
            <CardDescription>
              {aiHold.length ? `${aiHold.length} on hold` : "0 on hold"} · {aiDue.length ? `${aiDue.length} due soon` : "0 due soon"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Detail</th>
                    <th className="px-3 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {aiApGuard.slice(0, 8).map((r) => {
                    const j = (r as any).recommendation_json || {};
                    const kind = String(j.kind || "");
                    return (
                      <tr key={r.id} className="border-t border-border-subtle align-top">
                        <td className="px-3 py-2 font-mono text-xs text-fg-muted">{kind || "-"}</td>
                        <td className="px-3 py-2">
                          <div className="data-mono text-xs text-foreground">{j.invoice_no || "(draft)"}</div>
                          {j.supplier_ref ? <div className="data-mono text-[10px] text-fg-subtle">Ref: {j.supplier_ref}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-xs">{j.supplier_name || j.supplier_id || "-"}</td>
                        <td className="px-3 py-2 text-xs text-fg-muted">
                          {kind === "supplier_invoice_hold" ? (
                            <span>{j.hold_reason || "On hold"}</span>
                          ) : kind === "supplier_invoice_due_soon" ? (
                            <span>
                              Due: <span className="font-mono text-xs">{fmtIso(j.due_date)}</span> · Outstanding USD{" "}
                              <span className="font-mono text-xs">{String(j.outstanding_usd || "0")}</span>
                            </span>
                          ) : (
                            <span className="font-mono text-xs">{j.key || "-"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-fg-muted">{r.created_at}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <a href="/automation/ai-hub">Open AI Hub</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full md:w-96">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doc no / supplier ref / supplier / GR..." />
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
          <Button onClick={() => router.push("/purchasing/supplier-invoices/new")}>New Draft</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Supplier Invoices</CardTitle>
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
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">GR</th>
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
                    onClick={() => router.push(`/purchasing/supplier-invoices/${inv.id}`)}
                  >
                    <td className="px-3 py-2">
                      <div className="data-mono text-xs text-foreground">{inv.invoice_no || "(draft)"}</div>
                      {inv.supplier_ref ? <div className="data-mono text-[10px] text-fg-subtle">Ref: {inv.supplier_ref}</div> : null}
                      <div className="data-mono text-[10px] text-fg-subtle">{inv.id}</div>
                    </td>
                    <td className="px-3 py-2">{inv.supplier_name || inv.supplier_id || "-"}</td>
                    <td className="px-3 py-2 data-mono text-xs">{inv.goods_receipt_no || "-"}</td>
                    <td className="px-3 py-2">
                      <StatusChip value={inv.status} />
                      {inv.is_on_hold ? (
                        <div className="mt-1">
                          <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-200">
                            HOLD{inv.hold_reason ? `: ${inv.hold_reason}` : ""}
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      <div>
                        Inv: <span className="data-mono">{fmtIso(inv.invoice_date)}</span>
                      </div>
                      <div className="text-fg-subtle">
                        Due: <span className="data-mono">{fmtIso(inv.due_date)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right data-mono text-xs">{fmtUsd(inv.total_usd)}</td>
                    <td className="px-3 py-2 text-right data-mono text-xs">{fmtLbp(inv.total_lbp)}</td>
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

export default function SupplierInvoicesListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <SupplierInvoicesListInner />
    </Suspense>
  );
}
