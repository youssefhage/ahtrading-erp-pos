"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type CoaAccount = {
  id: string;
  account_code: string;
  name_en: string | null;
};

type BankAccountRow = {
  id: string;
  name: string;
  currency: "USD" | "LBP";
  gl_account_id: string;
  account_code: string;
  name_en: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export default function BankAccountsPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [coa, setCoa] = useState<CoaAccount[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [glCode, setGlCode] = useState("");
  const [active, setActive] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editCurrency, setEditCurrency] = useState<"USD" | "LBP">("USD");
  const [editGlCode, setEditGlCode] = useState("");
  const [editActive, setEditActive] = useState(true);
  const statusIsBusy = /^(Creating|Saving)\b/i.test(status);

  const coaByCode = useMemo(() => {
    const m = new Map<string, CoaAccount>();
    for (const a of coa) m.set(a.account_code, a);
    return m;
  }, [coa]);

  const columns = useMemo((): Array<DataTableColumn<BankAccountRow>> => {
    return [
      { id: "name", header: "Name", accessor: (a) => a.name, sortable: true },
      { id: "currency", header: "Currency", accessor: (a) => a.currency, sortable: true, globalSearch: false, cell: (a) => <span className="text-xs">{a.currency}</span> },
      {
        id: "gl",
        header: "GL",
        accessor: (a) => `${a.account_code} ${a.name_en || ""}`.trim(),
        sortable: true,
        cell: (a) => (
          <span className="text-xs">
            <span className="font-mono">{a.account_code}</span> <span className="text-fg-subtle">{a.name_en || ""}</span>
          </span>
        ),
      },
      { id: "is_active", header: "Active", accessor: (a) => (a.is_active ? "active" : "inactive"), sortable: true, globalSearch: false, cell: (a) => <StatusChip value={a.is_active ? "active" : "inactive"} /> },
      {
        id: "actions",
        header: "",
        accessor: () => "",
        align: "right",
        globalSearch: false,
        cell: (a) => (
          <Button variant="outline" size="sm" onClick={() => openEdit(a)}>
            Edit
          </Button>
        ),
      },
    ];
  }, []);

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const [a, c] = await Promise.all([
        apiGet<{ accounts: BankAccountRow[] }>("/banking/accounts"),
        apiGet<{ accounts: CoaAccount[] }>("/coa/accounts")
      ]);
      setAccounts(a.accounts || []);
      setCoa(c.accounts || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setStatus("Name is required.");
    const acc = coaByCode.get(glCode.trim());
    if (!acc) return setStatus("Invalid GL account code.");
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost<{ id: string }>("/banking/accounts", {
        name: name.trim(),
        currency,
        gl_account_id: acc.id,
        is_active: active
      });
      setCreateOpen(false);
      setName("");
      setGlCode("");
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

  function openEdit(row: BankAccountRow) {
    setEditId(row.id);
    setEditName(row.name);
    setEditCurrency(row.currency);
    setEditGlCode(row.account_code);
    setEditActive(!!row.is_active);
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    if (!editName.trim()) return setStatus("Name is required.");
    const acc = coaByCode.get(editGlCode.trim());
    if (!acc) return setStatus("Invalid GL account code.");
    setEditing(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/banking/accounts/${editId}`, {
        name: editName.trim(),
        currency: editCurrency,
        gl_account_id: acc.id,
        is_active: editActive
      });
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
    <div className="ui-module-shell-narrow">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Banking</p>
            <h1 className="ui-module-title">Bank Accounts</h1>
            <p className="ui-module-subtitle">Maintain bank account to GL mapping for payment and reconciliation flows.</p>
          </div>
          <div className="ui-module-actions">
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
          </div>
        </div>
      </div>
      {status && !statusIsBusy ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>{accounts.length} bank accounts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="ui-actions-inline">
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>Create Account</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Bank Account</DialogTitle>
                  <DialogDescription>Each bank account maps to a GL account in your chart of accounts.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createAccount} className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bank - USD" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Currency</label>
                      <select className="ui-select" value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "LBP")}>
                        <option value="USD">USD</option>
                        <option value="LBP">LL</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">GL Account Code</label>
                      <Input value={glCode} onChange={(e) => setGlCode(e.target.value)} placeholder="e.g. 100100" list="coaCodes" />
                      <datalist id="coaCodes">
                        {coa.slice(0, 2000).map((a) => (
                          <option key={a.id} value={a.account_code}>
                            {a.name_en || ""}
                          </option>
                        ))}
                      </datalist>
                      {coaByCode.get(glCode.trim()) ? (
                        <p className="text-xs text-fg-subtle">{coaByCode.get(glCode.trim())?.name_en || "OK"}</p>
                      ) : (
                        <p className="text-xs text-fg-subtle">Pick a valid GL account.</p>
                      )}
                    </div>
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

          <DataTable<BankAccountRow>
            tableId="accounting.banking.accounts"
            rows={accounts}
            columns={columns}
            isLoading={loading}
            initialSort={{ columnId: "name", dir: "asc" }}
            globalFilterPlaceholder="Search name / GL..."
            emptyText={loading ? "Loading..." : "No bank accounts yet."}
          />
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Bank Account</DialogTitle>
            <DialogDescription>Changing the GL mapping affects reconciliation matching.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Currency</label>
                <select className="ui-select" value={editCurrency} onChange={(e) => setEditCurrency(e.target.value as "USD" | "LBP")}>
                  <option value="USD">USD</option>
                  <option value="LBP">LL</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">GL Account Code</label>
                <Input value={editGlCode} onChange={(e) => setEditGlCode(e.target.value)} list="coaCodes" />
                {coaByCode.get(editGlCode.trim()) ? (
                  <p className="text-xs text-fg-subtle">{coaByCode.get(editGlCode.trim())?.name_en || "OK"}</p>
                ) : (
                  <p className="text-xs text-fg-subtle">Pick a valid GL account.</p>
                )}
              </div>
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
    </div>
  );
}
