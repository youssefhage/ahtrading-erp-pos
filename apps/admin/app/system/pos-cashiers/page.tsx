"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

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
      { value: "", label: "No linked employee" },
      ...employees
        .filter((u) => !linkedCashierByEmployeeId.has(String(u.id || "").trim()))
        .map((u) => ({
          value: u.id,
          label: `${u.full_name?.trim() || u.email}${u.is_active ? "" : " (inactive)"}`,
        })),
    ],
    [employees, linkedCashierByEmployeeId]
  );

  const editEmployeeOptions = useMemo(
    () => [
      { value: "", label: "No linked employee" },
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
    [employees, linkedCashierByEmployeeId, editId]
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
    if (selectedUserId) {
      const linked = linkedCashierByEmployeeId.get(selectedUserId);
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
        user_id: selectedUserId || null,
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
    setEditUserId(String(row.user_id || ""));
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
    if (nextUserId) {
      const linked = linkedCashierByEmployeeId.get(nextUserId);
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
      if (nextUserId !== currentUserId) patch.user_id = nextUserId || null;
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

  return (
    <Page width="lg" className="px-4 pb-10">
      {status && !statusIsBusy ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="POS Cashiers"
        description="Cashiers, PINs, and optional employee links used by POS devices (supports offline login)."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={statusIsBusy}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button disabled={statusIsBusy}>Create Cashier</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Cashier</DialogTitle>
                  <DialogDescription>PINs are synced to POS devices so they can login offline.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createCashier} className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cashier name" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Linked Employee (optional)</label>
                    <select className="ui-select" value={userId} onChange={(e) => setUserId(e.target.value)}>
                      {createEmployeeOptions.map((opt) => (
                        <option key={`create-emp-${opt.value || "none"}`} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">PIN</label>
                    <Input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4+ digits" inputMode="numeric" type="password" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-fg-muted">
                    <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                    Active
                  </label>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating || statusIsBusy}>
                      {creating ? "..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <Section title="Cashiers" description={`${cashiers.length} cashier(s)`}>
        {(() => {
              const columns: Array<DataTableColumn<CashierRow>> = [
                { id: "name", header: "Name", accessor: (c) => c.name, sortable: true, cell: (c) => <span className="font-medium text-foreground">{c.name}</span> },
                {
                  id: "employee",
                  header: "Employee",
                  accessor: (c) => c.user_full_name || c.user_email || "",
                  cell: (c) => <span className="text-xs text-fg-muted">{c.user_full_name || c.user_email || "-"}</span>,
                },
                { id: "id", header: "Cashier ID", accessor: (c) => c.id, mono: true, defaultHidden: true, cell: (c) => <span className="text-xs text-fg-subtle">{c.id}</span> },
                { id: "active", header: "Active", accessor: (c) => (c.is_active ? "yes" : "no"), sortable: true, cell: (c) => <span className="text-xs text-fg-muted">{c.is_active ? "yes" : "no"}</span> },
                {
                  id: "updated",
                  header: "Updated",
                  accessor: (c) => c.updated_at,
                  sortable: true,
                  cell: (c) => <span className="text-xs text-fg-muted">{c.updated_at ? new Date(c.updated_at).toLocaleString() : "-"}</span>,
                },
                {
                  id: "actions",
                  header: "Actions",
                  accessor: () => "",
                  globalSearch: false,
                  align: "right",
                  cell: (c) => (
                    <Button variant="outline" size="sm" onClick={() => openEdit(c.id)} disabled={statusIsBusy}>
                      Edit
                    </Button>
                  ),
                },
              ];

              return (
                <DataTable<CashierRow>
                  tableId="system.posCashiers"
                  rows={cashiers}
                  columns={columns}
                  isLoading={loading}
                  emptyText={loading ? "Loading cashiers..." : "No cashiers yet."}
                  globalFilterPlaceholder="Search cashier name..."
                  initialSort={{ columnId: "name", dir: "asc" }}
                />
              );
            })()}
      </Section>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Cashier</DialogTitle>
              <DialogDescription>Leave PIN empty to keep existing PIN.</DialogDescription>
            </DialogHeader>
            <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Name</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Cashier name" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Linked Employee (optional)</label>
                <select className="ui-select" value={editUserId} onChange={(e) => setEditUserId(e.target.value)}>
                  {editEmployeeOptions.map((opt) => (
                    <option key={`edit-emp-${opt.value || "none"}`} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">New PIN (optional)</label>
                <Input
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value)}
                  placeholder="4+ digits"
                  inputMode="numeric"
                  type="password"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                Active
              </label>
              <div className="flex justify-end">
                <Button type="submit" disabled={editing || statusIsBusy}>
                  {editing ? "..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
    </Page>
  );
}
