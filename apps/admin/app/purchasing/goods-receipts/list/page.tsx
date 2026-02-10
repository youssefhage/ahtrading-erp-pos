"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";

type Supplier = { id: string; name: string };
type Warehouse = { id: string; name: string };

type ReceiptRow = {
  id: string;
  receipt_no: string | null;
  supplier_id: string | null;
  supplier_ref?: string | null;
  warehouse_id: string | null;
  purchase_order_id?: string | null;
  purchase_order_no?: string | null;
  status: string;
  total_usd: string | number;
  received_at?: string | null;
  created_at: string;
};

function Inner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);

  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [statusFilter, setStatusFilter] = useState("");

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const filtered = useMemo(() => {
    return (receipts || []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
  }, [receipts, statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [r, s, w] = await Promise.all([
        apiGet<{ receipts: ReceiptRow[] }>("/purchases/receipts"),
        apiGet<{ suppliers: Supplier[] }>("/suppliers"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
      ]);
      setReceipts(r.receipts || []);
      setSuppliers(s.suppliers || []);
      setWarehouses(w.warehouses || []);
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<ReceiptRow>> = [
      {
        id: "receipt",
        header: "Receipt",
        sortable: true,
        accessor: (r) => r.receipt_no || "",
        cell: (r) => (
          <Link className="ui-link inline-flex flex-col items-start" href={`/purchasing/goods-receipts/${encodeURIComponent(r.id)}`}>
            <div className="flex flex-col gap-0.5">
              <div className="font-medium text-foreground">{r.receipt_no || "(draft)"}</div>
              {r.supplier_ref ? <div className="font-mono text-[11px] text-fg-muted">Ref: {r.supplier_ref}</div> : null}
              {r.received_at ? <div className="font-mono text-[11px] text-fg-muted">Received: {r.received_at}</div> : null}
            </div>
          </Link>
        ),
      },
      {
        id: "supplier",
        header: "Supplier",
        sortable: true,
        accessor: (r) => (r.supplier_id ? supplierById.get(r.supplier_id)?.name || "" : ""),
        cell: (r) =>
          r.supplier_id ? (
            <ShortcutLink href={`/partners/suppliers/${encodeURIComponent(r.supplier_id)}`} title="Open supplier">
              {supplierById.get(r.supplier_id)?.name || r.supplier_id}
            </ShortcutLink>
          ) : (
            "-"
          ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        sortable: true,
        accessor: (r) => (r.warehouse_id ? whById.get(r.warehouse_id)?.name || "" : ""),
        cell: (r) => whById.get(r.warehouse_id || "")?.name || "-",
      },
      { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => <StatusChip value={r.status} /> },
      {
        id: "total_usd",
        header: "Total USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_usd || 0),
        cell: (r) => <span className="ui-tone-usd">{fmtUsd(r.total_usd)}</span>,
      },
    ];
    return cols;
  }, [supplierById, whById]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Goods Receipts</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${filtered.length} receipt(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button type="button" onClick={() => router.push("/purchasing/goods-receipts/new")}>
            New Draft
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Receipts</CardTitle>
          <CardDescription>Open a receipt to view or post.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable<ReceiptRow>
            tableId="purchasing.goods_receipts.list"
            rows={filtered}
            columns={columns}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "receipt", dir: "desc" }}
            globalFilterPlaceholder="Search receipt / supplier / ref / warehouse / PO"
            toolbarLeft={
              <select className="ui-select h-9 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="posted">Posted</option>
                <option value="canceled">Canceled</option>
              </select>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function GoodsReceiptsListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
