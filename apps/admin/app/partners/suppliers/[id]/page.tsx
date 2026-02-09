"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { PartyAddresses } from "@/components/party-addresses";
import { PartyContacts } from "@/components/party-contacts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
  is_active?: boolean;
};

export default function SupplierViewPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ supplier: Supplier }>(`/suppliers/${encodeURIComponent(id)}`);
      setSupplier(res.supplier || null);
    } catch (e) {
      setSupplier(null);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (err) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Supplier</h1>
            <p className="text-sm text-fg-muted">{id}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => router.push("/partners/suppliers")}>
            Back
          </Button>
        </div>
        <ErrorBanner error={err} onRetry={load} />
      </div>
    );
  }

  if (!loading && !supplier) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <EmptyState title="Supplier not found" description="This supplier may have been deleted or you may not have access." actionLabel="Back" onAction={() => router.push("/partners/suppliers")} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{supplier?.name || (loading ? "Loading..." : "Supplier")}</h1>
          <p className="text-sm text-fg-muted">
            {supplier?.code ? <span className="font-mono">{supplier.code}</span> : null}
            {supplier?.code ? " · " : null}
            <span className="font-mono text-xs">{id}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/partners/suppliers")}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(`/partners/suppliers/${encodeURIComponent(id)}/edit`)}>
            Edit
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>Supplier identity and terms.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-fg-subtle">Active:</span> {supplier?.is_active === false ? "No" : "Yes"}
          </div>
          <div>
            <span className="text-fg-subtle">Phone:</span> {supplier?.phone || "-"}
          </div>
          <div>
            <span className="text-fg-subtle">Email:</span> {supplier?.email || "-"}
          </div>
          <div>
            <span className="text-fg-subtle">Terms:</span> {Number(supplier?.payment_terms_days || 0)} day(s)
          </div>
          <div>
            <span className="text-fg-subtle">VAT No:</span> {(supplier as any)?.vat_no || "-"}
          </div>
          <div>
            <span className="text-fg-subtle">Tax ID:</span> {(supplier as any)?.tax_id || "-"}
          </div>
          {supplier?.notes ? (
            <div className="rounded-md border border-border bg-bg-sunken p-3 text-sm text-fg-muted whitespace-pre-wrap">{supplier.notes}</div>
          ) : null}
        </CardContent>
      </Card>

      {supplier ? <PartyContacts partyKind="supplier" partyId={supplier.id} /> : null}
      {supplier ? <PartyAddresses partyKind="supplier" partyId={supplier.id} /> : null}
    </div>
  );
}
