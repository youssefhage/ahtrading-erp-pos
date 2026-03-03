"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Save, Truck } from "lucide-react";

import { apiGet, apiPatch } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { EmptyState } from "@/components/business/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { PartyAddresses } from "@/components/party-addresses";
import { PartyContacts } from "@/components/party-contacts";
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
import { Separator } from "@/components/ui/separator";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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
  bank_name?: string | null;
  bank_account_no?: string | null;
  bank_iban?: string | null;
  bank_swift?: string | null;
  payment_instructions?: string | null;
  is_active?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SupplierEditPage() {
  const router = useRouter();
  const paramsObj = useParams();
  const idParam = (paramsObj as Record<string, string | string[] | undefined>)
    ?.id;
  const id =
    typeof idParam === "string"
      ? idParam
      : Array.isArray(idParam)
        ? idParam[0] || ""
        : "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [supplier, setSupplier] = useState<Supplier | null>(null);

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

  /* ---- data fetching ---- */

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ supplier: Supplier }>(
        `/suppliers/${encodeURIComponent(id)}`,
      );
      const s = res.supplier || null;
      setSupplier(s);
      if (s) {
        setCode(String(s.code || ""));
        setName(String(s.name || ""));
        setPartyType((s.party_type as PartyType) || "business");
        setLegalName(String(s.legal_name || ""));
        setTaxId(String(s.tax_id || ""));
        setVatNo(String(s.vat_no || ""));
        setNotes(String(s.notes || ""));
        setPhone(String(s.phone || ""));
        setEmail(String(s.email || ""));
        setTermsDays(String(s.payment_terms_days ?? 0));
        setBankName(String(s.bank_name || ""));
        setBankAccountNo(String(s.bank_account_no || ""));
        setBankIban(String(s.bank_iban || ""));
        setBankSwift(String(s.bank_swift || ""));
        setPaymentInstructions(String(s.payment_instructions || ""));
        setIsActive(s.is_active !== false);
      }
    } catch (e) {
      setSupplier(null);
      setErr(e instanceof Error ? e.message : String(e));
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

  /* ---- save ---- */

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus("Name is required.");
      return;
    }
    setSaving(true);
    setStatus("");
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
        bank_name: bankName.trim() || null,
        bank_account_no: bankAccountNo.trim() || null,
        bank_iban: bankIban.trim() || null,
        bank_swift: bankSwift.trim() || null,
        payment_instructions: paymentInstructions.trim() || null,
        is_active: isActive,
      });
      router.push(`/partners/suppliers/${encodeURIComponent(id)}`);
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSaving(false);
    }
  }

  /* ---- derived display ---- */

  const title = loading
    ? "Loading..."
    : supplier
      ? `Edit ${supplier.name}`
      : "Edit Supplier";

  /* ---- error state ---- */

  if (err && !supplier) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title="Edit Supplier"
          backHref={`/partners/suppliers/${encodeURIComponent(id)}`}
        />
        <Card>
          <CardContent className="py-8">
            <EmptyState
              title="Failed to load supplier"
              description={err}
              action={{ label: "Retry", onClick: load }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---- not found ---- */

  if (!loading && !supplier) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader title="Edit Supplier" backHref="/partners/suppliers" />
        <EmptyState
          icon={Truck}
          title="Supplier not found"
          description="This supplier may have been deleted or you may not have access."
          action={{
            label: "Back to list",
            onClick: () => router.push("/partners/suppliers"),
          }}
        />
      </div>
    );
  }

  /* ---- main render ---- */

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={title}
        backHref={`/partners/suppliers/${encodeURIComponent(id)}`}
        actions={
          <DocumentUtilitiesDrawer
            entityType="supplier"
            entityId={id}
            allowUploadAttachments={true}
          />
        }
      >
        <p className="font-mono text-sm text-muted-foreground">{id}</p>
      </PageHeader>

      {status && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {status}
        </div>
      )}

      {supplier && (
        <form id="supplier-edit-form" onSubmit={save} className="space-y-6">
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
                <Label>Code</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={saving || loading}
                  placeholder="e.g. SUP-001"
                />
                <p className="text-xs text-muted-foreground">Short internal reference for quick lookup.</p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={saving || loading}
                />
              </div>

              <div className="space-y-2">
                <Label>Party Type</Label>
                <Select
                  value={partyType}
                  onValueChange={(v) => setPartyType(v as PartyType)}
                  disabled={saving || loading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="business">Business</SelectItem>
                    <SelectItem value="individual">Individual</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Affects tax treatment and document labels.</p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Legal Name</Label>
                <Input
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  disabled={saving || loading}
                  placeholder="Registered company name"
                />
                <p className="text-xs text-muted-foreground">Official name for legal and tax documents. Leave blank to use display name.</p>
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
                  disabled={saving || loading}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={saving || loading}
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Terms (days)</Label>
                <Input
                  value={termsDays}
                  onChange={(e) => setTermsDays(e.target.value)}
                  disabled={saving || loading}
                  inputMode="numeric"
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">Net days until invoice is due. 0 = due on receipt.</p>
              </div>

              <div className="space-y-2">
                <Label>VAT No</Label>
                <Input
                  value={vatNo}
                  onChange={(e) => setVatNo(e.target.value)}
                  disabled={saving || loading}
                />
                <p className="text-xs text-muted-foreground">VAT registration number.</p>
              </div>
              <div className="space-y-2">
                <Label>Tax ID</Label>
                <Input
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  disabled={saving || loading}
                />
                <p className="text-xs text-muted-foreground">Government-issued taxpayer ID.</p>
              </div>

              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <Label>Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  disabled={saving || loading}
                  placeholder="Internal notes about this supplier..."
                />
              </div>
            </CardContent>
          </Card>

          {/* ---- Bank & Payment ---- */}
          <Card>
            <CardHeader>
              <CardTitle>Bank & Payment</CardTitle>
              <CardDescription>
                Optional fields for AP setup and payment instructions.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Bank Name</Label>
                <Input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  disabled={saving || loading}
                />
              </div>
              <div className="space-y-2">
                <Label>Account No</Label>
                <Input
                  value={bankAccountNo}
                  onChange={(e) => setBankAccountNo(e.target.value)}
                  disabled={saving || loading}
                />
              </div>
              <div className="space-y-2">
                <Label>IBAN</Label>
                <Input
                  value={bankIban}
                  onChange={(e) => setBankIban(e.target.value)}
                  disabled={saving || loading}
                  placeholder="LBxx xxxx xxxx xxxx"
                />
                <p className="text-xs text-muted-foreground">International Bank Account Number for wire transfers.</p>
              </div>
              <div className="space-y-2">
                <Label>SWIFT / BIC</Label>
                <Input
                  value={bankSwift}
                  onChange={(e) => setBankSwift(e.target.value)}
                  disabled={saving || loading}
                />
                <p className="text-xs text-muted-foreground">Required for international payments.</p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Payment Instructions</Label>
                <Textarea
                  value={paymentInstructions}
                  onChange={(e) => setPaymentInstructions(e.target.value)}
                  rows={3}
                  disabled={saving || loading}
                  placeholder="e.g. Always pay via bank transfer to IBAN above..."
                />
                <p className="text-xs text-muted-foreground">Free-text notes shown to the AP team when processing payments.</p>
              </div>
            </CardContent>
          </Card>
        </form>
      )}

      {/* ---- Sticky Save Bar ---- */}
      {supplier && (
        <div className="sticky bottom-0 z-10 -mx-6 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-active"
                checked={isActive}
                onCheckedChange={(v) => setIsActive(v === true)}
                disabled={saving || loading}
              />
              <Label htmlFor="is-active" className="font-normal">
                Active
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  router.push(
                    `/partners/suppliers/${encodeURIComponent(id)}`,
                  )
                }
                disabled={saving || loading}
              >
                Cancel
              </Button>
              <Button type="submit" form="supplier-edit-form" disabled={saving || loading}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Contacts & Addresses (inline, always visible) ---- */}
      {supplier && (
        <>
          <Separator />
          <PartyContacts partyKind="supplier" partyId={supplier.id} />
          <PartyAddresses partyKind="supplier" partyId={supplier.id} />
        </>
      )}
    </div>
  );
}
