"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type RecommendationRow = {
  id: string;
  agent_code: string;
  status: string;
  recommendation_json: unknown;
  created_at: string;
};

type AgentSettingRow = {
  agent_code: string;
  auto_execute: boolean;
  max_amount_usd: number;
  max_actions_per_day: number;
};

const recStatusChoices = ["", "pending", "approved", "rejected", "executed"] as const;

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function AiHubPage() {
  const [status, setStatus] = useState("");

  const [filterStatus, setFilterStatus] = useState<string>("");
  const [recommendations, setRecommendations] = useState<RecommendationRow[]>([]);
  const [settings, setSettings] = useState<AgentSettingRow[]>([]);

  const [newAgentCode, setNewAgentCode] = useState("");
  const [newAutoExecute, setNewAutoExecute] = useState(false);
  const [newMaxAmountUsd, setNewMaxAmountUsd] = useState("0");
  const [newMaxActionsPerDay, setNewMaxActionsPerDay] = useState("0");

  const settingsByAgent = useMemo(() => new Map(settings.map((s) => [s.agent_code, s])), [settings]);

  async function load() {
    setStatus("Loading...");
    try {
      const qs = new URLSearchParams();
      if (filterStatus) qs.set("status", filterStatus);
      const [rec, set] = await Promise.all([
        apiGet<{ recommendations: RecommendationRow[] }>(`/ai/recommendations${qs.toString() ? `?${qs.toString()}` : ""}`),
        apiGet<{ settings: AgentSettingRow[] }>("/ai/settings")
      ]);
      setRecommendations(rec.recommendations || []);
      setSettings(set.settings || []);
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

  async function decide(recId: string, nextStatus: "approved" | "rejected" | "executed") {
    setStatus("Saving decision...");
    try {
      await apiPost(`/ai/recommendations/${recId}/decide`, { status: nextStatus });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function saveSetting(row: AgentSettingRow) {
    setStatus("Saving setting...");
    try {
      await apiPost("/ai/settings", row);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function createOrUpdateSetting(e: React.FormEvent) {
    e.preventDefault();
    if (!newAgentCode.trim()) {
      setStatus("agent_code is required");
      return;
    }
    const payload: AgentSettingRow = {
      agent_code: newAgentCode.trim(),
      auto_execute: newAutoExecute,
      max_amount_usd: toNum(newMaxAmountUsd),
      max_actions_per_day: Math.floor(toNum(newMaxActionsPerDay))
    };
    await saveSetting(payload);
    setNewAgentCode("");
    setNewAutoExecute(false);
    setNewMaxAmountUsd("0");
    setNewMaxActionsPerDay("0");
  }

  function updateSetting(agentCode: string, patch: Partial<AgentSettingRow>) {
    setSettings((prev) =>
      prev.map((s) => (s.agent_code === agentCode ? { ...s, ...patch } : s))
    );
  }

  return (
    <AppShell title="AI Hub">
      <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex items-center justify-end">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
            <CardDescription>Review and approve/reject recommendations. v1 is recommendation-first (no auto-execution by default).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Status</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  {recStatusChoices.map((s) => (
                    <option key={s || "all"} value={s}>
                      {s ? s : "all"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 flex items-end justify-end">
                <Button variant="outline" onClick={load}>
                  Apply Filter
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Recommendation</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendations.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 font-mono text-xs">{r.created_at}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.agent_code}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.status}</td>
                      <td className="px-3 py-2">
                        <pre className="max-w-[560px] whitespace-pre-wrap text-[11px] text-slate-700">
                          {JSON.stringify(r.recommendation_json, null, 2)}
                        </pre>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-col items-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => decide(r.id, "approved")}>
                            Approve
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => decide(r.id, "rejected")}>
                            Reject
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => decide(r.id, "executed")}>
                            Mark Executed
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {recommendations.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                        No recommendations.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent Settings</CardTitle>
            <CardDescription>Configure whether an agent can auto-execute and define safety caps.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={createOrUpdateSetting} className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Agent Code</label>
                <Input value={newAgentCode} onChange={(e) => setNewAgentCode(e.target.value)} placeholder="inventory_reorder" />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Max Amount USD</label>
                <Input value={newMaxAmountUsd} onChange={(e) => setNewMaxAmountUsd(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Max/Day</label>
                <Input value={newMaxActionsPerDay} onChange={(e) => setNewMaxActionsPerDay(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-1 flex items-end gap-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={newAutoExecute}
                    onChange={(e) => setNewAutoExecute(e.target.checked)}
                  />
                  Auto Execute
                </label>
                <Button type="submit">Upsert</Button>
              </div>
            </form>

            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Auto</th>
                    <th className="px-3 py-2 text-right">Max USD</th>
                    <th className="px-3 py-2 text-right">Max/Day</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.map((s) => (
                    <tr key={s.agent_code} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{s.agent_code}</td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={Boolean(s.auto_execute)}
                          onChange={(e) => updateSetting(s.agent_code, { auto_execute: e.target.checked })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          value={String(s.max_amount_usd ?? 0)}
                          onChange={(e) => updateSetting(s.agent_code, { max_amount_usd: toNum(e.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          value={String(s.max_actions_per_day ?? 0)}
                          onChange={(e) =>
                            updateSetting(s.agent_code, { max_actions_per_day: Math.floor(toNum(e.target.value)) })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => saveSetting(settingsByAgent.get(s.agent_code) || s)}>
                          Save
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {settings.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                        No settings yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

