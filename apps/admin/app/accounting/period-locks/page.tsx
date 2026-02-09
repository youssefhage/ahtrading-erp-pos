"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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
  return new Date().toISOString().slice(0, 10);
}

export default function PeriodLocksPage() {
  const [status, setStatus] = useState("");
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

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ locks: PeriodLock[] }>("/accounting/period-locks");
      setLocks(res.locks || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
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
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Locks</CardTitle>
            <CardDescription>{locks.length} locks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
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
                  <form onSubmit={createLock} className="grid grid-cols-1 gap-3 md:grid-cols-2">
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

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Range</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">By</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {locks.map((l) => (
                    <tr key={l.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">
                        {l.start_date} → {l.end_date}
                      </td>
                      <td className="px-3 py-2 text-xs">{l.locked ? "Locked" : "Unlocked"}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{l.reason || "-"}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{l.created_by_email || "-"}</td>
                      <td className="px-3 py-2">
                        {l.locked ? (
                          <Button variant="outline" size="sm" onClick={() => askToggle(l.id, false)}>
                            Unlock
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => askToggle(l.id, true)}>
                            Lock
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {locks.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                        No locks.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
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
      </div>);
}
