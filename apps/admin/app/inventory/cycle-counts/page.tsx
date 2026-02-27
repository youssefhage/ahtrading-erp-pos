"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";

import { apiGet, apiPatch, apiPost, getCompanyId } from "@/lib/api";
import { getDefaultWarehouseId, setDefaultWarehouseId } from "@/lib/op-context";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type WarehouseRow = { id: string; name: string };
type LocationRow = { id: string; code: string; name?: string | null };
type PlanRow = {
  id: string; name: string; warehouse_id: string; warehouse_name: string;
  location_id: string | null; location_code: string | null;
  frequency_days: number; next_run_date: string; is_active: boolean; updated_at: string;
};
type TaskRow = {
  id: string; plan_id: string | null; plan_name: string | null;
  warehouse_id: string; warehouse_name: string;
  location_id: string | null; location_code: string | null;
  status: string; scheduled_date: string; created_at: string;
};
type TaskLine = {
  id: string; item_id: string; item_sku: string; item_name: string;
  expected_qty: string | number; counted_qty: string | number | null; notes: string | null;
};

function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function toNum(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export default function CycleCountsPage() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locationId, setLocationId] = useState("");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [taskStatus, setTaskStatus] = useState("open");

  const [createOpen, setCreateOpen] = useState(false);
  const [planName, setPlanName] = useState("Main warehouse cycle count");
  const [frequencyDays, setFrequencyDays] = useState("7");
  const [nextRunDate, setNextRunDate] = useState(todayISO());
  const [savingPlan, setSavingPlan] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState("");
  const [detail, setDetail] = useState<{ task: any; lines: TaskLine[] } | null>(null);
  const [savingCounts, setSavingCounts] = useState(false);
  const [posting, setPosting] = useState(false);

  const loadWarehouses = useCallback(async () => {
    const res = await apiGet<{ warehouses: WarehouseRow[] }>("/warehouses");
    const ws = res.warehouses || []; setWarehouses(ws);
    const cid = getCompanyId(); const def = getDefaultWarehouseId(cid);
    setWarehouseId(def && ws.find((w) => w.id === def) ? def : (ws[0]?.id || ""));
  }, []);
  const loadLocations = useCallback(async (wid: string) => {
    if (!wid) { setLocations([]); setLocationId(""); return; }
    const res = await apiGet<{ locations: LocationRow[] }>(`/inventory/warehouses/${encodeURIComponent(wid)}/locations?limit=500`);
    setLocations(res.locations || []); setLocationId((p) => (p && (res.locations || []).find((l) => l.id === p) ? p : ""));
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true); setStatus("");
    try {
      const [p, t] = await Promise.all([
        apiGet<{ plans: PlanRow[] }>("/warehouse/cycle-count/plans"),
        apiGet<{ tasks: TaskRow[] }>(`/warehouse/cycle-count/tasks?status=${encodeURIComponent(taskStatus)}&limit=200`),
      ]);
      setPlans(p.plans || []); setTasks(t.tasks || []); setStatus("");
    } catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [taskStatus]);

  useEffect(() => { loadWarehouses().catch(() => {}); }, [loadWarehouses]);
  useEffect(() => { if (!warehouseId) return; setDefaultWarehouseId(getCompanyId(), warehouseId); loadLocations(warehouseId).catch(() => {}); }, [warehouseId, loadLocations]);
  useEffect(() => { refresh(); }, [refresh]);

  async function createPlan(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId) return; setSavingPlan(true);
    try {
      await apiPost("/warehouse/cycle-count/plans", {
        name: planName.trim(), warehouse_id: warehouseId, location_id: locationId.trim() || null,
        frequency_days: Number(frequencyDays || 7), next_run_date: nextRunDate, is_active: true,
      });
      setCreateOpen(false); await refresh();
    } catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
    finally { setSavingPlan(false); }
  }
  async function runPlanNow(planId: string) {
    setStatus("Creating task...");
    try { await apiPost(`/warehouse/cycle-count/plans/${encodeURIComponent(planId)}/run`, {}); await refresh(); setStatus(""); }
    catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
  }
  async function openTask(taskId: string) {
    setDetailOpen(true); setDetailTaskId(taskId); setDetail(null);
    try { const res = await apiGet<{ task: any; lines: TaskLine[] }>(`/warehouse/cycle-count/tasks/${encodeURIComponent(taskId)}`); setDetail(res); }
    catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
  }
  function updateLine(id: string, patch: Partial<TaskLine>) {
    setDetail((p) => p ? { ...p, lines: p.lines.map((l) => l.id === id ? { ...l, ...patch } : l) } : p);
  }
  async function saveCounts() {
    if (!detailTaskId || !detail) return; setSavingCounts(true);
    try {
      await apiPatch(`/warehouse/cycle-count/tasks/${encodeURIComponent(detailTaskId)}/count`, {
        lines: detail.lines.map((l) => ({ id: l.id, counted_qty: l.counted_qty == null || l.counted_qty === "" ? null : Number(l.counted_qty), notes: (l.notes || "").trim() || null })),
      });
      await openTask(detailTaskId);
    } catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
    finally { setSavingCounts(false); }
  }
  async function postTask() {
    if (!detailTaskId) return; setPosting(true);
    try { await apiPost(`/warehouse/cycle-count/tasks/${encodeURIComponent(detailTaskId)}/post`, {}); setDetailOpen(false); setDetail(null); await refresh(); }
    catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
    finally { setPosting(false); }
  }

  const planColumns = useMemo<ColumnDef<PlanRow>[]>(() => [
    { id: "plan", accessorFn: (p) => p.name, header: ({ column }) => <DataTableColumnHeader column={column} title="Plan" />, cell: ({ row }) => (<div><div className="font-medium">{row.original.name}</div><div className="text-xs text-muted-foreground font-mono">{row.original.id.slice(0, 8)}</div></div>) },
    { id: "scope", accessorFn: (p) => `${p.warehouse_name} ${p.location_code || "ALL"}`, header: ({ column }) => <DataTableColumnHeader column={column} title="Scope" />, cell: ({ row }) => (<div className="text-xs text-muted-foreground"><div>{row.original.warehouse_name}</div><div>Loc: <span className="font-mono">{row.original.location_code || "ALL"}</span></div></div>) },
    { id: "freq", accessorFn: (p) => p.frequency_days, header: "Freq", cell: ({ row }) => <span className="font-mono text-sm">{row.original.frequency_days}d</span> },
    { id: "next", accessorFn: (p) => p.next_run_date, header: ({ column }) => <DataTableColumnHeader column={column} title="Next" />, cell: ({ row }) => <span className="font-mono text-xs">{String(row.original.next_run_date).slice(0, 10)}</span> },
    { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <Button size="sm" onClick={() => runPlanNow(row.original.id)} disabled={!row.original.is_active}>Run</Button> },
  ], []);

  const taskColumns = useMemo<ColumnDef<TaskRow>[]>(() => [
    { id: "date", accessorFn: (t) => t.scheduled_date, header: ({ column }) => <DataTableColumnHeader column={column} title="When" />, cell: ({ row }) => <span className="font-mono text-xs">{String(row.original.scheduled_date).slice(0, 10)}</span> },
    { id: "scope", accessorFn: (t) => `${t.warehouse_name} ${t.location_code || "ALL"}`, header: "Scope", cell: ({ row }) => (<div className="text-xs text-muted-foreground"><div>{row.original.warehouse_name}</div><div>Loc: <span className="font-mono">{row.original.location_code || "ALL"}</span></div></div>) },
    { id: "status", accessorFn: (t) => t.status, header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <Button size="sm" variant="outline" onClick={() => openTask(row.original.id)}>View</Button> },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Cycle Counts"
        description="Plan scheduled counts, enter quantities, and post adjustments"
        actions={
          <>
            <select className="h-9 rounded-md border bg-background px-3 text-sm" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              {!warehouses.length && <option value="">No warehouses</option>}
            </select>
            <select className="h-9 rounded-md border bg-background px-3 text-sm" value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)}>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="posted">Posted</option>
              <option value="">All</option>
            </select>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" />Create Plan</Button></DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create Cycle Count Plan</DialogTitle>
                  <DialogDescription>Plans generate tasks on a schedule. You can also run a plan immediately.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createPlan} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                  <div className="md:col-span-6 space-y-1"><label className="text-xs font-medium text-muted-foreground">Name</label><Input value={planName} onChange={(e) => setPlanName(e.target.value)} /></div>
                  <div className="md:col-span-3 space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Location</label>
                    <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                      <option value="">Whole warehouse</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.code}{l.name ? ` \u00b7 ${l.name}` : ""}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-1 space-y-1"><label className="text-xs font-medium text-muted-foreground">Freq (days)</label><Input value={frequencyDays} onChange={(e) => setFrequencyDays(e.target.value)} /></div>
                  <div className="md:col-span-2 space-y-1"><label className="text-xs font-medium text-muted-foreground">Next Run</label><Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} /></div>
                  <div className="md:col-span-6 flex justify-end"><Button type="submit" disabled={savingPlan}>{savingPlan ? "Saving..." : "Save"}</Button></div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />
      {status && <p className="text-sm text-destructive">{status}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plans</CardTitle>
            <CardDescription>{plans.filter((p) => p.is_active).length} active {"\u00b7"} {plans.length} total</CardDescription>
          </CardHeader>
          <CardContent><DataTable columns={planColumns} data={plans} pageSize={10} /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks</CardTitle>
            <CardDescription>{tasks.length} shown</CardDescription>
          </CardHeader>
          <CardContent><DataTable columns={taskColumns} data={tasks} pageSize={10} /></CardContent>
        </Card>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Cycle Count Task</DialogTitle>
            <DialogDescription>Enter counted quantities, save, then post to create adjustments.</DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
                <div>Warehouse: <span className="font-mono">{detail.task?.warehouse_id}</span></div>
                <div>Location: <span className="font-mono">{detail.task?.location_id || "ALL"}</span></div>
                <div>Status: <StatusBadge status={detail.task?.status || "open"} /></div>
              </div>
              <div className="max-h-[420px] overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-right">Expected</th><th className="px-3 py-2 text-right">Counted</th><th className="px-3 py-2 text-left">Notes</th><th className="px-3 py-2 text-right">Diff</th></tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => {
                      const expected = toNum(l.expected_qty);
                      const counted = l.counted_qty == null || l.counted_qty === "" ? null : toNum(l.counted_qty);
                      const diff = counted == null ? null : counted - expected;
                      return (
                        <tr key={l.id} className="border-t hover:bg-muted/30">
                          <td className="px-3 py-2"><div className="font-mono text-xs">{l.item_sku || l.item_id.slice(0, 8)}</div><div className="text-xs text-muted-foreground">{l.item_name}</div></td>
                          <td className="px-3 py-2 text-right font-mono">{expected.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                          <td className="px-3 py-2 text-right"><Input value={l.counted_qty == null ? "" : String(l.counted_qty)} onChange={(e) => updateLine(l.id, { counted_qty: e.target.value })} placeholder="0" className="h-9 w-32 text-right font-mono" /></td>
                          <td className="px-3 py-2"><Input value={l.notes || ""} onChange={(e) => updateLine(l.id, { notes: e.target.value })} placeholder="Optional" className="h-9" /></td>
                          <td className={`px-3 py-2 text-right font-mono ${diff != null && diff !== 0 ? (diff > 0 ? "text-green-600" : "text-destructive") : ""}`}>{diff == null ? "-" : diff.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={saveCounts} disabled={savingCounts}>{savingCounts ? "Saving..." : "Save Counts"}</Button>
                <Button onClick={postTask} disabled={posting}>{posting ? "Posting..." : "Post Adjustments"}</Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/50 p-6 text-sm text-muted-foreground">Loading...</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
