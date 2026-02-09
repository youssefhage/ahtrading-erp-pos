"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet, apiPatch } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DocumentAttachments } from "@/components/document-attachments";
import { DocumentTimeline } from "@/components/document-timeline";
import { PartyAddresses } from "@/components/party-addresses";
import { PartyContacts } from "@/components/party-contacts";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type PartyType = "individual" | "business";

type Customer = {
  id: string;
  code?: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  party_type?: PartyType;
  legal_name?: string | null;
  tax_id?: string | null;
  vat_no?: string | null;
  notes?: string | null;
  membership_no?: string | null;
  is_member?: boolean;
  membership_expires_at?: string | null;
  payment_terms_days: string | number;
  credit_limit_usd: string | number;
  credit_limit_lbp: string | number;
  is_active?: boolean;
};

export default function CustomerEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [status, setStatus] = useState("");

  const [customer, setCustomer] = useState<Customer | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState<PartyType>("individual");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [vatNo, setVatNo] = useState("");
  const [notes, setNotes] = useState("");

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [membershipNo, setMembershipNo] = useState("");
  const [isMember, setIsMember] = useState(false);
  const [membershipExpiresAt, setMembershipExpiresAt] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [termsDays, setTermsDays] = useState("0");
  const [creditLimitUsd, setCreditLimitUsd] = useState("0");
  const [creditLimitLbp, setCreditLimitLbp] = useState("0");

  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ customer: Customer }>(`/customers/${encodeURIComponent(id)}`);
      const c = res.customer || null;
      setCustomer(c);
      if (c) {
        setCode(String(c.code || ""));
        setName(String(c.name || ""));
        setPartyType((c.party_type as any) || "individual");
        setLegalName(String(c.legal_name || ""));
        setTaxId(String(c.tax_id || ""));
        setVatNo(String(c.vat_no || ""));
        setNotes(String(c.notes || ""));
        setPhone(String(c.phone || ""));
        setEmail(String(c.email || ""));
        setMembershipNo(String(c.membership_no || ""));
        setIsMember(Boolean(c.is_member));
        setMembershipExpiresAt(String(c.membership_expires_at || "").slice(0, 10));
        setIsActive(c.is_active !== false);
        setTermsDays(String(c.payment_terms_days ?? 0));
        setCreditLimitUsd(String(c.credit_limit_usd ?? 0));
        setCreditLimitLbp(String(c.credit_limit_lbp ?? 0));
      }
      setStatus("");
    } catch (e) {
      setCustomer(null);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const title = useMemo(() => {
    if (loading) return "Loading...";
    if (customer) return `Edit ${customer.name}`;
    return "Edit Customer";
  }, [loading, customer]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return;
    if (!name.trim()) return setStatus("Name is required.");

    const termsRes = parseNumberInput(termsDays);
    if (!termsRes.ok) return setStatus("Invalid payment terms days.");
    const limUsd = parseNumberInput(creditLimitUsd);
    const limLbp = parseNumberInput(creditLimitLbp);
    if (!limUsd.ok) return setStatus("Invalid credit limit USD.");
    if (!limLbp.ok) return setStatus("Invalid credit limit LL.");

    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/customers/${encodeURIComponent(customer.id)}`, {
        code: code.trim() || null,
        name: name.trim(),
        party_type: partyType,
        legal_name: legalName.trim() || null,
        tax_id: taxId.trim() || null,
        vat_no: vatNo.trim() || null,
        notes: notes.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        membership_no: membershipNo.trim() || null,
        is_member: Boolean(isMember),
        membership_expires_at: membershipExpiresAt || null,
        payment_terms_days: termsRes.value,
        credit_limit_usd: limUsd.value,
        credit_limit_lbp: limLbp.value,
        is_active: Boolean(isActive),
      });
      await load();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSaving(false);
    }
  }

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Edit Customer</h1>
            <p className="text-sm text-fg-muted">{id}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => router.push(`/partners/customers/${encodeURIComponent(id)}`)}>
            Back
          </Button>
        </div>
        <ErrorBanner error={err} onRetry={load} />
      </div>
    );
  }

  if (!loading && !customer) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <EmptyState title="Customer not found" description="This customer may have been deleted or you may not have access." actionLabel="Back" onAction={() => router.push("/partners/customers/list")} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-fg-muted">
            <span className="font-mono text-xs">{id}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(`/partners/customers/${encodeURIComponent(id)}`)} disabled={saving}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={load} disabled={saving || loading}>
            Refresh
          </Button>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      {customer ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Identity and contact fields.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={save} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">Code</label>
                  <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1 md:col-span-4">
                  <label className="text-xs font-medium text-fg-muted">Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">Type</label>
                  <select className="ui-select" value={partyType} onChange={(e) => setPartyType(e.target.value as PartyType)} disabled={saving}>
                    <option value="individual">individual</option>
                    <option value="business">business</option>
                  </select>
                </div>
                <div className="space-y-1 md:col-span-4">
                  <label className="text-xs font-medium text-fg-muted">Legal Name</label>
                  <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} disabled={saving} />
                </div>

                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Phone</label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Email</label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving} />
                </div>

                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Tax ID</label>
                  <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">VAT No</label>
                  <Input value={vatNo} onChange={(e) => setVatNo(e.target.value)} disabled={saving} />
                </div>

                <div className="space-y-1 md:col-span-6">
                  <label className="text-xs font-medium text-fg-muted">Notes</label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
                </div>

                <Card className="md:col-span-6">
                  <CardHeader>
                    <CardTitle className="text-base">Membership</CardTitle>
                    <CardDescription>Loyalty and membership tracking.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-6">
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Membership #</label>
                      <Input value={membershipNo} onChange={(e) => setMembershipNo(e.target.value)} disabled={saving} />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Expires At</label>
                      <Input type="date" value={membershipExpiresAt} onChange={(e) => setMembershipExpiresAt(e.target.value)} disabled={saving} />
                    </div>
                    <label className="md:col-span-3 flex items-center gap-2 text-xs text-fg-muted">
                      <input type="checkbox" checked={isMember} onChange={(e) => setIsMember(e.target.checked)} disabled={saving} /> Is Member
                    </label>
                  </CardContent>
                </Card>

                <Card className="md:col-span-6">
                  <CardHeader>
                    <CardTitle className="text-base">Credit</CardTitle>
                    <CardDescription>Terms and limits (AR).</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-6">
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">Payment Terms (days)</label>
                      <Input value={termsDays} onChange={(e) => setTermsDays(e.target.value)} disabled={saving} inputMode="numeric" />
                    </div>
                    <MoneyInput label="Credit Limit" currency="USD" value={creditLimitUsd} onChange={setCreditLimitUsd} quick={[0, 100, 500, 1000]} className="md:col-span-2" />
                    <MoneyInput label="Credit Limit" currency="LBP" value={creditLimitLbp} onChange={setCreditLimitLbp} quick={[0, 1000000, 5000000]} className="md:col-span-2" />
                  </CardContent>
                </Card>

                <label className="md:col-span-6 flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} /> Active
                </label>

                <div className="md:col-span-6 flex justify-end">
                  <Button type="submit" disabled={saving}>
                    {saving ? "..." : "Save"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <PartyAddresses partyKind="customer" partyId={customer.id} />
          <PartyContacts partyKind="customer" partyId={customer.id} />

          <DocumentAttachments entityType="customer" entityId={customer.id} allowUpload={true} />
          <DocumentTimeline entityType="customer" entityId={customer.id} />
        </>
      ) : null}
    </div>
  );
}

