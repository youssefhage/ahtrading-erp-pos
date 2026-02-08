"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type UserRow = { id: string; email: string; is_active: boolean };
type RoleRow = { id: string; name: string };

export default function UsersPage() {
  const [status, setStatus] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const [assignUserId, setAssignUserId] = useState("");
  const [assignRoleId, setAssignRoleId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  async function load() {
    setStatus("Loading...");
    try {
      const [u, r] = await Promise.all([
        apiGet<{ users: UserRow[] }>("/users"),
        apiGet<{ roles: RoleRow[] }>("/users/roles")
      ]);
      setUsers(u.users || []);
      setRoles(r.roles || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!assignRoleId && roles.length) setAssignRoleId(roles[0]?.id || "");
    if (!assignUserId && users.length) setAssignUserId(users[0]?.id || "");
  }, [roles, users, assignRoleId, assignUserId]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setStatus("email is required");
    if (!password) return setStatus("password is required");
    setCreating(true);
    setStatus("Creating user...");
    try {
      await apiPost("/users", { email: email.trim().toLowerCase(), password });
      setEmail("");
      setPassword("");
      setCreateOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
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
              <Button>New User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create User</DialogTitle>
                <DialogDescription>Creates a global user account, then assign roles per company.</DialogDescription>
              </DialogHeader>
              <form onSubmit={createUser} className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Email</label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@ahtrading.local" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Password</label>
                  <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set a password" />
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
                <DialogDescription>Attach an existing company role to a user.</DialogDescription>
              </DialogHeader>
              <form onSubmit={assignRole} className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">User</label>
                  <select
                    className="ui-select"
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                  >
                    <option value="">Select user...</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Role</label>
                  <select
                    className="ui-select"
                    value={assignRoleId}
                    onChange={(e) => setAssignRoleId(e.target.value)}
                  >
                    <option value="">Select role...</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                {assignRoleId ? (
                  <p className="text-xs text-fg-muted">
                    Selected role:{" "}
                    <span className="font-mono text-xs">{roleById.get(assignRoleId)?.name || assignRoleId}</span>
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
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>{users.length} users with access to this company</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">User ID</th>
                    <th className="px-3 py-2">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="ui-tr-hover">
                      <td className="px-3 py-2">{u.email}</td>
                      <td className="px-3 py-2 font-mono text-xs">{u.id}</td>
                      <td className="px-3 py-2">{u.is_active ? "yes" : "no"}</td>
                    </tr>
                  ))}
                  {users.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={3}>
                        No users.
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
