"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

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

            <div className="rounded-md border border-border bg-bg-elevated p-3">
              <p className="text-sm font-medium text-foreground">
                {selectedRoleId ? (
                  <span className="ml-2 text-xs font-normal text-fg-muted">
                    ({roleById.get(selectedRoleId)?.name || selectedRoleId})
                  </span>
                ) : null}
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-3 py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rolePerms.map((p) => (
                      <tr key={p.code} className="ui-tr-hover">
                        <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                        <td className="px-3 py-2">{p.description}</td>
                      </tr>
                    ))}
                    {rolePerms.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={2}>
                          No permissions assigned.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>All Permissions</CardTitle>
            <CardDescription>{permissions.length} permission codes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((p) => (
                    <tr key={p.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                      <td className="px-3 py-2">{p.description}</td>
                    </tr>
                  ))}
                  {permissions.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={2}>
                        No permissions.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>);
}
