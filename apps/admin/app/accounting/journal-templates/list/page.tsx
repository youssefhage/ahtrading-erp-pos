"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { apiGet } from "@/lib/api";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/error-banner";

type TemplateRow = {
  id: string;
  name: string;
  is_active: boolean;
  memo: string | null;
  default_rate_type: string;
  created_at: string;
  updated_at: string;
  created_by_email: string | null;
  line_count: number | string;
};

export default function JournalTemplatesListPage() {
  const [status, setStatus] = useState("");
  const [templates, setTemplates] = useState<TemplateRow[]>([]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ templates: TemplateRow[] }>("/accounting/journal-templates");
      setTemplates(res.templates || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Journal Templates</CardTitle>
          <CardDescription>Create recurring/templated journals (balanced entries).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
          <Button asChild>
            <Link href="/accounting/journal-templates/new">New Template</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>{templates.length} templates</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Rate Type</th>
                  <th className="px-3 py-2 text-right">Lines</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="ui-tr-hover">
                    <td className="px-3 py-2 text-xs">
                      <ShortcutLink href={`/accounting/journal-templates/${encodeURIComponent(t.id)}`} title="Open template">
                        {t.name}
                      </ShortcutLink>
                      {t.memo ? <div className="mt-1 text-[11px] text-fg-muted">{t.memo}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-xs">{t.is_active ? "Active" : "Inactive"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.default_rate_type}</td>
                    <td className="px-3 py-2 text-right data-mono text-xs">{Number(t.line_count || 0)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-fg-muted">{(t.updated_at || "").slice(0, 10)}</td>
                  </tr>
                ))}
                {templates.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                      No templates yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
