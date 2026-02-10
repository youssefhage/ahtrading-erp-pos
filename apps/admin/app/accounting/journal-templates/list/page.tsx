"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { apiGet } from "@/lib/api";
import { ShortcutLink } from "@/components/shortcut-link";
import { DataTable, type DataTableColumn } from "@/components/data-table";
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

  const columns: Array<DataTableColumn<TemplateRow>> = [
    {
      id: "name",
      header: "Name",
      sortable: true,
      accessor: (t) => t.name,
      cell: (t) => (
        <div className="flex flex-col">
          <ShortcutLink href={`/accounting/journal-templates/${encodeURIComponent(t.id)}`} title="Open template">
            {t.name}
          </ShortcutLink>
          {t.memo ? <div className="mt-1 text-[11px] text-fg-muted">{t.memo}</div> : null}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (t) => (t.is_active ? "Active" : "Inactive"),
      cell: (t) => <span className="text-xs">{t.is_active ? "Active" : "Inactive"}</span>,
    },
    { id: "rate_type", header: "Rate Type", sortable: true, mono: true, accessor: (t) => t.default_rate_type, cell: (t) => <span className="font-mono text-xs">{t.default_rate_type}</span> },
    { id: "lines", header: "Lines", sortable: true, align: "right", mono: true, accessor: (t) => Number(t.line_count || 0), cell: (t) => String(Number(t.line_count || 0)) },
    { id: "updated", header: "Updated", sortable: true, mono: true, accessor: (t) => (t.updated_at || "").slice(0, 10), cell: (t) => <span className="font-mono text-xs text-fg-muted">{(t.updated_at || "").slice(0, 10)}</span> },
  ];

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
          <DataTable<TemplateRow>
            tableId="accounting.journal_templates.list"
            rows={templates}
            columns={columns}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "name", dir: "asc" }}
            globalFilterPlaceholder="Search name / memo / rate type"
          />
        </CardContent>
      </Card>
    </div>
  );
}
