"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type WarehouseRow = {
  id: string;
  name: string;
  location: string | null;
};

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [status, setStatus] = useState("");

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ warehouses: WarehouseRow[] }>("/warehouses");
      setWarehouses(res.warehouses || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createWarehouse(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus("name is required");
      return;
    }
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/warehouses", { name: name.trim(), location: location.trim() || undefined });
      setName("");
      setLocation("");
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
    <AppShell title="Warehouses">
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
            <CardTitle>Create Warehouse</CardTitle>
            <CardDescription>Add a new warehouse (for stock moves and POS config).</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createWarehouse} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Warehouse" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Location (optional)</label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lebanon" />
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
            <CardTitle>Warehouses</CardTitle>
            <CardDescription>{warehouses.length} warehouses</CardDescription>
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
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Warehouse ID</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((w) => (
                    <tr key={w.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{w.name}</td>
                      <td className="px-3 py-2">{w.location || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{w.id}</td>
                    </tr>
                  ))}
                  {warehouses.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                        No warehouses.
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

