"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type CopilotQueryResp = {
  query: string;
  answer: string;
  overview: unknown;
  cards: Array<{ type: string; rows: unknown[] }>;
};

type Message = { role: "user" | "assistant"; content: string; createdAt: string };

export default function CopilotChatPage() {
  const [status, setStatus] = useState("");
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
    setStatus("Thinking...");
    setMessages((m) => [...m, { role: "user", content: prompt, createdAt: new Date().toISOString() }]);
    setQ("");
    try {
      const res = await apiPost<CopilotQueryResp>("/ai/copilot/query", { query: prompt });
      setLast(res);
      setMessages((m) => [...m, { role: "assistant", content: res.answer, createdAt: new Date().toISOString() }]);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Ask Copilot</CardTitle>
            <CardDescription>Read-only operational assistant. It never executes actions directly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => ask(s)}>
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
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a question..." />
              </div>
              <Button type="submit">Ask</Button>
            </form>
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
                  <div
                    key={idx}
                    className={
                      m.role === "user"
                        ? "rounded-lg border border-border bg-bg-elevated p-3"
                        : "rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                    }
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-subtle">
                      {m.role === "user" ? "You" : "Copilot"}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-foreground">{m.content}</div>
                  </div>
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
              <div className="ui-table-wrap p-3">
                <pre className="whitespace-pre-wrap text-xs text-fg-muted">{JSON.stringify(last.cards || [], null, 2)}</pre>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>);
}

