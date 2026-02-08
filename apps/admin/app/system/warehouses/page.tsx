"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type WarehouseRow = {
  id: string;
  name: string;
  location: string | null;
  min_shelf_life_days_for_sale_default: number | string;
  allow_negative_stock?: boolean | null;
};

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [minShelfLifeDays, setMinShelfLifeDays] = useState("0");
  const [allowNegative, setAllowNegative] = useState<"" | "allow" | "block">("");
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editMinShelfLifeDays, setEditMinShelfLifeDays] = useState("0");
  const [editAllowNegative, setEditAllowNegative] = useState<"" | "allow" | "block">("");
  const [saving, setSaving] = useState(false);

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
    const minDays = Number(minShelfLifeDays || 0);
    if (!Number.isFinite(minDays) || minDays < 0) {
      setStatus("min shelf-life days must be >= 0");
      return;
    }
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/warehouses", {
        name: name.trim(),
        location: location.trim() || undefined,
        min_shelf_life_days_for_sale_default: Math.floor(minDays),
        allow_negative_stock: allowNegative ? (allowNegative === "allow") : undefined
      });
      setName("");
      setLocation("");
      setMinShelfLifeDays("0");
      setAllowNegative("");
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

  function openEdit(w: WarehouseRow) {
    setEditId(w.id);
    setEditName(w.name);
    setEditLocation(w.location || "");
    setEditMinShelfLifeDays(String(Number(w.min_shelf_life_days_for_sale_default || 0)));
    setEditAllowNegative(w.allow_negative_stock == null ? "" : (w.allow_negative_stock ? "allow" : "block"));
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    if (!editName.trim()) return setStatus("name is required");
    const minDays = Number(editMinShelfLifeDays || 0);
    if (!Number.isFinite(minDays) || minDays < 0) {
      setStatus("min shelf-life days must be >= 0");
      return;
    }
    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/warehouses/${encodeURIComponent(editId)}`, {
        name: editName.trim(),
        location: editLocation.trim() || null,
        min_shelf_life_days_for_sale_default: Math.floor(minDays),
        allow_negative_stock: editAllowNegative ? (editAllowNegative === "allow") : null
      });
      setEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
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
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Min Shelf-Life Days For Sale (default)</label>
                      <Input value={minShelfLifeDays} onChange={(e) => setMinShelfLifeDays(e.target.value)} placeholder="0" inputMode="numeric" />
                      <p className="text-xs text-fg-muted">
                        Enforces a minimum shelf-life window for FEFO allocation at sale-posting time (warehouse default).
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Negative Stock Override (optional)</label>
                      <select className="ui-select" value={allowNegative} onChange={(e) => setAllowNegative(e.target.value as any)}>
                        <option value="">Inherit</option>
                        <option value="block">Block</option>
                        <option value="allow">Allow</option>
                      </select>
                      <p className="text-xs text-fg-muted">
                        When set, this overrides item/company negative-stock policy for this warehouse.
                      </p>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={creating}>
                        {creating ? "..." : "Create"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>

              <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Warehouse</DialogTitle>
                    <DialogDescription>Update warehouse metadata and expiry policy defaults.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Name</label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Location (optional)</label>
                      <Input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Min Shelf-Life Days For Sale (default)</label>
                      <Input value={editMinShelfLifeDays} onChange={(e) => setEditMinShelfLifeDays(e.target.value)} inputMode="numeric" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Negative Stock Override (optional)</label>
                      <select className="ui-select" value={editAllowNegative} onChange={(e) => setEditAllowNegative(e.target.value as any)}>
                        <option value="">Inherit</option>
                        <option value="block">Block</option>
                        <option value="allow">Allow</option>
                      </select>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={saving}>
                        {saving ? "..." : "Save"}
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
                    <th className="px-3 py-2 text-right">Min Shelf-Life Days</th>
                    <th className="px-3 py-2">Negative Stock</th>
                    <th className="px-3 py-2">Warehouse ID</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((w) => (
                    <tr key={w.id} className="ui-tr-hover">
                      <td className="px-3 py-2">{w.name}</td>
                      <td className="px-3 py-2">{w.location || "-"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(w.min_shelf_life_days_for_sale_default || 0)}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        {w.allow_negative_stock == null ? "inherit" : w.allow_negative_stock ? "allow" : "block"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{w.id}</td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => openEdit(w)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {warehouses.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
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
