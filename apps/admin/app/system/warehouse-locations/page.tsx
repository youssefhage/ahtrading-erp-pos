"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MapPin, Plus, RefreshCw } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  const [loadingWarehouses, setLoadingWarehouses] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
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

  useEffect(() => {
    if (!warehouses.length) return;
    setWarehouseId((cur) => {
      if (cur && warehouses.some((w) => w.id === cur)) return cur;
      return warehouses[0]?.id || "";
    });
  }, [warehouses]);

  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const loading = loadingWarehouses || loadingLocations;

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

  async function refreshLocations(nextWhId?: string) {
    const wid = nextWhId ?? warehouseId;
    if (!wid) {
      setLocations([]);
      return;
    }
    setLoadingLocations(true);
    setStatus("");
    try {
      await loadLocations(wid);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoadingLocations(false);
    }
  }

  async function loadAll() {
    setLoadingWarehouses(true);
    setStatus("");
    try {
      await loadWarehouses();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoadingWarehouses(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!warehouseId) return;
      await refreshLocations(warehouseId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  async function createLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId) return setStatus("warehouse is required");
    if (!code.trim()) return setStatus("code is required");
    setCreating(true);
    setStatus("");
    try {
      await apiPost(`/warehouses/${encodeURIComponent(warehouseId)}/locations`, {
        code: code.trim(),
        name: name.trim() || undefined,
        is_active: Boolean(isActive),
      });
      setCode("");
      setName("");
      setIsActive(true);
      setCreateOpen(false);
      await refreshLocations(warehouseId);
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
    setStatus("");
    try {
      await apiPatch(`/warehouses/locations/${encodeURIComponent(editId)}`, {
        code: editCode.trim(),
        name: editName.trim() || null,
        is_active: Boolean(editActive),
      });
      setEditOpen(false);
      await refreshLocations(warehouseId);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo<ColumnDef<LocationRow>[]>(
    () => [
      {
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
      },
      {
        id: "name",
        accessorFn: (r) => r.name || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.name || "-"}</span>,
      },
      {
        id: "status",
        accessorFn: (r) => (r.is_active ? "active" : "inactive"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.is_active ? "active" : "inactive"} />,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => openEdit(row.original)} disabled={loading || creating || saving}>
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [loading, creating, saving],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Warehouse Locations"
        description="Bin/location master data per warehouse."
        actions={
          <Button variant="outline" size="sm" onClick={loadAll} disabled={loading || creating || saving}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loadingWarehouses ? "animate-spin" : ""}`} />
            Refresh Warehouses
          </Button>
        }
      />

      {status && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={loadAll}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Warehouse Picker */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Warehouse
              </CardTitle>
              <CardDescription>Select a warehouse to manage its locations.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refreshLocations(warehouseId)} disabled={!warehouseId || loading || creating || saving}>
                Refresh Locations
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" disabled={!warehouseId || loading || creating || saving}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Location
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Location</DialogTitle>
                    <DialogDescription>
                      Warehouse: <span className="font-mono text-sm">{whById.get(warehouseId)?.name || warehouseId}</span>
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createLocation} className="grid grid-cols-1 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Code</label>
                      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A1" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Name (optional)</label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Front shelf" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} />
                      Active
                    </label>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={creating || loading}>
                        {creating ? "Creating..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full md:w-96">
            <SearchableSelect
              value={warehouseId}
              onChange={setWarehouseId}
              searchPlaceholder="Search warehouses..."
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Location</DialogTitle>
            <DialogDescription>Update code/name/status.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Code</label>
              <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name (optional)</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={editActive} onCheckedChange={(v) => setEditActive(v === true)} />
              Active
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving || loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || loading}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Locations Table */}
      <Card>
        <CardHeader>
          <CardTitle>Locations</CardTitle>
          <CardDescription>{locations.length} location(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={locations}
            isLoading={loadingLocations}
            searchPlaceholder="Search code / name..."
          />
        </CardContent>
      </Card>
    </div>
  );
}
