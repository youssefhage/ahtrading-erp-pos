"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

type AuditLogRow = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details: unknown;
  created_at: string;
};

export default function AuditLogsPage() {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<AuditLogRow[]>([]);

  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [actionPrefix, setActionPrefix] = useState("");
  const [userId, setUserId] = useState("");
  const [limit, setLimit] = useState("200");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (entityType.trim()) p.set("entity_type", entityType.trim());
    if (entityId.trim()) p.set("entity_id", entityId.trim());
    if (actionPrefix.trim()) p.set("action_prefix", actionPrefix.trim());
    if (userId.trim()) p.set("user_id", userId.trim());
    const n = Number(limit || 200);
    p.set("limit", Number.isFinite(n) ? String(n) : "200");
    return p.toString();
  }, [entityType, entityId, actionPrefix, userId, limit]);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ audit_logs: AuditLogRow[] }>(`/reports/audit-logs?${qs}`);
      setRows(res.audit_logs || []);
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

  const columns = useMemo((): Array<DataTableColumn<AuditLogRow>> => {
    return [
      {
        id: "created_at",
        header: "Time",
        accessor: (r) => r.created_at,
        sortable: true,
        mono: true,
        cell: (r) => <span className="text-xs text-fg-subtle">{r.created_at}</span>,
      },
      {
        id: "action",
        header: "Action",
        accessor: (r) => r.action,
        sortable: true,
        cell: (r) => <span className="text-sm text-fg-muted">{r.action}</span>,
      },
      {
        id: "entity",
        header: "Entity",
        accessor: (r) => `${r.entity_type} ${r.entity_id}`,
        cell: (r) => (
          <div className="text-fg-muted">
            <div className="text-sm">{r.entity_type}</div>
            <div className="text-fg-subtle data-mono text-xs">{r.entity_id}</div>
          </div>
        ),
      },
      {
        id: "user",
        header: "User",
        accessor: (r) => r.user_email || r.user_id || "",
        cell: (r) => <span className="text-sm text-fg-subtle">{r.user_email || r.user_id || "-"}</span>,
      },
      {
        id: "details",
        header: "Details",
        accessor: (r) => "",
        globalSearch: false,
        defaultHidden: true,
        cell: (r) => (
          <pre className="max-w-[680px] whitespace-pre-wrap text-left text-xs text-fg-subtle">{JSON.stringify(r.details ?? {}, null, 2)}</pre>
        ),
      },
      {
        id: "id",
        header: "ID",
        accessor: (r) => r.id,
        mono: true,
        globalSearch: false,
        defaultHidden: true,
        cell: (r) => <span className="text-xs text-fg-subtle">{r.id}</span>,
      },
    ];
  }, []);

  return (
    <Page width="lg" className="px-4 pb-10">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="Audit Logs"
        description="Read-only audit feed. Use filters to narrow down to a document or action."
        actions={
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        }
      />

      <Section title="Filters" description="Filter by entity, action prefix, and user.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-fg-muted">Entity Type</label>
            <Input value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="sales_invoice" />
          </div>
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-fg-muted">Entity ID</label>
            <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-fg-muted">Action Prefix</label>
            <Input value={actionPrefix} onChange={(e) => setActionPrefix(e.target.value)} placeholder="sales." />
          </div>
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-fg-muted">User ID</label>
            <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid" />
          </div>
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-fg-muted">Limit</label>
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        </div>
      </Section>

      <Section title="Entries" description="Most recent first.">
        <DataTable<AuditLogRow>
          tableId="system.auditLogs"
          rows={rows}
          columns={columns}
          emptyText="No audit logs found."
          globalFilterPlaceholder="Search action / entity / user..."
          initialSort={{ columnId: "created_at", dir: "desc" }}
        />
      </Section>
    </Page>
  );
}
