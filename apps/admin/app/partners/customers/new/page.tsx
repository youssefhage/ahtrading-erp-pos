"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { ErrorBanner } from "@/components/error-banner";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type PartyType = "individual" | "business";
type CustomerType = "retail" | "wholesale" | "b2b";
type UserRow = { id: string; email: string; full_name?: string | null };

export default function NewCustomerPage() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);

  const [users, setUsers] = useState<UserRow[]>([]);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState<PartyType>("individual");
  const [customerType, setCustomerType] = useState<CustomerType>("retail");
  const [salespersonId, setSalespersonId] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
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

  useEffect(() => {
    apiGet<{ users: UserRow[] }>("/users")
      .then((r) => setUsers(r.users || []))
      .catch(() => setUsers([]));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setStatus("Name is required.");

    const termsRes = parseNumberInput(termsDays);
    if (!termsRes.ok) return setStatus("Invalid payment terms days.");
    const limUsd = parseNumberInput(creditLimitUsd);
    const limLbp = parseNumberInput(creditLimitLbp);
    if (!limUsd.ok) return setStatus("Invalid credit limit USD.");
    if (!limLbp.ok) return setStatus("Invalid credit limit LL.");

    setCreating(true);
    setStatus("Creating...");
    try {
      const res = await apiPost<{ id: string }>("/customers", {
        code: code.trim() || null,
        name: name.trim(),
        party_type: partyType,
        customer_type: customerType,
        assigned_salesperson_user_id: salespersonId || null,
        marketing_opt_in: Boolean(marketingOptIn),
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
      setStatus("");
      router.push(`/partners/customers/${encodeURIComponent(res.id)}`);
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">New Customer</h1>
          <p className="text-sm text-fg-muted">Create a customer record.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/partners/customers/list")}>
            Back
          </Button>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={() => setStatus("")} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Identity and contact fields.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">Code (optional)</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={creating} />
            </div>
            <div className="space-y-1 md:col-span-4">
              <label className="text-xs font-medium text-fg-muted">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={creating} />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">Type</label>
              <select className="ui-select" value={partyType} onChange={(e) => setPartyType(e.target.value as PartyType)} disabled={creating}>
                <option value="individual">individual</option>
                <option value="business">business</option>
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">Customer Type</label>
              <select className="ui-select" value={customerType} onChange={(e) => setCustomerType(e.target.value as CustomerType)} disabled={creating}>
                <option value="retail">retail</option>
                <option value="wholesale">wholesale</option>
                <option value="b2b">b2b</option>
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">Legal Name (optional)</label>
              <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} disabled={creating} />
            </div>

            <div className="space-y-1 md:col-span-3">
              <label className="text-xs font-medium text-fg-muted">Assigned Salesperson (optional)</label>
              <SearchableSelect
                value={salespersonId}
                onChange={setSalespersonId}
                disabled={creating}
                placeholder="(none)"
                searchPlaceholder="Search users..."
                options={[
                  { value: "", label: "(none)" },
                  ...(users || []).map((u) => ({
                    value: u.id,
                    label: u.full_name ? `${u.full_name} (${u.email})` : u.email,
                    keywords: u.email,
                  })),
                ]}
              />
            </div>
            <label className="md:col-span-3 flex items-center gap-2 text-xs text-fg-muted">
              <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} disabled={creating} /> Marketing opt-in
            </label>

            <div className="space-y-1 md:col-span-3">
              <label className="text-xs font-medium text-fg-muted">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={creating} />
            </div>
            <div className="space-y-1 md:col-span-3">
              <label className="text-xs font-medium text-fg-muted">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={creating} />
            </div>

            <div className="space-y-1 md:col-span-3">
              <label className="text-xs font-medium text-fg-muted">Tax ID</label>
              <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} disabled={creating} />
            </div>
            <div className="space-y-1 md:col-span-3">
              <label className="text-xs font-medium text-fg-muted">VAT No</label>
              <Input value={vatNo} onChange={(e) => setVatNo(e.target.value)} disabled={creating} />
            </div>

            <div className="space-y-1 md:col-span-6">
              <label className="text-xs font-medium text-fg-muted">Notes</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={creating} />
            </div>

            <Card className="md:col-span-6">
              <CardHeader>
                <CardTitle className="text-base">Membership</CardTitle>
                <CardDescription>Loyalty and membership tracking.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Membership #</label>
                  <Input value={membershipNo} onChange={(e) => setMembershipNo(e.target.value)} disabled={creating} />
                </div>
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Expires At</label>
                  <Input type="date" value={membershipExpiresAt} onChange={(e) => setMembershipExpiresAt(e.target.value)} disabled={creating} />
                </div>
                <label className="md:col-span-3 flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={isMember} onChange={(e) => setIsMember(e.target.checked)} disabled={creating} /> Is Member
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
                  <Input value={termsDays} onChange={(e) => setTermsDays(e.target.value)} disabled={creating} inputMode="numeric" />
                </div>
                <MoneyInput label="Credit Limit" currency="USD" value={creditLimitUsd} onChange={setCreditLimitUsd} quick={[0, 100, 500, 1000]} className="md:col-span-2" />
                <MoneyInput label="Credit Limit" currency="LBP" value={creditLimitLbp} onChange={setCreditLimitLbp} quick={[0, 1000000, 5000000]} className="md:col-span-2" />
              </CardContent>
            </Card>

            <label className="md:col-span-6 flex items-center gap-2 text-xs text-fg-muted">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={creating} /> Active
            </label>

            <div className="md:col-span-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.push("/partners/customers/list")} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "..." : "Create"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
