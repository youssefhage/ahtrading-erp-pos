"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function RecurringJournalsPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);

  const [templateId, setTemplateId] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [nextRunDate, setNextRunDate] = useState(todayISO());
  const [creating, setCreating] = useState(false);

  const activeTemplates = useMemo(() => templates.filter((t) => t.is_active), [templates]);

  async function load() {
    setLoading(true);
    try {
      const [tpl, rr] = await Promise.all([
        apiGet<{ templates: TemplateRow[] }>("/accounting/journal-templates"),
        apiGet<{ rules: RuleRow[] }>("/accounting/recurring-journals"),
      ]);
      setTemplates(tpl.templates || []);
      setRules(rr.rules || []);
      setStatus("");
      if (!templateId) {
        const first = (tpl.templates || []).find((t) => t.is_active);
        if (first) setTemplateId(first.id);
      }
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

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) {
      setStatus("template is required");
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
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleRule(ruleId: string, isActive: boolean) {
    setStatus("Updating...");
    try {
      await apiPatch(`/accounting/recurring-journals/${encodeURIComponent(ruleId)}`, { is_active: isActive });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function bumpNextRun(ruleId: string, next: string) {
    setStatus("Updating...");
    try {
      await apiPatch(`/accounting/recurring-journals/${encodeURIComponent(ruleId)}`, { next_run_date: next });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? "..." : "Refresh"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recurring Journals</CardTitle>
          <CardDescription>
            Schedule journals to be auto-created from journal templates. The worker runs the scheduler hourly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={createRule} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">Template</label>
              <select className="ui-select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Select template...</option>
                {activeTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-fg-subtle">
                Only active templates are shown. You can run templates manually from Journal Templates too.
              </div>
            </div>

            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-fg-muted">Cadence</label>
              <select className="ui-select" value={cadence} onChange={(e) => setCadence(e.target.value as any)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {cadence === "weekly" ? (
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-fg-muted">Day of Week</label>
                <select className="ui-select" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
                  <option value="1">Mon</option>
                  <option value="2">Tue</option>
                  <option value="3">Wed</option>
                  <option value="4">Thu</option>
                  <option value="5">Fri</option>
                  <option value="6">Sat</option>
                  <option value="7">Sun</option>
                </select>
              </div>
            ) : null}

            {cadence === "monthly" ? (
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-fg-muted">Day of Month</label>
                <Input value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} placeholder="1" />
              </div>
            ) : null}

            <div className="space-y-1 md:col-span-1">
              <label className="text-xs font-medium text-fg-muted">Next Run</label>
              <Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} />
            </div>

            <div className="md:col-span-6 flex justify-end">
              <Button type="submit" disabled={creating}>
                {creating ? "Saving..." : "Create / Update Rule"}
              </Button>
            </div>
          </form>

          <div className="section-divider" />

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2">Cadence</th>
                  <th className="px-3 py-2">Next Run</th>
                  <th className="px-3 py-2">Last Run</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={loading ? "opacity-70" : ""}>
                {rules.map((r) => (
                  <tr key={r.id} className="ui-tr ui-tr-hover">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.template_name}</div>
                      {!r.template_active ? (
                        <div className="text-[11px] text-danger">Template inactive (rule will auto-disable)</div>
                      ) : null}
                      <div className="text-[10px] text-fg-subtle data-mono">{r.journal_template_id}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      {r.cadence}
                      {r.cadence === "weekly" && r.day_of_week ? <span className="text-fg-subtle"> · DOW {r.day_of_week}</span> : null}
                      {r.cadence === "monthly" && r.day_of_month ? <span className="text-fg-subtle"> · DOM {r.day_of_month}</span> : null}
                    </td>
                    <td className="px-3 py-2 data-mono text-xs">{String(r.next_run_date || "").slice(0, 10)}</td>
                    <td className="px-3 py-2 data-mono text-xs text-fg-muted">{r.last_run_at ? String(r.last_run_at).slice(0, 19).replace("T", " ") : "-"}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.is_active ? (
                        <span className="ui-chip ui-chip-success">Active</span>
                      ) : (
                        <span className="ui-chip ui-chip-default">Paused</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => bumpNextRun(r.id, todayISO())}
                        >
                          Run Today
                        </Button>
                        <Button
                          variant={r.is_active ? "outline" : "default"}
                          size="sm"
                          onClick={() => toggleRule(r.id, !r.is_active)}
                        >
                          {r.is_active ? "Pause" : "Resume"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rules.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-fg-subtle" colSpan={6}>
                      No recurring rules.
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

