"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Play, Pause, CalendarClock } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatDate, formatDateLike } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type TemplateRow = { id: string; name: string; is_active: boolean; line_count?: number };

type RuleRow = {
  id: string;
  journal_template_id: string;
  template_name: string;
  template_active: boolean;
  cadence: "daily" | "weekly" | "monthly";
  day_of_week: number | null;
  day_of_month: number | null;
  next_run_date: string;
  is_active: boolean;
  last_run_at: string | null;
  updated_at: string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function RecurringJournalsPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);

  // Create form
  const [templateId, setTemplateId] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [nextRunDate, setNextRunDate] = useState(todayISO());
  const [creating, setCreating] = useState(false);

  const activeTemplates = useMemo(() => templates.filter((t) => t.is_active), [templates]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tpl, rr] = await Promise.all([
        apiGet<{ templates: TemplateRow[] }>("/accounting/journal-templates"),
        apiGet<{ rules: RuleRow[] }>("/accounting/recurring-journals"),
      ]);
      setTemplates(tpl.templates || []);
      setRules(rr.rules || []);
      setStatus("");
      const first = (tpl.templates || []).find((t) => t.is_active);
      if (first) setTemplateId((cur) => cur || first.id);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) {
      setStatus("Template is required");
      return;
    }
    setCreating(true);
    setStatus("Saving rule...");
    try {
      await apiPost("/accounting/recurring-journals", {
        journal_template_id: templateId,
        cadence,
        day_of_week: cadence === "weekly" ? Number(dayOfWeek || 1) : null,
        day_of_month: cadence === "monthly" ? Number(dayOfMonth || 1) : null,
        next_run_date: nextRunDate,
        is_active: true,
      });
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const toggleRule = useCallback(
    async (ruleId: string, isActive: boolean) => {
      setStatus("Updating...");
      try {
        await apiPatch(`/accounting/recurring-journals/${encodeURIComponent(ruleId)}`, { is_active: isActive });
        await load();
        setStatus("");
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const bumpNextRun = useCallback(
    async (ruleId: string, next: string) => {
      setStatus("Updating...");
      try {
        await apiPatch(`/accounting/recurring-journals/${encodeURIComponent(ruleId)}`, { next_run_date: next });
        await load();
        setStatus("");
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const columns = useMemo<ColumnDef<RuleRow>[]>(
    () => [
      {
        id: "template_name",
        accessorFn: (r) => r.template_name || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Template" />,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div>
              <p className="font-medium">{r.template_name}</p>
              {!r.template_active && (
                <p className="text-xs text-destructive">Template inactive (rule will auto-disable)</p>
              )}
              <p className="font-mono text-xs text-muted-foreground">{r.journal_template_id}</p>
            </div>
          );
        },
      },
      {
        id: "cadence",
        accessorFn: (r) => r.cadence,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cadence" />,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="text-sm capitalize">
              {r.cadence}
              {r.cadence === "weekly" && r.day_of_week != null && (
                <span className="ml-1 text-muted-foreground">DOW {r.day_of_week}</span>
              )}
              {r.cadence === "monthly" && r.day_of_month != null && (
                <span className="ml-1 text-muted-foreground">DOM {r.day_of_month}</span>
              )}
            </span>
          );
        },
      },
      {
        id: "next_run_date",
        accessorFn: (r) => r.next_run_date || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Next Run" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{formatDate(row.original.next_run_date)}</span>
        ),
      },
      {
        id: "last_run_at",
        accessorFn: (r) => r.last_run_at || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last Run" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm text-muted-foreground">
            {formatDateLike(row.original.last_run_at)}
          </span>
        ),
      },
      {
        id: "is_active",
        accessorFn: (r) => (r.is_active ? "active" : "paused"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.is_active ? "active" : "on_hold"} />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => bumpNextRun(r.id, todayISO())}>
                <Play className="mr-1 h-3 w-3" />
                Run Today
              </Button>
              <Button
                variant={r.is_active ? "outline" : "default"}
                size="sm"
                onClick={() => toggleRule(r.id, !r.is_active)}
              >
                {r.is_active ? (
                  <>
                    <Pause className="mr-1 h-3 w-3" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="mr-1 h-3 w-3" />
                    Resume
                  </>
                )}
              </Button>
            </div>
          );
        },
      },
    ],
    [bumpNextRun, toggleRule],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Recurring Journals"
        description="Automate scheduled journal creation from active templates."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {status && !/^(Saving|Updating)/i.test(status) && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Create Rule */}
      <Card>
        <CardHeader>
          <CardTitle>New Recurring Rule</CardTitle>
          <p className="text-sm text-muted-foreground">
            Schedule journals to be auto-created from journal templates. The worker runs the scheduler hourly.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={createRule} className="grid grid-cols-1 gap-4 sm:grid-cols-6">
            <div className="space-y-2 sm:col-span-2">
              <Label>Template</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">Select template...</option>
                {activeTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Only active templates are shown.</p>
            </div>

            <div className="space-y-2 sm:col-span-1">
              <Label>Cadence</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={cadence}
                onChange={(e) => setCadence(e.target.value as "daily" | "weekly" | "monthly")}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {cadence === "weekly" && (
              <div className="space-y-2 sm:col-span-1">
                <Label>Day of Week</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(e.target.value)}
                >
                  <option value="1">Mon</option>
                  <option value="2">Tue</option>
                  <option value="3">Wed</option>
                  <option value="4">Thu</option>
                  <option value="5">Fri</option>
                  <option value="6">Sat</option>
                  <option value="7">Sun</option>
                </select>
              </div>
            )}

            {cadence === "monthly" && (
              <div className="space-y-2 sm:col-span-1">
                <Label>Day of Month</Label>
                <Input value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} placeholder="1" />
              </div>
            )}

            <div className="space-y-2 sm:col-span-1">
              <Label>Next Run</Label>
              <Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} />
            </div>

            <div className="flex items-end sm:col-span-6 sm:justify-end">
              <Button type="submit" disabled={creating}>
                <Plus className="mr-2 h-4 w-4" />
                {creating ? "Saving..." : "Create Rule"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Rules list */}
      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <p className="text-sm text-muted-foreground">{rules.length} recurring rules</p>
        </CardHeader>
        <CardContent>
          {!loading && rules.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No recurring rules"
              description="Create a rule above to automate journal creation."
            />
          ) : (
            <DataTable
              columns={columns}
              data={rules}
              isLoading={loading}
              searchPlaceholder="Search template..."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
