"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type PartyType = "individual" | "business";
type Supplier = {
  id: string;
  code?: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  payment_terms_days: string | number;
  party_type?: PartyType;
  legal_name?: string | null;
  tax_id?: string | null;
  vat_no?: string | null;
  notes?: string | null;
  is_active?: boolean;
};

export default function SupplierEditPage() {
  const router = useRouter();
  const paramsObj = useParams();
  const idParam = (paramsObj as Record<string, string | string[] | undefined>)?.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? (idParam[0] || "") : "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState<PartyType>("business");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [vatNo, setVatNo] = useState("");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [termsDays, setTermsDays] = useState("0");
  const [isActive, setIsActive] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ supplier: Supplier }>(`/suppliers/${encodeURIComponent(id)}`);
      const s = res.supplier || null;
      setSupplier(s);
      setCode(String((s as any)?.code || ""));
      setName(String((s as any)?.name || ""));
      setPartyType(((s as any)?.party_type as PartyType) || "business");
      setLegalName(String((s as any)?.legal_name || ""));
      setTaxId(String((s as any)?.tax_id || ""));
      setVatNo(String((s as any)?.vat_no || ""));
      setNotes(String((s as any)?.notes || ""));
      setPhone(String((s as any)?.phone || ""));
      setEmail(String((s as any)?.email || ""));
      setTermsDays(String((s as any)?.payment_terms_days ?? 0));
      setIsActive((s as any)?.is_active !== false);
    } catch (e) {
      setSupplier(null);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    load();
  }, [load, id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr(new ApiError(422, "HTTP 422: name is required", { detail: "name is required" }));
      return;
    }
    setSaving(true);
    try {
      await apiPatch(`/suppliers/${encodeURIComponent(id)}`, {
        code: code.trim() || null,
        name: name.trim(),
        party_type: partyType,
        legal_name: legalName.trim() || null,
        tax_id: taxId.trim() || null,
        vat_no: vatNo.trim() || null,
        notes: notes.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        payment_terms_days: Number(termsDays || 0),
        is_active: isActive
      });
      router.push(`/partners/suppliers/${encodeURIComponent(id)}`);
    } catch (e2) {
      setErr(e2);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{loading ? "Loading..." : "Edit Supplier"}</h1>
          <p className="text-sm text-fg-muted">
            {supplier?.name ? supplier.name : ""}
            {supplier?.name ? " · " : ""}
            <span className="font-mono text-xs">{id}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(`/partners/suppliers/${encodeURIComponent(id)}`)} disabled={saving}>
            Back
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Supplier</CardTitle>
          <CardDescription>Update identity, contact, and terms.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Code (optional)</label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={saving || loading} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={saving || loading} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Party Type</label>
                <select className="ui-select" value={partyType} onChange={(e) => setPartyType(e.target.value as PartyType)} disabled={saving || loading}>
                  <option value="business">Business</option>
                  <option value="individual">Individual</option>
                </select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Legal Name (optional)</label>
                <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} disabled={saving || loading} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Phone (optional)</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving || loading} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Email (optional)</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving || loading} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Payment Terms (days)</label>
                <Input value={termsDays} onChange={(e) => setTermsDays(e.target.value)} disabled={saving || loading} inputMode="numeric" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">VAT No (optional)</label>
                <Input value={vatNo} onChange={(e) => setVatNo(e.target.value)} disabled={saving || loading} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Tax ID (optional)</label>
                <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} disabled={saving || loading} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Active</label>
                <label className="flex items-center gap-2 text-sm text-fg-muted">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving || loading} />
                  Enabled
                </label>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Notes (optional)</label>
              <textarea className="ui-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} disabled={saving || loading} />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.push(`/partners/suppliers/${encodeURIComponent(id)}`)} disabled={saving || loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || loading}>
                {saving ? "..." : "Save"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
