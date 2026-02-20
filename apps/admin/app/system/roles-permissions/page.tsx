"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ConfirmButton } from "@/components/confirm-button";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

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
        apiGet<{ permissions: PermissionRow[] }>("/users/permissions")
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

  const saveRoleName = useCallback(async (e: React.FormEvent) => {
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
  }, [editRoleId, editRoleName, load]);

  const deleteRole = useCallback(async (role: RoleRow) => {
    const msg = role.assigned_users
      ? `Role "${role.name}" is assigned to ${role.assigned_users} user(s) and cannot be deleted until unassigned.`
      : `Delete role "${role.name}"?`;
    if (role.assigned_users && role.assigned_users > 0) {
      setStatus(msg);
      return;
    }
    setStatus("Deleting role...");
    await apiDelete(`/users/roles/${encodeURIComponent(role.id)}`);
    if (selectedRoleId === role.id) setSelectedRoleId("");
    await load();
    setStatus("");
  }, [load, selectedRoleId]);

  const revokePermission = useCallback(async (code: string) => {
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
  }, [loadRolePerms, selectedRoleId]);

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
      {
        id: "actions",
        header: "Actions",
        accessor: () => "",
        globalSearch: false,
        align: "right",
        cell: (p) => (
          <ConfirmButton
            variant="outline"
            size="sm"
            title={`Revoke "${p.code}"?`}
            description="This removes the permission from the selected role."
            confirmText="Revoke"
            confirmVariant="destructive"
            onError={(err) => setStatus(err instanceof Error ? err.message : String(err))}
            onConfirm={() => revokePermission(p.code)}
          >
            Revoke
          </ConfirmButton>
        ),
      },
    ];
  }, [revokePermission]);

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
    <Page width="lg" className="px-4 pb-10">
      {status && !statusIsBusy && !statusIsNotice ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="Roles & Permissions"
        description="Define roles and grant permission codes."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={load} disabled={statusIsBusy}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
          <Button variant="outline" onClick={seedDefaults} disabled={seedingDefaults}>
            {seedingDefaults ? "..." : "Load Standard Roles"}
          </Button>
          <Button
            variant="outline"
            disabled={!selectedRoleId}
            onClick={() => {
              const r = roleById.get(selectedRoleId);
              if (!r) return;
              setEditRoleId(r.id);
              setEditRoleName(r.name || "");
              setEditRoleOpen(true);
            }}
          >
            Rename Role
          </Button>
          <ConfirmButton
            variant="outline"
            disabled={!selectedRoleId || Boolean(selectedRole?.assigned_users)}
            title="Delete Role?"
            description={
              selectedRole?.assigned_users
                ? `This role is assigned to ${selectedRole.assigned_users} user(s). Unassign users first.`
                : "This deletes the role (and its permissions)."
            }
            confirmText="Delete"
            confirmVariant="destructive"
            onError={(err) => setStatus(err instanceof Error ? err.message : String(err))}
            onConfirm={() => {
              const r = roleById.get(selectedRoleId);
              if (!r) return;
              return deleteRole(r);
            }}
          >
            Delete Role
          </ConfirmButton>
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
                        {r.name}{r.template_code ? " (Standard)" : ""}
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
        }
      />

      <Dialog open={editRoleOpen} onOpenChange={setEditRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Role</DialogTitle>
            <DialogDescription>Changes the display name only.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveRoleName} className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Role Name</label>
              <Input value={editRoleName} onChange={(e) => setEditRoleName(e.target.value)} placeholder="Role name" />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={editSaving}>
                {editSaving ? "..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Section title="Role Permissions" description="Pick a role to review its assigned permissions.">
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
                      {r.name}{r.template_code ? " (Standard)" : ""}
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
              isLoading={loading}
              emptyText={loading ? "Loading role permissions..." : selectedRoleId ? "No permissions assigned." : "Select a role."}
              enableGlobalFilter={Boolean(selectedRoleId)}
              globalFilterPlaceholder="Search permission code / description"
              initialSort={{ columnId: "code", dir: "asc" }}
            />
      </Section>

      <Section title="All Permissions" description={`${permissions.length} permission code(s)`}>
            <DataTable<PermissionRow>
              tableId="system.roles_permissions.all_permissions"
              rows={permissions}
              columns={allPermColumns}
              getRowId={(r) => r.id}
              enablePagination
              isLoading={loading}
              emptyText={loading ? "Loading permissions..." : "No permissions."}
              globalFilterPlaceholder="Search code / description"
              initialSort={{ columnId: "code", dir: "asc" }}
            />
      </Section>
    </Page>
  );
}
