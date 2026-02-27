"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Inbox, RefreshCw } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const [loading, setLoading] = useState(false);
  const [requeueingId, setRequeueingId] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState<string>("failed");
  const [filterDeviceId, setFilterDeviceId] = useState<string>("");
  const [limit, setLimit] = useState<string>("200");

  const canRequeue = useMemo(() => new Set(["failed", "dead"]), []);

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const qs = new URLSearchParams();
      if (filterStatus) qs.set("status", filterStatus);
      if (filterDeviceId.trim()) qs.set("device_id", filterDeviceId.trim());
      const n = Number(limit || 200);
      const clamped = Number.isFinite(n) ? Math.min(1000, Math.max(1, Math.trunc(n))) : 200;
      qs.set("limit", String(clamped));
      const res = await apiGet<{ events: OutboxRow[] }>(`/pos/outbox?${qs.toString()}`);
      setEvents(res.events || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requeue(eventId: string) {
    setRequeueingId(eventId);
    setStatus("");
    try {
      await apiPost(`/pos/outbox/${eventId}/requeue`, {});
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setRequeueingId(null);
    }
  }

  const columns = useMemo<ColumnDef<OutboxRow>[]>(
    () => [
      {
        id: "created_at",
        accessorFn: (r) => r.created_at,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => <span className="font-mono text-sm">{formatDateTime(row.original.created_at)}</span>,
      },
      {
        id: "status",
        accessorFn: (r) => r.status,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "device",
        accessorFn: (r) => `${r.device_code} ${r.device_id}`,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Device" />,
        cell: ({ row }) => (
          <div>
            <span className="font-mono text-sm">{row.original.device_code}</span>
            <div className="font-mono text-xs text-muted-foreground">{row.original.device_id}</div>
          </div>
        ),
      },
      {
        id: "event_type",
        accessorFn: (r) => r.event_type,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.event_type}</span>,
      },
      {
        id: "attempts",
        accessorFn: (r) => Number(r.attempt_count || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Attempts" />,
        cell: ({ row }) => <span className="font-mono text-sm">{Number(row.original.attempt_count || 0)}</span>,
      },
      {
        id: "processed_at",
        accessorFn: (r) => r.processed_at || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Processed" />,
        cell: ({ row }) => <span className="font-mono text-sm">{formatDateTime(row.original.processed_at)}</span>,
      },
      {
        id: "error",
        header: "Error",
        cell: ({ row }) =>
          row.original.error_message ? (
            <pre className="max-w-[520px] whitespace-pre-wrap text-xs text-muted-foreground">{row.original.error_message}</pre>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) =>
          canRequeue.has(row.original.status) ? (
            <Button variant="outline" size="sm" onClick={() => requeue(row.original.id)} disabled={loading || requeueingId != null}>
              {requeueingId === row.original.id ? "Requeuing..." : "Requeue"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
    ],
    [canRequeue, loading, requeueingId],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Outbox"
        description="Monitor and requeue failed POS/outbox events."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading || requeueingId != null}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {status && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            Filters
          </CardTitle>
          <CardDescription>Filter events by status, device, and limit.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={filterStatus || "__all__"} onValueChange={(v) => setFilterStatus(v === "__all__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processed">Processed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="dead">Dead</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Device ID (optional)</label>
              <Input value={filterDeviceId} onChange={(e) => setFilterDeviceId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Limit</label>
              <Input value={limit} onChange={(e) => setLimit(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={load} disabled={loading}>
              {loading ? "Loading..." : "Apply Filters"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Events */}
      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>{events.length} event(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={events} isLoading={loading} searchPlaceholder="Search device / type / status..." />
        </CardContent>
      </Card>
    </div>
  );
}
