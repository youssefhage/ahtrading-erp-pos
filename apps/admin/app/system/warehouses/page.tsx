"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Warehouse } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
        allow_negative_stock: allowNegative ? allowNegative === "allow" : undefined,
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
    setEditAddress(w.address || "");
    setEditIsVirtual(Boolean(w.is_virtual));
    setEditBinningEnabled(Boolean(w.binning_enabled));
    setEditCapacityNote(String(w.capacity_note || ""));
    setEditMinShelfLifeDays(String(Number(w.min_shelf_life_days_for_sale_default || 0)));
    setEditAllowNegative(w.allow_negative_stock == null ? "" : w.allow_negative_stock ? "allow" : "block");
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
        allow_negative_stock: editAllowNegative ? editAllowNegative === "allow" : null,
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

  const columns = useMemo<ColumnDef<WarehouseRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "location",
        accessorFn: (r) => r.location || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Location" />,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.location || "-"}</span>,
      },
      {
        id: "virtual",
        accessorFn: (r) => (r.is_virtual ? "yes" : "no"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Virtual" />,
        cell: ({ row }) => (
          <Badge variant={row.original.is_virtual ? "secondary" : "outline"}>
            {row.original.is_virtual ? "Yes" : "No"}
          </Badge>
        ),
      },
      {
        id: "bins",
        accessorFn: (r) => (r.binning_enabled ? "yes" : "no"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bins" />,
        cell: ({ row }) => (
          <Badge variant={row.original.binning_enabled ? "secondary" : "outline"}>
            {row.original.binning_enabled ? "Yes" : "No"}
          </Badge>
        ),
      },
      {
        id: "min_shelf_life",
        accessorFn: (r) => Number(r.min_shelf_life_days_for_sale_default || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Min Shelf-Life Days" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{Number(row.original.min_shelf_life_days_for_sale_default || 0)}</span>
        ),
      },
      {
        id: "negative_stock",
        accessorFn: (r) => (r.allow_negative_stock == null ? "inherit" : r.allow_negative_stock ? "allow" : "block"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Negative Stock" />,
        cell: ({ row }) => {
          const val = row.original.allow_negative_stock;
          return (
            <Badge variant={val == null ? "outline" : val ? "warning" : "secondary"}>
              {val == null ? "Inherit" : val ? "Allow" : "Block"}
            </Badge>
          );
        },
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

  function NegativeStockSelect({ value, onValueChange }: { value: string; onValueChange: (v: "" | "allow" | "block") => void }) {
    return (
      <Select value={value || "__inherit__"} onValueChange={(v) => onValueChange(v === "__inherit__" ? "" : (v as "allow" | "block"))}>
        <SelectTrigger>
          <SelectValue placeholder="Inherit" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__inherit__">Inherit</SelectItem>
          <SelectItem value="block">Block</SelectItem>
          <SelectItem value="allow">Allow</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Warehouses"
        description="Warehouses used for stock moves, costing, and POS defaults."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading || creating || saving}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={loading || creating || saving}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Warehouse
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Warehouse</DialogTitle>
                  <DialogDescription>Add a warehouse for stock moves + POS config.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createWarehouse} className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Warehouse" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Location (optional)</label>
                    <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lebanon" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Address (optional)</label>
                    <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city..." />
                  </div>
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox checked={isVirtual} onCheckedChange={(v) => setIsVirtual(v === true)} />
                      Virtual warehouse
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox checked={binningEnabled} onCheckedChange={(v) => setBinningEnabled(v === true)} />
                      Binning enabled
                    </label>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Capacity Note (optional)</label>
                    <Input value={capacityNote} onChange={(e) => setCapacityNote(e.target.value)} placeholder="e.g. 200 pallets max" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Min Shelf-Life Days For Sale (default)</label>
                    <Input value={minShelfLifeDays} onChange={(e) => setMinShelfLifeDays(e.target.value)} placeholder="0" inputMode="numeric" />
                    <p className="text-xs text-muted-foreground">
                      Enforces a minimum shelf-life window for FEFO allocation at sale-posting time (warehouse default).
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Negative Stock Override (optional)</label>
                    <NegativeStockSelect value={allowNegative} onValueChange={setAllowNegative} />
                    <p className="text-xs text-muted-foreground">
                      When set, this overrides item/company negative-stock policy for this warehouse.
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating || loading || saving}>
                      {creating ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {status && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Warehouse</DialogTitle>
            <DialogDescription>Update warehouse metadata and expiry policy defaults.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Location (optional)</label>
              <Input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Address (optional)</label>
              <Input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={editIsVirtual} onCheckedChange={(v) => setEditIsVirtual(v === true)} />
                Virtual warehouse
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={editBinningEnabled} onCheckedChange={(v) => setEditBinningEnabled(v === true)} />
                Binning enabled
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Capacity Note (optional)</label>
              <Input value={editCapacityNote} onChange={(e) => setEditCapacityNote(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Min Shelf-Life Days For Sale (default)</label>
              <Input value={editMinShelfLifeDays} onChange={(e) => setEditMinShelfLifeDays(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Negative Stock Override (optional)</label>
              <NegativeStockSelect value={editAllowNegative} onValueChange={setEditAllowNegative} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || loading || creating}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-4 w-4" />
            Warehouses
          </CardTitle>
          <CardDescription>{warehouses.length} warehouse(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={warehouses}
            isLoading={loading}
            searchPlaceholder="Search warehouse name / location..."
          />
        </CardContent>
      </Card>
    </div>
  );
}
