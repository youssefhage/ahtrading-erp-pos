"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";

type ReturnRow = {
  id: string;
  return_no: string | null;
  invoice_id: string | null;
  warehouse_id: string | null;
  device_id: string | null;
  shift_id: string | null;
  refund_method: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  restocking_fee_usd?: string | number;
  restocking_fee_lbp?: string | number;
  restocking_fee_reason?: string | null;
  created_at: string;
};

type InvoiceRow = { id: string; invoice_no: string };
type Warehouse = { id: string; name: string };
type Item = { id: string; sku: string; name: string };

type ReturnLine = {
  id: string;
  item_id: string;
  qty: string | number;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  base_usd: string | number;
  base_lbp: string | number;
  tax_usd: string | number;
  tax_lbp: string | number;
  tax_date: string | null;
  created_at: string;
};

type ReturnDetail = {
  return: ReturnRow & { exchange_rate: string | number };
  lines: ReturnLine[];
  tax_lines: TaxLine[];
  refunds: Array<{
    id: string;
    method: string;
    amount_usd: string | number;
    amount_lbp: string | number;
    bank_account_id: string | null;
    reference: string | null;
    created_at: string;
  }>;
};

export default function SalesReturnsPage() {
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState("");

  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [returnId, setReturnId] = useState("");
  const [detail, setDetail] = useState<ReturnDetail | null>(null);

  const columns = useMemo((): Array<DataTableColumn<ReturnRow>> => {
    return [
      {
        id: "return",
        header: "Return",
        sortable: true,
        mono: true,
        accessor: (r) => r.return_no || r.id,
        cell: (r) => <span className="font-mono text-xs">{r.return_no || r.id}</span>,
      },
      {
        id: "invoice",
        header: "Invoice",
        sortable: true,
        accessor: (r) => (r.invoice_id ? invoiceById.get(r.invoice_id)?.invoice_no || r.invoice_id : ""),
        cell: (r) =>
          r.invoice_id ? (
            <ShortcutLink
              href={`/sales/invoices/${encodeURIComponent(r.invoice_id)}`}
              title="Open sales invoice"
              className="font-mono text-xs"
            >
              {invoiceById.get(r.invoice_id)?.invoice_no || r.invoice_id.slice(0, 8)}
            </ShortcutLink>
          ) : (
            <span className="text-fg-subtle">-</span>
          ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        sortable: true,
        accessor: (r) => (r.warehouse_id ? whById.get(r.warehouse_id)?.name || r.warehouse_id : ""),
        cell: (r) =>
          r.warehouse_id ? (
            <span className="text-sm">{whById.get(r.warehouse_id)?.name || r.warehouse_id}</span>
          ) : (
            <span className="text-fg-subtle">-</span>
          ),
      },
      {
        id: "refund_method",
        header: "Refund",
        sortable: true,
        mono: true,
        accessor: (r) => r.refund_method || "",
        cell: (r) => <span className="font-mono text-xs">{r.refund_method || "-"}</span>,
      },
      {
        id: "status",
        header: "Status",
        sortable: true,
        accessor: (r) => r.status,
        cell: (r) => <StatusChip value={r.status} />,
      },
      {
        id: "total_usd",
        header: "Total USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_usd || 0),
        cell: (r) => <span className="data-mono text-xs ui-tone-usd">{fmtUsd(r.total_usd)}</span>,
      },
      {
        id: "total_lbp",
        header: "Total LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.total_lbp || 0),
        cell: (r) => <span className="data-mono text-xs ui-tone-lbp">{fmtLbp(r.total_lbp)}</span>,
      },
    ];
  }, [invoiceById, whById]);
  const detailLineColumns = useMemo((): Array<DataTableColumn<ReturnLine>> => {
    return [
      {
        id: "item",
        header: "Item",
        sortable: true,
        accessor: (l) => {
          const it = itemById.get(l.item_id);
          return `${it?.sku || ""} ${it?.name || l.item_id}`;
        },
        cell: (l) => {
          const it = itemById.get(l.item_id);
          return it ? (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item">
              <span className="font-mono text-xs">{it.sku}</span> · {it.name}
            </ShortcutLink>
          ) : (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(l.item_id)}`} title="Open item" className="font-mono text-xs">
              {l.item_id}
            </ShortcutLink>
          );
        },
      },
      {
        id: "qty",
        header: "Qty",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (l) => Number(l.qty || 0),
        cell: (l) => (
          <span className="font-mono text-xs">
            {Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
          </span>
        ),
      },
    ];
  }, [itemById]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [r, inv, wh, it] = await Promise.all([
        apiGet<{ returns: ReturnRow[] }>("/sales/returns"),
        apiGet<{ invoices: InvoiceRow[] }>("/sales/invoices"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
        apiGet<{ items: Item[] }>("/items/min")
      ]);
      setReturns(r.returns || []);
      setInvoices(inv.invoices || []);
      setWarehouses(wh.warehouses || []);
      setItems(it.items || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return;
    }
    setStatus("Loading return...");
    try {
      const res = await apiGet<ReturnDetail>(`/sales/returns/${id}`);
      setDetail(res);
      setStatus("");
    } catch (err) {
      setDetail(null);
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadDetail(returnId);
  }, [returnId, loadDetail]);

  const netRefund = useMemo(() => {
    if (!detail) return { usd: 0, lbp: 0 };
    const feeUsd = Number((detail.return as any).restocking_fee_usd || 0) || 0;
    const feeLbp = Number((detail.return as any).restocking_fee_lbp || 0) || 0;
    const totUsd = Number(detail.return.total_usd || 0) || 0;
    const totLbp = Number(detail.return.total_lbp || 0) || 0;
    return { usd: totUsd - feeUsd, lbp: totLbp - feeLbp };
  }, [detail]);

  const returnVat = useMemo(() => {
    if (!detail) return { usd: 0, lbp: 0 };
    const usd = (detail.tax_lines || []).reduce((a, t) => a + (Number(t.tax_usd || 0) || 0), 0);
    const lbp = (detail.tax_lines || []).reduce((a, t) => a + (Number(t.tax_lbp || 0) || 0), 0);
    return { usd, lbp };
  }, [detail]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Returns</CardTitle>
            <CardDescription>{returns.length} returns</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <DataTable<ReturnRow>
                  tableId="sales.returns.list"
                  rows={returns}
                  columns={columns}
                  getRowId={(r) => r.id}
                  onRowClick={(r) => setReturnId(r.id)}
                  rowClassName={(r) => (r.id === returnId ? "bg-bg-sunken/20" : undefined)}
                  emptyText="No returns."
                  initialSort={{ columnId: "return", dir: "desc" }}
                  globalFilterPlaceholder="Search return / invoice / warehouse"
                  actions={
                    <Button variant="outline" onClick={load}>
                      Refresh
                    </Button>
                  }
                />
              </div>

              <div className="md:col-span-1">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Return Detail</CardTitle>
                    <CardDescription>{detail ? `Status: ${detail.return.status}` : "Select a return"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail ? (
                      <>
                        <div className="ui-panel p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="ui-panel-title">Sales Return</p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                <span className="data-mono">{detail.return.return_no || detail.return.id}</span>
                              </p>
                            </div>
                            <StatusChip value={detail.return.status} />
                          </div>

                          <div className="mt-3">
                            <div className="text-xs text-fg-muted">Net refund</div>
                            <div className="mt-1 data-mono text-xl font-semibold ui-tone-usd">{fmtUsd(netRefund.usd)}</div>
                            <div className="data-mono text-sm text-fg-muted ui-tone-lbp">{fmtLbp(netRefund.lbp)}</div>
                          </div>

                          <div className="section-divider my-3" />

                          <div className="space-y-1">
                            <div className="ui-kv">
                              <span className="ui-kv-label">Invoice</span>
                              <span className="ui-kv-value">
                                {detail.return.invoice_id ? (
                                  <ShortcutLink
                                    href={`/sales/invoices/${encodeURIComponent(detail.return.invoice_id)}`}
                                    title="Open sales invoice"
                                    className="font-mono text-xs"
                                  >
                                    {invoiceById.get(detail.return.invoice_id)?.invoice_no || detail.return.invoice_id.slice(0, 8)}
                                  </ShortcutLink>
                                ) : (
                                  "-"
                                )}
                              </span>
                            </div>
                            <div className="ui-kv">
                              <span className="ui-kv-label">Warehouse</span>
                              <span className="ui-kv-value">
                                {detail.return.warehouse_id ? whById.get(detail.return.warehouse_id)?.name || detail.return.warehouse_id : "-"}
                              </span>
                            </div>
                            <div className="ui-kv">
                              <span className="ui-kv-label">Refund method</span>
                              <span className="ui-kv-value">{detail.return.refund_method || "-"}</span>
                            </div>
                            <div className="ui-kv">
                              <span className="ui-kv-label">Exchange rate</span>
                              <span className="ui-kv-value">{Number((detail.return as any).exchange_rate || 0).toLocaleString("en-US")}</span>
                            </div>
                            <div className="ui-kv">
                              <span className="ui-kv-label">Total</span>
                              <span className="ui-kv-value">
                                {fmtUsd(detail.return.total_usd)} / {fmtLbp(detail.return.total_lbp)}
                              </span>
                            </div>
                            {(Number((detail.return as any).restocking_fee_usd || 0) || Number((detail.return as any).restocking_fee_lbp || 0)) ? (
                              <div className="ui-kv">
                                <span className="ui-kv-label">Restocking fee</span>
                                <span className="ui-kv-value">
                                  {fmtUsd((detail.return as any).restocking_fee_usd || 0)} / {fmtLbp((detail.return as any).restocking_fee_lbp || 0)}
                                </span>
                              </div>
                            ) : null}
                            {(returnVat.usd !== 0 || returnVat.lbp !== 0) ? (
                              <div className="ui-kv">
                                <span className="ui-kv-label">VAT</span>
                                <span className="ui-kv-value">
                                  {fmtUsd(returnVat.usd)} / {fmtLbp(returnVat.lbp)}
                                </span>
                              </div>
                            ) : null}
                            {(detail.return as any).restocking_fee_reason ? (
                              <p className="ui-kv-sub">
                                Fee reason: {String((detail.return as any).restocking_fee_reason)}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        {(detail.refunds || []).length ? (
                          <div className="ui-panel p-3">
                            <div className="ui-panel-title">Refund Transactions</div>
                            <div className="mt-2 space-y-1 text-sm text-fg-muted">
                              {(detail.refunds || []).map((r) => (
                                <div key={r.id} className="flex items-center justify-between gap-2">
                                  <div className="data-mono text-xs">{r.method}</div>
                                  <div className="data-mono text-xs text-foreground">
                                    {fmtUsd(r.amount_usd)} / {fmtLbp(r.amount_lbp)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <DataTable<ReturnLine>
                          tableId="sales.returns.detail_lines"
                          rows={detail.lines || []}
                          columns={detailLineColumns}
                          getRowId={(l) => l.id}
                          emptyText="No lines."
                          enableGlobalFilter={false}
                          initialSort={{ columnId: "item", dir: "asc" }}
                        />

                        <div className="rounded-md border border-border bg-bg-elevated p-3">
                          <p className="text-sm font-medium text-foreground">Tax Lines</p>
                          <div className="mt-2 space-y-1 text-xs text-fg-muted">
                            {(detail.tax_lines || []).map((t) => (
                              <div key={t.id} className="flex items-center justify-between gap-2">
                                <span className="font-mono">{t.tax_code_id}</span>
                                <span className="data-mono">
                                  {fmtUsd(t.tax_usd)} / {fmtLbp(t.tax_lbp)}
                                </span>
                              </div>
                            ))}
                            {!(detail.tax_lines || []).length ? <p className="text-fg-subtle">No tax lines.</p> : null}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-fg-muted">Pick a return from the list to view it.</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>);
}
