"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

  const openEdit = useCallback((a: CoaAccount) => {
    setEdit(a);
    setEditNameEn(a.name_en || "");
    setEditNameFr(a.name_fr || "");
    setEditNameAr(a.name_ar || "");
    setEditPostable(Boolean(a.is_postable));
    const parent = a.parent_account_id ? accountById.get(a.parent_account_id) : null;
    setEditParentCode(parent?.account_code || "");
    setEditOpen(true);
  }, [accountById]);

  const columns = useMemo((): Array<DataTableColumn<CoaAccount>> => {
    return [
      { id: "account_code", header: "Code", accessor: (a) => a.account_code, mono: true, sortable: true, globalSearch: false },
      {
        id: "name_en",
        header: "Name",
        accessor: (a) => `${a.name_en || ""} ${a.name_fr || ""} ${a.name_ar || ""}`.trim(),
        sortable: true,
        cell: (a) => (
          <div>
            <div className="font-medium text-foreground">{a.name_en || "-"}</div>
            <div className="text-xs text-fg-subtle">{a.name_fr || ""}</div>
          </div>
        ),
      },
      { id: "normal_balance", header: "Normal", accessor: (a) => a.normal_balance || "", sortable: true, globalSearch: false, cell: (a) => <span className="text-xs text-fg-muted">{a.normal_balance}</span> },
      { id: "is_postable", header: "Postable", accessor: (a) => (a.is_postable ? "Yes" : "No"), sortable: true, globalSearch: false, cell: (a) => <span className="text-xs text-fg-muted">{a.is_postable ? "Yes" : "No"}</span> },
      {
        id: "parent",
        header: "Parent",
        accessor: (a) => {
          const parent = a.parent_account_id ? accountById.get(a.parent_account_id) : null;
          return parent?.account_code || "";
        },
        sortable: true,
        globalSearch: false,
        cell: (a) => {
          const parent = a.parent_account_id ? accountById.get(a.parent_account_id) : null;
          return <span className="text-xs text-fg-muted">{parent?.account_code || "-"}</span>;
        },
      },
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
  }, [accountById, openEdit]);

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const res = await apiGet<{ accounts: CoaAccount[] }>("/coa/accounts");
      setAccounts(res.accounts || []);
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
        parent_account_id: parent ? parent.id : null
      });
      setEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ui-module-shell">
      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Accounting</p>
            <h1 className="ui-module-title">Chart Of Accounts</h1>
            <p className="ui-module-subtitle">Manage account names, posting flags, and parent structure.</p>
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
          <CardDescription>{accounts.length} accounts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <datalist id="coa-parent-accounts">
            {accounts.map((a) => (
              <option key={a.id} value={a.account_code}>
                {a.name_en || ""}
              </option>
            ))}
          </datalist>

          <DataTable<CoaAccount>
            tableId="accounting.coa"
            rows={accounts}
            columns={columns}
            isLoading={loading}
            initialSort={{ columnId: "account_code", dir: "asc" }}
            globalFilterPlaceholder="Search code / name..."
            emptyText={loading ? "Loading..." : "No accounts."}
          />
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>Changes affect posting. Be careful.</DialogDescription>
          </DialogHeader>
          {edit ? (
            <form onSubmit={saveEdit} className="ui-form-grid-2">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Account</label>
                <div className="rounded-md border border-border bg-bg-sunken/20 px-3 py-2 font-mono text-xs text-fg-muted">
                  {edit.account_code} {edit.name_en ? `· ${edit.name_en}` : ""}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Name (EN)</label>
                <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Name (FR)</label>
                <Input value={editNameFr} onChange={(e) => setEditNameFr(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Name (AR)</label>
                <Input value={editNameAr} onChange={(e) => setEditNameAr(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Parent Account Code (optional)</label>
                <Input list="coa-parent-accounts" value={editParentCode} onChange={(e) => setEditParentCode(e.target.value)} placeholder="e.g. 1010" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Postable</label>
                <label className="flex items-center gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm">
                  <input type="checkbox" checked={editPostable} onChange={(e) => setEditPostable(e.target.checked)} />
                  <span>{editPostable ? "Yes" : "No"}</span>
                </label>
              </div>
              <div className="flex justify-end md:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "..." : "Save"}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
