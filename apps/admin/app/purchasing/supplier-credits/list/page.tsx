"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";
import { ShortcutLink } from "@/components/shortcut-link";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { ErrorBanner } from "@/components/error-banner";

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

type Res = { credits: CreditRow[] };

export default function SupplierCreditsListPage() {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<Res | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [docStatus, setDocStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierLabel, setSupplierLabel] = useState("");

  const totals = useMemo(() => {
    let remainingUsd = 0;
    let remainingLbp = 0;
    for (const r of data?.credits || []) {
      remainingUsd += Number(r.remaining_usd || 0);
      remainingLbp += Number(r.remaining_lbp || 0);
    }
    return { remainingUsd, remainingLbp };
  }, [data]);

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<CreditRow>> = [
      {
        id: "credit",
        header: "Credit",
        sortable: true,
        mono: true,
        accessor: (c) => c.credit_no,
        cell: (c) => (
          <ShortcutLink href={`/purchasing/supplier-credits/${encodeURIComponent(c.id)}`} title="Open credit">
            {c.credit_no}
          </ShortcutLink>
        ),
      },
      { id: "supplier", header: "Supplier", sortable: true, accessor: (c) => c.supplier_name || c.supplier_id, cell: (c) => <span className="text-xs">{c.supplier_name || c.supplier_id}</span> },
      { id: "status", header: "Status", sortable: true, accessor: (c) => c.status, cell: (c) => <StatusChip value={c.status} /> },
      { id: "kind", header: "Kind", sortable: true, accessor: (c) => c.kind, cell: (c) => <span className="text-xs">{c.kind}</span> },
      {
        id: "total",
        header: "Total",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (c) => Number(c.total_usd || 0),
        cell: (c) => (
          <div className="text-right data-mono text-xs">
            {fmtUsd(c.total_usd)}
            <div className="text-xs text-fg-muted">{fmtLbp(c.total_lbp)}</div>
          </div>
        ),
      },
      {
        id: "remaining",
        header: "Remaining",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (c) => Number(c.remaining_usd || 0),
        cell: (c) => (
          <div className="text-right data-mono text-xs">
            {fmtUsd(c.remaining_usd)}
            <div className="text-xs text-fg-muted">{fmtLbp(c.remaining_lbp)}</div>
          </div>
        ),
      },
      { id: "date", header: "Date", sortable: true, mono: true, accessor: (c) => c.credit_date, cell: (c) => <span className="font-mono text-xs text-fg-muted">{c.credit_date}</span> },
    ];
    return cols;
  }, []);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (docStatus) params.set("status", docStatus);
      if (supplierId) params.set("supplier_id", supplierId);
      const res = await apiGet<Res>(`/purchases/credits${params.toString() ? `?${params.toString()}` : ""}`);
      setData(res);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [q, docStatus, supplierId]);

  useEffect(() => {
    load();
  }, [load]);

  function onSelectSupplier(s: SupplierTypeaheadSupplier) {
    setSupplierId(s.id);
    setSupplierLabel(`${s.code ? `${s.code} · ` : ""}${s.name}`);
  }

  return (
    <div className="ui-module-shell">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <div className="ui-module-head">
        <div className="ui-module-head-row">
          <div>
            <p className="ui-module-kicker">Purchasing</p>
            <h1 className="ui-module-title">Supplier Credits</h1>
            <p className="ui-module-subtitle">Vendor rebates and credit notes that can be applied to supplier invoices.</p>
          </div>
          <div className="ui-module-actions">
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Filters</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Filters</DialogTitle>
                  <DialogDescription>Search and narrow down supplier credits.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Search</label>
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Credit no or memo..." />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Status</label>
                    <select className="ui-select w-full" value={docStatus} onChange={(e) => setDocStatus(e.target.value)}>
                      <option value="">All</option>
                      <option value="draft">draft</option>
                      <option value="posted">posted</option>
                      <option value="canceled">canceled</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Supplier</label>
                    <SupplierTypeahead
                      onSelect={onSelectSupplier}
                      onClear={() => {
                        setSupplierId("");
                        setSupplierLabel("");
                      }}
                      placeholder={supplierLabel || "Search supplier..."}
                    />
                    {supplierId ? (
                      <div className="text-xs text-fg-muted">
                        Filtering by supplier.{" "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            setSupplierId("");
                            setSupplierLabel("");
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex justify-end md:col-span-2">
                    <Button
                      onClick={async () => {
                        setFiltersOpen(false);
                        await load();
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Button asChild>
              <Link href="/purchasing/supplier-credits/new">New Credit</Link>
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Totals</CardTitle>
          <CardDescription>Remaining credit across returned rows.</CardDescription>
        </CardHeader>
        <CardContent className="ui-metric-grid">
          <div className="ui-metric">
            <div className="ui-metric-label">Remaining USD</div>
            <div className="ui-metric-value">{fmtUsd(totals.remainingUsd)}</div>
          </div>
          <div className="ui-metric">
            <div className="ui-metric-label">Remaining LL</div>
            <div className="ui-metric-value">{fmtLbp(totals.remainingLbp)}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credits</CardTitle>
          <CardDescription>{data?.credits?.length || 0} credits</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<CreditRow>
            tableId="purchasing.supplier_credits.list"
            rows={data?.credits || []}
            columns={columns}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "date", dir: "desc" }}
            globalFilterPlaceholder="Search credit no / supplier / memo"
            enableGlobalFilter={true}
            toolbarLeft={
              <div className="text-xs text-fg-muted">
                Tip: use <span className="data-mono">Filters</span> for precise search.
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
