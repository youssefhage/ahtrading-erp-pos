"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type PeriodLock = {
  id: string;
  start_date: string;
  end_date: string;
  locked: boolean;
  reason: string | null;
  created_at: string;
  created_by_email: string | null;
};

function todayIso() {
    const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function PeriodLocksPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [locks, setLocks] = useState<PeriodLock[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [creating, setCreating] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string>("");
  const [confirmNextLocked, setConfirmNextLocked] = useState<boolean>(false);
  const [toggling, setToggling] = useState(false);
  const statusIsBusy = /^(Creating|Locking|Unlocking)\b/i.test(status);

  const columns = useMemo((): Array<DataTableColumn<PeriodLock>> => {
    return [
      {
        id: "range",
        header: "Range",
        accessor: (l) => `${l.start_date} ${l.end_date}`.trim(),
        mono: true,
        sortable: true,
        globalSearch: false,
        cell: (l) => (
          <span className="font-mono text-xs">
            {l.start_date} → {l.end_date}
          </span>
        ),
      },
      { id: "locked", header: "Status", accessor: (l) => (l.locked ? "Locked" : "Unlocked"), sortable: true, globalSearch: false, cell: (l) => <StatusChip value={l.locked ? "locked" : "open"} /> },
      { id: "reason", header: "Reason", accessor: (l) => l.reason || "-", sortable: true, cell: (l) => <span className="text-xs text-fg-muted">{l.reason || "-"}</span> },
      { id: "created_by_email", header: "By", accessor: (l) => l.created_by_email || "-", sortable: true, cell: (l) => <span className="text-xs text-fg-muted">{l.created_by_email || "-"}</span> },
      {
        id: "actions",
        header: "",
        accessor: () => "",
        globalSearch: false,
        cell: (l) =>
          l.locked ? (
            <Button variant="outline" size="sm" onClick={() => askToggle(l.id, false)}>
              Unlock
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => askToggle(l.id, true)}>
              Lock
            </Button>
          ),
      },
    ];
  }, []);

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const res = await apiGet<{ locks: PeriodLock[] }>("/accounting/period-locks");
      setLocks(res.locks || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createLock(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/accounting/period-locks", {
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim() || null,
        locked: true
      });
      setCreateOpen(false);
      setReason("");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

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
      await apiPost(`/accounting/period-locks/${confirmId}/set?locked=${confirmNextLocked ? "true" : "false"}`, {});
      setConfirmOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Accounting</p>
            <h1 className="ui-module-title">Period Locks</h1>
            <p className="ui-module-subtitle">Control posting windows during month-end and close processes.</p>
          </div>
        </div>
      </div>
      {status && !statusIsBusy ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Locks</CardTitle>
          <CardDescription>{locks.length} locks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="ui-actions-between">
            <Button variant="outline" onClick={load} disabled={loading || creating || toggling}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>New Lock</Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Create Period Lock</DialogTitle>
                  <DialogDescription>Blocks journal inserts for the date range (inclusive).</DialogDescription>
                </DialogHeader>
                <form onSubmit={createLock} className="ui-form-grid-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Start Date</label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">End Date</label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Month-end close Jan 2026" />
                  </div>
                  <div className="flex justify-end md:col-span-2">
                    <Button type="submit" disabled={creating}>
                      {creating ? "..." : "Create Lock"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <DataTable<PeriodLock>
            tableId="accounting.periodLocks"
            rows={locks}
            columns={columns}
            isLoading={loading}
            initialSort={{ columnId: "range", dir: "desc" }}
            globalFilterPlaceholder="Search reason / by..."
            emptyText={loading ? "Loading..." : "No locks."}
          />
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmNextLocked ? "Lock Period?" : "Unlock Period?"}</DialogTitle>
            <DialogDescription>This affects all posting that creates GL journals.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doToggle} disabled={toggling}>
              {toggling ? "..." : confirmNextLocked ? "Lock" : "Unlock"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
