"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Me = {
  user_id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  mfa_enabled?: boolean;
};

type MfaStatus = { enabled: boolean; pending: boolean };

export default function SecurityPage() {
  const [status, setStatus] = useState("");
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
    setStatus("Loading...");
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
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setStatus("Saving...");
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
    setStatus("Creating MFA setup...");
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
    setStatus("Enabling MFA...");
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
    setStatus("Disabling MFA...");
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Security</h1>
        <p className="text-sm text-fg-muted">Profile and multi-factor authentication.</p>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>These fields help with audit trails and internal ops.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="space-y-1 md:col-span-6">
              <label className="text-xs font-medium text-fg-muted">Email</label>
              <Input value={me?.email || ""} disabled />
            </div>
            <div className="space-y-1 md:col-span-3">
              <label className="text-xs font-medium text-fg-muted">Full Name</label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={savingProfile} />
            </div>
            <div className="space-y-1 md:col-span-3">
              <label className="text-xs font-medium text-fg-muted">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={savingProfile} />
            </div>
            <div className="md:col-span-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={load} disabled={savingProfile}>
                Refresh
              </Button>
              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? "..." : "Save"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>MFA (Authenticator App)</CardTitle>
          <CardDescription>Optional, recommended for admin users.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-fg-muted">
            Status:{" "}
            <span className="font-mono text-xs">
              {mfa?.enabled ? "enabled" : mfa?.pending ? "pending" : "disabled"}
            </span>
          </div>

          {!mfa?.enabled ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={startMfaSetup} disabled={setupBusy}>
                  {setupBusy ? "..." : (mfa?.pending ? "Regenerate Secret" : "Start Setup")}
                </Button>
                <Button variant="outline" onClick={load} disabled={setupBusy}>
                  Refresh
                </Button>
              </div>

              {setupSecret ? (
                <div className="rounded-md border border-border-subtle bg-bg-elevated/40 p-3 space-y-2">
                  <div className="text-xs text-fg-muted">Secret (manual entry):</div>
                  <div className="font-mono text-xs break-all">{setupSecret}</div>
                  {setupOtpAuth ? (
                    <>
                      <div className="text-xs text-fg-muted">otpauth URL:</div>
                      <div className="font-mono text-xs break-all">{setupOtpAuth}</div>
                    </>
                  ) : null}
                </div>
              ) : null}

              <form onSubmit={enableMfa} className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Verify Code</label>
                  <Input value={enableCode} onChange={(e) => setEnableCode(e.target.value)} placeholder="123456" inputMode="numeric" disabled={setupBusy} />
                </div>
                <Button type="submit" disabled={setupBusy}>
                  Enable MFA
                </Button>
              </form>
            </div>
          ) : (
            <form onSubmit={disableMfa} className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Current Code</label>
                <Input value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="123456" inputMode="numeric" disabled={setupBusy} />
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

