"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { ConfirmButton } from "@/components/confirm-button";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const loading = status.startsWith("Loading");
  const statusIsBusy = /^(Loading|Creating|Assigning|Applying|Saving|Removing)\b/.test(status);
  const statusIsNotice = status.startsWith("User already existed.") || status.startsWith("Email already exists.");

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [u, d, r, t] = await Promise.all([
        apiGet<{ users: UserRow[] }>("/users"),
        apiGet<{ users: UserRow[] }>("/users/directory"),
        apiGet<{ roles: RoleRow[] }>("/users/roles"),
        apiGet<{ profile_types?: ProfileType[]; templates?: ProfileType[] }>("/users/profile-types")
      ]);
      let nextRoles = r.roles || [];
      if (!nextRoles.length && !seededDefaultsOnceRef.current) {
        seededDefaultsOnceRef.current = true;
        try {
          await apiPost("/users/roles/seed-defaults", {});
          const seeded = await apiGet<{ roles: RoleRow[] }>("/users/roles");
          nextRoles = seeded.roles || [];
        } catch {
          // Keep the page usable even if seeding fails (permissions/network).
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

  const columns = useMemo((): Array<DataTableColumn<UserRow>> => {
    return [
      { id: "email", header: "Email", accessor: (u) => u.email, sortable: true },
      { id: "full_name", header: "Name", accessor: (u) => u.full_name || "", sortable: true, cell: (u) => <span className="text-sm">{u.full_name || "-"}</span> },
      { id: "phone", header: "Phone", accessor: (u) => u.phone || "", sortable: true, cell: (u) => <span className="text-sm">{u.phone || "-"}</span> },
      { id: "id", header: "User ID", accessor: (u) => u.id, mono: true, defaultHidden: true },
      {
        id: "profile_type",
        header: "Profile Type",
        accessor: (u) => u.profile_type_name || u.profile_type_code || "",
        sortable: true,
        cell: (u) => <span className="text-sm">{u.profile_type_name || (u.profile_type_code === "mixed" ? "Mixed / Custom" : "-")}</span>,
      },
      {
        id: "active",
        header: "Active",
        accessor: (u) => (u.is_active ? "yes" : "no"),
        cell: (u) => (u.is_active ? "yes" : "no"),
      },
      {
        id: "actions",
        header: "Actions",
        accessor: () => "",
        globalSearch: false,
        align: "right",
        cell: (u) => (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
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
              onClick={() => {
                setProfileUserId(u.id);
                setProfileTypeCode((u.profile_type_code && u.profile_type_code !== "mixed") ? u.profile_type_code : "");
                setProfileOpen(true);
              }}
            >
              Profile Type
            </Button>
            <ConfirmButton
              variant="outline"
              size="sm"
              title="Remove Access?"
              description={`Remove ${u.email} from this company? This revokes their sessions.`}
              confirmText="Remove"
              confirmVariant="destructive"
              onError={(err) => setStatus(err instanceof Error ? err.message : String(err))}
              onConfirm={async () => {
                setStatus("Removing access...");
                await apiDelete(`/users/${encodeURIComponent(u.id)}`);
                await load();
                setStatus("");
              }}
            >
              Remove Access
            </ConfirmButton>
          </div>
        ),
      },
    ];
  }, [load]);

  return (
    <Page width="lg" className="px-4 pb-10">
      {status && !statusIsBusy && !statusIsNotice ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="Users"
        description="Manage access for this company (users, roles, profile types)."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={statusIsBusy}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>New User</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create User</DialogTitle>
                  <DialogDescription>Create the account and auto-assign access with a profile type (recommended).</DialogDescription>
                </DialogHeader>
                <form onSubmit={createUser} className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Email</label>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@ahtrading.local" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Password</label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set a password" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Profile Type (Recommended)</label>
                    <select className="ui-select" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)}>
                      <option value="">No profile type</option>
                      {profileTypes.map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedProfileType ? (
                    <p className="text-xs text-fg-muted">
                      {selectedProfileType.description} ({selectedProfileType.permission_codes.length} permissions)
                    </p>
                  ) : null}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Or Assign Existing Role</label>
                    <select className="ui-select" value={createRoleId} onChange={(e) => setCreateRoleId(e.target.value)} disabled={Boolean(templateCode)}>
                      <option value="">No role</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}{r.template_code ? " (Standard)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating}>
                      {creating ? "..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary">Assign Role</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign Role</DialogTitle>
                  <DialogDescription>Attach an existing company role to any user account.</DialogDescription>
                </DialogHeader>
                <form onSubmit={assignRole} className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">User</label>
                    <select className="ui-select" value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
                      <option value="">Select user...</option>
                      {allUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Role</label>
                    <select className="ui-select" value={assignRoleId} onChange={(e) => setAssignRoleId(e.target.value)}>
                      <option value="">Select role...</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}{r.template_code ? " (Standard)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  {assignRoleId ? (
                    <p className="text-xs text-fg-muted">
                      Selected role: <span className="font-mono text-xs">{roleById.get(assignRoleId)?.name || assignRoleId}</span>
                    </p>
                  ) : null}
                  <div className="flex justify-end">
                    <Button type="submit" disabled={assigning}>
                      {assigning ? "..." : "Assign"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary">Set Profile Type</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Set Profile Type</DialogTitle>
                  <DialogDescription>Assign a predefined profile type with its permission set.</DialogDescription>
                </DialogHeader>
                <form onSubmit={assignProfileType} className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">User</label>
                    <select className="ui-select" value={profileUserId} onChange={(e) => setProfileUserId(e.target.value)}>
                      <option value="">Select user...</option>
                      {allUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Profile Type</label>
                    <select className="ui-select" value={profileTypeCode} onChange={(e) => setProfileTypeCode(e.target.value)}>
                      <option value="">Select profile type...</option>
                      {profileTypes.map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {profileTypeCode ? (
                    <p className="text-xs text-fg-muted">
                      {profileTypes.find((p) => p.code === profileTypeCode)?.description || ""}
                    </p>
                  ) : null}
                  <div className="flex justify-end">
                    <Button type="submit" disabled={profileSaving}>
                      {profileSaving ? "..." : "Apply"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <Section title="Users" description={`${users.length} user(s) with access to this company`}>
        <DataTable<UserRow>
          tableId="system.users"
          rows={users}
          columns={columns}
          isLoading={loading}
          emptyText={loading ? "Loading users..." : "No users."}
          globalFilterPlaceholder="Search email / id..."
          initialSort={{ columnId: "email", dir: "asc" }}
        />
      </Section>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
              <DialogDescription>Update profile fields or deactivate the account (global).</DialogDescription>
            </DialogHeader>
            <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Email</label>
                <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Full Name</label>
                <Input value={editFullName} onChange={(e) => setEditFullName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Phone</label>
                <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+961..." />
              </div>
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                Active (uncheck to deactivate)
              </label>
              <div className="flex justify-end">
                <Button type="submit" disabled={editSaving}>
                  {editSaving ? "..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
    </Page>
  );
}
