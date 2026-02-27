"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Lock, LockOpen, ShieldCheck } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDate } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { KpiCard } from "@/components/business/kpi-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type PeriodLock = {
  id: string;
  start_date: string;
  end_date: string;
  locked: boolean;
  reason: string | null;
  created_at: string;
  created_by_email: string | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function PeriodLocksPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [locks, setLocks] = useState<PeriodLock[]>([]);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [reason, setReason] = useState("");

  // Confirm toggle dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState("");
  const [confirmNextLocked, setConfirmNextLocked] = useState(false);
  const [toggling, setToggling] = useState(false);

  const statusIsBusy = /^(Creating|Locking|Unlocking)\b/i.test(status);

  const summary = useMemo(() => {
    const total = locks.length;
    const locked = locks.filter((l) => l.locked).length;
    const unlocked = total - locked;
    return { total, locked, unlocked };
  }, [locks]);

  const columns = useMemo<ColumnDef<PeriodLock>[]>(
    () => [
      {
        id: "range",
        accessorFn: (l) => `${l.start_date} ${l.end_date}`,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date Range" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.start_date} &rarr; {row.original.end_date}
          </span>
        ),
      },
      {
        id: "locked",
        accessorFn: (l) => (l.locked ? "Locked" : "Unlocked"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.locked ? "overdue" : "active"} />
        ),
      },
      {
        id: "reason",
        accessorFn: (l) => l.reason || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Reason" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.reason || "-"}
          </span>
        ),
      },
      {
        id: "created_by_email",
        accessorFn: (l) => l.created_by_email || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.created_by_email || "-"}
          </span>
        ),
      },
      {
        id: "created_at",
        accessorFn: (l) => l.created_at || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm text-muted-foreground">
            {row.original.created_at ? formatDate(row.original.created_at) : "-"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            {row.original.locked ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => askToggle(row.original.id, false)}
              >
                <LockOpen className="mr-1 h-3 w-3" />
                Unlock
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => askToggle(row.original.id, true)}
              >
                <Lock className="mr-1 h-3 w-3" />
                Lock
              </Button>
            )}
          </div>
        ),
      },
    ],
    [],
  );

  /* ---------------------------------------------------------------- */
  /*  Data loading                                                    */
  /* ---------------------------------------------------------------- */

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const res = await apiGet<{ locks: PeriodLock[] }>("/accounting/period-locks");
      setLocks(res.locks || []);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Create lock                                                     */
  /* ---------------------------------------------------------------- */

  async function createLock(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate) return setStatus("Start and end dates are required.");
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/accounting/period-locks", {
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim() || null,
        locked: true,
      });
      setCreateOpen(false);
      setReason("");
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Toggle lock / unlock                                            */
  /* ---------------------------------------------------------------- */

  function askToggle(id: string, nextLocked: boolean) {
    setConfirmId(id);
    setConfirmNextLocked(nextLocked);
    setConfirmOpen(true);
  }

  async function doToggle() {
    if (!confirmId) return;
    setToggling(true);
    setStatus(confirmNextLocked ? "Locking..." : "Unlocking...");
    try {
      await apiPost(
        `/accounting/period-locks/${confirmId}/set?locked=${confirmNextLocked ? "true" : "false"}`,
        {},
      );
      setConfirmOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Period Locks"
        description="Control posting windows during month-end and close processes."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New Lock
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Period Lock</DialogTitle>
                  <DialogDescription>
                    Blocks journal posting for the date range (inclusive).
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={createLock} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Date</Label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>End Date</Label>
                      <Input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Reason (optional)</Label>
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. Month-end close Jan 2026"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating}>
                      {creating ? "Creating..." : "Create Lock"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {status && !statusIsBusy && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* KPI Summary */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard title="Total Locks" value={summary.total} icon={ShieldCheck} />
        <KpiCard
          title="Locked"
          value={summary.locked}
          trend={summary.locked > 0 ? "neutral" : undefined}
        />
        <KpiCard
          title="Unlocked"
          value={summary.unlocked}
          trend={summary.unlocked > 0 ? "neutral" : undefined}
        />
      </div>

      {/* Locks Table */}
      <Card>
        <CardHeader>
          <CardTitle>Locks</CardTitle>
          <p className="text-sm text-muted-foreground">{locks.length} period locks</p>
        </CardHeader>
        <CardContent>
          {!loading && locks.length === 0 ? (
            <EmptyState
              icon={Lock}
              title="No period locks"
              description="Create a period lock to restrict posting for a date range."
              action={{ label: "New Lock", onClick: () => setCreateOpen(true) }}
            />
          ) : (
            <DataTable
              columns={columns}
              data={locks}
              isLoading={loading}
              searchPlaceholder="Search reason / email..."
            />
          )}
        </CardContent>
      </Card>

      {/* Confirm Lock / Unlock */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmNextLocked ? "Lock Period?" : "Unlock Period?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmNextLocked
                ? "Locking this period will prevent all journal posting within its date range."
                : "Unlocking this period will allow journal posting within its date range again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggling}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={toggling} onClick={doToggle}>
              {toggling
                ? confirmNextLocked
                  ? "Locking..."
                  : "Unlocking..."
                : confirmNextLocked
                  ? "Lock"
                  : "Unlock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
