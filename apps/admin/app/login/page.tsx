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
      <div className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>AH Trading Admin</CardTitle>
            <CardDescription>Login using your ERP credentials.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Password</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? "..." : "Login"}
              </Button>
              {status ? (
                <p className="text-xs text-slate-600 break-words">{status}</p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
