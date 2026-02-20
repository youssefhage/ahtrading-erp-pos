"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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
    setEditDefaultWarehouseId(String((b as any).default_warehouse_id || ""));
    setEditInvoicePrefix(String((b as any).invoice_prefix || ""));
    setEditOperatingHours((b as any).operating_hours ? JSON.stringify((b as any).operating_hours, null, 2) : "");
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

  const columns: Array<DataTableColumn<BranchRow>> = [
    { id: "name", header: "Name", accessor: (b) => b.name, sortable: true, cell: (b) => <span className="font-medium text-foreground">{b.name}</span> },
    { id: "address", header: "Address", accessor: (b) => b.address || "", cell: (b) => <span className="text-fg-muted">{b.address || "-"}</span> },
    {
      id: "default_warehouse",
      header: "Default Warehouse",
      accessor: (b) => String((b as any).default_warehouse_id || ""),
      cell: (b) =>
        (b as any).default_warehouse_id ? (
          <span className="text-xs text-fg-muted">{whNameById.get((b as any).default_warehouse_id) || (b as any).default_warehouse_id}</span>
        ) : (
          <span className="text-xs text-fg-subtle">-</span>
        ),
    },
    { id: "invoice_prefix", header: "Invoice Prefix", accessor: (b) => String((b as any).invoice_prefix || ""), cell: (b) => <span className="text-xs text-fg-muted">{(b as any).invoice_prefix || "-"}</span> },
    { id: "id", header: "Branch ID", accessor: (b) => b.id, mono: true, defaultHidden: true, cell: (b) => <span className="text-xs text-fg-subtle">{b.id}</span> },
    {
      id: "actions",
      header: "Actions",
      accessor: () => "",
      globalSearch: false,
      align: "right",
      cell: (b) => (
        <Button variant="outline" size="sm" onClick={() => openEdit(b)} disabled={loading || creating || saving}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <Page width="lg" className="px-4">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="Branches"
        description="Branches are your stores/locations. POS devices can be scoped to a branch."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading || creating || saving}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button disabled={loading || creating || saving}>New Branch</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Branch</DialogTitle>
                  <DialogDescription>Add a new store/branch.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createBranch} className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Address (optional)</label>
                    <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Lebanon" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Default Warehouse (optional)</label>
                    <select className="ui-select" value={defaultWarehouseId} onChange={(e) => setDefaultWarehouseId(e.target.value)}>
                      <option value="">(none)</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Invoice Prefix (optional)</label>
                    <Input value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} placeholder="e.g. BR1-" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Operating Hours JSON (optional)</label>
                    <textarea
                      className="ui-textarea"
                      value={operatingHours}
                      onChange={(e) => setOperatingHours(e.target.value)}
                      rows={4}
                      placeholder='{"mon":[["09:00","18:00"]]}'
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating || loading || saving}>
                      {creating ? "..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Branch</DialogTitle>
            <DialogDescription>Update branch configuration and defaults.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Address (optional)</label>
              <Input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Default Warehouse (optional)</label>
              <select className="ui-select" value={editDefaultWarehouseId} onChange={(e) => setEditDefaultWarehouseId(e.target.value)}>
                <option value="">(none)</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Invoice Prefix (optional)</label>
              <Input value={editInvoicePrefix} onChange={(e) => setEditInvoicePrefix(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Operating Hours JSON (optional)</label>
              <textarea className="ui-textarea" value={editOperatingHours} onChange={(e) => setEditOperatingHours(e.target.value)} rows={6} />
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

      <Section title="List" description={`${branches.length} branches`}>
        <DataTable<BranchRow>
          tableId="system.branches"
          rows={branches}
          columns={columns}
          isLoading={loading}
          emptyText={loading ? "Loading branches..." : "No branches."}
          globalFilterPlaceholder="Search branch name / address..."
          initialSort={{ columnId: "name", dir: "asc" }}
        />
      </Section>
    </Page>
  );
}
