"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import {
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  User,
} from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtUsdLbp } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { KpiCard } from "@/components/business/kpi-card";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { PartyAddresses } from "@/components/party-addresses";
import { PartyContacts } from "@/components/party-contacts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "--";
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CustomerViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<LoyaltyRow[]>([]);

  /* ---- data fetching ---- */

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [det, led] = await Promise.all([
        apiGet<{ customer: Customer }>(
          `/customers/${encodeURIComponent(id)}`,
        ),
        apiGet<{ ledger: LoyaltyRow[]; loyalty_points: string | number }>(
          `/customers/${encodeURIComponent(id)}/loyalty-ledger?limit=50`,
        ).catch(() => ({ ledger: [] as LoyaltyRow[], loyalty_points: 0 })),
      ]);
      setCustomer(det.customer || null);
      setLedger(led.ledger || []);
    } catch (e) {
      setCustomer(null);
      setLedger([]);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /* ---- loyalty columns ---- */

  const loyaltyColumns = useMemo<ColumnDef<LoyaltyRow>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Date" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm text-muted-foreground">
            {fmtIso(row.original.created_at)}
          </span>
        ),
      },
      {
        id: "source",
        accessorFn: (row) => `${row.source_type} ${row.source_id}`,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Source" />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            <span className="font-mono">{row.original.source_type}</span>{" "}
            {row.original.source_id ? (
              <span className="font-mono text-sm">
                {String(row.original.source_id).slice(0, 8)}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: "points",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Points" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {String(row.original.points || 0)}
          </span>
        ),
      },
    ],
    [],
  );

  /* ---- derived display values ---- */

  const title = loading ? "Loading..." : customer?.name || "Customer";

  /* ---- error state ---- */

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Customer"
          description={id}
          backHref="/partners/customers/list"
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
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader title="Customer" backHref="/partners/customers/list" />
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
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={title}
        backHref="/partners/customers/list"
        badge={
          customer ? (
            <StatusBadge
              status={customer.is_active === false ? "inactive" : "active"}
            />
          ) : undefined
        }
        actions={
          customer ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => load()}
                disabled={loading}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/partners/customers/${encodeURIComponent(customer.id)}/edit`}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/accounting/reports/customer-soa?customer_id=${encodeURIComponent(customer.id)}`}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  SOA
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/partners/customers/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New Customer
                </Link>
              </Button>
              <DocumentUtilitiesDrawer
                entityType="customer"
                entityId={customer.id}
                allowUploadAttachments={true}
                className="ml-1"
              />
            </>
          ) : undefined
        }
      >
        {customer?.code && (
          <p className="font-mono text-sm text-muted-foreground">
            {customer.code}
          </p>
        )}
      </PageHeader>

      {customer && (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="loyalty">Loyalty</TabsTrigger>
            <TabsTrigger value="addresses">Addresses</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
          </TabsList>

          {/* ---- Overview tab ---- */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                title="AR Balance"
                value={fmtUsdLbp(
                  customer.credit_balance_usd,
                  customer.credit_balance_lbp,
                )}
              />
              <KpiCard
                title="Credit Limit"
                value={fmtUsdLbp(
                  customer.credit_limit_usd,
                  customer.credit_limit_lbp,
                )}
              />
              <KpiCard
                title="Payment Terms"
                value={`${Number(customer.payment_terms_days || 0)} days`}
              />
              <KpiCard
                title="Loyalty Points"
                value={String(customer.loyalty_points || 0)}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-sm text-muted-foreground">Type</dt>
                    <dd className="mt-1 text-sm font-medium">
                      {customer.party_type || "individual"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Phone</dt>
                    <dd className="mt-1 text-sm font-medium">
                      {customer.phone || "--"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Email</dt>
                    <dd className="mt-1 text-sm font-medium">
                      {customer.email || "--"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">
                      Legal Name
                    </dt>
                    <dd className="mt-1 text-sm font-medium">
                      {customer.legal_name || "--"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Tax ID</dt>
                    <dd className="mt-1 font-mono text-sm">
                      {customer.tax_id || "--"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">VAT No</dt>
                    <dd className="mt-1 font-mono text-sm">
                      {customer.vat_no || "--"}
                    </dd>
                  </div>
                  {customer.membership_no && (
                    <div>
                      <dt className="text-sm text-muted-foreground">
                        Membership #
                      </dt>
                      <dd className="mt-1 font-mono text-sm">
                        {customer.membership_no}
                      </dd>
                    </div>
                  )}
                  {customer.is_member && (
                    <div>
                      <dt className="text-sm text-muted-foreground">
                        Membership Expires
                      </dt>
                      <dd className="mt-1 font-mono text-sm">
                        {fmtIso(customer.membership_expires_at)}
                      </dd>
                    </div>
                  )}
                </dl>
                {customer.notes && (
                  <>
                    <Separator className="my-4" />
                    <div>
                      <p className="mb-1 text-sm text-muted-foreground">
                        Notes
                      </p>
                      <p className="whitespace-pre-wrap text-sm">
                        {customer.notes}
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- Loyalty tab ---- */}
          <TabsContent value="loyalty" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Loyalty Ledger</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={loyaltyColumns}
                  data={ledger}
                  isLoading={loading}
                  searchPlaceholder="Filter loyalty entries..."
                  pageSize={25}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- Addresses tab ---- */}
          <TabsContent value="addresses">
            <PartyAddresses partyKind="customer" partyId={customer.id} />
          </TabsContent>

          {/* ---- Contacts tab ---- */}
          <TabsContent value="contacts">
            <PartyContacts partyKind="customer" partyId={customer.id} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
