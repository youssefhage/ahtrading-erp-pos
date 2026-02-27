"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { PageHeader } from "@/components/business/page-header";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
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
type CustomerType = "retail" | "wholesale" | "b2b";
type UserRow = { id: string; email: string; full_name?: string | null };

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function NewCustomerPage() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);

  /* ---- form state ---- */
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

  /* ---- load users ---- */

  useEffect(() => {
    apiGet<{ users: UserRow[] }>("/users")
      .then((r) => setUsers(r.users || []))
      .catch(() => setUsers([]));
  }, []);

  /* ---- create ---- */

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setStatus("Name is required.");

    const termsRes = parseNumberInput(termsDays);
    if (!termsRes.ok) return setStatus("Invalid payment terms days.");
    const limUsd = parseNumberInput(creditLimitUsd);
    const limLbp = parseNumberInput(creditLimitLbp);
    if (!limUsd.ok) return setStatus("Invalid credit limit USD.");
    if (!limLbp.ok) return setStatus("Invalid credit limit LBP.");

    setCreating(true);
    setStatus("");
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

  /* ---- render ---- */

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="New Customer"
        description="Create a customer record."
        backHref="/partners/customers/list"
      />

      {status && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {status}
        </div>
      )}

      <form onSubmit={create} className="space-y-6">
        {/* ---- Profile ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Identity and contact fields.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Code (optional)</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={creating}
                placeholder="e.g. CUS-001"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
                placeholder="Customer name"
              />
            </div>

            <div className="space-y-2">
              <Label>Party Type</Label>
              <Select
                value={partyType}
                onValueChange={(v) => setPartyType(v as PartyType)}
                disabled={creating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Customer Type</Label>
              <Select
                value={customerType}
                onValueChange={(v) => setCustomerType(v as CustomerType)}
                disabled={creating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retail">Retail</SelectItem>
                  <SelectItem value="wholesale">Wholesale</SelectItem>
                  <SelectItem value="b2b">B2B</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Legal Name</Label>
              <Input
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                disabled={creating}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Assigned Salesperson</Label>
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
                    label: u.full_name
                      ? `${u.full_name} (${u.email})`
                      : u.email,
                    keywords: u.email,
                  })),
                ]}
              />
            </div>
            <div className="flex items-center space-x-2 self-end pb-2">
              <Checkbox
                id="marketing-opt-in"
                checked={marketingOptIn}
                onCheckedChange={(v) => setMarketingOptIn(v === true)}
                disabled={creating}
              />
              <Label htmlFor="marketing-opt-in" className="font-normal">
                Marketing opt-in
              </Label>
            </div>

            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={creating}
              />
            </div>

            <div className="space-y-2">
              <Label>Tax ID</Label>
              <Input
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-2">
              <Label>VAT No</Label>
              <Input
                value={vatNo}
                onChange={(e) => setVatNo(e.target.value)}
                disabled={creating}
              />
            </div>

            <div className="space-y-2 sm:col-span-2 lg:col-span-3">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={creating}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* ---- Membership ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Membership</CardTitle>
            <CardDescription>Loyalty and membership tracking.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Membership #</Label>
              <Input
                value={membershipNo}
                onChange={(e) => setMembershipNo(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-2">
              <Label>Expires At</Label>
              <Input
                type="date"
                value={membershipExpiresAt}
                onChange={(e) => setMembershipExpiresAt(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="flex items-center space-x-2 self-end pb-2">
              <Checkbox
                id="is-member"
                checked={isMember}
                onCheckedChange={(v) => setIsMember(v === true)}
                disabled={creating}
              />
              <Label htmlFor="is-member" className="font-normal">
                Is Member
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* ---- Credit ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Credit</CardTitle>
            <CardDescription>Terms and limits (AR).</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Payment Terms (days)</Label>
              <Input
                value={termsDays}
                onChange={(e) => setTermsDays(e.target.value)}
                disabled={creating}
                inputMode="numeric"
              />
            </div>
            <MoneyInput
              label="Credit Limit"
              currency="USD"
              value={creditLimitUsd}
              onChange={setCreditLimitUsd}
              quick={[0, 100, 500, 1000]}
            />
            <MoneyInput
              label="Credit Limit"
              currency="LBP"
              value={creditLimitLbp}
              onChange={setCreditLimitLbp}
              quick={[0, 1000000, 5000000]}
            />
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
                disabled={creating}
              />
              <Label htmlFor="is-active" className="font-normal">
                Active
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/partners/customers/list")}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {creating ? "Creating..." : "Create Customer"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
