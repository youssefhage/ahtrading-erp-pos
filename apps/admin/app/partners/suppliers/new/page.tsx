"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type PartyType = "individual" | "business";

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SupplierNewPage() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  /* ---- form state ---- */
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

  /* ---- create ---- */

  async function createSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus("Name is required.");
      return;
    }
    setSaving(true);
    setStatus("");
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
        is_active: isActive,
      });
      router.push(`/partners/suppliers/${res.id}`);
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSaving(false);
    }
  }

  /* ---- render ---- */

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="New Supplier"
        description="Create a supplier master record."
        backHref="/partners/suppliers"
      />

      {status && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {status}
        </div>
      )}

      <form onSubmit={createSupplier} className="space-y-6">
        {/* ---- Identity ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>
              Supplier name, type, and legal details.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Code (optional)</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. SUP-001"
                disabled={saving}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Supplier name"
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label>Party Type</Label>
              <Select
                value={partyType}
                onValueChange={(v) => setPartyType(v as PartyType)}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="individual">Individual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Legal Name</Label>
              <Input
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                disabled={saving}
              />
            </div>
          </CardContent>
        </Card>

        {/* ---- Contact & Terms ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Contact & Terms</CardTitle>
            <CardDescription>
              Phone, email, payment terms, and tax info.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Terms (days)</Label>
              <Input
                value={termsDays}
                onChange={(e) => setTermsDays(e.target.value)}
                disabled={saving}
                inputMode="numeric"
              />
            </div>

            <div className="space-y-2">
              <Label>VAT No</Label>
              <Input
                value={vatNo}
                onChange={(e) => setVatNo(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>Tax ID</Label>
              <Input
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-2 sm:col-span-2 lg:col-span-3">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Internal notes..."
                disabled={saving}
              />
            </div>
          </CardContent>
        </Card>

        {/* ---- Bank & Payment ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Bank & Payment (optional)</CardTitle>
            <CardDescription>
              Helpful for supplier payments and AP setup.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Bank Name</Label>
              <Input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>Account No</Label>
              <Input
                value={bankAccountNo}
                onChange={(e) => setBankAccountNo(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>IBAN</Label>
              <Input
                value={bankIban}
                onChange={(e) => setBankIban(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>SWIFT</Label>
              <Input
                value={bankSwift}
                onChange={(e) => setBankSwift(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Payment Instructions</Label>
              <Textarea
                value={paymentInstructions}
                onChange={(e) => setPaymentInstructions(e.target.value)}
                rows={3}
                disabled={saving}
              />
            </div>
          </CardContent>
        </Card>

        {/* ---- Status + Actions ---- */}
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-active"
                checked={isActive}
                onCheckedChange={(v) => setIsActive(v === true)}
                disabled={saving}
              />
              <Label htmlFor="is-active" className="font-normal">
                Active
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/partners/suppliers")}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {saving ? "Creating..." : "Create Supplier"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
