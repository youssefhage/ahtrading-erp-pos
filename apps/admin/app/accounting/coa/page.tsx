"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch } from "@/lib/api";
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
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [q, setQ] = useState("");

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((a) => {
      return (
        a.account_code.toLowerCase().includes(needle) ||
        (a.name_en || "").toLowerCase().includes(needle) ||
        (a.name_fr || "").toLowerCase().includes(needle) ||
        (a.name_ar || "").toLowerCase().includes(needle)
      );
    });
  }, [accounts, q]);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ accounts: CoaAccount[] }>("/coa/accounts");
      setAccounts(res.accounts || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openEdit(a: CoaAccount) {
    setEdit(a);
    setEditNameEn(a.name_en || "");
    setEditNameFr(a.name_fr || "");
    setEditNameAr(a.name_ar || "");
    setEditPostable(Boolean(a.is_postable));
    const parent = a.parent_account_id ? accountById.get(a.parent_account_id) : null;
    setEditParentCode(parent?.account_code || "");
    setEditOpen(true);
  }

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
    <div className="mx-auto max-w-7xl space-y-6">
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

        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>{accounts.length} accounts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-96">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code/name..." />
              </div>
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>

            <datalist id="coa-parent-accounts">
              {accounts.map((a) => (
                <option key={a.id} value={a.account_code}>
                  {a.name_en || ""}
                </option>
              ))}
            </datalist>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Normal</th>
                    <th className="px-3 py-2">Postable</th>
                    <th className="px-3 py-2">Parent</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const parent = a.parent_account_id ? accountById.get(a.parent_account_id) : null;
                    return (
                      <tr key={a.id} className="ui-tr-hover">
                        <td className="px-3 py-2 font-mono text-xs">{a.account_code}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{a.name_en || "-"}</div>
                          <div className="text-xs text-slate-500">{a.name_fr || ""}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">{a.normal_balance}</td>
                        <td className="px-3 py-2 text-xs text-slate-700">{a.is_postable ? "Yes" : "No"}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{parent?.account_code || "-"}</td>
                        <td className="px-3 py-2">
                          <Button variant="outline" size="sm" onClick={() => openEdit(a)}>
                            Edit
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                        No accounts.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Account</DialogTitle>
              <DialogDescription>Changes affect posting. Be careful.</DialogDescription>
            </DialogHeader>
            {edit ? (
              <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Account</label>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                    {edit.account_code} {edit.name_en ? `· ${edit.name_en}` : ""}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Name (EN)</label>
                  <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Name (FR)</label>
                  <Input value={editNameFr} onChange={(e) => setEditNameFr(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Name (AR)</label>
                  <Input value={editNameAr} onChange={(e) => setEditNameAr(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Parent Account Code (optional)</label>
                  <Input
                    list="coa-parent-accounts"
                    value={editParentCode}
                    onChange={(e) => setEditParentCode(e.target.value)}
                    placeholder="e.g. 1010"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Postable</label>
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editPostable}
                      onChange={(e) => setEditPostable(e.target.checked)}
                    />
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
      </div>);
}
