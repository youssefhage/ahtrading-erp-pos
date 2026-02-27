"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Users } from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CustomersListPage() {
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");

  /* ---- data fetching ---- */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String(page * pageSize));
      params.set("include_inactive", "true");
      const term = q.trim();
      if (term) params.set("q", term);
      const res = await apiGet<{ customers: Customer[]; total?: number }>(
        `/customers?${params.toString()}`,
      );
      setCustomers(res.customers || []);
      setTotal(typeof res.total === "number" ? res.total : null);
    } catch {
      setCustomers([]);
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, [q, pageSize, page]);

  useEffect(() => {
    setPage(0);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  /* ---- columns ---- */

  const columns = useMemo<ColumnDef<Customer>[]>(
    () => [
      {
        accessorKey: "code",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Code" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.code || "--"}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Name" />
        ),
        cell: ({ row }) => (
          <Link
            href={`/partners/customers/${encodeURIComponent(row.original.id)}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "party_type",
        accessorFn: (row) => row.party_type || "individual",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Type" />
        ),
        cell: ({ row }) => (
          <Badge
            variant={
              (row.original.party_type || "individual") === "business"
                ? "info"
                : "secondary"
            }
          >
            {row.original.party_type || "individual"}
          </Badge>
        ),
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
      },
      {
        accessorKey: "phone",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Phone" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.phone || "--"}
          </span>
        ),
      },
      {
        accessorKey: "email",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Email" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.email || "--"}
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => (row.is_active === false ? "inactive" : "active"),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.is_active === false ? "inactive" : "active"}
          />
        ),
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
      },
      {
        id: "credit_balance_usd",
        accessorFn: (row) => Number(row.credit_balance_usd || 0),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="AR (USD)" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {fmtUsd(row.original.credit_balance_usd)}
          </span>
        ),
      },
      {
        id: "credit_balance_lbp",
        accessorFn: (row) => Number(row.credit_balance_lbp || 0),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="AR (LBP)" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm text-muted-foreground">
            {fmtLbp(row.original.credit_balance_lbp)}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              router.push(
                `/partners/customers/${encodeURIComponent(row.original.id)}/edit`,
              );
            }}
          >
            Edit
          </Button>
        ),
      },
    ],
    [router],
  );

  /* ---- empty state ---- */

  if (!loading && customers.length === 0 && !q.trim()) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Customers"
          description="Partners"
          actions={
            <Button size="sm" onClick={() => router.push("/partners/customers/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Customer
            </Button>
          }
        />
        <EmptyState
          icon={Users}
          title="No customers yet"
          description="Create customers for invoicing, credit control, and loyalty tracking."
          action={{
            label: "New Customer",
            onClick: () => router.push("/partners/customers/new"),
          }}
        />
      </div>
    );
  }

  /* ---- main render ---- */

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Customers"
        description={
          total != null
            ? `${total.toLocaleString("en-US")} total`
            : `${customers.length} shown`
        }
        actions={
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
            <Button
              size="sm"
              onClick={() => router.push("/partners/customers/new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Customer
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        data={customers}
        isLoading={loading}
        searchPlaceholder="Search by name, phone, code, email, or membership..."
        onRowClick={(row) =>
          router.push(`/partners/customers/${encodeURIComponent(row.id)}`)
        }
        totalRows={total ?? undefined}
        filterableColumns={[
          {
            id: "party_type",
            title: "Type",
            options: [
              { label: "Individual", value: "individual" },
              { label: "Business", value: "business" },
            ],
          },
          {
            id: "status",
            title: "Status",
            options: [
              { label: "Active", value: "active" },
              { label: "Inactive", value: "inactive" },
            ],
          },
        ]}
      />
    </div>
  );
}
