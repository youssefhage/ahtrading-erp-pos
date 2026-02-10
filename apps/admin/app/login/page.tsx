"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Terminal, Command, ArrowRight } from "lucide-react";

import { apiPost, getCompanyId, setSession, type LoginResponse } from "@/lib/api";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(mfaToken ? "Verifying code..." : "Authenticating...");
    try {
      if (!mfaToken) {
        const res = await apiPost<LoginResponse>("/auth/login", { email, password });
        if ("mfa_required" in res && res.mfa_required) {
          setMfaToken(res.mfa_token);
          setStatus("MFA required. Enter the 6-digit code from your authenticator.");
          setLoading(false);
          return;
        }
        setSession(res);
      } else {
        const res2 = await apiPost<LoginResponse>("/auth/mfa/verify", { mfa_token: mfaToken, code: mfaCode });
        setSession(res2);
      }

      const companyId = getCompanyId();
      if (companyId) {
        try {
          await apiPost("/auth/select-company", { company_id: companyId });
        } catch {
          // ignore
        }
      }
      setStatus("Success");
      router.push("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-background">
      {/* Left side - Branding */}
      <div className="hidden flex-col justify-between border-r border-border-subtle bg-bg-elevated/60 p-8 lg:flex lg:w-1/2 xl:w-2/5">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-dim">
              <span className="text-lg font-bold text-primary-foreground">AH</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">AH Trading</h2>
              <p className="text-[10px] uppercase tracking-wider text-fg-subtle">Industrial ERP</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold leading-tight text-foreground">
              Command your operations
            </h1>
            <p className="max-w-sm text-sm leading-relaxed text-fg-muted">
              A terminal-inspired interface for warehouse management, sales tracking,
              and accounting workflows. Built for speed and precision.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs text-fg-subtle">
            <span className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-elevated/70 px-2 py-1">
              <Command className="h-3 w-3" />
              <kbd className="font-mono">Cmd</kbd>
              <span>+</span>
              <kbd className="font-mono">K</kbd>
            </span>
            <span>for quick navigation</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          <Terminal className="h-4 w-4" />
          <span className="font-mono">v2.0.0-terminal</span>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="flex flex-1 flex-col items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile branding */}
          <div className="flex flex-col items-center gap-3 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-dim">
              <span className="text-xl font-bold text-primary-foreground">AH</span>
            </div>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-foreground">AH Trading</h1>
              <p className="text-xs text-fg-subtle">Industrial ERP</p>
            </div>
          </div>

          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-lg font-semibold text-foreground">Sign in to your account</h2>
            <p className="text-sm text-fg-subtle">Enter your credentials to access the system</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="h-11"
                autoComplete="email"
                required
                disabled={loading || Boolean(mfaToken)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
                autoComplete="current-password"
                required
                disabled={loading || Boolean(mfaToken)}
              />
            </div>

            {mfaToken ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-fg-muted">Authenticator Code</label>
                <Input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  className="h-11"
                  inputMode="numeric"
                  placeholder="123456"
                  autoComplete="one-time-code"
                  required
                  disabled={loading}
                />
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    className="text-fg-subtle underline underline-offset-2 hover:text-foreground"
                    disabled={loading}
                    onClick={() => {
                      setMfaToken("");
                      setMfaCode("");
                      setStatus("");
                    }}
                  >
                    Use a different account
                  </button>
                </div>
              </div>
            ) : null}

            {status && (
              <Banner
                size="sm"
                variant={
                  status === "Success"
                    ? "success"
                    : /\.\.\.$/.test(status) || /^authenticating\b/i.test(status)
                      ? "progress"
                      : "danger"
                }
                title={
                  status === "Success"
                    ? "Signed in"
                    : /\.\.\.$/.test(status) || /^authenticating\b/i.test(status)
                      ? "Signing in"
                      : "Sign-in failed"
                }
                description={
                  status === "Success"
                    ? "Redirecting to dashboard..."
                    : /\.\.\.$/.test(status) || /^authenticating\b/i.test(status)
                      ? status
                      : status
                }
              />
            )}

            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full gap-2"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                  <span>{mfaToken ? "Verifying..." : "Signing in..."}</span>
                </>
              ) : (
                <>
                  <span>{mfaToken ? "Verify code" : "Sign in"}</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="text-center">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="text-xs text-fg-subtle hover:text-foreground transition-colors"
            >
              Back to landing page
            </button>
          </div>

          <div className="border-t border-border-subtle pt-4">
            <p className="text-center text-[11px] text-fg-subtle">
              Protected by industry-standard encryption
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
