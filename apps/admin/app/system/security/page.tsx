"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { Page, PageHeader, Section } from "@/components/page";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
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

  return (
    <Page width="md" className="px-4 pb-10">
      <PageHeader
        title="Security"
        description="Profile and multi-factor authentication."
        actions={
          <Button variant="outline" onClick={load} disabled={loading || savingProfile || setupBusy}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        }
      />

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Section title="Profile" description="These fields help with audit trails and internal ops.">
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
              <Button type="button" variant="outline" onClick={load} disabled={savingProfile || loading || setupBusy}>
                Refresh
              </Button>
              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? "..." : "Save"}
              </Button>
            </div>
          </form>
      </Section>

      <Section title="Active company roles and permissions" description="Computed from your active company role assignment." >
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-fg-muted">Roles</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(me?.roles || []).length ? (
                (me?.roles || []).map((r) => <Chip key={r} variant="primary">{r}</Chip>)
              ) : (
                <span className="text-xs text-fg-subtle">No role mapping found for active company.</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-fg-muted">Permissions</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(me?.permissions || []).length ? (
                (me?.permissions || []).map((perm) => <Chip key={perm} variant="default">{perm}</Chip>)
              ) : (
                <span className="text-xs text-fg-subtle">No permissions loaded for active company.</span>
              )}
            </div>
          </div>
        </div>
      </Section>

      <Section title="MFA (Authenticator App)" description="Optional, recommended for admin users.">
        <div className="space-y-4">
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
                <Button variant="outline" onClick={load} disabled={setupBusy || loading || savingProfile}>
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
        </div>
      </Section>
    </Page>
  );
}
