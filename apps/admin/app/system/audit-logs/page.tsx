"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { FileSearch, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { ViewRaw } from "@/components/view-raw";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
  const [loading, setLoading] = useState(true);
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
    const clamped = Number.isFinite(n) ? Math.min(500, Math.max(1, Math.trunc(n))) : 200;
    p.set("limit", String(clamped));
    return p.toString();
  }, [entityType, entityId, actionPrefix, userId, limit]);

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const res = await apiGet<{ audit_logs: AuditLogRow[] }>(`/reports/audit-logs?${qs}`);
      setRows(res.audit_logs || []);
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

  const columns = useMemo<ColumnDef<AuditLogRow>[]>(
    () => [
      {
        id: "created_at",
        accessorFn: (r) => r.created_at,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Time" />,
        cell: ({ row }) => <span className="font-mono text-sm text-muted-foreground">{formatDateTime(row.original.created_at)}</span>,
      },
      {
        accessorKey: "action",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Action" />,
        cell: ({ row }) => <span className="text-sm">{row.original.action}</span>,
      },
      {
        id: "entity",
        accessorFn: (r) => `${r.entity_type} ${r.entity_id}`,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Entity" />,
        cell: ({ row }) => (
          <div>
            <div className="text-sm">{row.original.entity_type}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.entity_id}</div>
          </div>
        ),
      },
      {
        id: "user",
        accessorFn: (r) => r.user_email || r.user_id || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="User" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.user_email || row.original.user_id || "-"}</span>,
      },
      {
        id: "details",
        header: "Details",
        cell: ({ row }) => <ViewRaw value={row.original.details ?? {}} label="Details" />,
      },
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Read-only audit feed. Use filters to narrow down to a document or action."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
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
            <FileSearch className="h-4 w-4" />
            Filters
          </CardTitle>
          <CardDescription>Filter by entity, action prefix, and user.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Entity Type</label>
              <Input value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="sales_invoice" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Entity ID</label>
              <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Action Prefix</label>
              <Input value={actionPrefix} onChange={(e) => setActionPrefix(e.target.value)} placeholder="sales." />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">User ID</label>
              <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid" />
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

      {/* Entries */}
      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
          <CardDescription>Most recent first. {rows.length} row(s) loaded.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={loading}
            searchPlaceholder="Search action / entity / user..."
          />
        </CardContent>
      </Card>
    </div>
  );
}
