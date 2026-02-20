"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

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

  const columns: Array<DataTableColumn<OutboxRow>> = [
    { id: "created_at", header: "Created", accessor: (e) => e.created_at, sortable: true, mono: true, cell: (e) => <span className="text-xs">{formatDateTime(e.created_at)}</span> },
    { id: "status", header: "Status", accessor: (e) => e.status, sortable: true, mono: true, cell: (e) => <span className="text-xs">{e.status}</span> },
    {
      id: "device",
      header: "Device",
      accessor: (e) => `${e.device_code} ${e.device_id}`,
      mono: true,
      cell: (e) => (
        <span className="font-mono text-xs">
          {e.device_code}
          <div className="text-xs text-fg-subtle">{e.device_id}</div>
        </span>
      ),
    },
    { id: "event_type", header: "Type", accessor: (e) => e.event_type, sortable: true, mono: true, cell: (e) => <span className="text-xs">{e.event_type}</span> },
    { id: "attempts", header: "Attempts", accessor: (e) => Number(e.attempt_count || 0), sortable: true, align: "right", mono: true, cell: (e) => <span className="text-xs">{Number(e.attempt_count || 0)}</span> },
    { id: "processed_at", header: "Processed", accessor: (e) => e.processed_at || "", sortable: true, mono: true, cell: (e) => <span className="text-xs">{formatDateTime(e.processed_at)}</span> },
    {
      id: "error",
      header: "Error",
      accessor: (e) => "",
      globalSearch: false,
      defaultHidden: true,
      cell: (e) =>
        e.error_message ? (
          <pre className="max-w-[520px] whitespace-pre-wrap text-xs text-fg-muted">{e.error_message}</pre>
        ) : (
          <span className="text-xs text-fg-subtle">-</span>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      accessor: (e) => "",
      globalSearch: false,
      align: "right",
      cell: (e) =>
        canRequeue.has(e.status) ? (
          <Button variant="outline" size="sm" onClick={() => requeue(e.id)} disabled={loading || requeueingId != null}>
            {requeueingId === e.id ? "Requeuing..." : "Requeue"}
          </Button>
        ) : (
          <span className="text-xs text-fg-subtle">-</span>
        ),
    },
  ];

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

  return (
    <Page width="lg" className="px-4 pb-10">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="Outbox"
        description="Monitor and requeue failed POS/outbox events."
        actions={
          <Button variant="outline" onClick={load} disabled={loading || requeueingId != null}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        }
      />

      <Section title="Filters" description="Filter events by status, device, and limit.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-fg-muted">Status</label>
              <select
                className="ui-select"
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
              <label className="text-xs font-medium text-fg-muted">Device ID (optional)</label>
              <Input value={filterDeviceId} onChange={(e) => setFilterDeviceId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-fg-muted">Limit</label>
              <Input value={limit} onChange={(e) => setLimit(e.target.value)} />
            </div>
        </div>
      </Section>

      <Section title="Events" description={`${events.length} event(s)`}>
        <DataTable<OutboxRow>
          tableId="system.outbox"
          rows={events}
          columns={columns}
          isLoading={loading}
          emptyText={loading ? "Loading..." : "No events."}
          globalFilterPlaceholder="Search device / type / status..."
          initialSort={{ columnId: "created_at", dir: "desc" }}
        />
      </Section>
    </Page>
  );
}
