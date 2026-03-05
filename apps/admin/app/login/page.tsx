"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Lock, Mail, KeyRound, Loader2 } from "lucide-react";

import { apiPost, getCompanyId, setSession, type LoginResponse } from "@/lib/api";
import { ADMIN_APP_VERSION } from "@/lib/app-version";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
      const raw = searchParams.get("redirect") || "/dashboard";
      // Only allow relative paths to prevent open-redirect attacks.
      const redirectTo = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
      // Hard navigation ensures the middleware sees the freshly-set session
      // cookie and avoids a silent soft-navigation loop.
      window.location.href = redirectTo;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  const isError = status && status !== "Success" && !/\.\.\.$/.test(status) && !/^authenticating\b/i.test(status) && !/^MFA required/i.test(status);
  const isProgress = /\.\.\.$/.test(status) || /^authenticating\b/i.test(status);
  const isMfaPrompt = /^MFA required/i.test(status);

  return (
    <main className="flex min-h-screen bg-background">
      {/* Left side - Branding */}
      <div className="hidden flex-col justify-between bg-muted/50 p-10 lg:flex lg:w-1/2 xl:w-2/5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <span className="text-lg font-bold text-primary-foreground">C</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold">Codex</h2>
            <p className="text-xs text-muted-foreground">Admin Portal</p>
          </div>
        </div>

        <div className="space-y-6">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            Manage your business
            <br />
            with confidence.
          </h1>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Sales, inventory, purchasing, and accounting — all unified in one
            modern interface. Built for teams that move fast.
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1">
              <kbd className="font-mono text-[11px]">⌘K</kbd>
            </span>
            <span>Quick navigation</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground font-mono">v{ADMIN_APP_VERSION}</p>
      </div>

      {/* Right side - Login Form */}
      <div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-sm">
          {/* Mobile branding */}
          <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <span className="text-xl font-bold text-primary-foreground">C</span>
            </div>
            <div className="text-center">
              <h1 className="text-xl font-semibold">Codex</h1>
              <p className="text-xs text-muted-foreground">Admin Portal</p>
            </div>
          </div>

          <Card className="border-0 shadow-none lg:border lg:shadow-sm">
            <CardHeader className="space-y-1 px-0 lg:px-6">
              <CardTitle className="text-xl">Sign in</CardTitle>
              <CardDescription>Enter your credentials to access the system</CardDescription>
            </CardHeader>
            <CardContent className="px-0 lg:px-6">
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="h-10 pl-9"
                      autoComplete="email"
                      required
                      disabled={loading || Boolean(mfaToken)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-10 pl-9"
                      autoComplete="current-password"
                      required
                      disabled={loading || Boolean(mfaToken)}
                    />
                  </div>
                </div>

                {mfaToken && (
                  <div className="space-y-2">
                    <Label htmlFor="mfa">Authenticator Code</Label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="mfa"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value)}
                        className="h-10 pl-9"
                        inputMode="numeric"
                        placeholder="123456"
                        autoComplete="one-time-code"
                        required
                        disabled={loading}
                      />
                    </div>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
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
                )}

                {status && (
                  <Alert variant={isError ? "destructive" : "default"}>
                    <AlertTitle className="text-sm">
                      {status === "Success"
                        ? "Signed in"
                        : isProgress
                          ? "Signing in..."
                          : isMfaPrompt
                            ? "Verification required"
                            : "Sign-in failed"}
                    </AlertTitle>
                    <AlertDescription className="text-xs">
                      {status === "Success" ? "Redirecting to dashboard..." : status}
                    </AlertDescription>
                  </Alert>
                )}

                <Button type="submit" disabled={loading} className="h-10 w-full gap-2">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
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

              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back to home
                </button>
              </div>
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Protected by industry-standard encryption
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
