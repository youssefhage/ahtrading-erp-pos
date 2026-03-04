"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Search } from "lucide-react";

import { apiGet, apiPost, getCompanies } from "@/lib/api";
import { applyCompanyMetadata } from "@/lib/constants";
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
    try { window.sessionStorage.setItem("ahtrading.companyId", id); } catch { /* ignore */ }
    const match = companies.find((c) => c.id === id);
    if (match) {
      try { window.localStorage.setItem(`ahtrading.companyName.${id}`, match.name); } catch {}
    }
    applyCompanyMetadata(id);
    try {
      await apiPost("/auth/select-company", { company_id: id });
    } catch {
      // ignore
    }
    router.push("/dashboard");
  }

  const shown = (() => {
    const base = companies.length ? companies.map((c) => c) : companyIds.map((id, i) => ({ id, name: `Company ${i + 1}`, legal_name: null }));
    return filterAndRankByFuzzy(base, q, (c) => `${c.name} ${c.legal_name || ""} ${c.id}`);
  })();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Building2 className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-semibold">Select Company</h1>
          <p className="text-sm text-muted-foreground">
            Choose the active company for reports, posting, and POS operations.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your Companies</CardTitle>
            <CardDescription>Pick one to continue.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {companyIds.length === 0 ? (
              <div className="rounded-lg border bg-muted/50 p-6 text-center">
                <p className="text-sm text-muted-foreground">No companies in session. Login first.</p>
                <Button className="mt-4" onClick={() => router.push("/login")}>Go to login</Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search company name..."
                    className="pl-9"
                  />
                </div>
                <div className="space-y-2">
                  {shown.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{c.name}</div>
                        {c.legal_name && c.legal_name !== c.name && <div className="truncate text-xs text-muted-foreground">{c.legal_name}</div>}
                      </div>
                      <Button variant="secondary" size="sm" onClick={() => selectCompany(c.id)}>
                        Select
                      </Button>
                    </div>
                  ))}
                  {!shown.length && <p className="text-sm text-muted-foreground text-center py-4">No matches.</p>}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
