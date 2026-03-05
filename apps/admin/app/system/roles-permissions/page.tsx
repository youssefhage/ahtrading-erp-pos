"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Shield, ShieldCheck, Trash2 } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { ConfirmDialog } from "@/components/business/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type RoleRow = { id: string; name: string; assigned_users?: number; template_code?: string | null };
type PermissionRow = { id: string; code: string; description: string };

export default function RolesPermissionsPage() {
  const seededDefaultsOnceRef = useRef(false);
  const [status, setStatus] = useState("");
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [editRoleOpen, setEditRoleOpen] = useState(false);
  const [seedingDefaults, setSeedingDefaults] = useState(false);

  const [newRoleName, setNewRoleName] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);

  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [rolePerms, setRolePerms] = useState<{ code: string; description: string }[]>([]);

  const [assignPermCode, setAssignPermCode] = useState("");
  const [assigning, setAssigning] = useState(false);

  const [editRoleId, setEditRoleId] = useState("");
  const [editRoleName, setEditRoleName] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const selectedRole = useMemo(() => (selectedRoleId ? roleById.get(selectedRoleId) || null : null), [roleById, selectedRoleId]);
  const loading = status.startsWith("Loading");
  const statusIsBusy = /^(Loading|Creating|Assigning|Saving|Deleting|Revoking)\b/.test(status);
  const statusIsNotice = status.startsWith("Standard roles ready.");

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [r, p] = await Promise.all([
        apiGet<{ roles: RoleRow[] }>("/users/roles"),
        apiGet<{ permissions: PermissionRow[] }>("/users/permissions"),
      ]);
      let nextRoles = r.roles || [];
      if (!nextRoles.length && !seededDefaultsOnceRef.current) {
        seededDefaultsOnceRef.current = true;
        try {
          await apiPost("/users/roles/seed-defaults", {});
          const seeded = await apiGet<{ roles: RoleRow[] }>("/users/roles");
          nextRoles = seeded.roles || [];
        } catch {
          // Keep role page available even if seeding fails.
        }
      }
      setRoles(nextRoles);
      setPermissions(p.permissions || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  const seedDefaults = useCallback(async () => {
    setSeedingDefaults(true);
    setStatus("Loading standard roles...");
    try {
      const res = await apiPost<{ created?: number }>("/users/roles/seed-defaults", {});
      await load();
      setStatus(`Standard roles ready. Created ${Number(res?.created || 0)} new role(s).`);
      window.setTimeout(() => setStatus(""), 1600);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSeedingDefaults(false);
    }
  }, [load]);

  const loadRolePerms = useCallback(async (roleId: string) => {
    if (!roleId) {
      setRolePerms([]);
      return;
    }
    setStatus("Loading role permissions...");
    try {
      const res = await apiGet<{ permissions: { code: string; description: string }[] }>(
        `/users/roles/${roleId}/permissions`,
      );
      setRolePerms(res.permissions || []);
      setStatus("");
    } catch (err) {
      setRolePerms([]);
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedRoleId && roles.length) setSelectedRoleId(roles[0]?.id || "");
    if (!assignPermCode && permissions.length) setAssignPermCode(permissions[0]?.code || "");
  }, [roles, permissions, selectedRoleId, assignPermCode]);

  useEffect(() => {
    loadRolePerms(selectedRoleId);
  }, [selectedRoleId, loadRolePerms]);

  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    if (!newRoleName.trim()) return setStatus("role name is required");
    setCreatingRole(true);
    setStatus("Creating role...");
    try {
      await apiPost("/users/roles", { name: newRoleName.trim() });
      setNewRoleName("");
      setCreateOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreatingRole(false);
    }
  }

  async function assignPermission(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRoleId) return setStatus("role is required");
    if (!assignPermCode) return setStatus("permission is required");
    setAssigning(true);
    setStatus("Assigning permission...");
    try {
      await apiPost("/users/roles/permissions", {
        role_id: selectedRoleId,
        permission_code: assignPermCode,
      });
      setGrantOpen(false);
      await loadRolePerms(selectedRoleId);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setAssigning(false);
    }
  }

  const saveRoleName = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editRoleId) return;
      if (!editRoleName.trim()) return setStatus("role name is required");
      setEditSaving(true);
      setStatus("Saving role...");
      try {
        await apiPatch(`/users/roles/${encodeURIComponent(editRoleId)}`, { name: editRoleName.trim() });
        setEditRoleOpen(false);
        await load();
        setStatus("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(message);
      } finally {
        setEditSaving(false);
      }
    },
    [editRoleId, editRoleName, load],
  );

  const deleteRole = useCallback(
    async (role: RoleRow) => {
      if (role.assigned_users && role.assigned_users > 0) {
        setStatus(`Role "${role.name}" is assigned to ${role.assigned_users} user(s) and cannot be deleted until unassigned.`);
        return;
      }
      setStatus("Deleting role...");
      try {
        await apiDelete(`/users/roles/${encodeURIComponent(role.id)}`);
        if (selectedRoleId === role.id) setSelectedRoleId("");
        await load();
        setStatus("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(message);
      }
    },
    [load, selectedRoleId],
  );

  const revokePermission = useCallback(
    async (code: string) => {
      if (!selectedRoleId) return;
      setStatus("Revoking permission...");
      try {
        await apiDelete(`/users/roles/${encodeURIComponent(selectedRoleId)}/permissions/${encodeURIComponent(code)}`);
        await loadRolePerms(selectedRoleId);
        setStatus("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(message);
      }
    },
    [loadRolePerms, selectedRoleId],
  );

  const rolePermColumns = useMemo<ColumnDef<{ code: string; description: string }>[]>(
    () => [
      {
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
      },
      {
        accessorKey: "description",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
        cell: ({ row }) => <span className="text-sm">{row.original.description}</span>,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex justify-end">
            <ConfirmDialog
              title={`Revoke "${row.original.code}"?`}
              description="This removes the permission from the selected role."
              confirmLabel="Revoke"
              variant="destructive"
              onConfirm={() => revokePermission(row.original.code)}
              trigger={
                <Button variant="outline" size="sm">
                  Revoke
                </Button>
              }
            />
          </div>
        ),
      },
    ],
    [revokePermission],
  );

  const allPermColumns = useMemo<ColumnDef<PermissionRow>[]>(
    () => [
      {
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
      },
      {
        accessorKey: "description",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
        cell: ({ row }) => <span className="text-sm">{row.original.description}</span>,
      },
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Roles & Permissions"
        description="Define roles and grant permission codes."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={statusIsBusy}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={seedDefaults} disabled={seedingDefaults}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              {seedingDefaults ? "Loading..." : "Load Standard Roles"}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New Role
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Role</DialogTitle>
                  <DialogDescription>Create a company role, then grant permissions.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createRole} className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Role Name</label>
                    <Input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="Cashier / Manager / Accounting" />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creatingRole}>
                      {creatingRole ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {status && !statusIsBusy && !statusIsNotice && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {statusIsNotice && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3">
            <p className="text-sm text-primary">{status}</p>
          </CardContent>
        </Card>
      )}

      {/* Rename Role Dialog */}
      <Dialog open={editRoleOpen} onOpenChange={setEditRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Role</DialogTitle>
            <DialogDescription>Changes the display name only.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveRoleName} className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Role Name</label>
              <Input value={editRoleName} onChange={(e) => setEditRoleName(e.target.value)} placeholder="Role name" />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={editSaving}>
                {editSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Grant Permission Dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant Permission</DialogTitle>
            <DialogDescription>Grant a permission code to a role.</DialogDescription>
          </DialogHeader>
          <form onSubmit={assignPermission} className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role..." />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                      {r.template_code ? " (Standard)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Permission</label>
              <Select value={assignPermCode} onValueChange={setAssignPermCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Select permission..." />
                </SelectTrigger>
                <SelectContent>
                  {permissions.map((p) => (
                    <SelectItem key={p.id} value={p.code}>
                      {p.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={assigning}>
                {assigning ? "Granting..." : "Grant"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Role Permissions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Role Permissions
              </CardTitle>
              <CardDescription>Pick a role to review its assigned permissions.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!selectedRoleId}
                onClick={() => {
                  const r = roleById.get(selectedRoleId);
                  if (!r) return;
                  setEditRoleId(r.id);
                  setEditRoleName(r.name || "");
                  setEditRoleOpen(true);
                }}
              >
                Rename
              </Button>
              <ConfirmDialog
                title="Delete Role?"
                description={
                  selectedRole?.assigned_users
                    ? `This role is assigned to ${selectedRole.assigned_users} user(s). Unassign users first.`
                    : "This deletes the role (and its permissions)."
                }
                confirmLabel="Delete"
                variant="destructive"
                onConfirm={() => {
                  const r = roleById.get(selectedRoleId);
                  if (!r) return;
                  return deleteRole(r);
                }}
                trigger={
                  <Button variant="outline" size="sm" disabled={!selectedRoleId || Boolean(selectedRole?.assigned_users)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                }
              />
              <Button variant="secondary" size="sm" onClick={() => setGrantOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Grant Permission
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="w-full md:w-80">
            <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select role..." />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                    {r.template_code ? " (Standard)" : ""}
                    {r.assigned_users ? ` [${r.assigned_users} user(s)]` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DataTable
            columns={rolePermColumns}
            data={rolePerms}
            isLoading={loading}
            searchPlaceholder="Search permission code / description"
          />
        </CardContent>
      </Card>

      {/* All Permissions */}
      <Card>
        <CardHeader>
          <CardTitle>All Permissions</CardTitle>
          <CardDescription>
            {permissions.length} permission code(s) registered in the system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={allPermColumns} data={permissions} isLoading={loading} searchPlaceholder="Search code / description" />
        </CardContent>
      </Card>
    </div>
  );
}
