"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  const [createOpen, setCreateOpen] = useState(false);

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
      setCreateOpen(false);
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
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Branches</CardTitle>
            <CardDescription>{branches.length} branches</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button>New Branch</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Branch</DialogTitle>
                    <DialogDescription>Add a new store/branch.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createBranch} className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Name</label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Address (optional)</label>
                      <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Lebanon" />
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={creating}>
                        {creating ? "..." : "Create"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Address</th>
                    <th className="px-3 py-2">Branch ID</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((b) => (
                    <tr key={b.id} className="ui-tr-hover">
                      <td className="px-3 py-2">{b.name}</td>
                      <td className="px-3 py-2">{b.address || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{b.id}</td>
                    </tr>
                  ))}
                  {branches.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={3}>
                        No branches.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>);
}
