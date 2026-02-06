"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type BranchRow = {
  id: string;
  name: string;
  address: string | null;
  created_at: string;
  updated_at: string | null;
};

export default function BranchesPage() {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [status, setStatus] = useState("");

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ branches: BranchRow[] }>("/branches");
      setBranches(res.branches || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus("name is required");
      return;
    }
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/branches", { name: name.trim(), address: address.trim() || undefined });
      setName("");
      setAddress("");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Branches">
      <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Create Branch</CardTitle>
            <CardDescription>Add a new store/branch.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createBranch} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Address (optional)</label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Lebanon" />
              </div>
              <div className="md:col-span-3">
                <Button type="submit" disabled={creating}>
                  {creating ? "..." : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Branches</CardTitle>
            <CardDescription>{branches.length} branches</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Address</th>
                    <th className="px-3 py-2">Branch ID</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((b) => (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{b.name}</td>
                      <td className="px-3 py-2">{b.address || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{b.id}</td>
                    </tr>
                  ))}
                  {branches.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                        No branches.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

