"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type RoleRow = { id: string; name: string };
type PermissionRow = { id: string; code: string; description: string };

export default function RolesPermissionsPage() {
  const [status, setStatus] = useState("");
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);

  const [newRoleName, setNewRoleName] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);

  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [rolePerms, setRolePerms] = useState<{ code: string; description: string }[]>([]);

  const [assignPermCode, setAssignPermCode] = useState("");
  const [assigning, setAssigning] = useState(false);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  async function load() {
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
  }

  async function loadRolePerms(roleId: string) {
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
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedRoleId && roles.length) setSelectedRoleId(roles[0]?.id || "");
    if (!assignPermCode && permissions.length) setAssignPermCode(permissions[0]?.code || "");
  }, [roles, permissions, selectedRoleId, assignPermCode]);

  useEffect(() => {
    loadRolePerms(selectedRoleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId]);

  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    if (!newRoleName.trim()) return setStatus("role name is required");
    setCreatingRole(true);
    setStatus("Creating role...");
    try {
      await apiPost("/users/roles", { name: newRoleName.trim() });
      setNewRoleName("");
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
    <AppShell title="Roles & Permissions">
      <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex items-center justify-end">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create Role</CardTitle>
            <CardDescription>Create a new company role, then assign permissions below.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createRole} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Role Name</label>
                <Input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="Cashier / Manager / Accounting" />
              </div>
              <div className="md:col-span-1 flex items-end">
                <Button type="submit" disabled={creatingRole}>
                  {creatingRole ? "..." : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assign Permission</CardTitle>
            <CardDescription>Grant a permission code to a role.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={assignPermission} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Role</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
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
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Permission</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
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
              <div className="md:col-span-1 flex items-end">
                <Button type="submit" disabled={assigning}>
                  {assigning ? "..." : "Grant"}
                </Button>
              </div>
            </form>

            <div className="rounded-md border border-slate-200 bg-white p-3">
              <p className="text-sm font-medium text-slate-900">
                Role Permissions
                {selectedRoleId ? (
                  <span className="ml-2 text-xs font-normal text-slate-600">
                    ({roleById.get(selectedRoleId)?.name || selectedRoleId})
                  </span>
                ) : null}
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-3 py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rolePerms.map((p) => (
                      <tr key={p.code} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                        <td className="px-3 py-2">{p.description}</td>
                      </tr>
                    ))}
                    {rolePerms.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-500" colSpan={2}>
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
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                      <td className="px-3 py-2">{p.description}</td>
                    </tr>
                  ))}
                  {permissions.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={2}>
                        No permissions.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

