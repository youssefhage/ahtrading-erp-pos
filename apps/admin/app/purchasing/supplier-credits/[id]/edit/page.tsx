"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet, apiPatch } from "@/lib/api";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { MoneyInput } from "@/components/money-input";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type RateRow = { id: string; rate_date: string; rate_type: string; usd_to_lbp: string | number };

type CreditDoc = {
  id: string;
  credit_no: string;
  status: "draft" | "posted" | "canceled";
  supplier_id: string;
  supplier_name: string | null;
  kind: "expense" | "receipt";
  goods_receipt_id: string | null;
  goods_receipt_no?: string | null;
  credit_date: string;
  rate_type: string;
  exchange_rate: string | number;
  memo: string | null;
  total_usd: string | number;
  total_lbp: string | number;
};

type LineRow = { id: string; line_no: number | string; description: string | null; amount_usd: string | number; amount_lbp: string | number };
type DetailRes = { credit: CreditDoc; lines: LineRow[]; applications: any[]; allocations: any[] };

type ReceiptRow = {
  id: string;
  receipt_no: string;
  supplier_ref: string | null;
  warehouse_id: string;
  warehouse_name: string | null;
  total_usd: string | number;
  total_lbp: string | number;
};

type LineDraft = { key: string; description: string; amount_usd: string; amount_lbp: string };

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function SupplierCreditEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id || "");

  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<DetailRes | null>(null);

  const [kind, setKind] = useState<"expense" | "receipt">("expense");
  const [goodsReceiptId, setGoodsReceiptId] = useState("");
  const [goodsReceiptLabel, setGoodsReceiptLabel] = useState("");

  const [creditDate, setCreditDate] = useState(todayIso());
  const [rateType, setRateType] = useState("market");
  const [exchangeRate, setExchangeRate] = useState("0");
  const [memo, setMemo] = useState("");

  const [lines, setLines] = useState<LineDraft[]>([]);

  const [pickOpen, setPickOpen] = useState(false);
  const [receiptQ, setReceiptQ] = useState("");
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);

  const totals = useMemo(() => {
    let usd = 0;
    let lbp = 0;
    for (const l of lines) {
      usd += toNum(l.amount_usd);
      lbp += toNum(l.amount_lbp);
    }
    return { usd, lbp };
  }, [lines]);

  const load = useCallback(async () => {
    if (!id) return;
    setStatus("Loading...");
    try {
      const res = await apiGet<DetailRes>(`/purchases/credits/${encodeURIComponent(id)}`);
      setData(res);
      setKind(res.credit.kind);
      setGoodsReceiptId(res.credit.goods_receipt_id || "");
      setGoodsReceiptLabel(res.credit.goods_receipt_id ? `${res.credit.goods_receipt_no || res.credit.goods_receipt_id}` : "");
      setCreditDate(res.credit.credit_date || todayIso());
      setRateType(String(res.credit.rate_type || "market"));
      setExchangeRate(String(res.credit.exchange_rate || 0));
      setMemo(res.credit.memo || "");
      setLines(
        (res.lines || []).map((l) => ({
          key: l.id,
          description: l.description || "",
          amount_usd: String(l.amount_usd ?? ""),
          amount_lbp: String(l.amount_lbp ?? "")
        }))
      );
      if (!res.lines?.length) {
        setLines([{ key: "l1", description: "Supplier credit", amount_usd: "", amount_lbp: "" }]);
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [id]);

  const primeExchangeRate = useCallback(async (nextDate: string, nextRateType: string) => {
    try {
      const r = await getFxRateUsdToLbp({ rateDate: nextDate, rateType: nextRateType });
      const rate = Number(r?.usd_to_lbp || 0);
      if (Number.isFinite(rate) && rate > 0) setExchangeRate(String(rate));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // If user changes rate type/date, re-prime (best-effort).
    primeExchangeRate(creditDate, rateType);
  }, [creditDate, rateType, primeExchangeRate]);

  const loadReceipts = useCallback(async () => {
    const sid = data?.credit?.supplier_id;
    if (!sid) return;
    setReceiptsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "posted");
      params.set("supplier_id", sid);
      if (receiptQ.trim()) params.set("q", receiptQ.trim());
      params.set("limit", "200");
      const res = await apiGet<{ receipts: ReceiptRow[] }>(`/purchases/receipts?${params.toString()}`);
      setReceipts(res.receipts || []);
    } catch {
      setReceipts([]);
    } finally {
      setReceiptsLoading(false);
    }
  }, [data?.credit?.supplier_id, receiptQ]);

  useEffect(() => {
    if (!pickOpen) return;
    loadReceipts();
  }, [pickOpen, loadReceipts]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { key: `l-${Date.now()}-${prev.length + 1}`, description: "", amount_usd: "", amount_lbp: "" }]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function save() {
    if (!id) return;
    if (data?.credit?.status !== "draft") return setStatus("Only draft credits can be edited.");
    if (kind === "receipt" && !goodsReceiptId) return setStatus("Select a posted goods receipt when kind=receipt.");

    const payloadLines = lines
      .map((l) => ({
        description: l.description.trim() || null,
        amount_usd: toNum(l.amount_usd),
        amount_lbp: toNum(l.amount_lbp)
      }))
      .filter((l) => l.amount_usd !== 0 || l.amount_lbp !== 0);

    if (!payloadLines.length) return setStatus("Add at least one non-zero line.");

    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/purchases/credits/${encodeURIComponent(id)}/draft`, {
        kind,
        goods_receipt_id: goodsReceiptId || null,
        credit_date: creditDate || null,
        rate_type: rateType,
        exchange_rate: toNum(exchangeRate),
        memo: memo.trim() || null,
        lines: payloadLines
      });
      router.push(`/purchasing/supplier-credits/${encodeURIComponent(id)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Edit Supplier Credit</CardTitle>
          <CardDescription className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono">{data?.credit?.credit_no || id}</span>
            <span className="text-xs text-fg-muted">{data?.credit?.status || ""}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Supplier</label>
              <Input value={data?.credit?.supplier_name || data?.credit?.supplier_id || ""} readOnly />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Kind</label>
              <select
                className="ui-select w-full"
                value={kind}
                onChange={(e) => {
                  const v = e.target.value as any;
                  setKind(v);
                  if (v !== "receipt") {
                    setGoodsReceiptId("");
                    setGoodsReceiptLabel("");
                  }
                }}
              >
                <option value="expense">expense (general credit)</option>
                <option value="receipt">receipt (allocate to goods receipt)</option>
              </select>
            </div>

            {kind === "receipt" ? (
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Goods Receipt (posted)</label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={goodsReceiptLabel} readOnly placeholder="Select a goods receipt..." className="flex-1" />
                  <Dialog open={pickOpen} onOpenChange={setPickOpen}>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline">
                        Pick
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl">
                      <DialogHeader>
                        <DialogTitle>Pick Goods Receipt</DialogTitle>
                        <DialogDescription>Posted goods receipts for this supplier.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            value={receiptQ}
                            onChange={(e) => setReceiptQ(e.target.value)}
                            placeholder="Search receipt no / supplier ref..."
                            className="flex-1"
                          />
                          <Button type="button" variant="outline" onClick={loadReceipts} disabled={receiptsLoading}>
                            {receiptsLoading ? "Loading..." : "Search"}
                          </Button>
                        </div>
                        <div className="ui-table-scroll">
                          <table className="ui-table">
                            <thead className="ui-thead">
                              <tr>
                                <th className="px-3 py-2">Receipt</th>
                                <th className="px-3 py-2">Warehouse</th>
                                <th className="px-3 py-2">Ref</th>
                                <th className="px-3 py-2 text-right">Total</th>
                                <th className="px-3 py-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {receipts.map((r) => (
                                <tr key={r.id} className="ui-tr-hover">
                                  <td className="px-3 py-2 font-mono text-xs">{r.receipt_no}</td>
                                  <td className="px-3 py-2 text-xs">{r.warehouse_name || r.warehouse_id}</td>
                                  <td className="px-3 py-2 text-xs text-fg-muted">{r.supplier_ref || "-"}</td>
                                  <td className="px-3 py-2 text-right data-mono text-xs">
                                    {fmtUsd(r.total_usd)}
                                    <div className="text-[11px] text-fg-muted">{fmtLbp(r.total_lbp)}</div>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => {
                                        setGoodsReceiptId(r.id);
                                        setGoodsReceiptLabel(`${r.receipt_no} · ${r.warehouse_name || r.warehouse_id}`);
                                        setPickOpen(false);
                                      }}
                                    >
                                      Select
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                              {receipts.length === 0 ? (
                                <tr>
                                  <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                                    No posted receipts found.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            ) : null}

            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Credit Date</label>
              <Input type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Rate Type</label>
              <select className="ui-select w-full" value={rateType} onChange={(e) => setRateType(e.target.value)}>
                <option value="market">market</option>
                <option value="official">official</option>
                <option value="internal">internal</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Exchange Rate</label>
              <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">Memo</label>
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional..." />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Lines</CardTitle>
              <CardDescription>
                Total: {fmtUsd(totals.usd)} / {fmtLbp(totals.lbp)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {lines.map((l) => (
                <div key={l.key} className="rounded-md border border-border bg-bg-elevated p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-fg-muted">Line</div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(l.key)} disabled={lines.length <= 1}>
                      Remove
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Description</label>
                      <Input value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                    </div>
                    <MoneyInput
                      label="Amount USD"
                      currency="USD"
                      value={l.amount_usd}
                      onChange={(v) => updateLine(l.key, { amount_usd: v })}
                      placeholder="0"
                      quick={[0, 10, 50, 100]}
                    />
                    <MoneyInput
                      label="Amount LL"
                      currency="LBP"
                      value={l.amount_lbp}
                      onChange={(v) => updateLine(l.key, { amount_lbp: v })}
                      placeholder="0"
                      quick={[0, 1000000, 5000000]}
                    />
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" onClick={addLine}>
                  + Add line
                </Button>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => router.push(`/purchasing/supplier-credits/${encodeURIComponent(id)}`)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={save} disabled={saving}>
                    {saving ? "Saving..." : "Save Draft"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
