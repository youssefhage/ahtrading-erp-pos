"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { SearchableSelect } from "@/components/searchable-select";

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

  useEffect(() => {
    // Ensure we have a valid selection after warehouses load.
    if (!warehouses.length) return;
    setWarehouseId((cur) => {
      if (cur && warehouses.some((w) => w.id === cur)) return cur;
      return warehouses[0]?.id || "";
    });
  }, [warehouses]);

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
    <Page width="lg" className="px-4 pb-10">
      {status ? <ErrorBanner error={status} onRetry={() => loadLocations(warehouseId)} /> : null}

      <PageHeader
        title="Warehouse Locations"
        description="Bin/location master data per warehouse."
        actions={
          <Button variant="outline" onClick={loadAll}>
            Refresh Warehouses
          </Button>
        }
      />

      <Section
        title="Warehouse"
        description="Select a warehouse to manage its locations."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => loadLocations(warehouseId)} disabled={!warehouseId}>
              Refresh Locations
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
        }
      >
        <div className="w-full md:w-96 space-y-1">
          <label className="text-xs font-medium text-fg-muted">Warehouse</label>
          <SearchableSelect
            value={warehouseId}
            onChange={setWarehouseId}
            searchPlaceholder="Search warehouses..."
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
        </div>
      </Section>

      <Section title="Locations" description={`${locations.length} location(s)`}>
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

          {(() => {
            const columns: Array<DataTableColumn<LocationRow>> = [
              { id: "code", header: "Code", accessor: (l) => l.code, sortable: true, mono: true, cell: (l) => <span className="text-xs">{l.code}</span> },
              { id: "name", header: "Name", accessor: (l) => l.name || "", sortable: true, cell: (l) => <span className="text-fg-muted">{l.name || "-"}</span> },
              {
                id: "status",
                header: "Status",
                accessor: (l) => (l.is_active ? "active" : "inactive"),
                sortable: true,
                cell: (l) => (
                  <span className={l.is_active ? "text-xs text-success" : "text-xs text-fg-muted"}>
                    {l.is_active ? "active" : "inactive"}
                  </span>
                ),
              },
              { id: "id", header: "Location ID", accessor: (l) => l.id, mono: true, defaultHidden: true, cell: (l) => <span className="text-xs text-fg-subtle">{l.id}</span> },
              {
                id: "actions",
                header: "Actions",
                accessor: () => "",
                globalSearch: false,
                align: "right",
                cell: (l) => (
                  <Button variant="outline" size="sm" onClick={() => openEdit(l)}>
                    Edit
                  </Button>
                ),
              },
            ];

            return (
              <DataTable<LocationRow>
                tableId={`system.warehouseLocations.${warehouseId || "none"}`}
                rows={locations}
                columns={columns}
                emptyText="No locations."
                globalFilterPlaceholder="Search code / name..."
                initialSort={{ columnId: "code", dir: "asc" }}
              />
            );
          })()}
      </Section>
    </Page>
  );
}
