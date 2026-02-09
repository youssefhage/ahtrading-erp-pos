"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { fmtUsd } from "@/lib/money";

import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ReceiptRow = {
  id: string;
  receipt_no: string | null;
  supplier_name?: string | null;
  warehouse_name?: string | null;
  total_usd?: string | number;
  created_at: string;
  status: string;
};

type Line = { description: string; amount_usd: string; amount_lbp: string };

function toNum(s: string) {
  const r = parseNumberInput(s);
  return r.ok ? r.value : 0;
}

function Inner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);

  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [goodsReceiptId, setGoodsReceiptId] = useState("");
  const [memo, setMemo] = useState("");
  const [exchangeRate, setExchangeRate] = useState("90000");
  const [lines, setLines] = useState<Line[]>([{ description: "Freight", amount_usd: "", amount_lbp: "" }]);
  const [submitting, setSubmitting] = useState(false);

  const receiptById = useMemo(() => new Map(receipts.map((r) => [r.id, r])), [receipts]);
  const selected = goodsReceiptId ? receiptById.get(goodsReceiptId) : null;

  const totalUsd = useMemo(() => lines.reduce((acc, ln) => acc + toNum(ln.amount_usd || "0"), 0), [lines]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ receipts: ReceiptRow[] }>("/purchases/receipts?status=posted");
      setReceipts(r.receipts || []);
    } catch (e) {
      setErr(e);
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((ln, idx) => (idx === i ? { ...ln, ...patch } : ln)));
  }

  function addLine() {
    setLines((prev) => [...prev, { description: "", amount_usd: "", amount_lbp: "" }]);
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!goodsReceiptId) {
      setErr(new Error("Select a posted goods receipt first."));
      return;
    }
    const ex = toNum(exchangeRate || "0");
    if (!ex || ex <= 0) {
      setErr(new Error("Exchange rate must be > 0."));
      return;
    }
    const payload = {
      goods_receipt_id: goodsReceiptId,
      memo: memo.trim() || undefined,
      exchange_rate: ex,
      lines: (lines || [])
        .map((ln) => ({
          description: (ln.description || "").trim() || undefined,
          amount_usd: toNum(ln.amount_usd || "0"),
          amount_lbp: toNum(ln.amount_lbp || "0")
        }))
        .filter((ln) => (ln.amount_usd || 0) > 0 || (ln.amount_lbp || 0) > 0)
    };

    if (!payload.lines.length) {
      setErr(new Error("Add at least one landed cost line with a non-zero amount."));
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiPost<{ id: string }>(`/inventory/landed-costs/drafts`, payload);
      router.push(`/inventory/landed-costs/${encodeURIComponent(res.id)}`);
    } catch (e2) {
      setErr(e2);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">New Landed Cost Draft</h1>
          <p className="text-sm text-fg-muted">Allocate freight/customs/handling to a posted goods receipt.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/inventory/landed-costs/list")}>
            Back
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
            <CardDescription>Pick the goods receipt and enter totals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <div className="text-xs text-fg-muted">Goods receipt (posted)</div>
                <select className="ui-select w-full" value={goodsReceiptId} onChange={(e) => setGoodsReceiptId(e.target.value)} disabled={loading}>
                  <option value="">Select a posted receipt...</option>
                  {receipts.map((r) => (
                    <option key={r.id} value={r.id}>
                      {(r.receipt_no || r.id.slice(0, 8)) + (r.supplier_name ? ` · ${r.supplier_name}` : "")}
                    </option>
                  ))}
                </select>
                {selected ? (
                  <div className="text-xs text-fg-muted">
                    Warehouse: {selected.warehouse_name || "-"} · Receipt total: {fmtUsd(selected.total_usd || 0)}
                  </div>
                ) : null}
              </label>

              <label className="space-y-1">
                <div className="text-xs text-fg-muted">Exchange rate (USD to LBP)</div>
                <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="90000" />
              </label>
            </div>

            <label className="space-y-1">
              <div className="text-xs text-fg-muted">Memo (optional)</div>
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Shipment freight invoice #..." />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Cost Lines</CardTitle>
                <CardDescription>Enter one or more landed cost components.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={addLine}>
                  Add line
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">USD</th>
                    <th className="px-3 py-2 text-right">LBP</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln, idx) => (
                    <tr key={idx} className="ui-tr-hover">
                      <td className="px-3 py-2">
                        <Input value={ln.description} onChange={(e) => updateLine(idx, { description: e.target.value })} placeholder="Freight / Customs / Handling..." />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input className="text-right data-mono" value={ln.amount_usd} onChange={(e) => updateLine(idx, { amount_usd: e.target.value })} placeholder="0" />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input className="text-right data-mono" value={ln.amount_lbp} onChange={(e) => updateLine(idx, { amount_lbp: e.target.value })} placeholder="0" />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button type="button" variant="outline" size="sm" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end text-sm">
              <div className="text-fg-muted">Total USD:</div>
              <div className="ml-2 data-mono font-medium">{fmtUsd(totalUsd)}</div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create Draft"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function LandedCostNewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}

