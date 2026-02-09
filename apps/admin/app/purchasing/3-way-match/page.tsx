"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
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

  async function doUnhold() {
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
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-full md:w-[520px]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice / supplier / receipt / ref..." />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>3-Way Match Exceptions</CardTitle>
          <CardDescription>
            Draft supplier invoices placed on hold due to AP variance detection. Unhold to allow posting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Receipt</th>
                  <th className="px-3 py-2">Dates</th>
                  <th className="px-3 py-2">Variance</th>
                  <th className="px-3 py-2 text-right">Total USD</th>
                  <th className="px-3 py-2 text-right">Total LL</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={loading ? "opacity-70" : ""}>
                {rows.map((r) => {
                  const s = r.summary;
                  return (
                    <tr key={r.id} className="ui-tr ui-tr-hover">
                      <td className="px-3 py-2">
                        <div className="data-mono text-xs">
                          <ShortcutLink href={`/purchasing/supplier-invoices/${encodeURIComponent(r.id)}`} title="Open supplier invoice">
                            {r.invoice_no || "(draft)"}
                          </ShortcutLink>
                        </div>
                        <div className="text-[11px] text-fg-subtle">
                          {r.hold_reason ? (
                            <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-medium text-warning">
                              HOLD: {r.hold_reason}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-medium text-warning">
                              HOLD
                            </span>
                          )}
                        </div>
                        {r.supplier_ref ? <div className="data-mono text-[10px] text-fg-muted">Ref: {r.supplier_ref}</div> : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        {r.supplier_id ? (
                          <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(r.supplier_id)}`} title="Open supplier">
                            {r.supplier_name || r.supplier_id}
                          </ShortcutLink>
                        ) : (
                          r.supplier_name || "-"
                        )}
                      </td>
                      <td className="px-3 py-2 data-mono text-xs">
                        {r.goods_receipt_id ? (
                          <ShortcutLink href={`/purchasing/goods-receipts/${encodeURIComponent(r.goods_receipt_id)}`} title="Open goods receipt">
                            {r.goods_receipt_no || r.goods_receipt_id.slice(0, 8)}
                          </ShortcutLink>
                        ) : (
                          r.goods_receipt_no || "-"
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        <div>
                          Inv: <span className="data-mono">{fmtIso(r.invoice_date)}</span>
                        </div>
                        <div className="text-fg-subtle">
                          Due: <span className="data-mono">{fmtIso(r.due_date)}</span>
                        </div>
                        <div className="text-fg-subtle">
                          Held: <span className="data-mono">{fmtIso(r.held_at)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
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
                      </td>
                      <td className="px-3 py-2 text-right data-mono text-xs ui-tone-usd">{fmtUsd(r.total_usd)}</td>
                      <td className="px-3 py-2 text-right data-mono text-xs ui-tone-lbp">{fmtLbp(r.total_lbp)}</td>
                      <td className="px-3 py-2 text-right">
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
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-fg-subtle" colSpan={8}>
                      No exceptions.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

