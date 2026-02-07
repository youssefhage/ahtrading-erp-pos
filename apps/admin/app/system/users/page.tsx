"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type UserRow = { id: string; email: string; is_active: boolean };
type RoleRow = { id: string; name: string };

export default function UsersPage() {
  const [status, setStatus] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);

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
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <AppShell title="Users">
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
            <CardTitle>Create User</CardTitle>
            <CardDescription>Creates a global user account (then assign roles per company).</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createUser} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Email</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@ahtrading.local" />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Password</label>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set a password" />
              </div>
              <div className="md:col-span-1 flex items-end">
                <Button type="submit" disabled={creating}>
                  {creating ? "..." : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assign Role</CardTitle>
            <CardDescription>Attach an existing company role to a user.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={assignRole} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">User</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
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
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Role</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
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
              <div className="md:col-span-1 flex items-end">
                <Button type="submit" disabled={assigning}>
                  {assigning ? "..." : "Assign"}
                </Button>
              </div>
            </form>
            {assignRoleId ? (
              <p className="mt-3 text-xs text-slate-600">
                Selected role:{" "}
                <span className="font-mono text-xs">
                  {roleById.get(assignRoleId)?.name || assignRoleId}
                </span>
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>{users.length} users with access to this company</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">User ID</th>
                    <th className="px-3 py-2">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{u.email}</td>
                      <td className="px-3 py-2 font-mono text-xs">{u.id}</td>
                      <td className="px-3 py-2">{u.is_active ? "yes" : "no"}</td>
                    </tr>
                  ))}
                  {users.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                        No users.
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

