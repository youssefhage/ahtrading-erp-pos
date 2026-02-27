"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, Pencil, RefreshCw, Truck } from "lucide-react";

import { apiGet } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { KpiCard } from "@/components/business/kpi-card";
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

export default function SupplierViewPage() {
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
  const [err, setErr] = useState<string | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);

  /* ---- data fetching ---- */

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ supplier: Supplier }>(
        `/suppliers/${encodeURIComponent(id)}`,
      );
      setSupplier(res.supplier || null);
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

  /* ---- derived display ---- */

  const title = loading
    ? "Loading..."
    : supplier?.name || "Supplier";

  /* ---- error state ---- */

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Supplier"
          description={id}
          backHref="/partners/suppliers"
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
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader title="Supplier" backHref="/partners/suppliers" />
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
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={title}
        backHref="/partners/suppliers"
        badge={
          supplier ? (
            <StatusBadge
              status={supplier.is_active === false ? "inactive" : "active"}
            />
          ) : undefined
        }
        actions={
          supplier ? (
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
                  href={`/partners/suppliers/${encodeURIComponent(id)}/edit`}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/accounting/reports/supplier-soa?supplier_id=${encodeURIComponent(supplier.id)}`}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  SOA
                </Link>
              </Button>
            </>
          ) : undefined
        }
      >
        {supplier?.code && (
          <p className="font-mono text-sm text-muted-foreground">
            {supplier.code}
          </p>
        )}
      </PageHeader>

      {supplier && (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="addresses">Addresses</TabsTrigger>
          </TabsList>

          {/* ---- Overview tab ---- */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                title="Payment Terms"
                value={`${Number(supplier.payment_terms_days || 0)} days`}
              />
              <KpiCard
                title="Party Type"
                value={supplier.party_type || "business"}
              />
              <KpiCard
                title="Status"
                value={supplier.is_active === false ? "Inactive" : "Active"}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-sm text-muted-foreground">Phone</dt>
                    <dd className="mt-1 text-sm font-medium">
                      {supplier.phone || "--"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Email</dt>
                    <dd className="mt-1 text-sm font-medium">
                      {supplier.email || "--"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">
                      Legal Name
                    </dt>
                    <dd className="mt-1 text-sm font-medium">
                      {supplier.legal_name || "--"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">VAT No</dt>
                    <dd className="mt-1 font-mono text-sm">
                      {supplier.vat_no || "--"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Tax ID</dt>
                    <dd className="mt-1 font-mono text-sm">
                      {supplier.tax_id || "--"}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {/* ---- Bank & Payment ---- */}
            {(supplier.bank_name ||
              supplier.bank_iban ||
              supplier.payment_instructions) && (
              <Card>
                <CardHeader>
                  <CardTitle>Bank & Payment</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                    {supplier.bank_name && (
                      <div>
                        <dt className="text-sm text-muted-foreground">
                          Bank Name
                        </dt>
                        <dd className="mt-1 text-sm font-medium">
                          {supplier.bank_name}
                        </dd>
                      </div>
                    )}
                    {supplier.bank_account_no && (
                      <div>
                        <dt className="text-sm text-muted-foreground">
                          Account No
                        </dt>
                        <dd className="mt-1 font-mono text-sm">
                          {supplier.bank_account_no}
                        </dd>
                      </div>
                    )}
                    {supplier.bank_iban && (
                      <div>
                        <dt className="text-sm text-muted-foreground">IBAN</dt>
                        <dd className="mt-1 font-mono text-sm">
                          {supplier.bank_iban}
                        </dd>
                      </div>
                    )}
                    {supplier.bank_swift && (
                      <div>
                        <dt className="text-sm text-muted-foreground">
                          SWIFT
                        </dt>
                        <dd className="mt-1 font-mono text-sm">
                          {supplier.bank_swift}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {supplier.payment_instructions && (
                    <>
                      <Separator className="my-4" />
                      <div>
                        <p className="mb-1 text-sm text-muted-foreground">
                          Payment Instructions
                        </p>
                        <div className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">
                          {supplier.payment_instructions}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ---- Notes ---- */}
            {supplier.notes && (
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">
                    {supplier.notes}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ---- Contacts tab ---- */}
          <TabsContent value="contacts">
            <PartyContacts partyKind="supplier" partyId={supplier.id} />
          </TabsContent>

          {/* ---- Addresses tab ---- */}
          <TabsContent value="addresses">
            <PartyAddresses partyKind="supplier" partyId={supplier.id} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
