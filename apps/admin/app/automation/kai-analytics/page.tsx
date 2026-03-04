"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bot,
  Hash,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  Smartphone,
  TrendingUp,
  User,
  Users,
  Wrench,
} from "lucide-react";

import { apiGet } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { cn } from "@/lib/utils";

import { AiSetupGate } from "@/components/ai-setup-gate";
import { ErrorBanner } from "@/components/error-banner";

import { PageHeader } from "@/components/business/page-header";
import { KpiCard } from "@/components/business/kpi-card";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Analytics = {
  period_days: number;
  totals: {
    conversations: number;
    conversations_24h: number;
    conversations_7d: number;
    messages: number;
    user_messages: number;
    assistant_messages: number;
    tool_calls: number;
  };
  by_channel: { channel: string; conversations: number; unique_users: number }[];
  daily_volume: { day: string; conversations: number }[];
  tool_usage: { tool_name: string; call_count: number }[];
  confirmations: Record<string, number>;
  active_users: {
    user_id: string;
    email: string;
    channel: string;
    conversations: number;
    last_active: string;
  }[];
  linked_channel_users: { channel: string; linked_users: number }[];
  recent_conversations: {
    id: string;
    channel: string;
    user_id: string;
    email: string;
    created_at: string;
    last_message_at: string;
    message_count: number;
  }[];
};

/* ------------------------------------------------------------------ */
/*  Channel helpers                                                    */
/* ------------------------------------------------------------------ */

const CHANNEL_ICONS: Record<string, typeof MessageSquare> = {
  web: MessageSquare,
  telegram: Smartphone,
  whatsapp: Smartphone,
};

const CHANNEL_LABELS: Record<string, string> = {
  web: "Web UI",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

function channelBadge(channel: string) {
  const label = CHANNEL_LABELS[channel] || channel;
  const colors: Record<string, string> = {
    web: "bg-blue-100 text-blue-700",
    telegram: "bg-sky-100 text-sky-700",
    whatsapp: "bg-green-100 text-green-700",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0.5", colors[channel])}>
      {label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Sparkline (simple CSS bar chart)                                   */
/* ------------------------------------------------------------------ */

function MiniBarChart({ data, maxBars = 30 }: { data: { day: string; conversations: number }[]; maxBars?: number }) {
  const slice = data.slice(-maxBars);
  const maxVal = Math.max(...slice.map((d) => d.conversations), 1);

  return (
    <div className="flex items-end gap-[2px] h-16">
      {slice.map((d, i) => (
        <div
          key={d.day}
          className="flex-1 min-w-[3px] max-w-[12px] bg-primary/70 rounded-t-sm transition-all hover:bg-primary"
          style={{ height: `${(d.conversations / maxVal) * 100}%` }}
          title={`${d.day}: ${d.conversations}`}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function KaiAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState("30");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet(`/ai/conversations/analytics?days=${days}`);
      setData(res);
    } catch (e: any) {
      setError(e?.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const confirmationTotal = useMemo(() => {
    if (!data?.confirmations) return 0;
    return Object.values(data.confirmations).reduce((a, b) => a + b, 0);
  }, [data]);

  const confirmedPct = useMemo(() => {
    if (!confirmationTotal || !data?.confirmations) return 0;
    return Math.round(((data.confirmations.confirmed || 0) / confirmationTotal) * 100);
  }, [data, confirmationTotal]);

  return (
    <AiSetupGate>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <PageHeader
            title="Kai Analytics"
            description="Conversation usage, tool activity, and channel insights."
            icon={<BarChart3 className="h-5 w-5" />}
          />
          <div className="flex items-center gap-3">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[130px] h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-1.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        {data && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                title="Conversations"
                value={data.totals.conversations}
                icon={<MessagesSquare className="h-4 w-4" />}
                subtitle={`${data.totals.conversations_24h} today`}
              />
              <KpiCard
                title="Messages"
                value={data.totals.messages}
                icon={<MessageSquare className="h-4 w-4" />}
                subtitle={`${data.totals.user_messages} user / ${data.totals.assistant_messages} assistant`}
              />
              <KpiCard
                title="Tool Calls"
                value={data.totals.tool_calls}
                icon={<Wrench className="h-4 w-4" />}
                subtitle="Functions executed"
              />
              <KpiCard
                title="Confirmations"
                value={confirmationTotal}
                icon={<Bot className="h-4 w-4" />}
                subtitle={`${confirmedPct}% confirmed`}
              />
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Daily Volume */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    Daily Conversations
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Last {data.period_days} days
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.daily_volume.length > 0 ? (
                    <MiniBarChart data={data.daily_volume} />
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">No data yet</p>
                  )}
                </CardContent>
              </Card>

              {/* Channel Breakdown */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-muted-foreground" />
                    Channel Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.by_channel.map((ch) => (
                      <div key={ch.channel} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {channelBadge(ch.channel)}
                        </div>
                        <div className="text-right text-sm">
                          <span className="font-medium">{ch.conversations}</span>
                          <span className="text-muted-foreground ml-1.5 text-xs">
                            ({ch.unique_users} users)
                          </span>
                        </div>
                      </div>
                    ))}
                    {data.by_channel.length === 0 && (
                      <p className="text-sm text-muted-foreground py-4 text-center">No conversations yet</p>
                    )}

                    {data.linked_channel_users.length > 0 && (
                      <div className="pt-2 border-t mt-2">
                        <p className="text-xs text-muted-foreground mb-1.5">Linked accounts</p>
                        {data.linked_channel_users.map((l) => (
                          <div key={l.channel} className="flex items-center justify-between text-sm">
                            {channelBadge(l.channel)}
                            <span className="text-xs text-muted-foreground">{l.linked_users} users</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tool Usage + Active Users */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top Tools */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    Most Used Tools
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.tool_usage.length > 0 ? (
                    <div className="space-y-2">
                      {data.tool_usage.slice(0, 10).map((t) => {
                        const maxCount = data.tool_usage[0]?.call_count || 1;
                        return (
                          <div key={t.tool_name} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded">
                                {t.tool_name}
                              </code>
                              <span className="text-muted-foreground">{t.call_count}</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary/70 rounded-full"
                                style={{ width: `${(t.call_count / maxCount) * 100}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">No tool usage data</p>
                  )}
                </CardContent>
              </Card>

              {/* Active Users */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Active Users
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.active_users.length > 0 ? (
                    <div className="space-y-2">
                      {data.active_users.slice(0, 8).map((u, i) => (
                        <div key={`${u.user_id}-${u.channel}-${i}`} className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                              <User className="h-3 w-3" />
                            </div>
                            <span className="text-xs truncate">
                              {u.email || "unlinked"}
                            </span>
                            {channelBadge(u.channel)}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-xs font-medium">{u.conversations}</span>
                            <span className="text-[10px] text-muted-foreground ml-1">convs</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">No active users</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Recent Conversations Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Hash className="h-4 w-4 text-muted-foreground" />
                  Recent Conversations
                </CardTitle>
                <CardDescription className="text-xs">
                  Last 20 conversations across all channels
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Channel</TableHead>
                      <TableHead className="text-xs">User</TableHead>
                      <TableHead className="text-xs text-right">Messages</TableHead>
                      <TableHead className="text-xs">Started</TableHead>
                      <TableHead className="text-xs">Last Activity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent_conversations.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{channelBadge(c.channel)}</TableCell>
                        <TableCell className="text-xs">{c.email || "—"}</TableCell>
                        <TableCell className="text-xs text-right font-medium">{c.message_count}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateLike(c.created_at)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateLike(c.last_message_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.recent_conversations.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                          No conversations yet
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Confirmation Breakdown */}
            {confirmationTotal > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                    Write Action Confirmations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4">
                    {Object.entries(data.confirmations).map(([status, count]) => (
                      <div key={status} className="text-center">
                        <div className="text-lg font-semibold">{count}</div>
                        <div className="text-[10px] text-muted-foreground capitalize">{status}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </AiSetupGate>
  );
}
