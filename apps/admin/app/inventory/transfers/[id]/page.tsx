"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";

import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { ItemTypeahead, ItemTypeaheadItem } from "@/components/item-typeahead";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type LocationRow = { id: string; code: string; name: string | null; is_active: boolean };

type TransferDoc = {
  id: string;
  transfer_no: string;
  status: string;
  from_warehouse_id: string;
  from_warehouse_name?: string | null;
  to_warehouse_id: string;
  to_warehouse_name?: string | null;
  from_location_id?: string | null;
  from_location_code?: string | null;
  from_location_name?: string | null;
  to_location_id?: string | null;
  to_location_code?: string | null;
  to_location_name?: string | null;
  memo?: string | null;
  created_at: string;
  picked_at?: string | null;
  posted_at?: string | null;
  cancel_reason?: string | null;
};

type TransferLine = {
  id: string;
  line_no: number;
  item_id: string;
  item_sku: string;
  item_name: string;
  qty: string | number;
  picked_qty: string | number;
  notes?: string | null;
};

type AllocationRow = {
  id: string;
  stock_transfer_line_id: string;
  batch_id?: string | null;
  batch_no?: string | null;
  expiry_date?: string | null;
  qty: string | number;
  created_at: string;
};

type Detail = { transfer: TransferDoc; lines: TransferLine[]; allocations_by_line: Record<string, AllocationRow[]> };

function fmtIso(iso: string | null | undefined) {
  const s = String(iso || "");
  return s ? s.replace("T", " ").slice(0, 19) : "-";
}

function toNum(s: string) {
  const r = parseNumberInput(s);
  return r.ok ? r.value : 0;
}

function Inner({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [memo, setMemo] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [fromLocCode, setFromLocCode] = useState("");
  const [toLocCode, setToLocCode] = useState("");
  const [fromLocations, setFromLocations] = useState<LocationRow[]>([]);
  const [toLocations, setToLocations] = useState<LocationRow[]>([]);
  const [linesDraft, setLinesDraft] = useState<Array<{ item_id: string; item_sku: string; item_name: string; qty: string; notes: string }>>([]);
  const [saving, setSaving] = useState(false);

  const [pickOpen, setPickOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  const [reverseOpen, setReverseOpen] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reverseReason, setReverseReason] = useState("");

  const [editPickMode, setEditPickMode] = useState(false);
  const [allocEdits, setAllocEdits] = useState<Record<string, string>>({});
  const [savingPick, setSavingPick] = useState(false);

  const tr = detail?.transfer;
  const lines = detail?.lines || [];
  const alloc = detail?.allocations_by_line || {};

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const d = await apiGet<Detail>(`/inventory/transfers/${encodeURIComponent(id)}`);
      setDetail(d);
      setMemo(String(d.transfer?.memo || ""));
      setFromLocationId(String(d.transfer?.from_location_id || ""));
      setToLocationId(String(d.transfer?.to_location_id || ""));
      setLinesDraft(
        (d.lines || []).map((l) => ({
          item_id: l.item_id,
          item_sku: l.item_sku,
          item_name: l.item_name,
          qty: String(l.qty ?? ""),
          notes: String(l.notes || "")
        }))
      );
    } catch (e) {
      setDetail(null);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tr?.from_warehouse_id) {
        setFromLocations([]);
        return;
      }
      try {
        const res = await apiGet<{ locations: LocationRow[] }>(
          `/inventory/locations?warehouse_id=${encodeURIComponent(tr.from_warehouse_id)}&limit=500`
        );
        if (cancelled) return;
        setFromLocations(res.locations || []);
      } catch {
        if (cancelled) return;
        setFromLocations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tr?.from_warehouse_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tr?.to_warehouse_id) {
        setToLocations([]);
        return;
      }
      try {
        const res = await apiGet<{ locations: LocationRow[] }>(
          `/inventory/locations?warehouse_id=${encodeURIComponent(tr.to_warehouse_id)}&limit=500`
        );
        if (cancelled) return;
        setToLocations(res.locations || []);
      } catch {
        if (cancelled) return;
        setToLocations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tr?.to_warehouse_id]);

  const fromLocOptions = useMemo(() => {
    return (fromLocations || []).map((l) => ({
      value: l.id,
      label: `${l.code}${l.name ? ` · ${l.name}` : ""}`,
      keywords: `${l.code} ${l.name || ""}`.trim(),
    }));
  }, [fromLocations]);

  const toLocOptions = useMemo(() => {
    return (toLocations || []).map((l) => ({
      value: l.id,
      label: `${l.code}${l.name ? ` · ${l.name}` : ""}`,
      keywords: `${l.code} ${l.name || ""}`.trim(),
    }));
  }, [toLocations]);

  function pickLocationByCode(code: string, locs: LocationRow[]): string {
    const t = String(code || "").trim().toLowerCase();
    if (!t) return "";
    const exact = (locs || []).find((l) => String(l.code || "").trim().toLowerCase() === t);
    return exact ? exact.id : "";
  }

  function addItem(it: ItemTypeaheadItem) {
    setLinesDraft((prev) => {
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
          qty: "1",
          notes: ""
        }
      ];
    });
  }

  function updateDraftLine(i: number, patch: Partial<{ qty: string; notes: string }>) {
    setLinesDraft((prev) => prev.map((ln, idx) => (idx === i ? { ...ln, ...patch } : ln)));
  }

  function removeDraftLine(i: number) {
    setLinesDraft((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!tr) return;
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        memo: memo.trim() || undefined,
        from_location_id: fromLocationId || undefined,
        to_location_id: toLocationId || undefined,
        lines: (linesDraft || [])
          .map((ln) => ({
            item_id: ln.item_id,
            qty: toNum(ln.qty || "0"),
            notes: ln.notes.trim() || undefined
          }))
          .filter((ln) => (ln.qty || 0) > 0)
      };
      if (!payload.lines.length) throw new Error("Draft must have at least one line with qty > 0.");
      await apiPatch(`/inventory/transfers/${encodeURIComponent(tr.id)}/draft`, payload);
      setEditMode(false);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setSaving(false);
    }
  }

  async function doPick(e: React.FormEvent) {
    e.preventDefault();
    if (!tr) return;
    setPicking(true);
    setErr(null);
    setLastWarnings([]);
    try {
      const res = await apiPost<{ ok: boolean; warnings?: string[] }>(`/inventory/transfers/${encodeURIComponent(tr.id)}/pick`, {});
      setLastWarnings(res.warnings || []);
      setPickOpen(false);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setPicking(false);
    }
  }

  async function doPost(e: React.FormEvent) {
    e.preventDefault();
    if (!tr) return;
    setPosting(true);
    setErr(null);
    setLastWarnings([]);
    try {
      const res = await apiPost<{ ok: boolean; warnings?: string[] }>(`/inventory/transfers/${encodeURIComponent(tr.id)}/post`, {});
      setLastWarnings(res.warnings || []);
      setPostOpen(false);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setPosting(false);
    }
  }

  async function doCancel(e: React.FormEvent) {
    e.preventDefault();
    if (!tr) return;
    setCanceling(true);
    setErr(null);
    try {
      await apiPost(`/inventory/transfers/${encodeURIComponent(tr.id)}/cancel`, { reason: cancelReason.trim() || undefined });
      setCancelOpen(false);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setCanceling(false);
    }
  }

  async function doReverse(e: React.FormEvent) {
    e.preventDefault();
    if (!tr) return;
    setReversing(true);
    setErr(null);
    try {
      const res = await apiPost<{ id: string }>(`/inventory/transfers/${encodeURIComponent(tr.id)}/reverse-draft`, {
        reason: reverseReason.trim() || undefined,
      });
      setReverseOpen(false);
      router.push(`/inventory/transfers/${encodeURIComponent(res.id)}`);
    } catch (e2) {
      setErr(e2);
    } finally {
      setReversing(false);
    }
  }

  const canEdit = tr?.status === "draft";
  const canPick = tr?.status === "draft" || tr?.status === "picked";
  const canPost = tr?.status === "picked";
  const canCancel = tr?.status === "draft" || tr?.status === "picked";
  const canReverse = tr?.status === "posted";
  const canEditPick = tr?.status === "picked";

  function startEditPick() {
    const map: Record<string, string> = {};
    Object.values(alloc || {}).forEach((rows) => {
      (rows || []).forEach((a) => {
        map[String(a.id)] = String(a.qty ?? "");
      });
    });
    setAllocEdits(map);
    setEditPickMode(true);
  }

  async function savePickEdits() {
    if (!tr) return;
    setSavingPick(true);
    setErr(null);
    try {
      const updates: Array<{ id: string; qty: number }> = [];
      Object.values(alloc || {}).forEach((rows) => {
        (rows || []).forEach((a) => {
          const raw = allocEdits[String(a.id)] ?? String(a.qty ?? "0");
          const qty = toNum(raw || "0");
          if (qty < 0) throw new Error("Allocation qty must be >= 0.");
          updates.push({ id: String(a.id), qty });
        });
      });
      await apiPatch(`/inventory/transfers/${encodeURIComponent(tr.id)}/allocations`, { allocations: updates });
      setEditPickMode(false);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setSavingPick(false);
    }
  }

  if (!loading && !detail && !err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <EmptyState
          title="Transfer not found"
          description="This document may not exist or you may not have access."
          actionLabel="Back"
          onAction={() => router.push("/inventory/transfers/list")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{tr?.transfer_no || (loading ? "Loading..." : "Stock Transfer")}</h1>
          <p className="text-sm text-fg-muted">
            <span className="font-mono text-xs">{id}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/inventory/transfers/list")}>
            Back
          </Button>
          {canEdit ? (
            <Button type="button" variant="outline" onClick={() => setEditMode((v) => !v)}>
              {editMode ? "Close Edit" : "Edit Draft"}
            </Button>
          ) : null}
          {canCancel ? (
            <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
              Cancel
            </Button>
          ) : null}
          {canPick ? (
            <Button type="button" variant="outline" onClick={() => setPickOpen(true)} disabled={editMode || editPickMode}>
              Pick
            </Button>
          ) : null}
          {canEditPick ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => (editPickMode ? setEditPickMode(false) : startEditPick())}
              disabled={editMode}
            >
              {editPickMode ? "Close Pick Edit" : "Edit Pick"}
            </Button>
          ) : null}
          {canPost ? (
            <Button type="button" onClick={() => setPostOpen(true)} disabled={editMode || editPickMode}>
              Post
            </Button>
          ) : null}
          {canReverse ? (
            <Button type="button" variant="outline" onClick={() => setReverseOpen(true)}>
              Reverse
            </Button>
          ) : null}
          {tr ? <DocumentUtilitiesDrawer entityType="stock_transfer" entityId={tr.id} showAttachments={false} className="ml-1" /> : null}
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      {lastWarnings.length ? (
        <Card className="border-border-subtle">
          <CardHeader>
            <CardTitle>Warnings</CardTitle>
            <CardDescription>Completed with warnings (best-effort behavior).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="list-disc pl-5 text-fg-muted">
              {lastWarnings.slice(0, 12).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {tr ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Header</CardTitle>
              <CardDescription>Status and warehouse context.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-2">
              <div>
                <div className="text-xs text-fg-muted">Status</div>
                <div className="mt-1">
                  <StatusChip value={tr.status} />
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Warehouses</div>
                <div className="mt-1">
                  <span className="font-medium">{tr.from_warehouse_name || tr.from_warehouse_id.slice(0, 8)}</span>
                  <span className="mx-2 text-fg-subtle">→</span>
                  <span className="font-medium">{tr.to_warehouse_name || tr.to_warehouse_id.slice(0, 8)}</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Locations</div>
                <div className="mt-1 text-sm">
                  <span className="font-medium">
                    {tr.from_location_code || tr.from_location_id ? (tr.from_location_code || String(tr.from_location_id).slice(0, 8)) : "(none)"}
                  </span>
                  <span className="mx-2 text-fg-subtle">→</span>
                  <span className="font-medium">
                    {tr.to_location_code || tr.to_location_id ? (tr.to_location_code || String(tr.to_location_id).slice(0, 8)) : "(none)"}
                  </span>
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-fg-muted">Memo</div>
                <div className="mt-1">{tr.memo || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Created</div>
                <div className="mt-1 font-mono text-xs text-fg-muted">{fmtIso(tr.created_at)}</div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Picked</div>
                <div className="mt-1 font-mono text-xs text-fg-muted">{fmtIso(tr.picked_at)}</div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Posted</div>
                <div className="mt-1 font-mono text-xs text-fg-muted">{fmtIso(tr.posted_at)}</div>
              </div>
              {tr.status === "canceled" ? (
                <div>
                  <div className="text-xs text-fg-muted">Cancel reason</div>
                  <div className="mt-1">{tr.cancel_reason || "-"}</div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {editMode && canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle>Edit Draft</CardTitle>
                <CardDescription>Update memo and lines. Then save.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <form onSubmit={saveDraft} className="space-y-4">
                  <label className="space-y-1">
                    <div className="text-xs text-fg-muted">Memo</div>
                    <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" />
                  </label>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-xs text-fg-muted">From location (optional)</div>
                      <Input
                        value={fromLocCode}
                        onChange={(e) => setFromLocCode(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const id = pickLocationByCode(fromLocCode, fromLocations);
                            if (id) setFromLocationId(id);
                          }
                        }}
                        placeholder="Scan/type location code"
                      />
                      <SearchableSelect
                        value={fromLocationId}
                        onChange={setFromLocationId}
                        placeholder="Select location..."
                        searchPlaceholder="Search locations..."
                        options={[{ value: "", label: "(none)" }, ...fromLocOptions]}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-fg-muted">To location (optional)</div>
                      <Input
                        value={toLocCode}
                        onChange={(e) => setToLocCode(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const id = pickLocationByCode(toLocCode, toLocations);
                            if (id) setToLocationId(id);
                          }
                        }}
                        placeholder="Scan/type location code"
                      />
                      <SearchableSelect
                        value={toLocationId}
                        onChange={setToLocationId}
                        placeholder="Select location..."
                        searchPlaceholder="Search locations..."
                        options={[{ value: "", label: "(none)" }, ...toLocOptions]}
                      />
                    </div>
                  </div>

                  <div className="max-w-xl">
                    <ItemTypeahead onSelect={addItem} onClear={() => {}} />
                  </div>

                  <div className="ui-table-scroll">
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
                        {linesDraft.map((ln, idx) => (
                          <tr key={`${ln.item_id}:${idx}`} className="ui-tr-hover">
                            <td className="px-3 py-2">
                              <div className="font-medium">
                                <span className="data-mono">{ln.item_sku}</span> · {ln.item_name}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Input className="w-28 text-right data-mono" value={ln.qty} onChange={(e) => updateDraftLine(idx, { qty: e.target.value })} />
                            </td>
                            <td className="px-3 py-2">
                              <Input value={ln.notes} onChange={(e) => updateDraftLine(idx, { notes: e.target.value })} placeholder="Optional" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Button type="button" variant="outline" size="sm" onClick={() => removeDraftLine(idx)}>
                                Remove
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {linesDraft.length === 0 ? (
                          <tr>
                            <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                              No lines.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setEditMode(false)} disabled={saving}>
                      Close
                    </Button>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving..." : "Save Draft"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Lines</CardTitle>
              <CardDescription>Requested qty and picked allocations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="ui-table-scroll">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Requested</th>
                      <th className="px-3 py-2 text-right">Picked</th>
                      <th className="px-3 py-2">Allocations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((ln) => {
                      const allocRows = alloc[String(ln.id)] || [];
                      return (
                        <tr key={ln.id} className="ui-tr-hover align-top">
                          <td className="px-3 py-2 text-xs font-mono text-fg-muted">{ln.line_no}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">
                              <span className="data-mono">{ln.item_sku}</span> · {ln.item_name}
                            </div>
                            {ln.notes ? <div className="mt-0.5 text-xs text-fg-muted">{ln.notes}</div> : null}
                          </td>
                          <td className="px-3 py-2 text-right data-mono">{String(ln.qty)}</td>
                          <td className="px-3 py-2 text-right data-mono">{String(ln.picked_qty)}</td>
                          <td className="px-3 py-2">
                            {allocRows.length ? (
                              <div className="space-y-1 text-xs">
                                {allocRows.slice(0, 12).map((a) => (
                                  <div key={a.id} className="flex flex-wrap items-center gap-2">
                                    {editPickMode ? (
                                      <Input
                                        className="h-8 w-24 text-right data-mono"
                                        value={allocEdits[String(a.id)] ?? String(a.qty)}
                                        onChange={(e) =>
                                          setAllocEdits((prev) => ({
                                            ...prev,
                                            [String(a.id)]: e.target.value
                                          }))
                                        }
                                      />
                                    ) : (
                                      <span className="data-mono font-medium">{String(a.qty)}</span>
                                    )}
                                    <span className="text-fg-subtle">from</span>
                                    <span className="data-mono">{a.batch_no || (a.batch_id ? String(a.batch_id).slice(0, 8) : "unbatched")}</span>
                                    {a.expiry_date ? <span className="text-fg-subtle">exp {String(a.expiry_date).slice(0, 10)}</span> : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-fg-subtle">No allocations yet.</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {lines.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                          No lines.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {editPickMode ? (
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setEditPickMode(false)} disabled={savingPick}>
                    Close
                  </Button>
                  <Button type="button" onClick={savePickEdits} disabled={savingPick}>
                    {savingPick ? "Saving..." : "Save Pick"}
                  </Button>
                </div>
              ) : null}

              {tr.status === "posted" ? (
                <div className="text-xs text-fg-subtle">
                  Posted transfers create stock moves. You can view movements in{" "}
                  <Link className="focus-ring text-primary hover:underline" href="/inventory/movements">
                    Inventory → Movements
                  </Link>{" "}
                  (filter by source).
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Audit trail is available via the right-rail utilities drawer. */}
        </>
      ) : null}

      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pick Transfer</DialogTitle>
            <DialogDescription>Compute FEFO batch allocations for each line (does not move stock yet).</DialogDescription>
          </DialogHeader>
          <form onSubmit={doPick} className="space-y-3">
            <div className="text-sm text-fg-muted">
              Picking is idempotent: you can re-pick after editing draft lines (it replaces allocations).
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPickOpen(false)} disabled={picking}>
                Close
              </Button>
              <Button type="submit" disabled={picking}>
                {picking ? "Picking..." : "Pick"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={postOpen} onOpenChange={setPostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post Transfer</DialogTitle>
            <DialogDescription>This will write stock moves out of the source and into the destination.</DialogDescription>
          </DialogHeader>
          <form onSubmit={doPost} className="space-y-3">
            <div className="text-sm text-fg-muted">You must pick before posting. Posted transfers cannot be canceled in v1.</div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPostOpen(false)} disabled={posting}>
                Close
              </Button>
              <Button type="submit" disabled={posting}>
                {posting ? "Posting..." : "Post"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Transfer</DialogTitle>
            <DialogDescription>Draft/picked only. Posted transfers require reversal support (v2).</DialogDescription>
          </DialogHeader>
          <form onSubmit={doCancel} className="space-y-3">
            <label className="space-y-1">
              <div className="text-xs text-fg-muted">Reason (optional)</div>
              <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Why cancel this transfer?" />
            </label>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={canceling}>
                Close
              </Button>
              <Button type="submit" variant="destructive" disabled={canceling}>
                {canceling ? "Canceling..." : "Cancel"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Reversal Draft</DialogTitle>
            <DialogDescription>
              This creates a new transfer draft that swaps From/To and copies moved quantities. You can pick and post it like a normal transfer.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={doReverse} className="space-y-3">
            <label className="space-y-1">
              <div className="text-xs text-fg-muted">Reason (optional)</div>
              <Input value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="Why reverse this transfer?" />
            </label>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setReverseOpen(false)} disabled={reversing}>
                Close
              </Button>
              <Button type="submit" disabled={reversing}>
                {reversing ? "Creating..." : "Create Draft"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TransferViewPage() {
  const paramsObj = useParams();
  const idParam = (paramsObj as Record<string, string | string[] | undefined>)?.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? (idParam[0] || "") : "";
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner id={id} />
    </Suspense>
  );
}
