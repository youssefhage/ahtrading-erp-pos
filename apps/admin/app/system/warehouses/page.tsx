"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

type WarehouseRow = {
  id: string;
  name: string;
  location: string | null;
  address?: string | null;
  is_virtual?: boolean;
  binning_enabled?: boolean;
  capacity_note?: string | null;
  min_shelf_life_days_for_sale_default: number | string;
  allow_negative_stock?: boolean | null;
};

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [isVirtual, setIsVirtual] = useState(false);
  const [binningEnabled, setBinningEnabled] = useState(false);
  const [capacityNote, setCapacityNote] = useState("");
  const [minShelfLifeDays, setMinShelfLifeDays] = useState("0");
  const [allowNegative, setAllowNegative] = useState<"" | "allow" | "block">("");
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editIsVirtual, setEditIsVirtual] = useState(false);
  const [editBinningEnabled, setEditBinningEnabled] = useState(false);
  const [editCapacityNote, setEditCapacityNote] = useState("");
  const [editMinShelfLifeDays, setEditMinShelfLifeDays] = useState("0");
  const [editAllowNegative, setEditAllowNegative] = useState<"" | "allow" | "block">("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const res = await apiGet<{ warehouses: WarehouseRow[] }>("/warehouses");
      setWarehouses(res.warehouses || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
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
    setStatus("");
    try {
      await apiPost("/warehouses", {
        name: name.trim(),
        location: location.trim() || undefined,
        address: address.trim() || undefined,
        is_virtual: Boolean(isVirtual),
        binning_enabled: Boolean(binningEnabled),
        capacity_note: capacityNote.trim() || undefined,
        min_shelf_life_days_for_sale_default: Math.floor(minDays),
        allow_negative_stock: allowNegative ? (allowNegative === "allow") : undefined
      });
      setName("");
      setLocation("");
      setAddress("");
      setIsVirtual(false);
      setBinningEnabled(false);
      setCapacityNote("");
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
    setEditAddress((w as any).address || "");
    setEditIsVirtual(Boolean((w as any).is_virtual));
    setEditBinningEnabled(Boolean((w as any).binning_enabled));
    setEditCapacityNote(String((w as any).capacity_note || ""));
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
    setStatus("");
    try {
      await apiPatch(`/warehouses/${encodeURIComponent(editId)}`, {
        name: editName.trim(),
        location: editLocation.trim() || null,
        address: editAddress.trim() || null,
        is_virtual: Boolean(editIsVirtual),
        binning_enabled: Boolean(editBinningEnabled),
        capacity_note: editCapacityNote.trim() || null,
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

  const columns: Array<DataTableColumn<WarehouseRow>> = [
    { id: "name", header: "Name", accessor: (w) => w.name, sortable: true, cell: (w) => <span className="font-medium text-foreground">{w.name}</span> },
    { id: "location", header: "Location", accessor: (w) => w.location || "", sortable: true, cell: (w) => <span className="text-fg-muted">{w.location || "-"}</span> },
    { id: "virtual", header: "Virtual", accessor: (w) => ((w as any).is_virtual ? "yes" : "no"), sortable: true, cell: (w) => <span className="text-xs text-fg-muted">{(w as any).is_virtual ? "yes" : "no"}</span> },
    { id: "bins", header: "Bins", accessor: (w) => ((w as any).binning_enabled ? "yes" : "no"), sortable: true, cell: (w) => <span className="text-xs text-fg-muted">{(w as any).binning_enabled ? "yes" : "no"}</span> },
    {
      id: "min_shelf_life",
      header: "Min Shelf-Life Days",
      accessor: (w) => Number(w.min_shelf_life_days_for_sale_default || 0),
      sortable: true,
      align: "right",
      mono: true,
      cell: (w) => <span className="text-xs">{Number(w.min_shelf_life_days_for_sale_default || 0)}</span>,
    },
    {
      id: "negative_stock",
      header: "Negative Stock",
      accessor: (w) => (w.allow_negative_stock == null ? "inherit" : w.allow_negative_stock ? "allow" : "block"),
      sortable: true,
      cell: (w) => <span className="text-xs text-fg-muted">{w.allow_negative_stock == null ? "inherit" : w.allow_negative_stock ? "allow" : "block"}</span>,
    },
    { id: "id", header: "Warehouse ID", accessor: (w) => w.id, mono: true, defaultHidden: true, cell: (w) => <span className="text-xs text-fg-subtle">{w.id}</span> },
    {
      id: "actions",
      header: "Actions",
      accessor: () => "",
      globalSearch: false,
      align: "right",
      cell: (w) => (
        <Button variant="outline" size="sm" onClick={() => openEdit(w)} disabled={loading || creating || saving}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <Page width="lg" className="px-4 pb-10">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="Warehouses"
        description="Warehouses used for stock moves, costing, and POS defaults."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading || creating || saving}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button disabled={loading || creating || saving}>New Warehouse</Button>
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
                      <label className="text-xs font-medium text-fg-muted">Address (optional)</label>
                      <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city..." />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-fg-muted">
                      <input type="checkbox" checked={isVirtual} onChange={(e) => setIsVirtual(e.target.checked)} /> Virtual warehouse
                    </label>
                    <label className="flex items-center gap-2 text-xs text-fg-muted">
                      <input type="checkbox" checked={binningEnabled} onChange={(e) => setBinningEnabled(e.target.checked)} /> Binning enabled
                    </label>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Capacity Note (optional)</label>
                      <Input value={capacityNote} onChange={(e) => setCapacityNote(e.target.value)} placeholder="e.g. 200 pallets max" />
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
                      <Button type="submit" disabled={creating || loading || saving}>
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
                    <label className="text-xs font-medium text-fg-muted">Address (optional)</label>
                    <Input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-fg-muted">
                    <input type="checkbox" checked={editIsVirtual} onChange={(e) => setEditIsVirtual(e.target.checked)} /> Virtual warehouse
                  </label>
                  <label className="flex items-center gap-2 text-xs text-fg-muted">
                    <input type="checkbox" checked={editBinningEnabled} onChange={(e) => setEditBinningEnabled(e.target.checked)} /> Binning enabled
                  </label>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Capacity Note (optional)</label>
                    <Input value={editCapacityNote} onChange={(e) => setEditCapacityNote(e.target.value)} />
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
                    <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving || loading || creating}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={saving || loading || creating}>
                      {saving ? "..." : "Save"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <Section title="List" description={`${warehouses.length} warehouse(s)`}>
            <DataTable<WarehouseRow>
              tableId="system.warehouses"
              rows={warehouses}
              columns={columns}
              isLoading={loading}
              emptyText={loading ? "Loading warehouses..." : "No warehouses."}
              globalFilterPlaceholder="Search warehouse name / location..."
              initialSort={{ columnId: "name", dir: "asc" }}
            />
      </Section>
    </Page>
  );
}
