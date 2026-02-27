"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";

import { apiGet } from "@/lib/api";
import { fmtUsd, fmtLbp } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type CreditRow = {
  id: string;
  credit_no: string;
  status: "draft" | "posted" | "canceled";
  kind: "expense" | "receipt";
  supplier_id: string;
  supplier_name: string | null;
  goods_receipt_id: string | null;
  goods_receipt_status: string | null;
  credit_date: string;
  total_usd: string | number;
  total_lbp: string | number;
  applied_usd: string | number;
  applied_lbp: string | number;
  remaining_usd: string | number;
  remaining_lbp: string | number;
  created_at: string;
  posted_at: string | null;
};

function toNum(v: unknown, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "canceled", label: "Canceled" },
] as const;

export default function SupplierCreditsPage() {
  const router = useRouter();
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const qs = params.toString();
      const res = await apiGet<{ credits: CreditRow[] }>(`/purchases/credits${qs ? `?${qs}` : ""}`);
      setCredits(res.credits || []);
    } catch {
      setCredits([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => statusFilter === "all" ? credits : credits.filter((c) => c.status === statusFilter),
    [credits, statusFilter],
  );

  const totals = useMemo(() => {
    let remainingUsd = 0;
    let remainingLbp = 0;
    for (const c of credits) {
      remainingUsd += toNum(c.remaining_usd);
      remainingLbp += toNum(c.remaining_lbp);
    }
    return { remainingUsd, remainingLbp };
  }, [credits]);

  const columns = useMemo<ColumnDef<CreditRow>[]>(() => [
    {
      accessorKey: "credit_no",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Credit #" />,
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium">{row.original.credit_no}</span>
      ),
    },
    {
      id: "supplier",
      accessorFn: (r) => r.supplier_name || r.supplier_id,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => row.original.supplier_name || row.original.supplier_id,
    },
    {
      id: "status",
      accessorFn: (r) => r.status,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "kind",
      accessorFn: (r) => r.kind,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Kind" />,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs capitalize">{row.original.kind}</Badge>
      ),
    },
    {
      id: "total",
      accessorFn: (r) => toNum(r.total_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.total_usd)} currency="USD" />
          <div className="text-xs">
            <CurrencyDisplay amount={toNum(row.original.total_lbp)} currency="LBP" />
          </div>
        </div>
      ),
    },
    {
      id: "remaining",
      accessorFn: (r) => toNum(r.remaining_usd),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Remaining" />,
      cell: ({ row }) => (
        <div className="text-right">
          <CurrencyDisplay amount={toNum(row.original.remaining_usd)} currency="USD" />
          <div className="text-xs">
            <CurrencyDisplay amount={toNum(row.original.remaining_lbp)} currency="LBP" />
          </div>
        </div>
      ),
    },
    {
      id: "date",
      accessorFn: (r) => r.credit_date,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.original.credit_date)}</span>
      ),
    },
  ], []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Supplier Credits"
        description="Vendor rebates and credit notes that can be applied to supplier invoices"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => router.push("/purchasing/supplier-credits/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Credit
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Remaining USD</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{fmtUsd(totals.remainingUsd)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Remaining LBP</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{fmtLbp(totals.remainingLbp)}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {STATUS_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            <DataTable
              columns={columns}
              data={filtered}
              isLoading={loading}
              searchPlaceholder="Search credit #, supplier..."
              onRowClick={(row) => router.push(`/purchasing/supplier-credits/${row.id}`)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
