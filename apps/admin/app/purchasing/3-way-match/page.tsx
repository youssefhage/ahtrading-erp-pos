"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ExceptionSummary = {
  flags_total: number;
  unit_cost_flags: number;
  qty_flags: number;
  tax_flags: number;
};

type ExceptionRow = {
  id: string;
  invoice_no: string | null;
  supplier_ref: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  goods_receipt_id: string | null;
  goods_receipt_no: string | null;
  hold_reason: string | null;
  held_at: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  invoice_date: string | null;
  due_date: string | null;
  summary?: ExceptionSummary;
};

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

export default function ThreeWayMatchPage() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ExceptionRow[]>([]);

  const [unholdOpen, setUnholdOpen] = useState(false);
  const [unholdReason, setUnholdReason] = useState("");
  const [unholdId, setUnholdId] = useState<string>("");
  const [unholding, setUnholding] = useState(false);

  const query = useMemo(() => q.trim(), [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      params.set("limit", "200");
      const res = await apiGet<{ exceptions: ExceptionRow[] }>(`/purchases/invoices/exceptions?${params.toString()}`);
      setRows(res.exceptions || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = window.setTimeout(() => load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const doUnhold = useCallback(async () => {
    if (!unholdId) return;
    setUnholding(true);
    setStatus("Unholding...");
    try {
      await apiPost(`/purchases/invoices/${encodeURIComponent(unholdId)}/unhold`, {
        reason: unholdReason.trim() || null,
      });
      setUnholdOpen(false);
      setUnholdReason("");
      setUnholdId("");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setUnholding(false);
    }
  }, [load, unholdId, unholdReason]);

  const columns = useMemo((): Array<DataTableColumn<ExceptionRow>> => {
    return [
      {
        id: "invoice",
        header: "Invoice",
        sortable: true,
        accessor: (r) => r.invoice_no || r.id,
        cell: (r) => (
          <div>
            <div className="data-mono text-xs">
              <ShortcutLink href={`/purchasing/supplier-invoices/${encodeURIComponent(r.id)}`} title="Open supplier invoice">
                {r.invoice_no || "(draft)"}
              </ShortcutLink>
            </div>
            <div className="text-xs text-fg-subtle">
              {r.hold_reason ? (
                <span className="ui-chip ui-chip-warning">
                  HOLD: {r.hold_reason}
                </span>
              ) : (
                <span className="ui-chip ui-chip-warning">
                  HOLD
                </span>
              )}
            </div>
            {r.supplier_ref ? <div className="data-mono text-xs text-fg-muted">Ref: {r.supplier_ref}</div> : null}
          </div>
        ),
      },
      {
        id: "supplier",
        header: "Supplier",
        sortable: true,
        accessor: (r) => `${r.supplier_name || ""} ${r.supplier_id || ""}`,
        cell: (r) => (
          <span className="text-xs text-fg-muted">
            {r.supplier_id ? (
              <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(r.supplier_id)}`} title="Open supplier">
                {r.supplier_name || r.supplier_id}
              </ShortcutLink>
            ) : (
              r.supplier_name || "-"
            )}
          </span>
        ),
      },
      {
        id: "receipt",
        header: "Receipt",
        sortable: true,
        mono: true,
        accessor: (r) => r.goods_receipt_no || r.goods_receipt_id || "",
        cell: (r) =>
          r.goods_receipt_id ? (
            <ShortcutLink href={`/purchasing/goods-receipts/${encodeURIComponent(r.goods_receipt_id)}`} title="Open goods receipt">
              {r.goods_receipt_no || r.goods_receipt_id.slice(0, 8)}
            </ShortcutLink>
          ) : (
            <span className="data-mono text-xs">{r.goods_receipt_no || "-"}</span>
          ),
      },
      {
        id: "dates",
        header: "Dates",
        sortable: true,
        accessor: (r) => `${r.invoice_date || ""} ${r.due_date || ""} ${r.held_at || ""}`,
        cell: (r) => (
          <div className="text-xs text-fg-muted">
            <div>
              Inv: <span className="data-mono">{fmtIso(r.invoice_date)}</span>
            </div>
            <div className="text-fg-subtle">
              Due: <span className="data-mono">{fmtIso(r.due_date)}</span>
            </div>
            <div className="text-fg-subtle">
              Held: <span className="data-mono">{fmtIso(r.held_at)}</span>
            </div>
          </div>
        ),
      },
      {
        id: "variance",
        header: "Variance",
        sortable: true,
        accessor: (r) => Number(r.summary?.flags_total || 0),
        cell: (r) => {
          const s = r.summary;
          return (
            <div className="text-xs text-fg-muted">
              {s ? (
                <div className="flex flex-wrap gap-1.5">
                  <span className="ui-chip ui-chip-default">
                    total <span className="data-mono">{Number(s.flags_total || 0)}</span>
                  </span>
                  {s.unit_cost_flags ? (
                    <span className="ui-chip ui-chip-warning">
                      cost <span className="data-mono">{Number(s.unit_cost_flags || 0)}</span>
                    </span>
                  ) : null}
                  {s.qty_flags ? (
                    <span className="ui-chip ui-chip-warning">
                      qty <span className="data-mono">{Number(s.qty_flags || 0)}</span>
                    </span>
                  ) : null}
                  {s.tax_flags ? (
                    <span className="ui-chip ui-chip-warning">
                      tax <span className="data-mono">{Number(s.tax_flags || 0)}</span>
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className="text-fg-subtle">-</span>
              )}
            </div>
          );
        },
      },
      {
        id: "total_usd",
        header: "Total USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_usd || 0),
        cell: (r) => <span className="data-mono text-sm ui-tone-usd">{fmtUsd(r.total_usd)}</span>,
      },
      {
        id: "total_lbp",
        header: "Total LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_lbp || 0),
        cell: (r) => <span className="data-mono text-sm ui-tone-lbp">{fmtLbp(r.total_lbp)}</span>,
      },
      {
        id: "actions",
        header: "Actions",
        sortable: false,
        align: "right",
        accessor: (r) => r.id,
        cell: (r) => (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push(`/purchasing/supplier-invoices/${r.id}`)}>
              View
            </Button>
            <Dialog
              open={unholdOpen && unholdId === r.id}
              onOpenChange={(v) => {
                setUnholdOpen(v);
                if (v) setUnholdId(r.id);
                else {
                  setUnholdId("");
                  setUnholdReason("");
                }
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm">Unhold</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Unhold Supplier Invoice</DialogTitle>
                  <DialogDescription>
                    This will allow the invoice to be posted. Add an optional note for audit trail.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
                  <Input value={unholdReason} onChange={(e) => setUnholdReason(e.target.value)} placeholder="Approved variance / verified receipt..." />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setUnholdOpen(false);
                      setUnholdId("");
                      setUnholdReason("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={doUnhold} disabled={unholding}>
                    {unholding ? "..." : "Unhold"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        ),
      },
    ];
  }, [doUnhold, router, unholdId, unholdOpen, unholdReason, unholding]);

  return (
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Purchasing</p>
            <h1 className="ui-module-title">3-Way Match Exceptions</h1>
            <p className="ui-module-subtitle">Held supplier invoices with quantity, cost, or tax variance signals.</p>
          </div>
        </div>
      </div>
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>3-Way Match Exceptions</CardTitle>
          <CardDescription>Draft supplier invoices placed on hold due to AP variance detection. Unhold to allow posting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable<ExceptionRow>
            tableId="purchasing.3way.exceptions"
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            isLoading={loading}
            emptyText={loading ? "Loading..." : "No hold exceptions found."}
            globalFilterValue={q}
            onGlobalFilterValueChange={setQ}
            globalFilterPlaceholder="Search invoice / supplier / receipt / ref..."
            initialSort={{ columnId: "invoice", dir: "desc" }}
            actions={
              <Button variant="outline" onClick={load} disabled={loading}>
                {loading ? "..." : "Refresh"}
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
