"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DataTable, type DataTableColumn } from "@/components/data-table";
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
  vat_no?: string | null;
  tax_id?: string | null;
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

export default function CustomersListPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ customers: Customer[] }>("/customers");
      setCustomers(res.customers || []);
    } catch (e) {
      setCustomers([]);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<Customer>> = [
      { id: "code", header: "Code", sortable: true, mono: true, defaultHidden: true, accessor: (c) => c.code || "" },
      {
        id: "name",
        header: "Name",
        sortable: true,
        accessor: (c) => c.name,
        cell: (c) => (
          <Link href={`/partners/customers/${encodeURIComponent(c.id)}`} className="ui-link font-medium">
            {c.name}
          </Link>
        ),
      },
      {
        id: "party_type",
        header: "Type",
        sortable: true,
        accessor: (c) => c.party_type || "individual",
        cell: (c) => <Chip variant={(c.party_type || "individual") === "business" ? "primary" : "default"}>{c.party_type || "individual"}</Chip>,
        globalSearch: true,
      },
      { id: "phone", header: "Phone", sortable: true, accessor: (c) => c.phone || "-" },
      { id: "email", header: "Email", sortable: true, accessor: (c) => c.email || "-", defaultHidden: true },
      { id: "membership_no", header: "Membership #", sortable: true, defaultHidden: true, accessor: (c) => c.membership_no || "-" },
      {
        id: "is_active",
        header: "Active",
        sortable: true,
        accessor: (c) => (c.is_active === false ? "No" : "Yes"),
        cell: (c) => <Chip variant={c.is_active === false ? "default" : "success"}>{c.is_active === false ? "No" : "Yes"}</Chip>,
      },
      {
        id: "credit_balance_usd",
        header: "AR USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (c) => Number(c.credit_balance_usd || 0),
        cell: (c) => fmtUsd(c.credit_balance_usd),
      },
      {
        id: "credit_balance_lbp",
        header: "AR LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (c) => Number(c.credit_balance_lbp || 0),
        cell: (c) => fmtLbp(c.credit_balance_lbp),
      },
      {
        id: "actions",
        header: "Actions",
        align: "right",
        cell: (c) => (
          <div className="text-right">
            <Button asChild size="sm" variant="outline">
              <Link href={`/partners/customers/${encodeURIComponent(c.id)}/edit`}>Edit</Link>
            </Button>
          </div>
        ),
      },
    ];
    return cols;
  }, []);

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Customers</h1>
            <p className="text-sm text-fg-muted">Partners</p>
          </div>
          <Button asChild>
            <Link href="/partners/customers/new">New Customer</Link>
          </Button>
        </div>
        <ErrorBanner error={err} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Customers</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${customers.length} customers`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button asChild>
            <Link href="/partners/customers/new">New Customer</Link>
          </Button>
        </div>
      </div>

      {!loading && customers.length === 0 ? (
        <EmptyState title="No customers yet" description="Create customers for invoicing, credit control, and loyalty tracking." actionLabel="New Customer" onAction={() => (window.location.href = "/partners/customers/new")} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Directory</CardTitle>
            <CardDescription>Search by name, code, phone, email, or membership number.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DataTable<Customer>
              tableId="partners.customers.list"
              rows={customers}
              columns={columns}
              getRowId={(r) => r.id}
              initialSort={{ columnId: "name", dir: "asc" }}
              globalFilterPlaceholder="Name / phone / code / email / membership"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
