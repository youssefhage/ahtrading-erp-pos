"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, FileText } from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function JournalTemplatesListPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);

  const columns = useMemo<ColumnDef<TemplateRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (t) => t.name,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <Link
              href={`/accounting/journal-templates/${encodeURIComponent(row.original.id)}`}
              className="font-medium text-primary hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.memo && (
              <span className="mt-0.5 text-xs text-muted-foreground">{row.original.memo}</span>
            )}
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (t) => (t.is_active ? "active" : "inactive"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.is_active ? "active" : "inactive"} />
        ),
      },
      {
        id: "rate_type",
        accessorFn: (t) => t.default_rate_type,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Rate Type" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.default_rate_type}</span>
        ),
      },
      {
        id: "lines",
        accessorFn: (t) => Number(t.line_count || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lines" className="justify-end" />,
        cell: ({ row }) => (
          <div className="text-right font-mono text-sm">{Number(row.original.line_count || 0)}</div>
        ),
      },
      {
        id: "updated",
        accessorFn: (t) => t.updated_at || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatDate(row.original.updated_at)}</span>
        ),
      },
    ],
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const res = await apiGet<{ templates: TemplateRow[] }>("/accounting/journal-templates");
      setTemplates(res.templates || []);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Journal Templates"
        description="Create reusable templates for recurring balanced journal entries."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" asChild>
              <Link href="/accounting/journal-templates/new">
                <Plus className="mr-2 h-4 w-4" />
                New Template
              </Link>
            </Button>
          </>
        }
      />

      {status && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <p className="text-sm text-muted-foreground">{templates.length} templates</p>
        </CardHeader>
        <CardContent>
          {!loading && templates.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No templates yet"
              description="Create a reusable template for recurring journal entries."
              action={{ label: "New Template", onClick: () => window.location.assign("/accounting/journal-templates/new") }}
            />
          ) : (
            <DataTable
              columns={columns}
              data={templates}
              isLoading={loading}
              searchPlaceholder="Search name / memo / rate type..."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
