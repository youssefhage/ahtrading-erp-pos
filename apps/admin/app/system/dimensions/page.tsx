"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { FolderKanban, Plus, RefreshCw } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DimRow = { id: string; code: string; name: string; is_active: boolean; created_at: string; updated_at: string };

function sortDims(rows: DimRow[]) {
  return [...(rows || [])].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return (a.code || "").localeCompare(b.code || "");
  });
}

export default function DimensionsPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    setStatus("");
    try {
      const [cc, pr] = await Promise.all([
        apiGet<{ cost_centers: DimRow[] }>("/dimensions/cost-centers"),
        apiGet<{ projects: DimRow[] }>("/dimensions/projects"),
      ]);
      setCostCenters(cc.cost_centers || []);
      setProjects(pr.projects || []);
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
    setStatus("");
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
    setStatus("");
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

  const makeCols = (kind: "cc" | "pr"): ColumnDef<DimRow>[] => [
    {
      accessorKey: "code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => <span className="text-sm">{row.original.name}</span>,
    },
    {
      id: "is_active",
      accessorFn: (r) => (r.is_active ? 1 : 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Active" />,
      cell: ({ row }) => <StatusBadge status={row.original.is_active ? "active" : "inactive"} />,
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={() => openEdit(kind, row.original)} disabled={loading || creating || saving}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  /* eslint-disable react-hooks/exhaustive-deps */
  const ccColumns = useMemo(() => makeCols("cc"), [loading, creating, saving]);
  const prColumns = useMemo(() => makeCols("pr"), [loading, creating, saving]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Dimensions"
        description="Cost centers and projects for tagging journals and reports."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading || creating || saving}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
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

      {/* Create Dialog */}
      <Dialog open={Boolean(createOpen)} onOpenChange={(o) => setCreateOpen(o ? createOpen : "")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create {createOpen === "cc" ? "Cost Center" : "Project"}</DialogTitle>
            <DialogDescription>Dimensions let you tag journals for better reporting.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createDim} className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Code</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CC-001" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Retail Operations" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Active</label>
              <Select value={isActive ? "yes" : "no"} onValueChange={(v) => setIsActive(v === "yes")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen("")} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating || loading || saving}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={Boolean(editOpen)} onOpenChange={(o) => setEditOpen(o ? editOpen : "")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editOpen === "cc" ? "Cost Center" : "Project"}</DialogTitle>
            <DialogDescription>Update code/name or deactivate.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Code</label>
              <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Active</label>
              <Select value={editActive ? "yes" : "no"} onValueChange={(v) => setEditActive(v === "yes")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen("")} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || loading || creating}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Side-by-side grids */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4" />
                  Cost Centers
                </CardTitle>
                <CardDescription>{ccSorted.length} row(s)</CardDescription>
              </div>
              <Button size="sm" onClick={() => openCreate("cc")} disabled={loading || creating || saving}>
                <Plus className="mr-2 h-4 w-4" />
                New
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable columns={ccColumns} data={ccSorted} isLoading={loading} searchPlaceholder="Search code / name" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4" />
                  Projects
                </CardTitle>
                <CardDescription>{prSorted.length} row(s)</CardDescription>
              </div>
              <Button size="sm" onClick={() => openCreate("pr")} disabled={loading || creating || saving}>
                <Plus className="mr-2 h-4 w-4" />
                New
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable columns={prColumns} data={prSorted} isLoading={loading} searchPlaceholder="Search code / name" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
