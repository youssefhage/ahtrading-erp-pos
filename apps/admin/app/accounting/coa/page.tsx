"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Pencil, BookOpenText } from "lucide-react";

import { apiGet, apiPatch } from "@/lib/api";
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
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type CoaAccount = {
  id: string;
  account_code: string;
  name_en: string | null;
  name_fr: string | null;
  name_ar: string | null;
  normal_balance: string;
  is_postable: boolean;
  parent_account_id: string | null;
};

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function CoaPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const statusIsBusy = /^Saving\b/i.test(status);

  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState<CoaAccount | null>(null);
  const [saving, setSaving] = useState(false);

  const [editNameEn, setEditNameEn] = useState("");
  const [editNameFr, setEditNameFr] = useState("");
  const [editNameAr, setEditNameAr] = useState("");
  const [editPostable, setEditPostable] = useState(true);
  const [editParentCode, setEditParentCode] = useState("");

  const accountById = useMemo(() => {
    const m = new Map<string, CoaAccount>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const accountByCode = useMemo(() => {
    const m = new Map<string, CoaAccount>();
    for (const a of accounts) m.set(a.account_code, a);
    return m;
  }, [accounts]);

  const openEdit = useCallback(
    (a: CoaAccount) => {
      setEdit(a);
      setEditNameEn(a.name_en || "");
      setEditNameFr(a.name_fr || "");
      setEditNameAr(a.name_ar || "");
      setEditPostable(Boolean(a.is_postable));
      const parent = a.parent_account_id ? accountById.get(a.parent_account_id) : null;
      setEditParentCode(parent?.account_code || "");
      setEditOpen(true);
    },
    [accountById],
  );

  const columns = useMemo<ColumnDef<CoaAccount>[]>(
    () => [
      {
        id: "account_code",
        accessorFn: (a) => a.account_code,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.account_code}</span>,
      },
      {
        id: "name_en",
        accessorFn: (a) => `${a.name_en || ""} ${a.name_fr || ""} ${a.name_ar || ""}`.trim(),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name_en || "-"}</p>
            {row.original.name_fr && (
              <p className="text-xs text-muted-foreground">{row.original.name_fr}</p>
            )}
          </div>
        ),
      },
      {
        id: "normal_balance",
        accessorFn: (a) => a.normal_balance || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Normal" />,
        cell: ({ row }) => (
          <span className="text-sm capitalize text-muted-foreground">{row.original.normal_balance}</span>
        ),
      },
      {
        id: "is_postable",
        accessorFn: (a) => (a.is_postable ? "Yes" : "No"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Postable" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.is_postable ? "active" : "draft"} />
        ),
      },
      {
        id: "parent",
        accessorFn: (a) => {
          const parent = a.parent_account_id ? accountById.get(a.parent_account_id) : null;
          return parent?.account_code || "";
        },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Parent" />,
        cell: ({ row }) => {
          const parent = row.original.parent_account_id
            ? accountById.get(row.original.parent_account_id)
            : null;
          return (
            <span className="font-mono text-sm text-muted-foreground">
              {parent?.account_code || "-"}
            </span>
          );
        },
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
    [accountById, openEdit],
  );

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const res = await apiGet<{ accounts: CoaAccount[] }>("/coa/accounts");
      setAccounts(res.accounts || []);
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

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setSaving(true);
    setStatus("Saving...");
    try {
      const parent = editParentCode.trim() ? accountByCode.get(editParentCode.trim()) : null;
      await apiPatch(`/coa/accounts/${edit.id}`, {
        name_en: editNameEn.trim() || null,
        name_fr: editNameFr.trim() || null,
        name_ar: editNameAr.trim() || null,
        is_postable: Boolean(editPostable),
        parent_account_id: parent ? parent.id : null,
      });
      setEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Chart of Accounts"
        description="Manage account names, posting flags, and parent structure."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
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
          <p className="text-sm text-muted-foreground">{accounts.length} accounts</p>
        </CardHeader>
        <CardContent>
          <datalist id="coa-parent-accounts">
            {accounts.map((a) => (
              <option key={a.id} value={a.account_code}>
                {a.name_en || ""}
              </option>
            ))}
          </datalist>

          {!loading && accounts.length === 0 ? (
            <EmptyState
              icon={BookOpenText}
              title="No accounts"
              description="Your chart of accounts is empty."
            />
          ) : (
            <DataTable
              columns={columns}
              data={accounts}
              isLoading={loading}
              searchPlaceholder="Search code / name..."
              pageSize={50}
            />
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>Changes affect posting. Be careful.</DialogDescription>
          </DialogHeader>
          {edit && (
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="rounded-lg border bg-muted/30 px-4 py-3">
                <p className="font-mono text-sm">
                  {edit.account_code} {edit.name_en ? `- ${edit.name_en}` : ""}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name (EN)</Label>
                  <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Name (FR)</Label>
                  <Input value={editNameFr} onChange={(e) => setEditNameFr(e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Name (AR)</Label>
                  <Input value={editNameAr} onChange={(e) => setEditNameAr(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Parent Account Code (optional)</Label>
                  <Input
                    list="coa-parent-accounts"
                    value={editParentCode}
                    onChange={(e) => setEditParentCode(e.target.value)}
                    placeholder="e.g. 1010"
                  />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="postable"
                      checked={editPostable}
                      onCheckedChange={(checked) => setEditPostable(Boolean(checked))}
                    />
                    <Label htmlFor="postable">Postable</Label>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
