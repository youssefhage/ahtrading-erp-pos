"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/error-banner";
import { ViewRaw } from "@/components/view-raw";

type AuditLogRow = {
  id: string;
  user_id: string | null;
  user_email?: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: any;
  created_at: string;
};

function fmtIso(iso: string) {
  const s = String(iso || "");
  return s.replace("T", " ").slice(0, 19);
}

export function DocumentTimeline(props: {
  entityType: string;
  entityId: string;
  title?: string;
  description?: string;
  limit?: number;
  variant?: "card" | "embedded";
}) {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ audit_logs: AuditLogRow[] }>(
        `/audit/logs?entity_type=${encodeURIComponent(props.entityType)}&entity_id=${encodeURIComponent(props.entityId)}&limit=${encodeURIComponent(
          String(props.limit || 200)
        )}`
      );
      setRows(res.audit_logs || []);
    } catch (e) {
      setRows([]);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [props.entityType, props.entityId, props.limit]);

  useEffect(() => {
    if (!props.entityId) return;
    load();
  }, [props.entityId, load]);

  const title = props.title || "Timeline";
  const description = props.description || "Audit trail of key actions on this document.";

  const content = (
    <>
      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead className="ui-thead">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Who</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2 text-right">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="ui-tr-hover">
                <td className="px-3 py-2 text-xs font-mono text-fg-muted">{fmtIso(r.created_at)}</td>
                <td className="px-3 py-2 text-xs">{r.user_email || (r.user_id ? String(r.user_id).slice(0, 8) : "system")}</td>
                <td className="px-3 py-2 text-sm">{r.action}</td>
                <td className="px-3 py-2 text-right">
                  <ViewRaw value={r.details} label="View" />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                  No audit entries.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );

  if (props.variant === "embedded") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="text-xs text-fg-subtle">{description}</div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
        {content}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{content}</CardContent>
    </Card>
  );
}
