"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/error-banner";

type AttachmentRow = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256?: string | null;
  uploaded_at: string;
  uploaded_by_user_id?: string | null;
};

function fmtBytes(n: number) {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentAttachments(props: {
  entityType: string;
  entityId: string;
  title?: string;
  description?: string;
  allowUpload?: boolean;
}) {
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await apiGet<{ attachments: AttachmentRow[] }>(
        `/attachments?entity_type=${encodeURIComponent(props.entityType)}&entity_id=${encodeURIComponent(props.entityId)}`
      );
      setAttachments(res.attachments || []);
    } catch (e) {
      setAttachments([]);
      setErr(e);
    }
  }, [props.entityType, props.entityId]);

  useEffect(() => {
    if (!props.entityId) return;
    load();
  }, [props.entityId, load]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!props.allowUpload) return;
    const form = e.target as HTMLFormElement;
    const input = form.querySelector<HTMLInputElement>("input[type='file']");
    const f = input?.files?.[0];
    if (!f) return;
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("entity_type", props.entityType);
      fd.set("entity_id", props.entityId);
      fd.set("file", f);
      const raw = await fetch("/api/attachments", { method: "POST", body: fd, credentials: "include" });
      if (!raw.ok) throw new Error(await raw.text());
      await load();
      if (input) input.value = "";
    } catch (e2) {
      setErr(e2);
    } finally {
      setUploading(false);
    }
  }

  const title = props.title || "Attachments";
  const description = props.description || "Supporting files for audit and reconciliation.";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={load}>
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {err ? <ErrorBanner error={err} onRetry={load} /> : null}

        {props.allowUpload ? (
          <form onSubmit={upload} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Upload (max 5MB)</label>
              <input type="file" className="block text-xs" disabled={uploading} />
            </div>
            <Button type="submit" disabled={uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </form>
        ) : null}

        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead className="ui-thead">
              <tr>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {attachments.map((a) => (
                <tr key={a.id} className="ui-tr-hover">
                  <td className="px-3 py-2 text-sm">{a.filename}</td>
                  <td className="px-3 py-2 text-xs text-fg-muted">{a.content_type}</td>
                  <td className="px-3 py-2 text-xs text-fg-muted">{fmtBytes(a.size_bytes)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/attachments/${encodeURIComponent(a.id)}/view`} target="_blank" rel="noreferrer">
                          View
                        </a>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/attachments/${encodeURIComponent(a.id)}/download`} target="_blank" rel="noreferrer">
                          Download
                        </a>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {attachments.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                    No attachments.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

