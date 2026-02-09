"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

type CashierRow = {
  id: string;
  name: string;
  is_active: boolean;
  updated_at: string;
};

export default function PosCashiersPage() {
  const [status, setStatus] = useState("");
  const [cashiers, setCashiers] = useState<CashierRow[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [active, setActive] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string>("");
  const [editName, setEditName] = useState("");
  const [editPin, setEditPin] = useState("");
  const [editActive, setEditActive] = useState(true);

  const cashierById = useMemo(() => {
    const m = new Map<string, CashierRow>();
    for (const c of cashiers) m.set(c.id, c);
    return m;
  }, [cashiers]);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ cashiers: CashierRow[] }>("/pos/cashiers");
      setCashiers(res.cashiers || []);
      setStatus("");
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
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost<{ id: string }>("/pos/cashiers", { name: name.trim(), pin: pin.trim(), is_active: active });
      setCreateOpen(false);
      setName("");
      setPin("");
      setActive(true);
      await load();
      setStatus("");
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
    setEditing(true);
    setStatus("Saving...");
    try {
      const patch: Record<string, unknown> = { name: editName.trim(), is_active: editActive };
      if (editPin.trim()) patch.pin = editPin.trim();
      await apiPatch<{ ok: true }>(`/pos/cashiers/${editId}`, patch);
      setEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setEditing(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Cashiers</CardTitle>
            <CardDescription>{cashiers.length} cashiers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button>Create Cashier</Button>
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
                      <label className="text-xs font-medium text-fg-muted">PIN</label>
                      <Input
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        placeholder="4+ digits"
                        inputMode="numeric"
                        type="password"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-fg-muted">
                      <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                      Active
                    </label>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={creating}>
                        {creating ? "..." : "Create"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Cashier ID</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cashiers.map((c) => (
                    <tr key={c.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{c.id}</td>
                      <td className="px-3 py-2 text-xs">{c.is_active ? "yes" : "no"}</td>
                      <td className="px-3 py-2 text-xs">{c.updated_at ? new Date(c.updated_at).toLocaleString() : "-"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => openEdit(c.id)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {cashiers.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                        No cashiers yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

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
                <Button type="submit" disabled={editing}>
                  {editing ? "..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>);
}
