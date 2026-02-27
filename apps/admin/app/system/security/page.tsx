"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, RefreshCw, Shield, User } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Me = {
  user_id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  mfa_enabled?: boolean;
  permissions?: string[];
  roles?: string[];
};

type MfaStatus = { enabled: boolean; pending: boolean };

export default function SecurityPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [mfa, setMfa] = useState<MfaStatus | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [setupSecret, setSetupSecret] = useState<string>("");
  const [setupOtpAuth, setSetupOtpAuth] = useState<string>("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [enableCode, setEnableCode] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const [m, s] = await Promise.all([
        apiGet<Me>("/auth/me"),
        apiGet<MfaStatus>("/auth/mfa/status").catch(() => ({ enabled: false, pending: false })),
      ]);
      setMe(m || null);
      setMfa(s || null);
      setFullName(String(m?.full_name || ""));
      setPhone(String(m?.phone || ""));
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setStatus("");
    try {
      await apiPatch("/auth/profile", {
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
      });
      await load();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSavingProfile(false);
    }
  }

  async function startMfaSetup() {
    setSetupBusy(true);
    setStatus("");
    try {
      const res = await apiPost<{ secret: string; otpauth_url: string }>("/auth/mfa/setup", {});
      setSetupSecret(res.secret || "");
      setSetupOtpAuth(res.otpauth_url || "");
      setStatus("");
      await load();
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSetupBusy(false);
    }
  }

  async function enableMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!enableCode.trim()) return setStatus("Code is required.");
    setSetupBusy(true);
    setStatus("");
    try {
      await apiPost("/auth/mfa/enable", { code: enableCode.trim() });
      setEnableCode("");
      setSetupSecret("");
      setSetupOtpAuth("");
      await load();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSetupBusy(false);
    }
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!disableCode.trim()) return setStatus("Code is required.");
    setSetupBusy(true);
    setStatus("");
    try {
      await apiPost("/auth/mfa/disable", { code: disableCode.trim() });
      setDisableCode("");
      await load();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSetupBusy(false);
    }
  }

  const busy = loading || savingProfile || setupBusy;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Security"
        description="Profile and multi-factor authentication."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={busy}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {status && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Profile
          </CardTitle>
          <CardDescription>These fields help with audit trails and internal ops.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="grid grid-cols-1 gap-4 md:grid-cols-6">
            <div className="space-y-1.5 md:col-span-6">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input value={me?.email || ""} disabled />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <label className="text-xs font-medium text-muted-foreground">Full Name</label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={savingProfile} />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <label className="text-xs font-medium text-muted-foreground">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={savingProfile} />
            </div>
            <div className="md:col-span-6 flex justify-end gap-2">
              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Roles & Permissions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Active Company Roles & Permissions
          </CardTitle>
          <CardDescription>Computed from your active company role assignment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Roles</p>
            <div className="flex flex-wrap gap-2">
              {(me?.roles || []).length ? (
                (me?.roles || []).map((r) => (
                  <Badge key={r} variant="default">
                    {r}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">No role mapping found for active company.</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Permissions</p>
            <div className="flex flex-wrap gap-2">
              {(me?.permissions || []).length ? (
                (me?.permissions || []).map((perm) => (
                  <Badge key={perm} variant="outline">
                    <span className="font-mono text-xs">{perm}</span>
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">No permissions loaded for active company.</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MFA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            MFA (Authenticator App)
          </CardTitle>
          <CardDescription>Optional, recommended for admin users.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            Status:{" "}
            <Badge variant={mfa?.enabled ? "success" : mfa?.pending ? "warning" : "secondary"}>
              {mfa?.enabled ? "Enabled" : mfa?.pending ? "Pending" : "Disabled"}
            </Badge>
          </div>

          {!mfa?.enabled ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={startMfaSetup} disabled={setupBusy}>
                  {setupBusy ? "Setting up..." : mfa?.pending ? "Regenerate Secret" : "Start Setup"}
                </Button>
              </div>

              {setupSecret && (
                <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Secret (manual entry)</div>
                  <div className="font-mono text-sm break-all select-all">{setupSecret}</div>
                  {setupOtpAuth && (
                    <>
                      <div className="text-xs font-medium text-muted-foreground mt-3">otpauth URL</div>
                      <div className="font-mono text-xs break-all select-all">{setupOtpAuth}</div>
                    </>
                  )}
                </div>
              )}

              <form onSubmit={enableMfa} className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Verify Code</label>
                  <Input
                    value={enableCode}
                    onChange={(e) => setEnableCode(e.target.value)}
                    placeholder="123456"
                    inputMode="numeric"
                    disabled={setupBusy}
                    className="w-40"
                  />
                </div>
                <Button type="submit" disabled={setupBusy}>
                  Enable MFA
                </Button>
              </form>
            </div>
          ) : (
            <form onSubmit={disableMfa} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Current Code</label>
                <Input
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  disabled={setupBusy}
                  className="w-40"
                />
              </div>
              <Button type="submit" variant="destructive" disabled={setupBusy}>
                Disable MFA
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
