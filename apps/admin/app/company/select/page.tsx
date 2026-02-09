"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPost, getCompanies } from "@/lib/api";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function CompanySelectPage() {
  const router = useRouter();
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; legal_name?: string | null }>>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    const ids = getCompanies();
    setCompanyIds(ids);
    (async () => {
      try {
        const res = await apiGet<{ companies: Array<{ id: string; name: string; legal_name?: string | null }> }>("/companies");
        const list = (res.companies || []).filter((c) => ids.includes(c.id));
        setCompanies(list);
      } catch {
        setCompanies([]);
      }
    })();
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

  const shown = (() => {
    const base = companies.length ? companies.map((c) => c) : companyIds.map((id) => ({ id, name: id, legal_name: null }));
    return filterAndRankByFuzzy(base, q, (c) => `${c.name} ${c.legal_name || ""} ${c.id}`);
  })();

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-fg-muted">Context</p>
          <h1 className="text-3xl font-semibold text-foreground">Select company</h1>
          <p className="text-sm text-fg-muted">This sets the active company for reports, posting, and POS operations.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Companies in session</CardTitle>
            <CardDescription>Pick one to continue.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {companyIds.length === 0 ? (
              <div className="rounded-2xl border border-[rgb(var(--border)/0.92)] bg-bg-elevated/60 p-4">
                <p className="text-sm text-fg-muted">No companies in session. Login first.</p>
                <div className="mt-3">
                  <Button onClick={() => router.push("/login")}>Go to login</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="w-full">
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company name..." />
                </div>
                {shown.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgb(var(--border)/0.92)] bg-bg-elevated/60 px-4 py-3 shadow-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
                      {c.legal_name ? <div className="truncate text-xs text-fg-subtle">{c.legal_name}</div> : null}
                      <code className="mt-1 block truncate text-[11px] text-fg-muted">{c.id}</code>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => selectCompany(c.id)}>
                      Use
                    </Button>
                  </div>
                ))}
                {!shown.length ? <p className="text-sm text-fg-muted">No matches.</p> : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
