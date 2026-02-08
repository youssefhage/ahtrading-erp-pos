"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiPost, getCompanies } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CompanySelectPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<string[]>([]);

  useEffect(() => {
    setCompanies(getCompanies());
  }, []);

  async function selectCompany(id: string) {
    window.localStorage.setItem("ahtrading.companyId", id);
    try {
      await apiPost("/auth/select-company", { company_id: id });
    } catch {
      // ignore
    }
    router.push("/dashboard");
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">Context</p>
          <h1 className="text-3xl font-semibold text-slate-950">Select company</h1>
          <p className="text-sm text-slate-700">This sets the active company for reports, posting, and POS operations.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Companies in session</CardTitle>
            <CardDescription>Pick one to continue.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {companies.length === 0 ? (
              <div className="rounded-2xl border border-[rgb(var(--border)/0.92)] bg-white/60 p-4">
                <p className="text-sm text-slate-700">No companies in session. Login first.</p>
                <div className="mt-3">
                  <Button onClick={() => router.push("/login")}>Go to login</Button>
                </div>
              </div>
            ) : (
              companies.map((id) => (
                <div
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgb(var(--border)/0.92)] bg-white/60 px-4 py-3 shadow-sm"
                >
                  <code className="text-xs">{id}</code>
                  <Button variant="secondary" size="sm" onClick={() => selectCompany(id)}>
                    Use this company
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
