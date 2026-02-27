"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Pencil, Landmark } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type CoaAccount = { id: string; account_code: string; name_en: string | null };

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

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function BankAccountsPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [coa, setCoa] = useState<CoaAccount[]>([]);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [glCode, setGlCode] = useState("");
  const [active, setActive] = useState(true);

  // Edit dialog
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

  const columns = useMemo<ColumnDef<BankAccountRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (a) => a.name,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "currency",
        accessorFn: (a) => a.currency,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Currency" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.currency}</span>
        ),
      },
      {
        id: "gl",
        accessorFn: (a) => `${a.account_code} ${a.name_en || ""}`.trim(),
        header: ({ column }) => <DataTableColumnHeader column={column} title="GL Account" />,
        cell: ({ row }) => (
          <div>
            <span className="font-mono text-sm">{row.original.account_code}</span>
            <span className="ml-2 text-xs text-muted-foreground">{row.original.name_en || ""}</span>
          </div>
        ),
      },
      {
        id: "is_active",
        accessorFn: (a) => (a.is_active ? "active" : "inactive"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.is_active ? "active" : "inactive"} />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => openEdit(row.original)}>
              <Pencil className="mr-1 h-3 w-3" />
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const [a, c] = await Promise.all([
        apiGet<{ accounts: BankAccountRow[] }>("/banking/accounts"),
        apiGet<{ accounts: CoaAccount[] }>("/coa/accounts"),
      ]);
      setAccounts(a.accounts || []);
      setCoa(c.accounts || []);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
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
        is_active: active,
      });
      setCreateOpen(false);
      setName("");
      setGlCode("");
      setActive(true);
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
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
        is_active: editActive,
      });
      setEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setEditing(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Bank Accounts"
        description="Maintain bank account to GL mapping for payment and reconciliation flows."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Account
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Bank Account</DialogTitle>
                  <DialogDescription>
                    Each bank account maps to a GL account in your chart of accounts.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={createAccount} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bank - USD" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Currency</Label>
                      <select
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value as "USD" | "LBP")}
                      >
                        <option value="USD">USD</option>
                        <option value="LBP">LBP</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>GL Account Code</Label>
                      <Input
                        value={glCode}
                        onChange={(e) => setGlCode(e.target.value)}
                        placeholder="e.g. 100100"
                        list="coaCodes"
                      />
                      <datalist id="coaCodes">
                        {coa.slice(0, 2000).map((a) => (
                          <option key={a.id} value={a.account_code}>{a.name_en || ""}</option>
                        ))}
                      </datalist>
                      <p className="text-xs text-muted-foreground">
                        {coaByCode.get(glCode.trim())?.name_en || "Pick a valid GL account."}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="create-active"
                      checked={active}
                      onCheckedChange={(checked) => setActive(Boolean(checked))}
                    />
                    <Label htmlFor="create-active" className="text-sm">Active</Label>
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

      {status && !statusIsBusy && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <p className="text-sm text-muted-foreground">{accounts.length} bank accounts</p>
        </CardHeader>
        <CardContent>
          {!loading && accounts.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No bank accounts yet"
              description="Create a bank account to enable reconciliation."
              action={{ label: "Create Account", onClick: () => setCreateOpen(true) }}
            />
          ) : (
            <DataTable
              columns={columns}
              data={accounts}
              isLoading={loading}
              searchPlaceholder="Search name / GL..."
            />
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Bank Account</DialogTitle>
            <DialogDescription>
              Changing the GL mapping affects reconciliation matching.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Currency</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={editCurrency}
                  onChange={(e) => setEditCurrency(e.target.value as "USD" | "LBP")}
                >
                  <option value="USD">USD</option>
                  <option value="LBP">LBP</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>GL Account Code</Label>
                <Input value={editGlCode} onChange={(e) => setEditGlCode(e.target.value)} list="coaCodes" />
                <p className="text-xs text-muted-foreground">
                  {coaByCode.get(editGlCode.trim())?.name_en || "Pick a valid GL account."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-active"
                checked={editActive}
                onCheckedChange={(checked) => setEditActive(Boolean(checked))}
              />
              <Label htmlFor="edit-active" className="text-sm">Active</Label>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={editing}>
                {editing ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
