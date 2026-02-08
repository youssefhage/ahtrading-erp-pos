"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type WarehouseRow = { id: string; name: string };
type LocationRow = {
  id: string;
  warehouse_id: string;
  code: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export default function WarehouseLocationsPage() {
  const [status, setStatus] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [locations, setLocations] = useState<LocationRow[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function loadWarehouses() {
    const res = await apiGet<{ warehouses: WarehouseRow[] }>("/warehouses");
    const ws = res.warehouses || [];
    setWarehouses(ws);
    if (!warehouseId && ws[0]?.id) setWarehouseId(ws[0].id);
  }

  async function loadLocations(nextWhId?: string) {
    const wid = nextWhId ?? warehouseId;
    if (!wid) {
      setLocations([]);
      return;
    }
    const res = await apiGet<{ locations: LocationRow[] }>(`/warehouses/${encodeURIComponent(wid)}/locations`);
    setLocations(res.locations || []);
  }

  async function loadAll() {
    setStatus("Loading...");
    try {
      await loadWarehouses();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!warehouseId) return;
      setStatus("Loading locations...");
      try {
        await loadLocations(warehouseId);
        setStatus("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  async function createLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId) return setStatus("warehouse is required");
    if (!code.trim()) return setStatus("code is required");
    setCreating(true);
    setStatus("Saving...");
    try {
      await apiPost(`/warehouses/${encodeURIComponent(warehouseId)}/locations`, {
        code: code.trim(),
        name: name.trim() || undefined,
        is_active: Boolean(isActive)
      });
      setCode("");
      setName("");
      setIsActive(true);
      setCreateOpen(false);
      await loadLocations(warehouseId);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(l: LocationRow) {
    setEditId(l.id);
    setEditCode(l.code || "");
    setEditName(l.name || "");
    setEditActive(Boolean(l.is_active));
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    if (!editCode.trim()) return setStatus("code is required");
    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/warehouses/locations/${encodeURIComponent(editId)}`, {
        code: editCode.trim(),
        name: editName.trim() || null,
        is_active: Boolean(editActive)
      });
      setEditOpen(false);
      await loadLocations(warehouseId);
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
          <CardTitle>Warehouse Locations</CardTitle>
          <CardDescription>Bin/location master data per warehouse (v1).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full md:w-96 space-y-1">
            <label className="text-xs font-medium text-fg-muted">Warehouse</label>
            <select className="ui-select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => loadLocations(warehouseId)} disabled={!warehouseId}>
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button disabled={!warehouseId}>New Location</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Location</DialogTitle>
                  <DialogDescription>
                    Warehouse: <span className="font-mono text-xs">{whById.get(warehouseId)?.name || warehouseId}</span>
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={createLocation} className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Code</label>
                    <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A1" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Name (optional)</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Front shelf" />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-fg-muted">
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    Active
                  </label>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating}>
                      {creating ? "..." : "Save"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Locations</CardTitle>
          <CardDescription>{locations.length} locations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Location</DialogTitle>
                <DialogDescription>Update code/name/status.</DialogDescription>
              </DialogHeader>
              <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Code</label>
                  <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Name (optional)</label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                  Active
                </label>
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

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 font-mono text-xs">Location ID</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id} className="ui-tr-hover">
                    <td className="px-3 py-2 font-mono text-xs">{l.code}</td>
                    <td className="px-3 py-2">{l.name || "-"}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{l.is_active ? "active" : "inactive"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.id}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => openEdit(l)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
                {locations.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                      No locations.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

