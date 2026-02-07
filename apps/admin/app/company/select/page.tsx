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
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Select Company</CardTitle>
            <CardDescription>
              Choose which company context to use for headers and reports.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {companies.length === 0 ? (
              <p className="text-sm text-slate-600">
                No companies in session. Login first.
              </p>
            ) : (
              companies.map((id) => (
                <div key={id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
                  <code className="text-xs">{id}</code>
                  <Button variant="secondary" size="sm" onClick={() => selectCompany(id)}>
                    Use
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
