"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, UserCheck } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type CashierRow = {
  id: string;
  name: string;
  user_id?: string | null;
  user_email?: string | null;
  user_full_name?: string | null;
  is_active: boolean;
  updated_at: string;
};

type EmployeeRow = {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
};

export default function PosCashiersPage() {
  const [status, setStatus] = useState("");
  const [cashiers, setCashiers] = useState<CashierRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const loading = status.startsWith("Loading");
  const statusIsBusy = /^(Loading|Creating|Saving)\b/.test(status);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [active, setActive] = useState(true);
  const [userId, setUserId] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string>("");
  const [editName, setEditName] = useState("");
  const [editPin, setEditPin] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editUserId, setEditUserId] = useState("");

  const cashierById = useMemo(() => {
    const m = new Map<string, CashierRow>();
    for (const c of cashiers) m.set(c.id, c);
    return m;
  }, [cashiers]);

  const linkedCashierByEmployeeId = useMemo(() => {
    const m = new Map<string, { cashierId: string; cashierName: string }>();
    for (const c of cashiers) {
      const uid = String(c.user_id || "").trim();
      if (!uid) continue;
      m.set(uid, { cashierId: c.id, cashierName: c.name });
    }
    return m;
  }, [cashiers]);

  const createEmployeeOptions = useMemo(
    () => [
      { value: "__none__", label: "No linked employee" },
      ...employees
        .filter((u) => !linkedCashierByEmployeeId.has(String(u.id || "").trim()))
        .map((u) => ({
          value: u.id,
          label: `${u.full_name?.trim() || u.email}${u.is_active ? "" : " (inactive)"}`,
        })),
    ],
    [employees, linkedCashierByEmployeeId],
  );

  const editEmployeeOptions = useMemo(
    () => [
      { value: "__none__", label: "No linked employee" },
      ...employees
        .filter((u) => {
          const linked = linkedCashierByEmployeeId.get(String(u.id || "").trim());
          return !linked || linked.cashierId === editId;
        })
        .map((u) => ({
          value: u.id,
          label: `${u.full_name?.trim() || u.email}${u.is_active ? "" : " (inactive)"}`,
        })),
    ],
    [employees, linkedCashierByEmployeeId, editId],
  );

  async function load() {
    setStatus("Loading...");
    try {
      const [cashiersRes, employeesRes] = await Promise.allSettled([
        apiGet<{ cashiers: CashierRow[] }>("/pos/cashiers"),
        apiGet<{ employees: EmployeeRow[] }>("/pos/employees"),
      ]);

      if (cashiersRes.status !== "fulfilled") throw cashiersRes.reason;
      setCashiers(cashiersRes.value.cashiers || []);

      if (employeesRes.status === "fulfilled") {
        setEmployees(employeesRes.value.employees || []);
        setStatus("");
      } else {
        setEmployees([]);
        const message = employeesRes.reason instanceof Error ? employeesRes.reason.message : String(employeesRes.reason);
        setStatus(`Cashiers loaded, but employee links are unavailable: ${message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createCashier(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus("Name is required.");
      return;
    }
    if ((pin || "").trim().length < 4) {
      setStatus("PIN must be at least 4 digits.");
      return;
    }
    const selectedUserId = (userId || "").trim();
    const actualUserId = selectedUserId === "__none__" ? "" : selectedUserId;
    if (actualUserId) {
      const linked = linkedCashierByEmployeeId.get(actualUserId);
      if (linked) {
        setStatus(`Employee is already linked to cashier "${linked.cashierName}". Unlink it first.`);
        return;
      }
    }
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost<{ id: string }>("/pos/cashiers", {
        name: name.trim(),
        pin: pin.trim(),
        is_active: active,
        user_id: actualUserId || null,
      });
      setCreateOpen(false);
      setName("");
      setPin("");
      setActive(true);
      setUserId("");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(id: string) {
    const row = cashierById.get(id);
    if (!row) return;
    setEditId(id);
    setEditName(row.name);
    setEditPin("");
    setEditActive(!!row.is_active);
    setEditUserId(String(row.user_id || "") || "__none__");
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    if (!editName.trim()) {
      setStatus("Name is required.");
      return;
    }
    if (editPin.trim() && editPin.trim().length < 4) {
      setStatus("PIN must be at least 4 digits.");
      return;
    }
    const nextUserId = (editUserId || "").trim();
    const actualUserId = nextUserId === "__none__" ? "" : nextUserId;
    if (actualUserId) {
      const linked = linkedCashierByEmployeeId.get(actualUserId);
      if (linked && linked.cashierId !== editId) {
        setStatus(`Employee is already linked to cashier "${linked.cashierName}". Unlink it first.`);
        return;
      }
    }
    setEditing(true);
    setStatus("Saving...");
    try {
      const patch: Record<string, unknown> = {
        name: editName.trim(),
        is_active: editActive,
      };
      const currentUserId = String(cashierById.get(editId)?.user_id || "").trim();
      if (actualUserId !== currentUserId) patch.user_id = actualUserId || null;
      if (editPin.trim()) patch.pin = editPin.trim();
      await apiPatch<{ ok: true }>(`/pos/cashiers/${editId}`, patch);
      setEditOpen(false);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setEditing(false);
    }
  }

  /* eslint-disable react-hooks/exhaustive-deps */
  const columns = useMemo<ColumnDef<CashierRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (c) => c.name,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
      },
      {
        id: "employee",
        accessorFn: (c) => c.user_full_name || c.user_email || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Employee" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.user_full_name || row.original.user_email || "-"}</span>,
      },
      {
        id: "active",
        accessorFn: (c) => (c.is_active ? 1 : 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Active" />,
        cell: ({ row }) => <StatusBadge status={row.original.is_active ? "active" : "inactive"} />,
      },
      {
        id: "updated",
        accessorFn: (c) => c.updated_at,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
        cell: ({ row }) => <span className="font-mono text-sm text-muted-foreground">{formatDateTime(row.original.updated_at)}</span>,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => openEdit(row.original.id)} disabled={statusIsBusy}>
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [statusIsBusy],
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="POS Cashiers"
        description="Cashiers, PINs, and optional employee links used by POS devices (supports offline login)."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={statusIsBusy}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={statusIsBusy}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Cashier
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Cashier</DialogTitle>
                  <DialogDescription>PINs are synced to POS devices so they can login offline.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createCashier} className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cashier name" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Linked Employee (optional)</label>
                    <Select value={userId || "__none__"} onValueChange={(v) => setUserId(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="No linked employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {createEmployeeOptions.map((opt) => (
                          <SelectItem key={`create-emp-${opt.value}`} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">PIN</label>
                    <Input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4+ digits" inputMode="numeric" type="password" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox checked={active} onCheckedChange={(checked) => setActive(!!checked)} />
                    Active
                  </label>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating || statusIsBusy}>
                      {creating ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {status && !statusIsBusy && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Cashier</DialogTitle>
            <DialogDescription>Leave PIN empty to keep existing PIN.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Cashier name" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Linked Employee (optional)</label>
              <Select value={editUserId || "__none__"} onValueChange={(v) => setEditUserId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="No linked employee" />
                </SelectTrigger>
                <SelectContent>
                  {editEmployeeOptions.map((opt) => (
                    <SelectItem key={`edit-emp-${opt.value}`} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">New PIN (optional)</label>
              <Input
                value={editPin}
                onChange={(e) => setEditPin(e.target.value)}
                placeholder="4+ digits"
                inputMode="numeric"
                type="password"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={editActive} onCheckedChange={(checked) => setEditActive(!!checked)} />
              Active
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={editing}>
                Cancel
              </Button>
              <Button type="submit" disabled={editing || statusIsBusy}>
                {editing ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cashiers Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            Cashiers
          </CardTitle>
          <CardDescription>{cashiers.length} cashier(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={cashiers} isLoading={loading} searchPlaceholder="Search cashier name..." />
        </CardContent>
      </Card>
    </div>
  );
}
