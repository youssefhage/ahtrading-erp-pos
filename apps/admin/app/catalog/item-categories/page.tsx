"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
  updated_at: string;
};

export default function ItemCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(needle) || c.id.toLowerCase().includes(needle));
  }, [categories, q]);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ categories: Category[] }>("/item-categories");
      setCategories(res.categories || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setStatus("name is required");
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/item-categories", {
        name: name.trim(),
        parent_id: parentId || null,
        is_active: isActive
      });
      setName("");
      setParentId("");
      setIsActive(true);
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

  function openEdit(c: Category) {
    setEditCat(c);
    setEditName(c.name || "");
    setEditParentId(c.parent_id || "");
    setEditIsActive(c.is_active !== false);
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editCat) return;
    if (!editName.trim()) return setStatus("name is required");
    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/item-categories/${editCat.id}`, {
        name: editName.trim(),
        parent_id: editParentId || null,
        is_active: editIsActive
      });
      setEditOpen(false);
      setEditCat(null);
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
            <CardDescription>Errors and action results show here.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Item Categories</CardTitle>
              <CardDescription>{categories.length} categories</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Dialog
                open={createOpen}
                onOpenChange={(o) => {
                  setCreateOpen(o);
                  if (!o) {
                    setName("");
                    setParentId("");
                    setIsActive(true);
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button>New Category</Button>
                </DialogTrigger>
                <DialogContent className="max-w-xl">
                  <DialogHeader>
                    <DialogTitle>Create Category</DialogTitle>
                    <DialogDescription>Use categories for reporting, pricing, and shelf labels.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createCategory} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Name</label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dairy, Beverages..." />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Parent (optional)</label>
                      <select className="ui-select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                        <option value="">None</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Active?</label>
                      <select className="ui-select" value={isActive ? "yes" : "no"} onChange={(e) => setIsActive(e.target.value === "yes")}>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                    <div className="md:col-span-2 flex justify-end">
                      <Button type="submit" disabled={creating}>
                        {creating ? "..." : "Create"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="w-full md:w-96">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name..." />
            </div>
          </div>

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Parent</th>
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="ui-tr-hover" style={{ cursor: "pointer" }} onClick={() => openEdit(c)}>
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2">{c.parent_id ? parentNameById.get(c.parent_id) || c.parent_id : "-"}</td>
                    <td className="px-3 py-2">{c.is_active === false ? <span className="text-slate-500">No</span> : "Yes"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openEdit(c);
                        }}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Edit Category</DialogTitle>
                <DialogDescription>Keep category names stable for reporting.</DialogDescription>
              </DialogHeader>
              <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Name</label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Parent (optional)</label>
                  <select className="ui-select" value={editParentId} onChange={(e) => setEditParentId(e.target.value)}>
                    <option value="">None</option>
                    {categories
                      .filter((c) => c.id !== editCat?.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Active?</label>
                  <select className="ui-select" value={editIsActive ? "yes" : "no"} onChange={(e) => setEditIsActive(e.target.value === "yes")}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button type="submit" disabled={saving}>
                    {saving ? "..." : "Save"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}

