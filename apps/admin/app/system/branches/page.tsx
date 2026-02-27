"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Plus, RefreshCw } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type BranchRow = {
  id: string;
  name: string;
  address: string | null;
  default_warehouse_id?: string | null;
  invoice_prefix?: string | null;
  operating_hours?: any;
  created_at: string;
  updated_at: string | null;
};

type WarehouseRow = { id: string; name: string };

export default function BranchesPage() {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [defaultWarehouseId, setDefaultWarehouseId] = useState("");
  const [invoicePrefix, setInvoicePrefix] = useState("");
  const [operatingHours, setOperatingHours] = useState("");
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editDefaultWarehouseId, setEditDefaultWarehouseId] = useState("");
  const [editInvoicePrefix, setEditInvoicePrefix] = useState("");
  const [editOperatingHours, setEditOperatingHours] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const [res, wh] = await Promise.all([
        apiGet<{ branches: BranchRow[] }>("/branches"),
        apiGet<{ warehouses: WarehouseRow[] }>("/warehouses").catch(() => ({ warehouses: [] as WarehouseRow[] })),
      ]);
      setBranches(res.branches || []);
      setWarehouses(wh.warehouses || []);
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

  async function createBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus("name is required");
      return;
    }
    let opHours: any = null;
    const ohRaw = (operatingHours || "").trim();
    if (ohRaw) {
      try {
        opHours = JSON.parse(ohRaw);
      } catch {
        setStatus("operating hours must be valid JSON (or leave blank)");
        return;
      }
    }
    setCreating(true);
    setStatus("");
    try {
      await apiPost("/branches", {
        name: name.trim(),
        address: address.trim() || undefined,
        default_warehouse_id: defaultWarehouseId || null,
        invoice_prefix: invoicePrefix.trim() || null,
        operating_hours: opHours,
      });
      setName("");
      setAddress("");
      setDefaultWarehouseId("");
      setInvoicePrefix("");
      setOperatingHours("");
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

  function openEdit(b: BranchRow) {
    setEditId(b.id);
    setEditName(b.name);
    setEditAddress(b.address || "");
    setEditDefaultWarehouseId(String(b.default_warehouse_id || ""));
    setEditInvoicePrefix(String(b.invoice_prefix || ""));
    setEditOperatingHours(b.operating_hours ? JSON.stringify(b.operating_hours, null, 2) : "");
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    if (!editName.trim()) return setStatus("name is required");
    let opHours: any = null;
    const ohRaw = (editOperatingHours || "").trim();
    if (ohRaw) {
      try {
        opHours = JSON.parse(ohRaw);
      } catch {
        setStatus("operating hours must be valid JSON (or leave blank)");
        return;
      }
    }
    setSaving(true);
    setStatus("");
    try {
      await apiPatch(`/branches/${encodeURIComponent(editId)}`, {
        name: editName.trim(),
        address: editAddress.trim() || null,
        default_warehouse_id: editDefaultWarehouseId || null,
        invoice_prefix: editInvoicePrefix.trim() || null,
        operating_hours: opHours,
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

  const whNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehouses) m.set(w.id, w.name);
    return m;
  }, [warehouses]);

  const columns = useMemo<ColumnDef<BranchRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "address",
        accessorFn: (r) => r.address || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Address" />,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.address || "-"}</span>,
      },
      {
        id: "default_warehouse",
        accessorFn: (r) => String(r.default_warehouse_id || ""),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Default Warehouse" />,
        cell: ({ row }) =>
          row.original.default_warehouse_id ? (
            <span className="text-sm text-muted-foreground">{whNameById.get(row.original.default_warehouse_id) || row.original.default_warehouse_id}</span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
      },
      {
        id: "invoice_prefix",
        accessorFn: (r) => String(r.invoice_prefix || ""),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Prefix" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm text-muted-foreground">{row.original.invoice_prefix || "-"}</span>
        ),
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
    [loading, creating, saving, whNameById],
  );

  function WarehouseSelect({ value, onValueChange }: { value: string; onValueChange: (v: string) => void }) {
    return (
      <Select value={value || "__none__"} onValueChange={(v) => onValueChange(v === "__none__" ? "" : v)}>
        <SelectTrigger>
          <SelectValue placeholder="(none)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">(none)</SelectItem>
          {warehouses.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Branches"
        description="Branches are your stores/locations. POS devices can be scoped to a branch."
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
                  New Branch
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Branch</DialogTitle>
                  <DialogDescription>Add a new store/branch.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createBranch} className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Address (optional)</label>
                    <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Lebanon" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Default Warehouse (optional)</label>
                    <WarehouseSelect value={defaultWarehouseId} onValueChange={setDefaultWarehouseId} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Invoice Prefix (optional)</label>
                    <Input value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} placeholder="e.g. BR1-" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Operating Hours JSON (optional)</label>
                    <Textarea
                      value={operatingHours}
                      onChange={(e) => setOperatingHours(e.target.value)}
                      rows={4}
                      placeholder='{"mon":[["09:00","18:00"]]}'
                    />
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
            <DialogTitle>Edit Branch</DialogTitle>
            <DialogDescription>Update branch configuration and defaults.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Address (optional)</label>
              <Input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Default Warehouse (optional)</label>
              <WarehouseSelect value={editDefaultWarehouseId} onValueChange={setEditDefaultWarehouseId} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Invoice Prefix (optional)</label>
              <Input value={editInvoicePrefix} onChange={(e) => setEditInvoicePrefix(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Operating Hours JSON (optional)</label>
              <Textarea value={editOperatingHours} onChange={(e) => setEditOperatingHours(e.target.value)} rows={6} />
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
            <Building2 className="h-4 w-4" />
            Branches
          </CardTitle>
          <CardDescription>{branches.length} branch(es)</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={branches}
            isLoading={loading}
            searchPlaceholder="Search branch name / address..."
          />
        </CardContent>
      </Card>
    </div>
  );
}
