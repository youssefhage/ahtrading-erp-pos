"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

type DimRow = { id: string; code: string; name: string; is_active: boolean; created_at: string; updated_at: string };

function sortDims(rows: DimRow[]) {
  return [...(rows || [])].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return (a.code || "").localeCompare(b.code || "");
  });
}

export default function DimensionsPage() {
  const [status, setStatus] = useState("");
  const [costCenters, setCostCenters] = useState<DimRow[]>([]);
  const [projects, setProjects] = useState<DimRow[]>([]);

  const [createOpen, setCreateOpen] = useState<"cc" | "pr" | "">("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState<"cc" | "pr" | "">("");
  const [editId, setEditId] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const ccSorted = useMemo(() => sortDims(costCenters), [costCenters]);
  const prSorted = useMemo(() => sortDims(projects), [projects]);

  async function load() {
    setStatus("Loading...");
    try {
      const [cc, pr] = await Promise.all([
        apiGet<{ cost_centers: DimRow[] }>("/dimensions/cost-centers"),
        apiGet<{ projects: DimRow[] }>("/dimensions/projects")
      ]);
      setCostCenters(cc.cost_centers || []);
      setProjects(pr.projects || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate(kind: "cc" | "pr") {
    setCode("");
    setName("");
    setIsActive(true);
    setCreateOpen(kind);
  }

  async function createDim(e: React.FormEvent) {
    e.preventDefault();
    if (!createOpen) return;
    if (!code.trim() || !name.trim()) return setStatus("code and name are required");
    setCreating(true);
    setStatus("Creating...");
    try {
      const payload = { code: code.trim(), name: name.trim(), is_active: isActive };
      if (createOpen === "cc") await apiPost("/dimensions/cost-centers", payload);
      else await apiPost("/dimensions/projects", payload);
      setCreateOpen("");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(kind: "cc" | "pr", row: DimRow) {
    setEditOpen(kind);
    setEditId(row.id);
    setEditCode(row.code || "");
    setEditName(row.name || "");
    setEditActive(Boolean(row.is_active));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editOpen || !editId) return;
    if (!editCode.trim() || !editName.trim()) return setStatus("code and name are required");
    setSaving(true);
    setStatus("Saving...");
    try {
      const payload = { code: editCode.trim(), name: editName.trim(), is_active: editActive };
      if (editOpen === "cc") await apiPatch(`/dimensions/cost-centers/${encodeURIComponent(editId)}`, payload);
      else await apiPatch(`/dimensions/projects/${encodeURIComponent(editId)}`, payload);
      setEditOpen("");
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
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cost Centers</CardTitle>
            <CardDescription>{ccSorted.length} rows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Button onClick={() => openCreate("cc")}>New</Button>
            </div>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ccSorted.map((r) => (
                    <tr key={r.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                      <td className="px-3 py-2 text-sm">{r.name}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{r.is_active ? "yes" : "no"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button type="button" size="sm" variant="outline" onClick={() => openEdit("cc", r)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!ccSorted.length ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                        No cost centers.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
            <CardDescription>{prSorted.length} rows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Button onClick={() => openCreate("pr")}>New</Button>
            </div>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {prSorted.map((r) => (
                    <tr key={r.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                      <td className="px-3 py-2 text-sm">{r.name}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{r.is_active ? "yes" : "no"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button type="button" size="sm" variant="outline" onClick={() => openEdit("pr", r)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!prSorted.length ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                        No projects.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(createOpen)} onOpenChange={(o) => setCreateOpen(o ? createOpen : "")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create {createOpen === "cc" ? "Cost Center" : "Project"}</DialogTitle>
            <DialogDescription>Dimensions let you tag journals for better reporting.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createDim} className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Code</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CC-001" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Retail Operations" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Active</label>
              <select className="ui-select" value={isActive ? "yes" : "no"} onChange={(e) => setIsActive(e.target.value === "yes")}>
                <option value="yes">yes</option>
                <option value="no">no</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen("")} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "..." : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editOpen)} onOpenChange={(o) => setEditOpen(o ? editOpen : "")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editOpen === "cc" ? "Cost Center" : "Project"}</DialogTitle>
            <DialogDescription>Update code/name or deactivate.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Code</label>
              <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Active</label>
              <select className="ui-select" value={editActive ? "yes" : "no"} onChange={(e) => setEditActive(e.target.value === "yes")}>
                <option value="yes">yes</option>
                <option value="no">no</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen("")} disabled={saving}>
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
  );
}
