"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Loader2,
  MessageSquare,
  Send,
  ShieldAlert,
  Sparkles,
  User,
} from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { recommendationView } from "@/lib/ai-recommendations";
import { formatDateLike } from "@/lib/datetime";
import {
  hasAnyPermission,
  permissionsToStringArray,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { AiSetupGate } from "@/components/ai-setup-gate";
import { ErrorBanner } from "@/components/error-banner";
import { ViewRaw } from "@/components/view-raw";
import { DataTable, type DataTableColumn } from "@/components/data-table";

import { PageHeader } from "@/components/business/page-header";
import { EmptyState } from "@/components/business/empty-state";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CopilotQueryResp = {
  query: string;
  answer: string;
  overview: unknown;
  cards: Array<{ type: string; rows: unknown[] }>;
};

type MeContext = {
  permissions?: string[];
};

type Message = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function safeIso(iso: unknown): string {
  return formatDateLike(String(iso || ""));
}

function summarizeRec(row: Record<string, unknown>): string {
  const v = recommendationView(row);
  return `${v.title} ${v.summary}`.trim();
}

/* ------------------------------------------------------------------ */
/*  Message Bubble                                                     */
/* ------------------------------------------------------------------ */

function MessageBubble({
  role,
  content,
  createdAt,
}: {
  role: Message["role"];
  content: string;
  createdAt?: string;
}) {
  const isUser = role === "user";

  return (
    <div
      className={cn(
        "flex gap-3",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="mt-1 shrink-0 rounded-full bg-primary/10 p-2">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] space-y-1 rounded-2xl px-4 py-3",
          isUser
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md border bg-card"
        )}
      >
        <p
          className={cn(
            "whitespace-pre-wrap text-sm leading-relaxed",
            isUser ? "text-primary-foreground" : "text-foreground"
          )}
        >
          {content}
        </p>
        {createdAt && (
          <p
            className={cn(
              "text-[10px] tabular-nums",
              isUser
                ? "text-primary-foreground/60"
                : "text-muted-foreground"
            )}
          >
            {safeIso(createdAt)}
          </p>
        )}
      </div>
      {isUser && (
        <div className="mt-1 shrink-0 rounded-full bg-muted p-2">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Data Card (for structured response data)                           */
/* ------------------------------------------------------------------ */

function DataCard({
  type,
  rows,
  idx,
}: {
  type: string;
  rows: unknown[];
  idx: number;
}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm capitalize">
            {type.replace(/_/g, " ")}
          </CardTitle>
          <CardDescription>No data available.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (type === "pos_outbox") {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">POS Outbox</CardTitle>
          <CardDescription>
            Breakdown by device and status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<Record<string, unknown>>
            tableId={`automation.copilot.pos_outbox.${idx}`}
            rows={rows as Record<string, unknown>[]}
            columns={[
              {
                id: "device",
                header: "Device",
                sortable: true,
                mono: true,
                accessor: (r) =>
                  String((r as Record<string, unknown>).device_code || "-"),
                cell: (r) => (
                  <span className="font-mono text-xs">
                    {String(
                      (r as Record<string, unknown>).device_code || "-"
                    )}
                  </span>
                ),
              },
              {
                id: "status",
                header: "Status",
                sortable: true,
                accessor: (r) =>
                  String((r as Record<string, unknown>).status || "-"),
                cell: (r) => (
                  <span className="text-muted-foreground">
                    {String(
                      (r as Record<string, unknown>).status || "-"
                    )}
                  </span>
                ),
              },
              {
                id: "count",
                header: "Count",
                sortable: true,
                align: "right",
                mono: true,
                accessor: (r) =>
                  Number(
                    (r as Record<string, unknown>).count ?? 0
                  ),
                cell: (r) => (
                  <span className="font-mono text-xs">
                    {String(
                      (r as Record<string, unknown>).count ?? 0
                    )}
                  </span>
                ),
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Period Locks</CardTitle>
          <CardDescription>
            Posting is blocked inside locked ranges.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<Record<string, unknown>>
            tableId={`automation.copilot.period_locks.${idx}`}
            rows={rows as Record<string, unknown>[]}
            columns={[
              {
                id: "start",
                header: "Start",
                sortable: true,
                mono: true,
                accessor: (r) =>
                  String(
                    (r as Record<string, unknown>).start_date || "-"
                  ),
                cell: (r) => (
                  <span className="font-mono text-xs">
                    {String(
                      (r as Record<string, unknown>).start_date || "-"
                    )}
                  </span>
                ),
              },
              {
                id: "end",
                header: "End",
                sortable: true,
                mono: true,
                accessor: (r) =>
                  String(
                    (r as Record<string, unknown>).end_date || "-"
                  ),
                cell: (r) => (
                  <span className="font-mono text-xs">
                    {String(
                      (r as Record<string, unknown>).end_date || "-"
                    )}
                  </span>
                ),
              },
              {
                id: "reason",
                header: "Reason",
                sortable: true,
                accessor: (r) =>
                  String(
                    (r as Record<string, unknown>).reason || "-"
                  ),
                cell: (r) => (
                  <span className="text-sm text-muted-foreground">
                    {String(
                      (r as Record<string, unknown>).reason || "-"
                    )}
                  </span>
                ),
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {type === "anomalies"
              ? "Anomalies / Shrinkage"
              : "Reorder Recommendations"}
          </CardTitle>
          <CardDescription>
            Queue-first view. Approve items in AI Hub.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<Record<string, unknown>>
            tableId={`automation.copilot.recs.${type}.${idx}`}
            rows={rows as Record<string, unknown>[]}
            columns={[
              {
                id: "when",
                header: "When",
                sortable: true,
                mono: true,
                accessor: (r) =>
                  safeIso(
                    (r as Record<string, unknown>).created_at
                  ),
                cell: (r) => (
                  <span className="font-mono text-xs">
                    {safeIso(
                      (r as Record<string, unknown>).created_at
                    )}
                  </span>
                ),
              },
              {
                id: "agent",
                header: "Agent",
                sortable: true,
                accessor: (r) =>
                  String(
                    (r as Record<string, unknown>).agent_code || "-"
                  ),
                cell: (r) => (
                  <span className="text-xs text-muted-foreground">
                    {String(
                      (r as Record<string, unknown>).agent_code || "-"
                    )}
                  </span>
                ),
              },
              {
                id: "summary",
                header: "Summary",
                sortable: true,
                accessor: (r) =>
                  summarizeRec(r as Record<string, unknown>),
                cell: (r) => {
                  const v = recommendationView(r);
                  return (
                    <div className="space-y-0.5">
                      <div className="text-xs font-medium">
                        {v.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {v.summary}
                      </div>
                    </div>
                  );
                },
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

  // Fallback: generic card
  const first =
    rows[0] && typeof rows[0] === "object"
      ? (rows[0] as Record<string, unknown>)
      : null;
  const keys = first ? Object.keys(first).slice(0, 6) : [];
  const fallbackColumns: Array<DataTableColumn<Record<string, unknown>>> =
    keys.map((k) => ({
      id: k,
      header: k,
      sortable: true,
      accessor: (r) => String(r?.[k] ?? ""),
      cell: (r) => (
        <span className="font-mono text-xs text-muted-foreground">
          {String(r?.[k] ?? "") || "-"}
        </span>
      ),
    }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm capitalize">
          {type.replace(/_/g, " ")}
        </CardTitle>
        <CardDescription>{rows.length} row(s)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {keys.length > 0 && (
          <DataTable<Record<string, unknown>>
            tableId={`automation.copilot.fallback.${type}.${idx}`}
            rows={
              (rows as Record<string, unknown>[]).slice(0, 25)
            }
            columns={fallbackColumns}
            getRowId={(_, i) => String(i)}
            emptyText="No rows."
            enableGlobalFilter={false}
          />
        )}
        <ViewRaw
          value={{ type, rows }}
          label="View raw card"
        />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function CopilotChatPage() {
  const [err, setErr] = useState<string>("");
  const [thinking, setThinking] = useState(false);
  const [q, setQ] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [last, setLast] = useState<CopilotQueryResp | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(
    () => [
      "What should we reorder this week?",
      "Show anomalies and shrinkage signals",
      "POS outbox status",
      "Are there any period locks active?",
    ],
    []
  );

  const canReadAi = hasAnyPermission({ permissions }, [
    "ai:read",
    "ai:write",
  ]);

  async function loadInitial() {
    setPermissionsLoaded(false);
    setErr("");
    try {
      const me = await apiGet<MeContext>("/auth/me");
      const nextPermissions = permissionsToStringArray(me);
      setPermissions(nextPermissions);
      if (
        !hasAnyPermission({ permissions: nextPermissions }, [
          "ai:read",
          "ai:write",
        ])
      ) {
        setErr("");
        return;
      }
      try {
        await apiGet("/ai/copilot/overview");
      } catch (overviewErr) {
        console.error(overviewErr);
      }
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    } finally {
      setPermissionsLoaded(true);
    }
  }

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function ask(text: string) {
    if (!canReadAi) {
      setErr("You need ai:read permission to use Copilot.");
      return;
    }
    const prompt = (text || "").trim();
    if (!prompt) return;
    setErr("");
    setThinking(true);
    setMessages((m) => [
      ...m,
      {
        role: "user",
        content: prompt,
        createdAt: new Date().toISOString(),
      },
    ]);
    setQ("");
    try {
      const res = await apiPost<CopilotQueryResp>(
        "/ai/copilot/query",
        { query: prompt }
      );
      setLast(res);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.answer,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
    } finally {
      setThinking(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-6">
      {err ? <AiSetupGate error={err} /> : null}
      {err ? <ErrorBanner error={err} /> : null}

      <PageHeader
        title="AI Copilot"
        description="Read-only operational assistant. It never executes actions directly."
        badge={
          !canReadAi && permissionsLoaded ? (
            <Badge variant="warning" className="text-xs">
              No Permission
            </Badge>
          ) : undefined
        }
      />

      {/* Permission warning */}
      {permissionsLoaded && !canReadAi && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="py-6">
            <EmptyState
              icon={ShieldAlert}
              title="Copilot is disabled"
              description="You do not have AI read permissions. Ask your administrator for ai:read permission."
            />
          </CardContent>
        </Card>
      )}

      {/* Chat interface */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main chat area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Messages */}
          <Card className="flex flex-col" style={{ minHeight: 400 }}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">
                  Conversation
                </CardTitle>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="flex-1 py-4">
              <ScrollArea className="h-[400px] pr-4">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center py-16 text-center">
                    <div className="mb-4 rounded-full bg-primary/10 p-4">
                      <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold">
                      Ask a question
                    </h3>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                      Start a conversation with Copilot to get
                      operational insights, reorder suggestions, and
                      more.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((m, idx) => (
                      <MessageBubble
                        key={idx}
                        role={m.role}
                        content={m.content}
                        createdAt={m.createdAt}
                      />
                    ))}
                    {thinking && (
                      <div className="flex items-center gap-3">
                        <div className="rounded-full bg-primary/10 p-2">
                          <Bot className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border bg-card px-4 py-3">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            Thinking...
                          </span>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>
            </CardContent>

            {/* Input area */}
            <Separator />
            <div className="p-4">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(q);
                }}
              >
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Type a question..."
                  disabled={thinking || !canReadAi}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={thinking || !canReadAi || !q.trim()}
                >
                  {thinking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </div>
          </Card>
        </div>

        {/* Sidebar: Suggestions + Data cards */}
        <div className="space-y-4">
          {/* Suggestions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Quick Questions</CardTitle>
              <CardDescription>
                Common queries to get started.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {suggestions.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-start text-left"
                    onClick={() => ask(s)}
                    disabled={thinking || !canReadAi}
                  >
                    <MessageSquare className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{s}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Structured data from last response */}
          {last &&
            (last.cards || []).length > 0 &&
            (last.cards || []).map((c, idx) => (
              <DataCard
                key={`${String((c as Record<string, unknown>)?.type || "card")}:${idx}`}
                type={String(
                  (c as Record<string, unknown>)?.type || "card"
                )}
                rows={
                  ((c as Record<string, unknown>)?.rows as unknown[]) ||
                  []
                }
                idx={idx}
              />
            ))}

          {last && (
            <Card>
              <CardContent className="pt-4">
                <ViewRaw value={last} label="View raw response" />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
