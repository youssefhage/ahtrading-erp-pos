"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost, getCompanyId } from "@/lib/api";
import { getDefaultWarehouseId, setDefaultWarehouseId } from "@/lib/op-context";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type WarehouseRow = { id: string; name: string };
type LocationRow = { id: string; code: string; name?: string | null };

type PlanRow = {
  id: string;
  name: string;
  warehouse_id: string;
  warehouse_name: string;
  location_id: string | null;
  location_code: string | null;
  frequency_days: number;
  next_run_date: string;
  is_active: boolean;
  updated_at: string;
};

type TaskRow = {
  id: string;
  plan_id: string | null;
  plan_name: string | null;
  warehouse_id: string;
  warehouse_name: string;
  location_id: string | null;
  location_code: string | null;
  status: string;
  scheduled_date: string;
  created_at: string;
};

type TaskLine = {
  id: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  expected_qty: string | number;
  counted_qty: string | number | null;
  notes: string | null;
};

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function CycleCountsPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locationId, setLocationId] = useState<string>("");

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [taskStatus, setTaskStatus] = useState<string>("open");

  const [createOpen, setCreateOpen] = useState(false);
  const [planName, setPlanName] = useState("Main warehouse cycle count");
  const [frequencyDays, setFrequencyDays] = useState("7");
  const [nextRunDate, setNextRunDate] = useState(todayISO());
  const [savingPlan, setSavingPlan] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string>("");
  const [detail, setDetail] = useState<{ task: any; lines: TaskLine[] } | null>(null);
  const [savingCounts, setSavingCounts] = useState(false);
  const [posting, setPosting] = useState(false);

  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const loadWarehouses = useCallback(async () => {
    const res = await apiGet<{ warehouses: WarehouseRow[] }>("/warehouses");
    const ws = res.warehouses || [];
    setWarehouses(ws);
    const cid = getCompanyId();
    const def = getDefaultWarehouseId(cid);
    const next = def && ws.find((w) => w.id === def) ? def : (ws[0]?.id || "");
    setWarehouseId(next);
  }, []);

  const loadLocations = useCallback(async (wid: string) => {
    if (!wid) {
      setLocations([]);
      setLocationId("");
      return;
    }
    const res = await apiGet<{ locations: LocationRow[] }>(`/inventory/warehouses/${encodeURIComponent(wid)}/locations?limit=500`);
    const locs = res.locations || [];
    setLocations(locs);
    setLocationId((prev) => (prev && locs.find((l) => l.id === prev) ? prev : ""));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [p, t] = await Promise.all([
        apiGet<{ plans: PlanRow[] }>("/warehouse/cycle-count/plans"),
        apiGet<{ tasks: TaskRow[] }>(`/warehouse/cycle-count/tasks?status=${encodeURIComponent(taskStatus)}&limit=200`),
      ]);
      setPlans(p.plans || []);
      setTasks(t.tasks || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [taskStatus]);

  useEffect(() => {
    loadWarehouses().catch((e) => setStatus(String(e)));
  }, [loadWarehouses]);

  useEffect(() => {
    if (!warehouseId) return;
    const cid = getCompanyId();
    setDefaultWarehouseId(cid, warehouseId);
    loadLocations(warehouseId).catch((e) => setStatus(String(e)));
  }, [warehouseId, loadLocations]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function createPlan(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId) {
      setStatus("Warehouse is required");
      return;
    }
    setSavingPlan(true);
    setStatus("Saving plan...");
    try {
      await apiPost("/warehouse/cycle-count/plans", {
        name: planName.trim(),
        warehouse_id: warehouseId,
        location_id: locationId.trim() || null,
        frequency_days: Number(frequencyDays || 7),
        next_run_date: nextRunDate,
        is_active: true,
      });
      setCreateOpen(false);
      await refresh();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingPlan(false);
    }
  }

  async function runPlanNow(planId: string) {
    setStatus("Creating task...");
    try {
      await apiPost(`/warehouse/cycle-count/plans/${encodeURIComponent(planId)}/run`, {});
      await refresh();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function openTask(taskId: string) {
    setDetailOpen(true);
    setDetailTaskId(taskId);
    setDetail(null);
    setStatus("Loading task...");
    try {
      const res = await apiGet<{ task: any; lines: TaskLine[] }>(`/warehouse/cycle-count/tasks/${encodeURIComponent(taskId)}`);
      setDetail(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  function updateLine(id: string, patch: Partial<TaskLine>) {
    setDetail((prev) => {
      if (!prev) return prev;
      return { ...prev, lines: prev.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
    });
  }

  async function saveCounts() {
    if (!detailTaskId || !detail) return;
    setSavingCounts(true);
    setStatus("Saving counts...");
    try {
      await apiPatch(`/warehouse/cycle-count/tasks/${encodeURIComponent(detailTaskId)}/count`, {
        lines: detail.lines.map((l) => ({
          id: l.id,
          counted_qty: l.counted_qty == null || l.counted_qty === "" ? null : Number(l.counted_qty),
          notes: (l.notes || "").trim() || null,
        })),
      });
      await openTask(detailTaskId);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingCounts(false);
    }
  }

  async function postTask() {
    if (!detailTaskId) return;
    setPosting(true);
    setStatus("Posting adjustments...");
    try {
      await apiPost(`/warehouse/cycle-count/tasks/${encodeURIComponent(detailTaskId)}/post`, {});
      setDetailOpen(false);
      setDetailTaskId("");
      setDetail(null);
      await refresh();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setPosting(false);
    }
  }

  const activePlanCount = plans.filter((p) => p.is_active).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={refresh} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select className="ui-select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
            {!warehouses.length ? <option value="">No warehouses</option> : null}
          </select>
          <select className="ui-select" value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)}>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="posted">Posted</option>
            <option value="">All</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>Create Plan</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Cycle Count Plan</DialogTitle>
                <DialogDescription>
                  Plans generate cycle count tasks on a schedule (worker runs hourly). You can also run a plan immediately.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={createPlan} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="md:col-span-6 space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Name</label>
                  <Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Main warehouse cycle count" />
                </div>
                <div className="md:col-span-3 space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Location (optional)</label>
                  <select className="ui-select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                    <option value="">Whole warehouse</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code}{l.name ? ` · ${l.name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-1 space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Frequency (days)</label>
                  <Input value={frequencyDays} onChange={(e) => setFrequencyDays(e.target.value)} placeholder="7" />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Next Run</label>
                  <Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} />
                </div>
                <div className="md:col-span-6 flex justify-end">
                  <Button type="submit" disabled={savingPlan}>
                    {savingPlan ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Plans</CardTitle>
            <CardDescription>
              {activePlanCount.toLocaleString("en-US")} active · {plans.length.toLocaleString("en-US")} total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Scope</th>
                    <th className="px-3 py-2 text-right">Freq</th>
                    <th className="px-3 py-2">Next</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className={loading ? "opacity-70" : ""}>
                  {plans.map((p) => (
                    <tr key={p.id} className="ui-tr ui-tr-hover">
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-[10px] text-fg-subtle data-mono">{p.id}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        <div>{p.warehouse_name}</div>
                        <div className="text-fg-subtle">Loc: <span className="data-mono">{p.location_code || "ALL"}</span></div>
                      </td>
                      <td className="px-3 py-2 text-right data-mono text-xs">{Number(p.frequency_days || 0)}</td>
                      <td className="px-3 py-2 data-mono text-xs">{String(p.next_run_date || "").slice(0, 10)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" onClick={() => runPlanNow(p.id)} disabled={!p.is_active}>
                          Run
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {plans.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                        No plans.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            <CardDescription>{tasks.length.toLocaleString("en-US")} shown</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Scope</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className={loading ? "opacity-70" : ""}>
                  {tasks.map((t) => (
                    <tr key={t.id} className="ui-tr ui-tr-hover">
                      <td className="px-3 py-2 data-mono text-xs">{String(t.scheduled_date || "").slice(0, 10)}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        <div>{t.warehouse_name}</div>
                        <div className="text-fg-subtle">Loc: <span className="data-mono">{t.location_code || "ALL"}</span></div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={t.status === "posted" ? "ui-chip ui-chip-success" : "ui-chip ui-chip-default"}>{t.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => openTask(t.id)}>
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {tasks.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                        No tasks.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
              <DialogContent className="max-w-5xl">
                <DialogHeader>
                  <DialogTitle>Cycle Count Task</DialogTitle>
                  <DialogDescription>
                    Enter counted quantities, save, then post to create inventory adjustments.
                  </DialogDescription>
                </DialogHeader>

                {detail ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border-subtle bg-bg-elevated/60 p-3 text-xs text-fg-muted">
                      <div>
                        Warehouse: <span className="data-mono">{detail.task?.warehouse_id}</span>
                      </div>
                      <div>
                        Location: <span className="data-mono">{detail.task?.location_id || "ALL"}</span>
                      </div>
                      <div>
                        Status: <span className="data-mono">{detail.task?.status}</span>
                      </div>
                    </div>

                    <div className="ui-table-wrap max-h-[420px]">
                      <table className="ui-table">
                        <thead className="ui-thead">
                          <tr>
                            <th className="px-3 py-2">Item</th>
                            <th className="px-3 py-2 text-right">Expected</th>
                            <th className="px-3 py-2 text-right">Counted</th>
                            <th className="px-3 py-2">Notes</th>
                            <th className="px-3 py-2 text-right">Diff</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.lines.map((l) => {
                            const expected = toNum(l.expected_qty);
                            const counted = l.counted_qty == null || l.counted_qty === "" ? null : toNum(l.counted_qty);
                            const diff = counted == null ? null : counted - expected;
                            const diffTone = diff == null ? "" : diff === 0 ? "" : diff > 0 ? "ui-tone-qty" : "ui-tone-negative";
                            return (
                              <tr key={l.id} className="ui-tr ui-tr-hover">
                                <td className="px-3 py-2">
                                  <div className="data-mono text-xs">{l.item_sku || l.item_id.slice(0, 8)}</div>
                                  <div className="text-xs text-fg-muted">{l.item_name}</div>
                                </td>
                                <td className="px-3 py-2 text-right data-mono text-xs ui-tone-qty">
                                  {expected.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <Input
                                    value={l.counted_qty == null ? "" : String(l.counted_qty)}
                                    onChange={(e) => updateLine(l.id, { counted_qty: e.target.value })}
                                    placeholder="0"
                                    className="h-9 w-32 text-right data-mono"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <Input
                                    value={l.notes || ""}
                                    onChange={(e) => updateLine(l.id, { notes: e.target.value })}
                                    placeholder="Optional"
                                    className="h-9"
                                  />
                                </td>
                                <td className={`px-3 py-2 text-right data-mono text-xs ${diffTone}`}>
                                  {diff == null ? "-" : diff.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" onClick={saveCounts} disabled={savingCounts}>
                        {savingCounts ? "Saving..." : "Save Counts"}
                      </Button>
                      <Button onClick={postTask} disabled={posting}>
                        {posting ? "Posting..." : "Post Adjustments"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border-subtle bg-bg-elevated/60 p-6 text-sm text-fg-muted">
                    Loading...
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

