"use client";

import { useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type CopilotOverview = {
  generated_at: string;
  ai: {
    actions_by_status: Record<string, number>;
    recommendations_by_status: Record<string, number>;
    pending_recommendations_by_agent: Record<string, number>;
  };
  pos: {
    outbox_by_status: Record<string, number>;
    outbox_failed: number;
  };
  inventory: {
    negative_on_hand_rows: number;
    approx_value_usd: string;
    approx_value_lbp: string;
  };
  accounting: {
    period_locks: Array<{
      id: string;
      start_date: string;
      end_date: string;
      reason: string | null;
      locked: boolean;
      created_at: string;
    }>;
  };
};

function pill(label: string, value: string) {
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">{label}</div>
      <div className="mt-1 font-mono text-xs text-foreground">{value}</div>
    </div>
  );
}

export default function OpsCopilotPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<CopilotOverview | null>(null);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<CopilotOverview>("/ai/copilot/overview");
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const aiActions = data?.ai.actions_by_status || {};
  const recs = data?.ai.recommendations_by_status || {};
  const pendingByAgent = data?.ai.pending_recommendations_by_agent || {};
  const outbox = data?.pos.outbox_by_status || {};

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-fg-muted">
              Read-only operational snapshot (safe by default). Generated:{" "}
              <span className="font-mono text-xs text-foreground">{data?.generated_at || "-"}</span>
            </p>
          </div>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>AI</CardTitle>
              <CardDescription>Recommendations + actions lifecycle.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {pill("recs pending", String(recs["pending"] || 0))}
                {pill("recs approved", String(recs["approved"] || 0))}
                {pill("actions approved", String(aiActions["approved"] || 0))}
                {pill("actions queued", String(aiActions["queued"] || 0))}
                {pill("actions blocked", String(aiActions["blocked"] || 0))}
                {pill("actions failed", String(aiActions["failed"] || 0))}
              </div>
              <div className="rounded-md border border-border bg-bg-elevated p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">
                  Pending By Agent
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-fg-muted">
                  {JSON.stringify(pendingByAgent, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>POS</CardTitle>
              <CardDescription>Outbox queue health.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {pill("pending", String(outbox["pending"] || 0))}
                {pill("processed", String(outbox["processed"] || 0))}
                {pill("failed", String(data?.pos.outbox_failed || 0))}
                {pill("total", String(Object.values(outbox).reduce((a, b) => a + (b || 0), 0)))}
              </div>
              <div className="rounded-md border border-border bg-bg-elevated p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">By Status</div>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-fg-muted">{JSON.stringify(outbox, null, 2)}</pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inventory + Close</CardTitle>
              <CardDescription>Integrity + accounting period locks.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {pill("negative rows", String(data?.inventory.negative_on_hand_rows || 0))}
                {pill("neg value USD", String(data?.inventory.approx_value_usd || "0"))}
                {pill("neg value LL", String(data?.inventory.approx_value_lbp || "0"))}
                {pill("locks", String(data?.accounting.period_locks?.length || 0))}
              </div>
              <div className="rounded-md border border-border bg-bg-elevated p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">Period Locks</div>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-fg-muted">
                  {JSON.stringify(data?.accounting.period_locks || [], null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>);
}
