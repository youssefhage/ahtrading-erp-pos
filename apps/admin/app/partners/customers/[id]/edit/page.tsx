"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Save, User } from "lucide-react";

import { apiGet, apiPatch } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { PageHeader } from "@/components/business/page-header";
import { EmptyState } from "@/components/business/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { PartyAddresses } from "@/components/party-addresses";
import { PartyContacts } from "@/components/party-contacts";
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
import { Separator } from "@/components/ui/separator";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type PartyType = "individual" | "business";
type CustomerType = "retail" | "wholesale" | "b2b";
type UserRow = { id: string; email: string; full_name?: string | null };

type Customer = {
  id: string;
  code?: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  party_type?: PartyType;
  customer_type?: CustomerType;
  assigned_salesperson_user_id?: string | null;
  marketing_opt_in?: boolean;
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

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CustomerEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
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

  const [saving, setSaving] = useState(false);

  /* ---- data fetching ---- */

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [res, u] = await Promise.all([
        apiGet<{ customer: Customer }>(
          `/customers/${encodeURIComponent(id)}`,
        ),
        apiGet<{ users: UserRow[] }>("/users").catch(() => ({
          users: [] as UserRow[],
        })),
      ]);
      const c = res.customer || null;
      setCustomer(c);
      setUsers(u.users || []);
      if (c) {
        setCode(String(c.code || ""));
        setName(String(c.name || ""));
        setPartyType((c.party_type as PartyType) || "individual");
        setCustomerType((c.customer_type as CustomerType) || "retail");
        setSalespersonId(String(c.assigned_salesperson_user_id || ""));
        setMarketingOptIn(Boolean(c.marketing_opt_in));
        setLegalName(String(c.legal_name || ""));
        setTaxId(String(c.tax_id || ""));
        setVatNo(String(c.vat_no || ""));
        setNotes(String(c.notes || ""));
        setPhone(String(c.phone || ""));
        setEmail(String(c.email || ""));
        setMembershipNo(String(c.membership_no || ""));
        setIsMember(Boolean(c.is_member));
        setMembershipExpiresAt(
          String(c.membership_expires_at || "").slice(0, 10),
        );
        setIsActive(c.is_active !== false);
        setTermsDays(String(c.payment_terms_days ?? 0));
        setCreditLimitUsd(String(c.credit_limit_usd ?? 0));
        setCreditLimitLbp(String(c.credit_limit_lbp ?? 0));
      }
      setStatus("");
    } catch (e) {
      setCustomer(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /* ---- save ---- */

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return;
    if (!name.trim()) return setStatus("Name is required.");

    const termsRes = parseNumberInput(termsDays);
    if (!termsRes.ok) return setStatus("Invalid payment terms days.");
    const limUsd = parseNumberInput(creditLimitUsd);
    const limLbp = parseNumberInput(creditLimitLbp);
    if (!limUsd.ok) return setStatus("Invalid credit limit USD.");
    if (!limLbp.ok) return setStatus("Invalid credit limit LBP.");

    setSaving(true);
    setStatus("");
    try {
      await apiPatch(`/customers/${encodeURIComponent(customer.id)}`, {
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
      await load();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSaving(false);
    }
  }

  /* ---- derived display ---- */

  const title = loading
    ? "Loading..."
    : customer
      ? `Edit ${customer.name}`
      : "Edit Customer";

  /* ---- error state ---- */

  if (err && !customer) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title="Edit Customer"
          backHref={`/partners/customers/${encodeURIComponent(id)}`}
        />
        <Card>
          <CardContent className="py-8">
            <EmptyState
              title="Failed to load customer"
              description={err}
              action={{ label: "Retry", onClick: load }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---- not found ---- */

  if (!loading && !customer) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader title="Edit Customer" backHref="/partners/customers/list" />
        <EmptyState
          icon={User}
          title="Customer not found"
          description="This customer may have been deleted or you may not have access."
          action={{
            label: "Back to list",
            onClick: () => router.push("/partners/customers/list"),
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
        backHref={`/partners/customers/${encodeURIComponent(id)}`}
        actions={
          <>
            <DocumentUtilitiesDrawer
              entityType="customer"
              entityId={id}
              allowUploadAttachments={true}
            />
          </>
        }
      >
        <p className="font-mono text-sm text-muted-foreground">{id}</p>
      </PageHeader>

      {status && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {status}
        </div>
      )}

      {customer && (
        <form id="customer-edit-form" onSubmit={save} className="space-y-6">
          {/* ---- Profile ---- */}
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Identity and contact fields.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={saving}
                  placeholder="e.g. CUS-001"
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
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Affects tax treatment and document labels.</p>
              </div>
              <div className="space-y-2">
                <Label>Customer Type</Label>
                <Select
                  value={customerType}
                  onValueChange={(v) => setCustomerType(v as CustomerType)}
                  disabled={saving}
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
                <p className="text-xs text-muted-foreground">Determines default price list and payment terms.</p>
              </div>
              <div className="space-y-2">
                <Label>Legal Name</Label>
                <Input
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  disabled={saving}
                  placeholder="Registered company name"
                />
                <p className="text-xs text-muted-foreground">Official name for legal and tax documents. Leave blank to use display name.</p>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Assigned Salesperson</Label>
                <SearchableSelect
                  value={salespersonId}
                  onChange={setSalespersonId}
                  disabled={saving}
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
                  disabled={saving}
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
                <Label>Tax ID</Label>
                <Input
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">Government-issued taxpayer ID.</p>
              </div>
              <div className="space-y-2">
                <Label>VAT No</Label>
                <Input
                  value={vatNo}
                  onChange={(e) => setVatNo(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">VAT registration number.</p>
              </div>

              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <Label>Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={saving}
                  rows={3}
                  placeholder="Internal notes about this customer..."
                />
              </div>
            </CardContent>
          </Card>

          {/* ---- Membership ---- */}
          <Card>
            <CardHeader>
              <CardTitle>Membership</CardTitle>
              <CardDescription>
                Loyalty and membership tracking.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Membership #</Label>
                <Input
                  value={membershipNo}
                  onChange={(e) => setMembershipNo(e.target.value)}
                  disabled={saving}
                  placeholder="e.g. MEM-0001"
                />
                <p className="text-xs text-muted-foreground">Card or badge number for loyalty tracking.</p>
              </div>
              <div className="space-y-2">
                <Label>Expires At</Label>
                <Input
                  type="date"
                  value={membershipExpiresAt}
                  onChange={(e) => setMembershipExpiresAt(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">Membership automatically expires on this date.</p>
              </div>
              <div className="flex items-center space-x-2 self-end pb-2">
                <Checkbox
                  id="is-member"
                  checked={isMember}
                  onCheckedChange={(v) => setIsMember(v === true)}
                  disabled={saving}
                />
                <Label htmlFor="is-member" className="font-normal">
                  Active Member
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* ---- Credit ---- */}
          <Card>
            <CardHeader>
              <CardTitle>Credit</CardTitle>
              <CardDescription>
                Payment terms and limits (Accounts Receivable).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Payment Terms (days)</Label>
                <Input
                  value={termsDays}
                  onChange={(e) => setTermsDays(e.target.value)}
                  disabled={saving}
                  inputMode="numeric"
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">Net days until invoice is due. 0 = due on receipt.</p>
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
              <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Maximum outstanding balance before new sales are blocked. Set to 0 for no limit.</p>
            </CardContent>
          </Card>
        </form>
      )}

      {/* ---- Sticky Save Bar ---- */}
      {customer && (
        <div className="sticky bottom-0 z-10 -mx-6 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
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
                onClick={() => router.push(`/partners/customers/${encodeURIComponent(id)}`)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" form="customer-edit-form" disabled={saving}>
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

      {/* ---- Addresses & Contacts (inline, always visible) ---- */}
      {customer && (
        <>
          <Separator />
          <PartyAddresses partyKind="customer" partyId={customer.id} />
          <PartyContacts partyKind="customer" partyId={customer.id} />
        </>
      )}
    </div>
  );
}
