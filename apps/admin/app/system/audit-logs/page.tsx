"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Audit feed (read-only). Use filters to narrow down to a document or action.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-5">
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
          <div className="md:col-span-5 flex items-center justify-end gap-2">
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit Logs</CardTitle>
          <CardDescription>Most recent first.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>User</th>
                  <th className="text-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((r) => (
                    <tr key={r.id} className="ui-tr ui-tr-hover align-top">
                      <td className="text-fg-subtle data-mono">{r.created_at}</td>
                      <td className="text-fg-muted">{r.action}</td>
                      <td className="text-fg-muted">
                        <div className="text-fg-muted">{r.entity_type}</div>
                        <div className="text-fg-subtle data-mono">{r.entity_id}</div>
                      </td>
                      <td className="text-fg-subtle">{r.user_email || r.user_id || "-"}</td>
                      <td className="text-right">
                        <pre className="whitespace-pre-wrap text-left text-xs text-fg-subtle">
                          {JSON.stringify(r.details ?? {}, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="ui-tr">
                    <td colSpan={5} className="py-8 text-center text-fg-subtle">
                      No audit logs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
