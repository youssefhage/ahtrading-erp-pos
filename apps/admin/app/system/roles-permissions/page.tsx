"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

type RoleRow = { id: string; name: string };
type PermissionRow = { id: string; code: string; description: string };

export default function RolesPermissionsPage() {
  const [status, setStatus] = useState("");
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);

  const [newRoleName, setNewRoleName] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);

  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [rolePerms, setRolePerms] = useState<{ code: string; description: string }[]>([]);

  const [assignPermCode, setAssignPermCode] = useState("");
  const [assigning, setAssigning] = useState(false);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [r, p] = await Promise.all([
        apiGet<{ roles: RoleRow[] }>("/users/roles"),
        apiGet<{ permissions: PermissionRow[] }>("/users/permissions")
      ]);
      setRoles(r.roles || []);
      setPermissions(p.permissions || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  const loadRolePerms = useCallback(async (roleId: string) => {
    if (!roleId) {
      setRolePerms([]);
      return;
    }
    setStatus("Loading role permissions...");
    try {
      const res = await apiGet<{ permissions: { code: string; description: string }[] }>(
        `/users/roles/${roleId}/permissions`
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
        permission_code: assignPermCode
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

  const rolePermColumns = useMemo((): Array<DataTableColumn<{ code: string; description: string }>> => {
    return [
      {
        id: "code",
        header: "Code",
        sortable: true,
        mono: true,
        accessor: (p) => p.code,
        cell: (p) => <span className="font-mono text-xs">{p.code}</span>,
      },
      {
        id: "description",
        header: "Description",
        sortable: true,
        accessor: (p) => p.description,
        cell: (p) => <span className="text-sm">{p.description}</span>,
      },
    ];
  }, []);

  const allPermColumns = useMemo((): Array<DataTableColumn<PermissionRow>> => {
    return [
      {
        id: "code",
        header: "Code",
        sortable: true,
        mono: true,
        accessor: (p) => p.code,
        cell: (p) => <span className="font-mono text-xs">{p.code}</span>,
      },
      {
        id: "description",
        header: "Description",
        sortable: true,
        accessor: (p) => p.description,
        cell: (p) => <span className="text-sm">{p.description}</span>,
      },
    ];
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Roles & Permissions</h1>
          <p className="text-sm text-fg-muted">Define roles and grant permission codes.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>New Role</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Role</DialogTitle>
                <DialogDescription>Create a company role, then grant permissions.</DialogDescription>
              </DialogHeader>
              <form onSubmit={createRole} className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Role Name</label>
                  <Input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="Cashier / Manager / Accounting" />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={creatingRole}>
                    {creatingRole ? "..." : "Create"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary">Grant Permission</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Grant Permission</DialogTitle>
                <DialogDescription>Grant a permission code to a role.</DialogDescription>
              </DialogHeader>
              <form onSubmit={assignPermission} className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Role</label>
                  <select
                    className="ui-select"
                    value={selectedRoleId}
                    onChange={(e) => setSelectedRoleId(e.target.value)}
                  >
                    <option value="">Select role...</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Permission</label>
                  <select
                    className="ui-select"
                    value={assignPermCode}
                    onChange={(e) => setAssignPermCode(e.target.value)}
                  >
                    <option value="">Select permission...</option>
                    {permissions.map((p) => (
                      <option key={p.id} value={p.code}>
                        {p.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={assigning}>
                    {assigning ? "..." : "Grant"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

        <Card>
          <CardHeader>
            <CardTitle>Role Permissions</CardTitle>
            <CardDescription>Pick a role to review its assigned permissions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Role</label>
                <select
                  className="ui-select"
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                >
                  <option value="">Select role...</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DataTable<{ code: string; description: string }>
              tableId="system.roles_permissions.role_perms"
              rows={rolePerms}
              columns={rolePermColumns}
              getRowId={(r) => r.code}
              enablePagination
              emptyText={selectedRoleId ? "No permissions assigned." : "Select a role."}
              enableGlobalFilter={Boolean(selectedRoleId)}
              globalFilterPlaceholder="Search permission code / description"
              initialSort={{ columnId: "code", dir: "asc" }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>All Permissions</CardTitle>
            <CardDescription>{permissions.length} permission codes</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<PermissionRow>
              tableId="system.roles_permissions.all_permissions"
              rows={permissions}
              columns={allPermColumns}
              getRowId={(r) => r.id}
              enablePagination
              emptyText="No permissions."
              globalFilterPlaceholder="Search code / description"
              initialSort={{ columnId: "code", dir: "asc" }}
            />
          </CardContent>
        </Card>
      </div>);
}
