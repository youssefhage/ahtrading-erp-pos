"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { PartyAddresses } from "@/components/party-addresses";
import { PartyContacts } from "@/components/party-contacts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";

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
  credit_balance_usd: string | number;
  credit_balance_lbp: string | number;
  loyalty_points: string | number;
  is_active?: boolean;
};

type LoyaltyRow = {
  id: string;
  source_type: string;
  source_id: string;
  points: string | number;
  created_at: string;
};

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

export default function CustomerViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<LoyaltyRow[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [det, led] = await Promise.all([
        apiGet<{ customer: Customer }>(`/customers/${encodeURIComponent(id)}`),
        apiGet<{ ledger: LoyaltyRow[]; loyalty_points: string | number }>(`/customers/${encodeURIComponent(id)}/loyalty-ledger?limit=50`).catch(() => ({ ledger: [] as LoyaltyRow[], loyalty_points: 0 })),
      ]);
      setCustomer(det.customer || null);
      setLedger(led.ledger || []);
    } catch (e) {
      setCustomer(null);
      setLedger([]);
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
    if (customer) return customer.name;
    return "Customer";
  }, [loading, customer]);
  const loyaltyColumns = useMemo((): Array<DataTableColumn<LoyaltyRow>> => {
    return [
      {
        id: "created_at",
        header: "When",
        sortable: true,
        mono: true,
        accessor: (l) => l.created_at,
        cell: (l) => <span className="font-mono text-xs text-fg-muted">{fmtIso(l.created_at)}</span>,
      },
      {
        id: "source",
        header: "Source",
        sortable: true,
        accessor: (l) => `${l.source_type} ${l.source_id}`,
        cell: (l) => (
          <span className="text-xs text-fg-muted">
            <span className="font-mono">{l.source_type}</span>{" "}
            {l.source_id ? <span className="font-mono text-[10px]">{String(l.source_id).slice(0, 8)}</span> : null}
          </span>
        ),
      },
      {
        id: "points",
        header: "Points",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (l) => Number(l.points || 0),
        cell: (l) => <span className="font-mono text-xs">{String(l.points || 0)}</span>,
      },
    ];
  }, []);

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Customer</h1>
            <p className="text-sm text-fg-muted">{id}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => router.push("/partners/customers/list")}>
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
            {customer ? (
              <>
                {" "}
                · <Chip variant={customer.is_active === false ? "default" : "success"}>{customer.is_active === false ? "inactive" : "active"}</Chip>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/partners/customers/list")} disabled={loading}>
            Back
          </Button>
          {customer ? (
            <Button asChild variant="outline">
              <Link href={`/partners/customers/${encodeURIComponent(customer.id)}/edit`}>Edit</Link>
            </Button>
          ) : null}
          {customer ? (
            <Button asChild variant="outline">
              <Link href={`/accounting/reports/customer-soa?customer_id=${encodeURIComponent(customer.id)}`}>SOA</Link>
            </Button>
          ) : null}
          <Button asChild>
            <Link href="/partners/customers/new">New Customer</Link>
          </Button>
          {customer ? <DocumentUtilitiesDrawer entityType="customer" entityId={customer.id} allowUploadAttachments={true} className="ml-1" /> : null}
        </div>
      </div>

      {customer ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription>Contact and credit snapshot.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">Type</p>
                <p className="text-sm text-foreground">{customer.party_type || "individual"}</p>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">Phone</p>
                <p className="text-sm text-foreground">{customer.phone || "-"}</p>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">Email</p>
                <p className="text-sm text-foreground">{customer.email || "-"}</p>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">Terms (days)</p>
                <p className="font-mono text-sm text-foreground">{String(customer.payment_terms_days || 0)}</p>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">AR Balance</p>
                <p className="font-mono text-sm text-foreground">{fmtUsdLbp(customer.credit_balance_usd, customer.credit_balance_lbp)}</p>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">Credit Limit</p>
                <p className="font-mono text-sm text-foreground">{fmtUsdLbp(customer.credit_limit_usd, customer.credit_limit_lbp)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Loyalty</CardTitle>
              <CardDescription>Points ledger (most recent).</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable<LoyaltyRow>
                tableId="partners.customer.loyalty"
                rows={ledger}
                columns={loyaltyColumns}
                getRowId={(l) => l.id}
                emptyText="No loyalty activity."
                enableGlobalFilter={false}
                initialSort={{ columnId: "created_at", dir: "desc" }}
              />
            </CardContent>
          </Card>

          <PartyAddresses partyKind="customer" partyId={customer.id} />
          <PartyContacts partyKind="customer" partyId={customer.id} />

          {/* Attachments + audit trail are available via the right-rail utilities drawer. */}
        </>
      ) : null}
    </div>
  );
}
