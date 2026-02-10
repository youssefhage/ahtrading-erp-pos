"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { apiPost, ApiError } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type PartyType = "individual" | "business";

export default function SupplierNewPage() {
  const router = useRouter();

  const [err, setErr] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

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
  const [bankName, setBankName] = useState("");
  const [bankAccountNo, setBankAccountNo] = useState("");
  const [bankIban, setBankIban] = useState("");
  const [bankSwift, setBankSwift] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [isActive, setIsActive] = useState(true);

  async function createSupplier(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr(new ApiError(422, "HTTP 422: name is required", { detail: "name is required" }));
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ id: string }>("/suppliers", {
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
        bank_name: bankName.trim() || null,
        bank_account_no: bankAccountNo.trim() || null,
        bank_iban: bankIban.trim() || null,
        bank_swift: bankSwift.trim() || null,
        payment_instructions: paymentInstructions.trim() || null,
        is_active: isActive
      });
      router.push(`/partners/suppliers/${res.id}`);
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
          <h1 className="text-xl font-semibold text-foreground">New Supplier</h1>
          <p className="text-sm text-fg-muted">Create a supplier master record.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => router.push("/partners/suppliers")}>
          Back
        </Button>
      </div>

      {err ? <ErrorBanner error={err} onRetry={() => setErr(null)} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Supplier</CardTitle>
          <CardDescription>Identity, contact, and terms.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createSupplier} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Code (optional)</label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SUP-001" disabled={saving} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplier name" disabled={saving} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Party Type</label>
                <select className="ui-select" value={partyType} onChange={(e) => setPartyType(e.target.value as PartyType)} disabled={saving}>
                  <option value="business">Business</option>
                  <option value="individual">Individual</option>
                </select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Legal Name (optional)</label>
                <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} disabled={saving} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Phone (optional)</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Email (optional)</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Payment Terms (days)</label>
                <Input value={termsDays} onChange={(e) => setTermsDays(e.target.value)} disabled={saving} inputMode="numeric" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">VAT No (optional)</label>
                <Input value={vatNo} onChange={(e) => setVatNo(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Tax ID (optional)</label>
                <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Active</label>
                <label className="flex items-center gap-2 text-sm text-fg-muted">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} />
                  Enabled
                </label>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Notes (optional)</label>
              <textarea
                className="ui-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Internal notes..."
                disabled={saving}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bank & Payment (optional)</CardTitle>
                <CardDescription>Helpful for supplier payments and AP setup.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Bank Name</label>
                  <Input value={bankName} onChange={(e) => setBankName(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Account No</label>
                  <Input value={bankAccountNo} onChange={(e) => setBankAccountNo(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">IBAN</label>
                  <Input value={bankIban} onChange={(e) => setBankIban(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">SWIFT</label>
                  <Input value={bankSwift} onChange={(e) => setBankSwift(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1 md:col-span-6">
                  <label className="text-xs font-medium text-fg-muted">Payment Instructions</label>
                  <textarea className="ui-textarea" value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} rows={3} disabled={saving} />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.push("/partners/suppliers")} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "..." : "Create Supplier"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
