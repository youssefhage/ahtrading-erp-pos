"use client";

import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PartyKind = "customer" | "supplier";

type Address = {
  id: string;
  label: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postal_code: string | null;
  is_default: boolean;
  updated_at: string;
};

export function PartyAddresses({ partyKind, partyId }: { partyKind: PartyKind; partyId: string }) {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string>("");

  const [label, setLabel] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("Lebanon");
  const [postal, setPostal] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!partyId) return;
    setStatus("Loading addresses...");
    try {
      const qs = new URLSearchParams({ party_kind: partyKind, party_id: partyId });
      const res = await apiGet<{ addresses: Address[] }>(`/party-addresses?${qs.toString()}`);
      setAddresses(res.addresses || []);
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
    setLabel("");
    setLine1("");
    setLine2("");
    setCity("");
    setRegion("");
    setCountry("Lebanon");
    setPostal("");
    setIsDefault(addresses.length === 0);
    setOpen(true);
  }

  function openEdit(a: Address) {
    setEditId(a.id);
    setLabel(a.label || "");
    setLine1(a.line1 || "");
    setLine2(a.line2 || "");
    setCity(a.city || "");
    setRegion(a.region || "");
    setCountry(a.country || "Lebanon");
    setPostal(a.postal_code || "");
    setIsDefault(Boolean(a.is_default));
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) return;
    setSaving(true);
    setStatus("Saving...");
    try {
      if (!editId) {
        await apiPost("/party-addresses", {
          party_kind: partyKind,
          party_id: partyId,
          label: label.trim() || null,
          line1: line1.trim() || null,
          line2: line2.trim() || null,
          city: city.trim() || null,
          region: region.trim() || null,
          country: country.trim() || null,
          postal_code: postal.trim() || null,
          is_default: isDefault
        });
      } else {
        await apiPatch(`/party-addresses/${editId}`, {
          label: label.trim() || null,
          line1: line1.trim() || null,
          line2: line2.trim() || null,
          city: city.trim() || null,
          region: region.trim() || null,
          country: country.trim() || null,
          postal_code: postal.trim() || null,
          is_default: isDefault
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
    if (!id) return;
    setStatus("Deleting...");
    try {
      await apiDelete(`/party-addresses/${id}`);
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
            <CardTitle className="text-base">Addresses</CardTitle>
            <CardDescription>Default address is used for printing and documents.</CardDescription>
          </div>
          <Button variant="outline" onClick={openNew}>
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {status ? <div className="text-xs text-fg-muted">{status}</div> : null}

        <div className="space-y-2">
          {(addresses || []).map((a) => (
            <div key={a.id} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm">
                  <div className="font-medium">
                    {a.label || "Address"} {a.is_default ? <span className="text-xs text-fg-subtle">(default)</span> : null}
                  </div>
                  <div className="text-fg-muted">{[a.line1, a.line2].filter(Boolean).join(", ") || "-"}</div>
                  <div className="text-fg-muted">
                    {[a.city, a.region, a.country].filter(Boolean).join(", ") || "-"}{a.postal_code ? ` · ${a.postal_code}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(a)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => del(a.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!addresses.length ? <div className="text-sm text-fg-muted">No addresses yet.</div> : null}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{editId ? "Edit Address" : "New Address"}</DialogTitle>
              <DialogDescription>Keep it simple. Add more details later if needed.</DialogDescription>
            </DialogHeader>

            <form onSubmit={save} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Label</label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main, Warehouse, Billing..." />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Line 1</label>
                <Input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street, building..." />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Line 2</label>
                <Input value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Area, floor..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">City</label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Beirut" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Region</label>
                <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Mount Lebanon" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Country</label>
                <Input value={country} onChange={(e) => setCountry(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Postal Code</label>
                <Input value={postal} onChange={(e) => setPostal(e.target.value)} />
              </div>

              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Default?</label>
                <select className="ui-select" value={isDefault ? "yes" : "no"} onChange={(e) => setIsDefault(e.target.value === "yes")}>
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
