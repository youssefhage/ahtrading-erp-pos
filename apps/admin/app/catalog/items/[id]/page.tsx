"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";

import { apiGet, apiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";

type TaxCode = { id: string; name: string; rate: string | number };

type Item = {
  id: string;
  sku: string;
  name: string;
  item_type?: "stocked" | "service" | "bundle";
  tags?: string[] | null;
  unit_of_measure: string;
  barcode: string | null;
  tax_code_id: string | null;
  reorder_point: string | number | null;
  reorder_qty: string | number | null;
  is_active?: boolean;
  category_id?: string | null;
  brand?: string | null;
  short_name?: string | null;
  description?: string | null;
  track_batches?: boolean;
  track_expiry?: boolean;
  default_shelf_life_days?: number | null;
  min_shelf_life_days_for_sale?: number | null;
  expiry_warning_days?: number | null;
  allow_negative_stock?: boolean | null;
  image_attachment_id?: string | null;
  image_alt?: string | null;
};

type ItemBarcode = {
  id: string;
  barcode: string;
  qty_factor: string | number;
  label: string | null;
  is_primary: boolean;
};

type ItemSupplierLinkRow = {
  id: string; // link id
  supplier_id: string;
  name: string;
  is_primary: boolean;
  lead_time_days: number;
  min_order_qty: string | number;
  last_cost_usd: string | number;
  last_cost_lbp: string | number;
};

function shortId(v: string, head = 8, tail = 4) {
  const s = (v || "").trim();
  if (!s) return "-";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function itemTypeLabel(t?: Item["item_type"]) {
  if (t === "service") return "Service";
  if (t === "bundle") return "Bundle";
  return "Stocked";
}

function fmtRate(v: string | number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  // Most rates are stored as "11" for 11%, so keep it simple and readable.
  const s = String(n);
  return `${s.replace(/\.0+$/, "")}%`;
}

function CopyIconButton(props: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const text = (props.text || "").trim();
  const disabled = !text || text === "-";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8 text-fg-muted hover:text-foreground", props.className)}
      disabled={disabled}
      onClick={async () => {
        if (disabled) return;
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          // ignore
        }
      }}
      title={disabled ? undefined : `Copy${props.label ? ` ${props.label}` : ""}`}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

function SummaryField(props: { label: string; value: string; mono?: boolean; copyText?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">{props.label}</p>
        {props.copyText ? <CopyIconButton text={props.copyText} label={props.label} className="h-7 w-7" /> : null}
      </div>
      <p
        className={cn(
          "mt-1 text-[15px] font-semibold leading-snug text-foreground",
          props.mono && "font-mono text-[14px] font-medium"
        )}
        title={props.value}
      >
        {props.value}
      </p>
      {props.hint ? <p className="mt-1 text-xs text-fg-subtle">{props.hint}</p> : null}
    </div>
  );
}

export default function ItemViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [barcodes, setBarcodes] = useState<ItemBarcode[]>([]);
  const [suppliers, setSuppliers] = useState<ItemSupplierLinkRow[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [it, bc, sup, tc] = await Promise.all([
        apiGet<{ item: Item }>(`/items/${encodeURIComponent(id)}`),
        apiGet<{ barcodes: ItemBarcode[] }>(`/items/${encodeURIComponent(id)}/barcodes`).catch(() => ({ barcodes: [] as ItemBarcode[] })),
        apiGet<{ suppliers: ItemSupplierLinkRow[] }>(`/suppliers/items/${encodeURIComponent(id)}`).catch(() => ({ suppliers: [] as ItemSupplierLinkRow[] })),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes").catch(() => ({ tax_codes: [] as TaxCode[] })),
      ]);
      setItem(it.item || null);
      setBarcodes(bc.barcodes || []);
      setSuppliers(sup.suppliers || []);
      setTaxCodes(tc.tax_codes || []);
    } catch (e) {
      setItem(null);
      setBarcodes([]);
      setSuppliers([]);
      setTaxCodes([]);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const title = useMemo(() => {
    if (loading) return "Loading...";
    if (item) return `${item.sku} · ${item.name}`;
    return "Item";
  }, [loading, item]);

  const taxById = useMemo(() => new Map(taxCodes.map((t) => [t.id, t])), [taxCodes]);
  const taxMeta = useMemo(() => (item?.tax_code_id ? taxById.get(item.tax_code_id) : undefined), [item?.tax_code_id, taxById]);
  const barcodeColumns = useMemo((): Array<DataTableColumn<ItemBarcode>> => {
    return [
      {
        id: "barcode",
        header: "Barcode",
        sortable: true,
        mono: true,
        accessor: (b) => b.barcode,
        cell: (b) => (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm">{b.barcode}</span>
            <CopyIconButton text={b.barcode} label="barcode" className="h-7 w-7" />
          </div>
        ),
      },
      {
        id: "qty_factor",
        header: "Factor",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (b) => Number(b.qty_factor || 1),
        cell: (b) => <span className="font-mono text-sm">{String(b.qty_factor || 1)}</span>,
      },
      {
        id: "label",
        header: "Label",
        sortable: true,
        accessor: (b) => b.label || "",
        cell: (b) => <span className="text-sm text-fg-muted">{b.label || "-"}</span>,
      },
      {
        id: "is_primary",
        header: "Primary",
        sortable: true,
        accessor: (b) => (b.is_primary ? "yes" : "no"),
        cell: (b) => (b.is_primary ? <Chip variant="primary">yes</Chip> : <Chip variant="default">no</Chip>),
      },
    ];
  }, []);
  const supplierColumns = useMemo((): Array<DataTableColumn<ItemSupplierLinkRow>> => {
    return [
      {
        id: "name",
        header: "Supplier",
        sortable: true,
        accessor: (s) => s.name,
        cell: (s) => <span className="text-sm">{s.name}</span>,
      },
      {
        id: "is_primary",
        header: "Primary",
        sortable: true,
        accessor: (s) => (s.is_primary ? "yes" : "no"),
        cell: (s) => (s.is_primary ? <Chip variant="primary">yes</Chip> : <Chip variant="default">no</Chip>),
      },
      {
        id: "lead_time_days",
        header: "Lead (days)",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.lead_time_days || 0),
        cell: (s) => <span className="font-mono text-sm">{String(s.lead_time_days || 0)}</span>,
      },
      {
        id: "min_order_qty",
        header: "Min Qty",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.min_order_qty || 0),
        cell: (s) => <span className="font-mono text-sm">{String(s.min_order_qty || 0)}</span>,
      },
      {
        id: "last_cost_usd",
        header: "Last Cost USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.last_cost_usd || 0),
        cell: (s) => <span className="font-mono text-sm">{String(s.last_cost_usd || 0)}</span>,
      },
      {
        id: "last_cost_lbp",
        header: "Last Cost LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.last_cost_lbp || 0),
        cell: (s) => <span className="font-mono text-sm">{String(s.last_cost_lbp || 0)}</span>,
      },
    ];
  }, []);

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Item</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <span className="font-mono text-xs">{shortId(id)}</span>
              <CopyIconButton text={id} label="ID" className="h-7 w-7" />
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")}>
            Back
          </Button>
        </div>
        <ErrorBanner error={err} onRetry={load} />
      </div>
    );
  }

  if (!loading && !item) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <EmptyState title="Item not found" description="This item may have been deleted or you may not have access." actionLabel="Back" onAction={() => router.push("/catalog/items/list")} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span className="font-mono text-xs">{shortId(id)}</span>
            <CopyIconButton text={id} label="ID" className="h-7 w-7" />
            {item ? (
              <>
                <span className="text-fg-subtle">·</span>
                <Chip variant={item.is_active === false ? "default" : "success"}>{item.is_active === false ? "inactive" : "active"}</Chip>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")} disabled={loading}>
            Back
          </Button>
          {item ? (
            <Button asChild variant="outline" disabled={loading}>
              <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>Edit</Link>
            </Button>
          ) : null}
          <Button asChild disabled={loading}>
            <Link href="/catalog/items/new">New Item</Link>
          </Button>
          {item ? <DocumentUtilitiesDrawer entityType="item" entityId={item.id} allowUploadAttachments={true} className="ml-1" /> : null}
        </div>
      </div>

      {item ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription>Core catalog fields.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <SummaryField label="SKU" value={item.sku || "-"} copyText={item.sku || ""} mono />
              <SummaryField label="UOM" value={item.unit_of_measure || "-"} />
              <SummaryField label="Primary Barcode" value={item.barcode || "-"} copyText={item.barcode || ""} mono />
              <SummaryField label="Type" value={itemTypeLabel(item.item_type)} />
              <SummaryField
                label="Tax"
                value={
                  item.tax_code_id
                    ? taxMeta
                      ? `${taxMeta.name}${taxMeta.rate !== undefined && taxMeta.rate !== null ? ` (${fmtRate(taxMeta.rate)})` : ""}`
                      : shortId(item.tax_code_id)
                    : "-"
                }
                copyText={item.tax_code_id || ""}
                hint={item.tax_code_id && taxMeta ? `ID: ${shortId(item.tax_code_id)}` : undefined}
              />
              <SummaryField
                label="Reorder"
                value={
                  item.reorder_point == null && item.reorder_qty == null
                    ? "-"
                    : `Point: ${String(item.reorder_point ?? "-")}  Qty: ${String(item.reorder_qty ?? "-")}`
                }
                mono
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Image</CardTitle>
              <CardDescription>Primary item image (optional).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {item.image_attachment_id ? (
                <div className="flex flex-wrap items-start gap-4">
                  <div className="rounded-md border border-border-subtle bg-bg-sunken/30 p-2">
                    <Image
                      src={apiUrl(`/attachments/${encodeURIComponent(item.image_attachment_id)}/view`)}
                      alt={item.image_alt || item.name}
                      width={220}
                      height={220}
                      className="h-[220px] w-[220px] object-contain"
                      // Attachments are permissioned (cookie/session). Avoid Next.js optimization fetching without auth.
                      unoptimized
                    />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-fg-subtle">Alt</span>: {item.image_alt || "-"}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <a href={apiUrl(`/attachments/${encodeURIComponent(item.image_attachment_id)}/view`)} target="_blank" rel="noreferrer">
                          View
                        </a>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <a href={apiUrl(`/attachments/${encodeURIComponent(item.image_attachment_id)}/download`)} target="_blank" rel="noreferrer">
                          Download
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-fg-subtle">No image.</p>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>Add image</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Barcodes</CardTitle>
              <CardDescription>Primary and alternate barcodes.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable<ItemBarcode>
                tableId="catalog.item.barcodes"
                rows={barcodes}
                columns={barcodeColumns}
                getRowId={(b) => b.id}
                emptyText="No barcodes."
                enableGlobalFilter={false}
                initialSort={{ columnId: "is_primary", dir: "desc" }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Suppliers</CardTitle>
              <CardDescription>Preferred supplier and last cost.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable<ItemSupplierLinkRow>
                tableId="catalog.item.suppliers"
                rows={suppliers}
                columns={supplierColumns}
                getRowId={(s) => s.id}
                emptyText="No suppliers linked."
                enableGlobalFilter={false}
                initialSort={{ columnId: "is_primary", dir: "desc" }}
              />
            </CardContent>
          </Card>

          {/* Attachments + audit trail are available via the right-rail utilities drawer. */}
        </>
      ) : null}
    </div>
  );
}
