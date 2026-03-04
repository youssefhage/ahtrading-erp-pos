"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Smartphone,
  Trash2,
  MessageSquare,
  User,
} from "lucide-react";

import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { cn } from "@/lib/utils";

import { AiSetupGate } from "@/components/ai-setup-gate";
import { ErrorBanner } from "@/components/error-banner";

import { PageHeader } from "@/components/business/page-header";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type ChannelLink = {
  id: string;
  channel: string;
  channel_user_id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  linked_at: string;
  is_active: boolean;
};

type ChannelConfig = {
  telegram: {
    bot_token: string;
    webhook_secret: string;
  };
  whatsapp: {
    api_url: string;
    api_token: string;
    phone_number_id: string;
    verify_token: string;
    app_secret: string;
  };
};

/* ------------------------------------------------------------------ */
/*  Channel helpers                                                    */
/* ------------------------------------------------------------------ */

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

function channelBadge(channel: string) {
  const label = CHANNEL_LABELS[channel] || channel;
  const colors: Record<string, string> = {
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
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function KaiSettingsPage() {
  // --- Channel links state ---
  const [links, setLinks] = useState<ChannelLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    channel: "telegram",
    channel_user_id: "",
    user_email: "",
  });
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // --- Channel config state ---
  const [hasTelegram, setHasTelegram] = useState(false);
  const [hasWhatsApp, setHasWhatsApp] = useState(false);
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgWebhookSecret, setTgWebhookSecret] = useState("");
  const [waApiUrl, setWaApiUrl] = useState("");
  const [waApiToken, setWaApiToken] = useState("");
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState("");
  const [waAppSecret, setWaAppSecret] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const loadLinks = useCallback(async () => {
    try {
      const res = await apiGet("/ai/channel-links");
      setLinks(res.links || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load channel links");
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await apiGet("/ai/kai-channel-config");
      const cfg: ChannelConfig = res.config;
      setHasTelegram(res.has_telegram);
      setHasWhatsApp(res.has_whatsapp);
      setTgBotToken(cfg.telegram.bot_token || "");
      setTgWebhookSecret(cfg.telegram.webhook_secret || "");
      setWaApiUrl(cfg.whatsapp.api_url || "");
      setWaApiToken(cfg.whatsapp.api_token || "");
      setWaPhoneNumberId(cfg.whatsapp.phone_number_id || "");
      setWaVerifyToken(cfg.whatsapp.verify_token || "");
      setWaAppSecret(cfg.whatsapp.app_secret || "");
    } catch {
      // Config endpoint may not exist yet — that's ok
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([loadLinks(), loadConfig()]);
    setLoading(false);
  }, [loadLinks, loadConfig]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setConfigSaved(false);
    setError(null);
    try {
      await apiPost("/ai/kai-channel-config", {
        telegram_bot_token: tgBotToken,
        telegram_webhook_secret: tgWebhookSecret,
        whatsapp_api_url: waApiUrl,
        whatsapp_api_token: waApiToken,
        whatsapp_phone_number_id: waPhoneNumberId,
        whatsapp_verify_token: waVerifyToken,
        whatsapp_app_secret: waAppSecret,
      });
      setConfigSaved(true);
      await loadConfig();
      setTimeout(() => setConfigSaved(false), 3000);
    } catch (e: any) {
      setError(e?.message || "Failed to save configuration");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleAdd = async () => {
    setAddError(null);
    if (!addForm.channel_user_id.trim() || !addForm.user_email.trim()) {
      setAddError("All fields are required");
      return;
    }
    setAdding(true);
    try {
      await apiPost("/ai/channel-links", {
        channel: addForm.channel,
        channel_user_id: addForm.channel_user_id.trim(),
        user_email: addForm.user_email.trim().toLowerCase(),
      });
      setShowAdd(false);
      setAddForm({ channel: "telegram", channel_user_id: "", user_email: "" });
      loadLinks();
    } catch (e: any) {
      setAddError(e?.message || "Failed to link user");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (linkId: string) => {
    try {
      await apiDelete(`/ai/channel-links/${linkId}`);
      loadLinks();
    } catch (e: any) {
      setError(e?.message || "Failed to deactivate link");
    }
  };

  const activeLinks = links.filter((l) => l.is_active);
  const inactiveLinks = links.filter((l) => !l.is_active);

  return (
    <AiSetupGate>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <PageHeader
            title="Kai Settings"
            description="Configure Telegram and WhatsApp channels for Kai AI copilot."
            icon={<Settings className="h-5 w-5" />}
          />
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-1.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        {/* ============================================================ */}
        {/*  Channel Configuration Forms                                 */}
        {/* ============================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Telegram Config */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-sky-500" />
                  Telegram
                </CardTitle>
                {hasTelegram ? (
                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">Connected</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-gray-100 text-gray-500">Not configured</Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                Create a bot via{" "}
                <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                  @BotFather <ExternalLink className="h-2.5 w-2.5" />
                </a>
                {" "}and paste the token below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="tg-bot-token" className="text-xs">Bot Token</Label>
                <Input
                  id="tg-bot-token"
                  type="password"
                  placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v..."
                  value={tgBotToken}
                  onChange={(e) => setTgBotToken(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tg-webhook-secret" className="text-xs">
                  Webhook Secret <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="tg-webhook-secret"
                  type="password"
                  placeholder="Optional secret for webhook verification"
                  value={tgWebhookSecret}
                  onChange={(e) => setTgWebhookSecret(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div className="rounded-md bg-muted/50 p-2.5 text-[11px] text-muted-foreground space-y-1">
                <p><strong>Webhook URL:</strong> <code className="bg-muted px-1 rounded">{`https://<your-domain>/api/integrations/telegram/webhook`}</code></p>
                <p>After saving, set this URL via BotFather or the Telegram API <code>setWebhook</code> method.</p>
              </div>
            </CardContent>
          </Card>

          {/* WhatsApp Config */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-green-500" />
                  WhatsApp
                </CardTitle>
                {hasWhatsApp ? (
                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">Connected</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-gray-100 text-gray-500">Not configured</Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                Configure your{" "}
                <a href="https://developers.facebook.com/docs/whatsapp/cloud-api" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                  Meta Cloud API <ExternalLink className="h-2.5 w-2.5" />
                </a>
                {" "}credentials.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="wa-api-url" className="text-xs">API URL</Label>
                <Input
                  id="wa-api-url"
                  placeholder="https://graph.facebook.com/v18.0"
                  value={waApiUrl}
                  onChange={(e) => setWaApiUrl(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wa-api-token" className="text-xs">API Token</Label>
                <Input
                  id="wa-api-token"
                  type="password"
                  placeholder="Bearer token from Meta"
                  value={waApiToken}
                  onChange={(e) => setWaApiToken(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="wa-phone-id" className="text-xs">Phone Number ID</Label>
                  <Input
                    id="wa-phone-id"
                    placeholder="e.g. 123456789"
                    value={waPhoneNumberId}
                    onChange={(e) => setWaPhoneNumberId(e.target.value)}
                    className="text-xs font-mono"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="wa-verify-token" className="text-xs">Verify Token</Label>
                  <Input
                    id="wa-verify-token"
                    type="password"
                    placeholder="Webhook verify token"
                    value={waVerifyToken}
                    onChange={(e) => setWaVerifyToken(e.target.value)}
                    className="text-xs font-mono"
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wa-app-secret" className="text-xs">
                  App Secret <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="wa-app-secret"
                  type="password"
                  placeholder="For signature verification"
                  value={waAppSecret}
                  onChange={(e) => setWaAppSecret(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div className="rounded-md bg-muted/50 p-2.5 text-[11px] text-muted-foreground">
                <p><strong>Webhook URL:</strong> <code className="bg-muted px-1 rounded">{`https://<your-domain>/api/integrations/whatsapp/webhook`}</code></p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Save Config Button */}
        <div className="flex justify-end">
          <Button onClick={handleSaveConfig} disabled={savingConfig}>
            {configSaved ? (
              <><Check className="h-4 w-4 mr-1.5 text-emerald-500" /> Saved</>
            ) : savingConfig ? (
              <><RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4 mr-1.5" /> Save Channel Config</>
            )}
          </Button>
        </div>

        {/* ============================================================ */}
        {/*  Linked Users                                                 */}
        {/* ============================================================ */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  Linked Channel Users
                </CardTitle>
                <CardDescription className="text-xs">
                  {activeLinks.length} active link{activeLinks.length !== 1 ? "s" : ""}
                  {inactiveLinks.length > 0 && ` (${inactiveLinks.length} inactive)`}
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Link User
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs">Channel ID</TableHead>
                  <TableHead className="text-xs">System User</TableHead>
                  <TableHead className="text-xs">Linked</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => (
                  <TableRow key={link.id} className={!link.is_active ? "opacity-50" : ""}>
                    <TableCell>{channelBadge(link.channel)}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {link.channel_user_id}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs">
                          {link.display_name || link.email || "Unknown"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateLike(link.linked_at)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1.5 py-0.5",
                          link.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        )}
                      >
                        {link.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {link.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(link.id)}
                          title="Deactivate link"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {links.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      No channel users linked yet. Users can link via Telegram/WhatsApp
                      or you can link them manually.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Notification Info Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              Proactive Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1.5">
            <p>
              Linked users automatically receive critical alerts from AI agents via their connected channel.
              These include:
            </p>
            <ul className="list-disc list-inside space-y-0.5 ml-2">
              <li>Low stock alerts when inventory falls critically below reorder points</li>
              <li>Purchase order suggestions when automated reorders exceed thresholds</li>
              <li>Anomaly detection alerts (high return rates, large adjustments)</li>
              <li>Pricing recommendation notifications</li>
              <li>Shrinkage detection and expiry warnings</li>
            </ul>
            <p className="pt-1">
              Notification severity is determined by each AI agent. Only <strong>critical</strong> and{" "}
              <strong>warning</strong> level recommendations trigger push notifications.
            </p>
          </CardContent>
        </Card>

        {loading && links.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Add Link Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Link Channel User</DialogTitle>
            <DialogDescription>
              Manually link a Telegram or WhatsApp user to a system account.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="channel">Channel</Label>
              <Select
                value={addForm.channel}
                onValueChange={(v) => setAddForm({ ...addForm, channel: v })}
              >
                <SelectTrigger id="channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="channel_user_id">
                {addForm.channel === "telegram" ? "Telegram Chat ID" : "WhatsApp Phone Number"}
              </Label>
              <Input
                id="channel_user_id"
                placeholder={addForm.channel === "telegram" ? "e.g. 123456789" : "e.g. +961XXXXXXXX"}
                value={addForm.channel_user_id}
                onChange={(e) => setAddForm({ ...addForm, channel_user_id: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user_email">System User Email</Label>
              <Input
                id="user_email"
                type="email"
                placeholder="user@company.com"
                value={addForm.user_email}
                onChange={(e) => setAddForm({ ...addForm, user_email: e.target.value })}
              />
            </div>
            {addError && (
              <p className="text-sm text-destructive">{addError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={adding}>
              {adding ? "Linking..." : "Link User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AiSetupGate>
  );
}
