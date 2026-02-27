"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, FolderTree } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { SearchableSelect } from "@/components/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
  updated_at: string;
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function ItemCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const parentNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const openEdit = useCallback((c: Category) => {
    setEditCat(c);
    setEditName(c.name || "");
    setEditParentId(c.parent_id || "");
    setEditIsActive(c.is_active !== false);
    setEditOpen(true);
  }, []);

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const res = await apiGet<{ categories: Category[] }>("/item-categories");
      setCategories(res.categories || []);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const columns = useMemo<ColumnDef<Category>[]>(() => [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => (
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => openEdit(row.original)}>
          {row.original.name}
        </button>
      ),
    },
    {
      accessorFn: (c) => (c.parent_id ? parentNameById.get(c.parent_id) || c.parent_id : ""),
      id: "parent",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Parent" />,
      cell: ({ row }) => {
        const pid = row.original.parent_id;
        return pid ? parentNameById.get(pid) || pid : <span className="text-muted-foreground">-</span>;
      },
    },
    {
      accessorFn: (c) => (c.is_active === false ? "inactive" : "active"),
      id: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.is_active === false ? "inactive" : "active"} />,
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => openEdit(row.original)}>Edit</Button>
        </div>
      ),
    },
  ], [parentNameById, openEdit]);

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setStatus("Name is required");
    setCreating(true);
    setStatus("");
    try {
      await apiPost("/item-categories", { name: name.trim(), parent_id: parentId || null, is_active: isActive });
      setName("");
      setParentId("");
      setIsActive(true);
      setCreateOpen(false);
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editCat) return;
    if (!editName.trim()) return setStatus("Name is required");
    setSaving(true);
    setStatus("");
    try {
      await apiPatch(`/item-categories/${editCat.id}`, { name: editName.trim(), parent_id: editParentId || null, is_active: editIsActive });
      setEditOpen(false);
      setEditCat(null);
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <PageHeader
        title="Item Categories"
        description={`${categories.length} categories`}
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading}>
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) { setName(""); setParentId(""); setIsActive(true); } }}>
              <DialogTrigger asChild>
                <Button><Plus className="mr-2 h-4 w-4" /> New Category</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create Category</DialogTitle>
                  <DialogDescription>Use categories for reporting, pricing, and shelf labels.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createCategory} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name <span className="text-destructive">*</span></Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dairy, Beverages..." />
                  </div>
                  <div className="space-y-2">
                    <Label>Parent (optional)</Label>
                    <SearchableSelect value={parentId} onChange={setParentId} searchPlaceholder="Search categories..." options={[{ value: "", label: "None" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={isActive} onCheckedChange={setIsActive} />
                    <Label>Active</Label>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={creating}>
                      {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Create
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {status ? <Alert variant="destructive"><AlertDescription>{status}</AlertDescription></Alert> : null}

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={categories}
            isLoading={loading}
            searchPlaceholder="Search categories..."
            pageSize={25}
          />
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>Keep category names stable for reporting.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Parent (optional)</Label>
              <SearchableSelect value={editParentId} onChange={setEditParentId} searchPlaceholder="Search categories..." options={[{ value: "", label: "None" }, ...categories.filter((c) => c.id !== editCat?.id).map((c) => ({ value: c.id, label: c.name }))]} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={editIsActive} onCheckedChange={setEditIsActive} />
              <Label>Active</Label>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
