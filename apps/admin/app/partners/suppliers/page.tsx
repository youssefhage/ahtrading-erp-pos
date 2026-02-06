"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return suppliers;
    return suppliers.filter((s) => {
      return (
        s.name.toLowerCase().includes(needle) ||
        (s.phone || "").toLowerCase().includes(needle) ||
        (s.email || "").toLowerCase().includes(needle)
      );
    });
  }, [suppliers, q]);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ suppliers: Supplier[] }>("/suppliers");
      setSuppliers(res.suppliers || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus("name is required");
      return;
    }
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/suppliers", { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null });
      setName("");
      setPhone("");
      setEmail("");
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
    <AppShell title="Suppliers">
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
            <CardTitle>Create Supplier</CardTitle>
            <CardDescription>Minimal v1 supplier master data.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createSupplier} className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplier name" />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Phone</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+961..." />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Email</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@supplier.com" />
              </div>
              <div className="md:col-span-4">
                <Button type="submit" disabled={creating}>
                  {creating ? "..." : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Suppliers</CardTitle>
            <CardDescription>{suppliers.length} suppliers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-80">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name/phone/email..." />
              </div>
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{s.name}</td>
                      <td className="px-3 py-2">{s.phone || "-"}</td>
                      <td className="px-3 py-2">{s.email || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{s.id}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                        No suppliers.
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

