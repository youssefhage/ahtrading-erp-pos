"use client";

import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PartyKind = "customer" | "supplier";

type Contact = {
  id: string;
  name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_primary: boolean;
  is_active: boolean;
  updated_at: string;
};

function basePath(partyKind: PartyKind, partyId: string) {
  if (partyKind === "customer") return `/customers/${partyId}/contacts`;
  return `/suppliers/${partyId}/contacts`;
}

export function PartyContacts({ partyKind, partyId }: { partyKind: PartyKind; partyId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string>("");

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!partyId) return;
    setStatus("Loading contacts...");
    try {
      const res = await apiGet<{ contacts: Contact[] }>(basePath(partyKind, partyId));
      setContacts(res.contacts || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId]);

  function openNew() {
    setEditId("");
    setName("");
    setTitle("");
    setPhone("");
    setEmail("");
    setNotes("");
    setIsPrimary(contacts.length === 0);
    setIsActive(true);
    setOpen(true);
  }

  function openEdit(c: Contact) {
    setEditId(c.id);
    setName(c.name || "");
    setTitle(c.title || "");
    setPhone(c.phone || "");
    setEmail(c.email || "");
    setNotes(c.notes || "");
    setIsPrimary(Boolean(c.is_primary));
    setIsActive(Boolean(c.is_active));
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) return;
    if (!name.trim()) return setStatus("name is required");
    setSaving(true);
    setStatus("Saving...");
    try {
      if (!editId) {
        await apiPost(basePath(partyKind, partyId), {
          name: name.trim(),
          title: title.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          notes: notes.trim() || null,
          is_primary: isPrimary,
          is_active: isActive
        });
      } else {
        await apiPatch(`${basePath(partyKind, partyId)}/${editId}`, {
          name: name.trim(),
          title: title.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          notes: notes.trim() || null,
          is_primary: isPrimary,
          is_active: isActive
        });
      }
      setOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  async function del(id: string) {
    if (!partyId || !id) return;
    setStatus("Deleting...");
    try {
      await apiDelete(`${basePath(partyKind, partyId)}/${id}`);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Contacts</CardTitle>
            <CardDescription>Primary contact is used for follow-ups and documents.</CardDescription>
          </div>
          <Button variant="outline" onClick={openNew}>
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {status ? <div className="text-xs text-slate-600">{status}</div> : null}

        <div className="space-y-2">
          {(contacts || []).map((c) => (
            <div key={c.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm">
                  <div className="font-medium">
                    {c.name}{" "}
                    {c.is_primary ? <span className="text-xs text-slate-500">(primary)</span> : null}{" "}
                    {!c.is_active ? <span className="text-xs text-slate-500">(inactive)</span> : null}
                  </div>
                  <div className="text-slate-700">{c.title || "-"}</div>
                  <div className="text-slate-600">
                    {[c.phone, c.email].filter(Boolean).join(" · ") || "-"}
                    {c.notes ? ` · ${c.notes}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => del(c.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!contacts.length ? <div className="text-sm text-slate-600">No contacts yet.</div> : null}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{editId ? "Edit Contact" : "New Contact"}</DialogTitle>
              <DialogDescription>Add a person we can actually reach.</DialogDescription>
            </DialogHeader>

            <form onSubmit={save} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Owner, Accountant, Buyer..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Phone</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+961..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Email</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Notes</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="WhatsApp preferred, call mornings..." />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Primary?</label>
                <select className="ui-select" value={isPrimary ? "yes" : "no"} onChange={(e) => setIsPrimary(e.target.value === "yes")}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Active?</label>
                <select className="ui-select" value={isActive ? "yes" : "no"} onChange={(e) => setIsActive(e.target.value === "yes")}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div className="md:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

