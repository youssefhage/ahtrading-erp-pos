"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, Plus, RefreshCw, ShieldCheck, UserPlus, Users } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { ConfirmDialog } from "@/components/business/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

type UserRow = {
  id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  is_active: boolean;
  mfa_enabled?: boolean;
  profile_type_code?: string | null;
  profile_type_name?: string | null;
  role_names?: string[];
};
type RoleRow = { id: string; name: string; assigned_users?: number; template_code?: string | null };
type ProfileType = {
  code: string;
  name: string;
  description: string;
  permission_codes: string[];
};

export default function UsersPage() {
  const seededDefaultsOnceRef = useRef(false);
  const [status, setStatus] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [profileTypes, setProfileTypes] = useState<ProfileType[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [templateCode, setTemplateCode] = useState("");
  const [createRoleId, setCreateRoleId] = useState("");
  const [creating, setCreating] = useState(false);

  const [assignUserId, setAssignUserId] = useState("");
  const [assignRoleId, setAssignRoleId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const [profileUserId, setProfileUserId] = useState("");
  const [profileTypeCode, setProfileTypeCode] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  const [editUserId, setEditUserId] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editSaving, setEditSaving] = useState(false);

  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwUserId, setResetPwUserId] = useState("");
  const [resetPwEmail, setResetPwEmail] = useState("");
  const [resetPwValue, setResetPwValue] = useState("");
  const [resetPwSaving, setResetPwSaving] = useState(false);

  const loading = status.startsWith("Loading");
  const statusIsBusy = /^(Loading|Creating|Assigning|Applying|Saving|Removing|Resetting)\b/.test(status);
  const statusIsNotice = status.startsWith("User already existed.") || status.startsWith("Email already exists.") || status.startsWith("Password reset successfully");

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [u, d, r, t] = await Promise.all([
        apiGet<{ users: UserRow[] }>("/users"),
        apiGet<{ users: UserRow[] }>("/users/directory"),
        apiGet<{ roles: RoleRow[] }>("/users/roles"),
        apiGet<{ profile_types?: ProfileType[]; templates?: ProfileType[] }>("/users/profile-types"),
      ]);
      let nextRoles = r.roles || [];
      if (!nextRoles.length && !seededDefaultsOnceRef.current) {
        seededDefaultsOnceRef.current = true;
        try {
          await apiPost("/users/roles/seed-defaults", {});
          const seeded = await apiGet<{ roles: RoleRow[] }>("/users/roles");
          nextRoles = seeded.roles || [];
        } catch {
          // Keep the page usable even if seeding fails.
        }
      }
      setUsers(u.users || []);
      setAllUsers(d.users || []);
      setRoles(nextRoles);
      setProfileTypes(t.profile_types || t.templates || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!assignRoleId && roles.length) setAssignRoleId(roles[0]?.id || "");
    if (!assignUserId && allUsers.length) setAssignUserId(allUsers[0]?.id || "");
  }, [roles, allUsers, assignRoleId, assignUserId]);

  useEffect(() => {
    if (!profileUserId && allUsers.length) setProfileUserId(allUsers[0]?.id || "");
    if (!profileTypeCode && profileTypes.length) setProfileTypeCode(profileTypes[0]?.code || "");
  }, [allUsers, profileTypes, profileUserId, profileTypeCode]);

  useEffect(() => {
    if (!templateCode && profileTypes.length) {
      const preferred = profileTypes.find((p) => p.code === "cashier")?.code || profileTypes[0]?.code || "";
      if (preferred) setTemplateCode(preferred);
    }
  }, [profileTypes, templateCode]);

  useEffect(() => {
    if (templateCode && createRoleId) {
      setCreateRoleId("");
    }
  }, [templateCode, createRoleId]);

  const selectedProfileType = useMemo(
    () => profileTypes.find((t) => t.code === templateCode) || null,
    [profileTypes, templateCode],
  );

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setStatus("email is required");
    if (!password) return setStatus("password is required");
    if (templateCode && createRoleId) return setStatus("choose either a profile type or an existing role");
    setCreating(true);
    setStatus("Creating user...");
    try {
      const res = await apiPost<{ id?: string; created?: boolean; existing?: boolean; access_granted?: boolean; note?: string }>("/users", {
        email: email.trim().toLowerCase(),
        password,
        profile_type_code: templateCode || undefined,
        role_id: createRoleId || undefined,
      });
      setEmail("");
      setPassword("");
      setCreateRoleId("");
      setCreateOpen(false);
      await load();
      if (res && (res.existing || res.created === false)) {
        setStatus(res.note || "User already existed. Access was updated.");
        window.setTimeout(() => setStatus(""), 1800);
      } else {
        setStatus("");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (String(message).includes("409") && String(message).toLowerCase().includes("email")) {
        const desiredEmail = email.trim().toLowerCase();
        const existing = allUsers.find((u) => String(u.email || "").toLowerCase() === desiredEmail) || null;
        if (existing?.id) setAssignUserId(existing.id);
        setPassword("");
        setCreateOpen(false);
        setAssignOpen(true);
        setStatus("Email already exists. Opened Assign Role so you can grant access to this company.");
      } else {
        setStatus(message);
      }
    } finally {
      setCreating(false);
    }
  }

  async function assignRole(e: React.FormEvent) {
    e.preventDefault();
    if (!assignUserId) return setStatus("user is required");
    if (!assignRoleId) return setStatus("role is required");
    setAssigning(true);
    setStatus("Assigning role...");
    try {
      await apiPost("/users/roles/assign", { user_id: assignUserId, role_id: assignRoleId });
      setAssignOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setAssigning(false);
    }
  }

  async function assignProfileType(e: React.FormEvent) {
    e.preventDefault();
    if (!profileUserId) return setStatus("user is required");
    if (!profileTypeCode) return setStatus("profile type is required");
    setProfileSaving(true);
    setStatus("Applying profile type...");
    try {
      await apiPost(`/users/${encodeURIComponent(profileUserId)}/profile-type`, {
        profile_type_code: profileTypeCode,
        replace_existing_roles: true,
      });
      setProfileOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUserId) return;
    if (!editEmail.trim()) return setStatus("email is required");
    setEditSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/users/${encodeURIComponent(editUserId)}`, {
        email: editEmail.trim().toLowerCase(),
        full_name: editFullName.trim() ? editFullName.trim() : null,
        phone: editPhone.trim() ? editPhone.trim() : null,
        is_active: Boolean(editActive),
      });
      setEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setEditSaving(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetPwUserId) return;
    if (!resetPwValue || resetPwValue.length < 6) return setStatus("Password must be at least 6 characters");
    setResetPwSaving(true);
    setStatus("Resetting password...");
    try {
      await apiPost(`/users/${encodeURIComponent(resetPwUserId)}/password`, { password: resetPwValue });
      setResetPwOpen(false);
      setResetPwValue("");
      setStatus("Password reset successfully. User must log in with the new password.");
      window.setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setResetPwSaving(false);
    }
  }

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        accessorKey: "email",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
        cell: ({ row }) => <span className="text-sm">{row.original.email}</span>,
      },
      {
        id: "full_name",
        accessorFn: (r) => r.full_name || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="text-sm">{row.original.full_name || "-"}</span>,
      },
      {
        id: "phone",
        accessorFn: (r) => r.phone || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Phone" />,
        cell: ({ row }) => <span className="text-sm">{row.original.phone || "-"}</span>,
      },
      {
        id: "profile_type",
        accessorFn: (r) => r.profile_type_name || r.profile_type_code || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Profile Type" />,
        cell: ({ row }) => {
          const u = row.original;
          return (
            <span className="text-sm">
              {u.profile_type_name || (u.profile_type_code === "mixed" ? "Mixed / Custom" : "-")}
            </span>
          );
        },
      },
      {
        id: "active",
        accessorFn: (r) => (r.is_active ? "active" : "inactive"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.is_active ? "active" : "void"} />
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditUserId(u.id);
                  setEditEmail(u.email || "");
                  setEditFullName((u.full_name || "") as string);
                  setEditPhone((u.phone || "") as string);
                  setEditActive(Boolean(u.is_active));
                  setEditOpen(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setResetPwUserId(u.id);
                  setResetPwEmail(u.email);
                  setResetPwValue("");
                  setResetPwOpen(true);
                }}
              >
                <KeyRound className="mr-1 h-3 w-3" />
                Password
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setProfileUserId(u.id);
                  setProfileTypeCode(
                    u.profile_type_code && u.profile_type_code !== "mixed" ? u.profile_type_code : "",
                  );
                  setProfileOpen(true);
                }}
              >
                Profile Type
              </Button>
              <ConfirmDialog
                title="Remove Access?"
                description={`Remove ${u.email} from this company? This revokes their sessions.`}
                confirmLabel="Remove"
                variant="destructive"
                onConfirm={async () => {
                  setStatus("Removing access...");
                  try {
                    await apiDelete(`/users/${encodeURIComponent(u.id)}`);
                    await load();
                    setStatus("");
                  } catch (err) {
                    setStatus(err instanceof Error ? err.message : String(err));
                  }
                }}
                trigger={
                  <Button variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
                    Remove Access
                  </Button>
                }
              />
            </div>
          );
        },
      },
    ],
    [load],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Users"
        description={`Manage access for this company -- ${users.length} user(s)`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={statusIsBusy}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Assign Role
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign Role</DialogTitle>
                  <DialogDescription>Attach an existing company role to any user account.</DialogDescription>
                </DialogHeader>
                <form onSubmit={assignRole} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">User</label>
                    <Select value={assignUserId} onValueChange={setAssignUserId}>
                      <SelectTrigger><SelectValue placeholder="Select user..." /></SelectTrigger>
                      <SelectContent>
                        {allUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.email}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Role</label>
                    <Select value={assignRoleId} onValueChange={setAssignRoleId}>
                      <SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}{r.template_code ? " (Standard)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={assigning}>
                      {assigning ? "Assigning..." : "Assign"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <UserPlus className="mr-2 h-4 w-4" />
                  Set Profile Type
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Set Profile Type</DialogTitle>
                  <DialogDescription>Assign a predefined profile type with its permission set.</DialogDescription>
                </DialogHeader>
                <form onSubmit={assignProfileType} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">User</label>
                    <Select value={profileUserId} onValueChange={setProfileUserId}>
                      <SelectTrigger><SelectValue placeholder="Select user..." /></SelectTrigger>
                      <SelectContent>
                        {allUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.email}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Profile Type</label>
                    <Select value={profileTypeCode} onValueChange={setProfileTypeCode}>
                      <SelectTrigger><SelectValue placeholder="Select profile type..." /></SelectTrigger>
                      <SelectContent>
                        {profileTypes.map((t) => (
                          <SelectItem key={t.code} value={t.code}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {profileTypeCode && (
                      <p className="text-xs text-muted-foreground">
                        {profileTypes.find((p) => p.code === profileTypeCode)?.description || ""}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={profileSaving}>
                      {profileSaving ? "Applying..." : "Apply"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New User
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create User</DialogTitle>
                  <DialogDescription>Create the account and auto-assign access with a profile type (recommended).</DialogDescription>
                </DialogHeader>
                <form onSubmit={createUser} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Email</label>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.local" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Password</label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set a password" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Profile Type (Recommended)</label>
                    <Select value={templateCode || "__none__"} onValueChange={(v) => setTemplateCode(v === "__none__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="No profile type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No profile type</SelectItem>
                        {profileTypes.map((t) => (
                          <SelectItem key={t.code} value={t.code}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedProfileType && (
                      <p className="text-xs text-muted-foreground">
                        {selectedProfileType.description} ({selectedProfileType.permission_codes.length} permissions)
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Or Assign Existing Role</label>
                    <Select value={createRoleId || "__none__"} onValueChange={(v) => setCreateRoleId(v === "__none__" ? "" : v)} disabled={Boolean(templateCode)}>
                      <SelectTrigger><SelectValue placeholder="No role" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No role</SelectItem>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}{r.template_code ? " (Standard)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating}>
                      {creating ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {status && !statusIsBusy && !statusIsNotice && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-3">
            <p className="text-sm text-destructive">{status}</p>
          </CardContent>
        </Card>
      )}

      {statusIsNotice && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="py-3">
            <p className="text-sm text-warning">{status}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Users
          </CardTitle>
          <CardDescription>{users.length} user(s) with access to this company</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={users}
            isLoading={loading}
            searchPlaceholder="Search email, name..."
          />
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update profile fields or deactivate the account (global).</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="user@example.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Full Name</label>
              <Input value={editFullName} onChange={(e) => setEditFullName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone</label>
              <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+961..." />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-active"
                checked={editActive}
                onCheckedChange={(v) => setEditActive(Boolean(v))}
              />
              <label htmlFor="edit-active" className="text-sm text-muted-foreground">
                Active (uncheck to deactivate)
              </label>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={editSaving}>
                {editSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resetPwOpen} onOpenChange={setResetPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for <span className="font-medium">{resetPwEmail}</span>. Their existing sessions will be revoked.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={resetPassword} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">New Password</label>
              <Input
                type="password"
                value={resetPwValue}
                onChange={(e) => setResetPwValue(e.target.value)}
                placeholder="Min 6 characters"
                autoFocus
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={resetPwSaving}>
                {resetPwSaving ? "Resetting..." : "Reset Password"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
