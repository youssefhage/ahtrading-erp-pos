"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
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

  const dimColumns = useMemo((): Array<DataTableColumn<DimRow>> => {
    return [
      {
        id: "code",
        header: "Code",
        sortable: true,
        mono: true,
        accessor: (r) => r.code,
        cell: (r) => <span className="font-mono text-xs">{r.code}</span>,
      },
      {
        id: "name",
        header: "Name",
        sortable: true,
        accessor: (r) => r.name,
        cell: (r) => <span className="text-sm">{r.name}</span>,
      },
      {
        id: "is_active",
        header: "Active",
        sortable: true,
        accessor: (r) => (r.is_active ? 1 : 0),
        cell: (r) => <span className="text-xs text-fg-muted">{r.is_active ? "yes" : "no"}</span>,
      },
      {
        id: "actions",
        header: "Actions",
        align: "right",
        sortable: false,
        accessor: (r) => r.id,
        cell: () => null,
      },
    ];
  }, []);

  async function load() {
    setLoading(true);
    setStatus("");
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

  return (
    <Page width="lg" className="px-4 pb-10">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="Dimensions"
        description="Cost centers and projects for tagging journals and reports."
        actions={
          <Button variant="outline" onClick={load} disabled={loading || creating || saving}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Section
          title="Cost Centers"
          description={`${ccSorted.length} row(s)`}
          actions={<Button onClick={() => openCreate("cc")} disabled={loading || creating || saving}>New</Button>}
        >
            <DataTable<DimRow>
              tableId="system.dimensions.cost_centers"
              rows={ccSorted}
              columns={dimColumns.map((c) =>
                c.id === "actions"
                  ? {
                      ...c,
                      cell: (r) => (
                        <Button type="button" size="sm" variant="outline" onClick={() => openEdit("cc", r)} disabled={loading || creating || saving}>
                          Edit
                        </Button>
                      ),
                    }
                  : c
              )}
              getRowId={(r) => r.id}
              isLoading={loading}
              emptyText={loading ? "Loading cost centers..." : "No cost centers."}
              globalFilterPlaceholder="Search code / name"
              initialSort={{ columnId: "code", dir: "asc" }}
            />
        </Section>

        <Section title="Projects" description={`${prSorted.length} row(s)`} actions={<Button onClick={() => openCreate("pr")} disabled={loading || creating || saving}>New</Button>}>
            <DataTable<DimRow>
              tableId="system.dimensions.projects"
              rows={prSorted}
              columns={dimColumns.map((c) =>
                c.id === "actions"
                  ? {
                      ...c,
                      cell: (r) => (
                        <Button type="button" size="sm" variant="outline" onClick={() => openEdit("pr", r)} disabled={loading || creating || saving}>
                          Edit
                        </Button>
                      ),
                    }
                  : c
              )}
              getRowId={(r) => r.id}
              isLoading={loading}
              emptyText={loading ? "Loading projects..." : "No projects."}
              globalFilterPlaceholder="Search code / name"
              initialSort={{ columnId: "code", dir: "asc" }}
            />
        </Section>
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
              <Button type="button" variant="outline" onClick={() => setCreateOpen("")} disabled={creating || loading || saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating || loading || saving}>
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
              <Button type="button" variant="outline" onClick={() => setEditOpen("")} disabled={saving || loading || creating}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || loading || creating}>
                {saving ? "..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
