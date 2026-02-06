"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type OutboxRow = {
  id: string;
  device_id: string;
  device_code: string;
  event_type: string;
  created_at: string;
  status: string;
  attempt_count: number;
  error_message: string | null;
  processed_at: string | null;
};

const statusChoices = ["", "pending", "processed", "failed", "dead"] as const;

export default function OutboxPage() {
  const [events, setEvents] = useState<OutboxRow[]>([]);
  const [status, setStatus] = useState("");

  const [filterStatus, setFilterStatus] = useState<string>("failed");
  const [filterDeviceId, setFilterDeviceId] = useState<string>("");
  const [limit, setLimit] = useState<string>("200");

  const canRequeue = useMemo(() => new Set(["failed", "dead"]), []);

  async function load() {
    setStatus("Loading...");
    try {
      const qs = new URLSearchParams();
      if (filterStatus) qs.set("status", filterStatus);
      if (filterDeviceId.trim()) qs.set("device_id", filterDeviceId.trim());
      const n = Number(limit || 200);
      qs.set("limit", Number.isFinite(n) ? String(n) : "200");
      const res = await apiGet<{ events: OutboxRow[] }>(`/pos/outbox?${qs.toString()}`);
      setEvents(res.events || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requeue(eventId: string) {
    setStatus("Requeuing...");
    try {
      await apiPost(`/pos/outbox/${eventId}/requeue`, {});
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <AppShell title="Outbox">
      <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Use this screen to monitor and requeue failed POS/outbox events.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-slate-700">Status</label>
              <select
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                {statusChoices.map((s) => (
                  <option key={s || "all"} value={s}>
                    {s ? s : "all"}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-slate-700">Device ID (optional)</label>
              <Input value={filterDeviceId} onChange={(e) => setFilterDeviceId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-slate-700">Limit</label>
              <Input value={limit} onChange={(e) => setLimit(e.target.value)} />
            </div>
            <div className="md:col-span-4 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Events</CardTitle>
            <CardDescription>{events.length} events</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Device</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Attempts</th>
                    <th className="px-3 py-2">Processed</th>
                    <th className="px-3 py-2">Error</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 font-mono text-xs">{e.created_at}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.status}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {e.device_code}
                        <div className="text-[10px] text-slate-500">{e.device_id}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{e.event_type}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{e.attempt_count}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.processed_at || "-"}</td>
                      <td className="px-3 py-2">
                        {e.error_message ? (
                          <pre className="max-w-[520px] whitespace-pre-wrap text-[11px] text-slate-700">
                            {e.error_message}
                          </pre>
                        ) : (
                          <span className="text-xs text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canRequeue.has(e.status) ? (
                          <Button variant="outline" size="sm" onClick={() => requeue(e.id)}>
                            Requeue
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-500">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {events.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                        No events.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

