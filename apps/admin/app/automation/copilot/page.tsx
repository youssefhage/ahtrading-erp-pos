"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { AiSetupGate } from "@/components/ai-setup-gate";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ViewRaw } from "@/components/view-raw";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CopilotQueryResp = {
  query: string;
  answer: string;
  overview: unknown;
  cards: Array<{ type: string; rows: unknown[] }>;
};

type Message = { role: "user" | "assistant"; content: string; createdAt: string };

function safeIso(iso: unknown): string {
  const s = String(iso || "");
  return s ? s.slice(0, 19).replace("T", " ") : "-";
}

function summarizeRecJson(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const o = v as Record<string, any>;
  const candidates = [o.kind, o.type, o.title, o.reason, o.message, o.summary].filter((x) => typeof x === "string" && x.trim());
  return String(candidates[0] || "").trim();
}

function MessageBubble(props: { role: Message["role"]; content: string; createdAt?: string }) {
  const isUser = props.role === "user";
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border p-3",
        isUser
          ? "border-border bg-bg-elevated"
          : "border-success/20 bg-gradient-to-b from-success/10 to-bg-elevated/60"
      )}
      data-role={props.role}
    >
      <div className={cn("absolute left-0 top-0 h-full w-1", isUser ? "bg-border-strong" : "bg-success")} />

      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-subtle">
          {isUser ? "You" : "Copilot"}
        </div>
        {props.createdAt ? (
          <div className="text-[11px] tabular-nums text-fg-subtle">{safeIso(props.createdAt)}</div>
        ) : null}
      </div>

      <div className="mt-1 whitespace-pre-wrap text-sm text-foreground">{props.content}</div>
    </div>
  );
}

export default function CopilotChatPage() {
  const [err, setErr] = useState<unknown>(null);
  const [thinking, setThinking] = useState(false);
  const [q, setQ] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [last, setLast] = useState<CopilotQueryResp | null>(null);

  const suggestions = useMemo(
    () => [
      "What should we reorder this week?",
      "Show anomalies and shrinkage signals",
      "POS outbox status",
      "Are there any period locks active?"
    ],
    []
  );

  async function loadOverview() {
    // Prime the page with something useful without requiring a prompt.
    try {
      await apiGet("/ai/copilot/overview");
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadOverview();
  }, []);

  async function ask(text: string) {
    const prompt = (text || "").trim();
    if (!prompt) return;
    setErr(null);
    setThinking(true);
    setMessages((m) => [...m, { role: "user", content: prompt, createdAt: new Date().toISOString() }]);
    setQ("");
    try {
      const res = await apiPost<CopilotQueryResp>("/ai/copilot/query", { query: prompt });
      setLast(res);
      setMessages((m) => [...m, { role: "assistant", content: res.answer, createdAt: new Date().toISOString() }]);
    } catch (err) {
      setErr(err);
    } finally {
      setThinking(false);
    }
  }

  return (
    <Page>
        {err ? <AiSetupGate error={err} /> : null}
        {err ? <ErrorBanner error={err} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Ask Copilot</CardTitle>
            <CardDescription>Read-only operational assistant. It never executes actions directly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Button key={s} type="button" variant="outline" size="sm" onClick={() => ask(s)} disabled={thinking}>
                  {s}
                </Button>
              ))}
            </div>

            <form
              className="flex flex-col gap-2 md:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                ask(q);
              }}
            >
              <div className="flex-1">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a question..." disabled={thinking} />
              </div>
              <Button type="submit" disabled={thinking}>
                {thinking ? "..." : "Ask"}
              </Button>
            </form>
            {thinking ? <div className="text-xs text-fg-muted">Thinking...</div> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
            <CardDescription>Short answers to keep store operations fast.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-fg-muted">No messages yet.</p>
            ) : (
              <div className="space-y-2">
                {messages.map((m, idx) => (
                  <MessageBubble key={idx} role={m.role} content={m.content} createdAt={m.createdAt} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {last ? (
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>Structured data behind the latest answer.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(last.cards || []).length ? (
                <div className="space-y-3">
                  {(last.cards || []).map((c, idx) => {
                    const rows = (c as any)?.rows as any[];
                    const type = String((c as any)?.type || "card");

                    if (!Array.isArray(rows) || rows.length === 0) {
                      return (
                        <Card key={`${type}:${idx}`}>
                          <CardHeader>
                            <CardTitle className="text-base">{type}</CardTitle>
                            <CardDescription>No rows.</CardDescription>
                          </CardHeader>
                        </Card>
                      );
                    }

                    if (type === "pos_outbox") {
                      return (
                        <Card key={`${type}:${idx}`}>
                          <CardHeader>
                            <CardTitle className="text-base">POS Outbox</CardTitle>
                            <CardDescription>Breakdown by device and status.</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <DataTable<any>
                              tableId={`automation.copilot.pos_outbox.${idx}`}
                              rows={rows}
                              columns={[
                                {
                                  id: "device",
                                  header: "Device",
                                  sortable: true,
                                  mono: true,
                                  accessor: (r) => String(r.device_code || "-"),
                                  cell: (r) => <span className="font-mono text-xs">{String(r.device_code || "-")}</span>,
                                },
                                {
                                  id: "status",
                                  header: "Status",
                                  sortable: true,
                                  accessor: (r) => String(r.status || "-"),
                                  cell: (r) => <span className="text-fg-muted">{String(r.status || "-")}</span>,
                                },
                                {
                                  id: "count",
                                  header: "Count",
                                  sortable: true,
                                  align: "right",
                                  mono: true,
                                  accessor: (r) => Number(r.count ?? 0),
                                  cell: (r) => <span className="data-mono">{String(r.count ?? 0)}</span>,
                                },
                              ]}
                              getRowId={(_, i) => String(i)}
                              emptyText="No rows."
                              enableGlobalFilter={false}
                            />
                          </CardContent>
                        </Card>
                      );
                    }

                    if (type === "period_locks") {
                      return (
                        <Card key={`${type}:${idx}`}>
                          <CardHeader>
                            <CardTitle className="text-base">Period Locks</CardTitle>
                            <CardDescription>Posting is blocked inside locked ranges.</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <DataTable<any>
                              tableId={`automation.copilot.period_locks.${idx}`}
                              rows={rows}
                              columns={[
                                {
                                  id: "start",
                                  header: "Start",
                                  sortable: true,
                                  mono: true,
                                  accessor: (r) => String(r.start_date || "-"),
                                  cell: (r) => <span className="font-mono text-xs">{String(r.start_date || "-")}</span>,
                                },
                                {
                                  id: "end",
                                  header: "End",
                                  sortable: true,
                                  mono: true,
                                  accessor: (r) => String(r.end_date || "-"),
                                  cell: (r) => <span className="font-mono text-xs">{String(r.end_date || "-")}</span>,
                                },
                                {
                                  id: "reason",
                                  header: "Reason",
                                  sortable: true,
                                  accessor: (r) => String(r.reason || "-"),
                                  cell: (r) => <span className="text-sm text-fg-muted">{String(r.reason || "-")}</span>,
                                },
                              ]}
                              getRowId={(_, i) => String(i)}
                              emptyText="No rows."
                              enableGlobalFilter={false}
                            />
                          </CardContent>
                        </Card>
                      );
                    }

                    if (type === "reorder_recommendations" || type === "anomalies") {
                      return (
                        <Card key={`${type}:${idx}`}>
                          <CardHeader>
                            <CardTitle className="text-base">{type === "anomalies" ? "Anomalies / Shrinkage" : "Reorder Recommendations"}</CardTitle>
                            <CardDescription>Queue-first view. Approve items in AI Hub.</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <DataTable<any>
                              tableId={`automation.copilot.recs.${type}.${idx}`}
                              rows={rows}
                              columns={[
                                {
                                  id: "when",
                                  header: "When",
                                  sortable: true,
                                  mono: true,
                                  accessor: (r) => safeIso(r.created_at),
                                  cell: (r) => <span className="font-mono text-xs">{safeIso(r.created_at)}</span>,
                                },
                                {
                                  id: "agent",
                                  header: "Agent",
                                  sortable: true,
                                  accessor: (r) => String(r.agent_code || "-"),
                                  cell: (r) => <span className="text-xs text-fg-muted">{String(r.agent_code || "-")}</span>,
                                },
                                {
                                  id: "summary",
                                  header: "Summary",
                                  sortable: true,
                                  accessor: (r) => summarizeRecJson(r.recommendation_json),
                                  cell: (r) => summarizeRecJson(r.recommendation_json) || <span className="text-fg-subtle">View raw</span>,
                                },
                                {
                                  id: "id",
                                  header: "ID",
                                  sortable: true,
                                  mono: true,
                                  accessor: (r) => String(r.id || "-"),
                                  cell: (r) => <span className="font-mono text-[10px] text-fg-subtle">{String(r.id || "-")}</span>,
                                },
                              ]}
                              getRowId={(_, i) => String(i)}
                              emptyText="No rows."
                              enableGlobalFilter={false}
                            />
                          </CardContent>
                        </Card>
                      );
                    }

                    // Fallback: show a small table from object keys and keep raw behind a toggle.
                    const first = rows[0] && typeof rows[0] === "object" ? (rows[0] as any) : null;
                    const keys = first ? Object.keys(first).slice(0, 6) : [];
                    const fallbackColumns: Array<DataTableColumn<any>> = keys.map((k) => ({
                      id: k,
                      header: k,
                      sortable: true,
                      accessor: (r) => String(r?.[k] ?? ""),
                      cell: (r) => <span className="font-mono text-xs text-fg-muted">{String(r?.[k] ?? "") || "-"}</span>,
                    }));
                    return (
                      <Card key={`${type}:${idx}`}>
                        <CardHeader>
                          <CardTitle className="text-base">{type}</CardTitle>
                          <CardDescription>{rows.length} row(s)</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {keys.length ? (
                            <DataTable<any>
                              tableId={`automation.copilot.fallback.${type}.${idx}`}
                              rows={rows.slice(0, 25)}
                              columns={fallbackColumns}
                              getRowId={(_, i) => String(i)}
                              emptyText="No rows."
                              enableGlobalFilter={false}
                            />
                          ) : null}
                          <ViewRaw value={c} label="View raw card" />
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-fg-muted">No cards for this answer.</div>
              )}

              <ViewRaw value={last} label="View raw response" />
            </CardContent>
          </Card>
        ) : null}
      </Page>);
}
