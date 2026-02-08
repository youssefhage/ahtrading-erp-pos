"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { apiPost, getCompanyId, setSession, type LoginResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus("Logging in...");
    try {
      const res = await apiPost<LoginResponse>("/auth/login", { email, password });
      setSession(res);
      // Best-effort: persist the active company on the server-side session.
      const companyId = getCompanyId();
      if (companyId) {
        try {
          await apiPost("/auth/select-company", { company_id: companyId });
        } catch {
          // ignore
        }
      }
      setStatus("OK");
      router.push("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto grid max-w-5xl items-center gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">AH Trading</p>
          <h1 className="text-4xl font-semibold leading-tight text-slate-950">
            Admin ERP
            <span className="text-teal-700">.</span>
          </h1>
          <p className="max-w-md text-sm text-slate-700">
            Faster navigation, clearer workflows, and a calmer interface for warehouse, sales, and accounting teams.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
            <span className="ui-chip">
              <span className="font-medium">Tip</span>
              <span className="text-slate-600">Use</span>
              <span className="ui-kbd">Cmd</span>
              <span className="ui-kbd">K</span>
              <span className="text-slate-600">inside the app.</span>
            </span>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>Use your ERP credentials.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Email</label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Password</label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={loading}>
                    {loading ? "Signing in..." : "Sign in"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => router.push("/")}>
                    Back
                  </Button>
                </div>
                {status ? (
                  <p className={`text-xs break-words ${status === "OK" ? "text-teal-700" : "text-rose-700"}`}>{status}</p>
                ) : null}
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
