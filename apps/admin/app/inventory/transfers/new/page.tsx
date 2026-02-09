"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { ErrorBanner } from "@/components/error-banner";
import { ItemTypeahead, ItemTypeaheadItem } from "@/components/item-typeahead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type WarehouseRow = { id: string; name: string };

type LineDraft = {
  item_id: string;
  item_sku: string;
  item_name: string;
  unit_of_measure?: string | null;
  qty: string;
  notes: string;
};

function toNum(s: string) {
  const r = parseNumberInput(s);
  return r.ok ? r.value : 0;
}

function Inner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);

  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [memo, setMemo] = useState("");

  const [lines, setLines] = useState<LineDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const warehouseById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const fromName = fromWarehouseId ? warehouseById.get(fromWarehouseId)?.name : "";
  const toName = toWarehouseId ? warehouseById.get(toWarehouseId)?.name : "";

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ warehouses: WarehouseRow[] }>("/warehouses");
      setWarehouses(res.warehouses || []);
    } catch (e) {
      setWarehouses([]);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function addItem(it: ItemTypeaheadItem) {
    setLines((prev) => {
      const idx = prev.findIndex((x) => x.item_id === it.id);
      if (idx >= 0) {
        const next = [...prev];
        const cur = next[idx];
        const n = toNum(cur.qty || "0") || 0;
        next[idx] = { ...cur, qty: String(n + 1) };
        return next;
      }
      return [
        ...prev,
        {
          item_id: it.id,
          item_sku: it.sku,
          item_name: it.name,
          unit_of_measure: it.unit_of_measure || null,
          qty: "1",
          notes: ""
        }
      ];
    });
  }

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((ln, idx) => (idx === i ? { ...ln, ...patch } : ln)));
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!fromWarehouseId) {
      setErr(new Error("Select a From warehouse."));
      return;
    }
    if (!toWarehouseId) {
      setErr(new Error("Select a To warehouse."));
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setErr(new Error("From and To warehouses must differ."));
      return;
    }

    const payload = {
      from_warehouse_id: fromWarehouseId,
      to_warehouse_id: toWarehouseId,
      memo: memo.trim() || undefined,
      lines: (lines || [])
        .map((ln) => ({
          item_id: ln.item_id,
          qty: toNum(ln.qty || "0"),
          notes: ln.notes.trim() || undefined
        }))
        .filter((ln) => (ln.qty || 0) > 0)
    };

    if (!payload.lines.length) {
      setErr(new Error("Add at least one line with qty > 0."));
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiPost<{ id: string }>(`/inventory/transfers/drafts`, payload);
      router.push(`/inventory/transfers/${encodeURIComponent(res.id)}`);
    } catch (e2) {
      setErr(e2);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">New Transfer Draft</h1>
          <p className="text-sm text-fg-muted">
            {fromName && toName ? (
              <>
                {fromName} <span className="text-fg-subtle">→</span> {toName}
              </>
            ) : (
              "Pick source and destination warehouses, then add lines."
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/inventory/transfers/list")}>
            Back
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
            <CardDescription>Warehouse transfer header and memo.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <label className="space-y-1">
              <div className="text-xs text-fg-muted">From warehouse</div>
              <select className="ui-select w-full" value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)} disabled={loading}>
                <option value="">Select...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <div className="text-xs text-fg-muted">To warehouse</div>
              <select className="ui-select w-full" value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} disabled={loading}>
                <option value="">Select...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 md:col-span-2">
              <div className="text-xs text-fg-muted">Memo (optional)</div>
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Move to Branch B for wholesale order..." />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Lines</CardTitle>
                <CardDescription>Scan/type to add items. Selecting an item again increments qty by 1.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-w-xl">
              <ItemTypeahead onSelect={addItem} onClear={() => {}} />
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2">Notes</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln, idx) => (
                    <tr key={ln.item_id} className="ui-tr-hover">
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          <span className="data-mono">{ln.item_sku}</span> · {ln.item_name}
                        </div>
                        {ln.unit_of_measure ? <div className="mt-0.5 text-xs text-fg-muted">UOM: {ln.unit_of_measure}</div> : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input className="w-28 text-right data-mono" value={ln.qty} onChange={(e) => updateLine(idx, { qty: e.target.value })} placeholder="0" />
                      </td>
                      <td className="px-3 py-2">
                        <Input value={ln.notes} onChange={(e) => updateLine(idx, { notes: e.target.value })} placeholder="Optional" />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button type="button" variant="outline" size="sm" onClick={() => removeLine(idx)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                        No lines yet. Add items above.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
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

export default function TransferNewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}

