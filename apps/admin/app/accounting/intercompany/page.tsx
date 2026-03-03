"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw, Building2, ArrowRightLeft } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { fmtUsd, fmtLbp } from "@/lib/money";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { CurrencyDisplay } from "@/components/business/currency-display";
import { EmptyState } from "@/components/business/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type DocRow = {
  id: string;
  source_company_id: string;
  source_company_name: string | null;
  issue_company_id: string;
  issue_company_name: string | null;
  sell_company_id: string;
  sell_company_name: string | null;
  source_type: string;
  source_id: string;
  settlement_status: string;
  created_at: string;
};

type SettlementRow = {
  id: string;
  from_company_id: string;
  from_company_name: string | null;
  to_company_id: string;
  to_company_name: string | null;
  amount_usd: string | number;
  amount_lbp: string | number;
  exchange_rate: string | number;
  created_at: string;
};

type Company = { id: string; name: string };

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function n(v: unknown) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function IntercompanyPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  // Settlement form
  const [fromCompanyId, setFromCompanyId] = useState("");
  const [toCompanyId, setToCompanyId] = useState("");
  const [amountUsd, setAmountUsd] = useState("0");
  const [amountLbp, setAmountLbp] = useState("0");
  const [exchangeRate, setExchangeRate] = useState("0");
  const [method, setMethod] = useState<"cash" | "bank">("bank");
  const [saving, setSaving] = useState(false);
  const statusIsBusy = /^Posting settlement\b/i.test(status);

  const docColumns = useMemo<ColumnDef<DocRow>[]>(
    () => [
      {
        id: "created_at",
        accessorFn: (d) => d.created_at || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="When" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{formatDateTime(row.original.created_at)}</span>
        ),
      },
      {
        id: "source",
        accessorFn: (d) => `${d.source_type}:${String(d.source_id).slice(0, 8)}`,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.source_type}:{String(row.original.source_id).slice(0, 8)}
          </span>
        ),
      },
      {
        id: "source_company_name",
        accessorFn: (d) => d.source_company_name || "Unknown",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source Co" />,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.source_company_name || "Unknown"}</span>
        ),
      },
      {
        id: "issue_company_name",
        accessorFn: (d) => d.issue_company_name || "Unknown",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Issue Co" />,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.issue_company_name || "Unknown"}</span>
        ),
      },
      {
        id: "sell_company_name",
        accessorFn: (d) => d.sell_company_name || "Unknown",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Sell Co" />,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.sell_company_name || "Unknown"}</span>
        ),
      },
      {
        id: "settlement_status",
        accessorFn: (d) => d.settlement_status,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.settlement_status} />,
      },
    ],
    [],
  );

  const settlementColumns = useMemo<ColumnDef<SettlementRow>[]>(
    () => [
      {
        id: "created_at",
        accessorFn: (s) => s.created_at || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="When" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{formatDateTime(row.original.created_at)}</span>
        ),
      },
      {
        id: "from_company_name",
        accessorFn: (s) => s.from_company_name || "Unknown",
        header: ({ column }) => <DataTableColumnHeader column={column} title="From" />,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.from_company_name || "Unknown"}
          </span>
        ),
      },
      {
        id: "to_company_name",
        accessorFn: (s) => s.to_company_name || "Unknown",
        header: ({ column }) => <DataTableColumnHeader column={column} title="To" />,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.to_company_name || "Unknown"}
          </span>
        ),
      },
      {
        id: "amount_usd",
        accessorFn: (s) => n(s.amount_usd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="USD" className="justify-end" />,
        cell: ({ row }) => <CurrencyDisplay amount={n(row.original.amount_usd)} currency="USD" />,
      },
      {
        id: "amount_lbp",
        accessorFn: (s) => n(s.amount_lbp),
        header: ({ column }) => <DataTableColumnHeader column={column} title="LBP" className="justify-end" />,
        cell: ({ row }) => <CurrencyDisplay amount={n(row.original.amount_lbp)} currency="LBP" />,
      },
      {
        id: "exchange_rate",
        accessorFn: (s) => n(s.exchange_rate),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Rate" className="justify-end" />,
        cell: ({ row }) => (
          <div className="text-right font-mono text-sm">
            {Number(row.original.exchange_rate || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </div>
        ),
      },
    ],
    [],
  );

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const [c, d, s] = await Promise.all([
        apiGet<{ companies: Company[] }>("/companies"),
        apiGet<{ documents: DocRow[] }>("/intercompany/documents?limit=200"),
        apiGet<{ settlements: SettlementRow[] }>("/intercompany/settlements?limit=200"),
      ]);
      setCompanies(c.companies || []);
      setDocs(d.documents || []);
      setSettlements(s.settlements || []);
      if (!fromCompanyId && c.companies?.length) setFromCompanyId(c.companies[0].id);
      if (!toCompanyId && c.companies?.length) setToCompanyId(c.companies[0].id);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function prime() {
      const curr = Number(exchangeRate || 0);
      if (Number.isFinite(curr) && curr > 0) return;
      const r = await getFxRateUsdToLbp();
      if (cancelled) return;
      const val = Number(r?.usd_to_lbp || 0);
      if (Number.isFinite(val) && val > 0) setExchangeRate(String(val));
    }
    prime().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [exchangeRate]);

  async function settle(e: React.FormEvent) {
    e.preventDefault();
    if (!fromCompanyId || !toCompanyId) return setStatus("From/to company are required");
    if (fromCompanyId === toCompanyId) return setStatus("From and to must differ");
    setSaving(true);
    setStatus("Posting settlement...");
    try {
      await apiPost("/intercompany/settle", {
        from_company_id: fromCompanyId,
        to_company_id: toCompanyId,
        amount_usd: Number(amountUsd || 0),
        amount_lbp: Number(amountLbp || 0),
        exchange_rate: Number(exchangeRate || 0),
        method,
      });
      await load();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Intercompany"
        description="Track documents and settlements between legal entities."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {status && !statusIsBusy && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Settlement Form */}
      <Card>
        <CardHeader>
          <CardTitle>Intercompany Settlement</CardTitle>
          <p className="text-sm text-muted-foreground">
            Record a settlement between companies (posts journals on both sides).
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={settle} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>From (payer)</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={fromCompanyId}
                onChange={(e) => setFromCompanyId(e.target.value)}
              >
                <option value="">Select...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>To (receiver)</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={toCompanyId}
                onChange={(e) => setToCompanyId(e.target.value)}
              >
                <option value="">Select...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={method}
                onChange={(e) => setMethod(e.target.value as "cash" | "bank")}
              >
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Amount USD</Label>
              <Input value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-2">
              <Label>Amount LBP</Label>
              <Input value={amountLbp} onChange={(e) => setAmountLbp(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-2">
              <Label>Exchange Rate</Label>
              <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} inputMode="decimal" />
            </div>
            <div className="flex items-end justify-end sm:col-span-3">
              <Button disabled={saving} type="submit">
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                {saving ? "Posting..." : "Settle"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader>
          <CardTitle>Intercompany Documents</CardTitle>
          <p className="text-sm text-muted-foreground">{docs.length} recent documents</p>
        </CardHeader>
        <CardContent>
          {!loading && docs.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No intercompany documents"
              description="Documents are created when cross-company transactions occur."
            />
          ) : (
            <DataTable
              columns={docColumns}
              data={docs}
              isLoading={loading}
              searchPlaceholder="Search source / company..."
            />
          )}
        </CardContent>
      </Card>

      {/* Settlements */}
      <Card>
        <CardHeader>
          <CardTitle>Settlements</CardTitle>
          <p className="text-sm text-muted-foreground">{settlements.length} recent settlements</p>
        </CardHeader>
        <CardContent>
          {!loading && settlements.length === 0 ? (
            <EmptyState
              icon={ArrowRightLeft}
              title="No settlements"
              description="Record a settlement above to clear intercompany balances."
            />
          ) : (
            <DataTable
              columns={settlementColumns}
              data={settlements}
              isLoading={loading}
              searchPlaceholder="Search company..."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
