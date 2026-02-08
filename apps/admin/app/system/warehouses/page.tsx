"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type WarehouseRow = {
  id: string;
  name: string;
  location: string | null;
};

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

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
            <CardTitle>Warehouses</CardTitle>
            <CardDescription>{warehouses.length} warehouses</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button>New Warehouse</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Warehouse</DialogTitle>
                    <DialogDescription>Add a warehouse for stock moves + POS config.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createWarehouse} className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Name</label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Warehouse" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Location (optional)</label>
                      <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lebanon" />
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
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Warehouse ID</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((w) => (
                    <tr key={w.id} className="ui-tr-hover">
                      <td className="px-3 py-2">{w.name}</td>
                      <td className="px-3 py-2">{w.location || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{w.id}</td>
                    </tr>
                  ))}
                  {warehouses.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={3}>
                        No warehouses.
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
