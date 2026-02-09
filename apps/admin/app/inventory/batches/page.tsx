"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Item = { id: string; sku: string; name: string };

type BatchRow = {
  id: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  batch_no: string | null;
  expiry_date: string | null;
  status: "available" | "quarantine" | "expired";
  hold_reason: string | null;
  notes: string | null;
  received_at: string | null;
  received_source_type: string | null;
  received_source_id: string | null;
  received_supplier_name: string | null;
  created_at: string;
  updated_at: string;
};

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

export default function InventoryBatchesPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [rows, setRows] = useState<BatchRow[]>([]);

  const [filterItemId, setFilterItemId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [expFrom, setExpFrom] = useState("");
  const [expTo, setExpTo] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editStatus, setEditStatus] = useState<"available" | "quarantine" | "expired">("available");
  const [editHoldReason, setEditHoldReason] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [it, batches] = await Promise.all([
        apiGet<{ items: Item[] }>("/items"),
        (async () => {
          const qs = new URLSearchParams();
          if (filterItemId) qs.set("item_id", filterItemId);
          if (filterStatus) qs.set("status", filterStatus);
          if (expFrom) qs.set("exp_from", expFrom);
          if (expTo) qs.set("exp_to", expTo);
          qs.set("limit", "500");
          return await apiGet<{ batches: BatchRow[] }>(`/inventory/batches?${qs.toString()}`);
        })()
      ]);
      setItems(it.items || []);
      setRows(batches.batches || []);
      setStatus("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg);
    } finally {
      setLoading(false);
    }
  }, [filterItemId, filterStatus, expFrom, expTo]);

  useEffect(() => {
    load();
  }, [load]);

  function openEdit(b: BatchRow) {
    setEditId(b.id);
    setEditStatus(b.status);
    setEditHoldReason(b.hold_reason || "");
    setEditNotes(b.notes || "");
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    if (editStatus === "quarantine" && !editHoldReason.trim()) return setStatus("hold_reason is required when status=quarantine");
    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/inventory/batches/${encodeURIComponent(editId)}`, {
        status: editStatus,
        hold_reason: editHoldReason.trim() || undefined,
        notes: editNotes.trim() || undefined
      });
      setEditOpen(false);
      setStatus("");
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-12">
          <div className="md:col-span-5">
            <label className="text-xs font-medium text-fg-muted">Item (optional)</label>
            <select className="ui-select" value={filterItemId} onChange={(e) => setFilterItemId(e.target.value)}>
              <option value="">All items</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} · {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="text-xs font-medium text-fg-muted">Status (optional)</label>
            <select className="ui-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              <option value="available">available</option>
              <option value="quarantine">quarantine</option>
              <option value="expired">expired</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-fg-muted">Expiry From</label>
            <Input type="date" value={expFrom} onChange={(e) => setExpFrom(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-fg-muted">Expiry To</label>
            <Input type="date" value={expTo} onChange={(e) => setExpTo(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Batches</CardTitle>
          <CardDescription>Manage lot status (available/quarantine/expired) and see receiving attribution.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2">Expiry</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Received</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={loading ? "opacity-70" : ""}>
                {rows.map((b) => {
                  const it = itemById.get(b.item_id);
                  return (
                    <tr key={b.id} className="ui-tr-hover">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{it?.sku || b.item_sku || "-"}</span> · {it?.name || b.item_name || "-"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{b.batch_no || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{fmtIso(b.expiry_date)}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-[10px] text-fg-muted">
                          {b.status}
                        </span>
                        {b.hold_reason ? <span className="ml-2 text-[10px] text-fg-subtle">{b.hold_reason}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        <div className="data-mono">{fmtIso(b.received_at)}</div>
                        <div className="text-fg-subtle">
                          {(b.received_source_type || "-") + (b.received_supplier_name ? ` · ${b.received_supplier_name}` : "")}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => openEdit(b)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-fg-subtle" colSpan={6}>
                      No batches.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Batch</DialogTitle>
            <DialogDescription>Use quarantine to block allocation; expired batches are never allocated.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Status</label>
              <select className="ui-select" value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)}>
                <option value="available">available</option>
                <option value="quarantine">quarantine</option>
                <option value="expired">expired</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Hold Reason</label>
              <Input value={editHoldReason} onChange={(e) => setEditHoldReason(e.target.value)} placeholder="Required when quarantined" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Notes</label>
              <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Optional notes" />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
