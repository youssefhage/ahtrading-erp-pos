"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DocumentAttachments } from "@/components/document-attachments";
import { DocumentTimeline } from "@/components/document-timeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";

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

export default function ItemViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [barcodes, setBarcodes] = useState<ItemBarcode[]>([]);
  const [suppliers, setSuppliers] = useState<ItemSupplierLinkRow[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [it, bc, sup] = await Promise.all([
        apiGet<{ item: Item }>(`/items/${encodeURIComponent(id)}`),
        apiGet<{ barcodes: ItemBarcode[] }>(`/items/${encodeURIComponent(id)}/barcodes`).catch(() => ({ barcodes: [] as ItemBarcode[] })),
        apiGet<{ suppliers: ItemSupplierLinkRow[] }>(`/suppliers/items/${encodeURIComponent(id)}`).catch(() => ({ suppliers: [] as ItemSupplierLinkRow[] })),
      ]);
      setItem(it.item || null);
      setBarcodes(bc.barcodes || []);
      setSuppliers(sup.suppliers || []);
    } catch (e) {
      setItem(null);
      setBarcodes([]);
      setSuppliers([]);
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

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Item</h1>
            <p className="text-sm text-fg-muted">{id}</p>
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
          <p className="text-sm text-fg-muted">
            <span className="font-mono text-xs">{id}</span>
            {item ? (
              <>
                {" "}
                · <Chip variant={item.is_active === false ? "default" : "success"}>{item.is_active === false ? "inactive" : "active"}</Chip>
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
        </div>
      </div>

      {item ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription>Core catalog fields.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">SKU</p>
                <p className="font-mono text-sm text-foreground">{item.sku}</p>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">UOM</p>
                <p className="font-mono text-sm text-foreground">{item.unit_of_measure}</p>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">Primary Barcode</p>
                <p className="font-mono text-sm text-foreground">{item.barcode || "-"}</p>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">Type</p>
                <p className="text-sm text-foreground">{item.item_type || "stocked"}</p>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">Tax Code</p>
                <p className="font-mono text-sm text-foreground">{item.tax_code_id || "-"}</p>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-3">
                <p className="text-xs text-fg-muted">Reorder</p>
                <p className="font-mono text-sm text-foreground">
                  {String(item.reorder_point ?? "-")} / {String(item.reorder_qty ?? "-")}
                </p>
              </div>
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
                      src={`/api/attachments/${encodeURIComponent(item.image_attachment_id)}/view`}
                      alt={item.image_alt || item.name}
                      width={220}
                      height={220}
                      className="h-[220px] w-[220px] object-contain"
                    />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-fg-subtle">Alt</span>: {item.image_alt || "-"}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/attachments/${encodeURIComponent(item.image_attachment_id)}/view`} target="_blank" rel="noreferrer">
                          View
                        </a>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/attachments/${encodeURIComponent(item.image_attachment_id)}/download`} target="_blank" rel="noreferrer">
                          Download
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-fg-subtle">No image.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Barcodes</CardTitle>
              <CardDescription>Primary and alternate barcodes.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Barcode</th>
                      <th className="px-3 py-2 text-right">Factor</th>
                      <th className="px-3 py-2">Label</th>
                      <th className="px-3 py-2">Primary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {barcodes.map((b) => (
                      <tr key={b.id} className="ui-tr-hover">
                        <td className="px-3 py-2 font-mono text-xs">{b.barcode}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{String(b.qty_factor || 1)}</td>
                        <td className="px-3 py-2 text-xs text-fg-muted">{b.label || "-"}</td>
                        <td className="px-3 py-2">
                          {b.is_primary ? <Chip variant="primary">yes</Chip> : <Chip variant="default">no</Chip>}
                        </td>
                      </tr>
                    ))}
                    {barcodes.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                          No barcodes.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Suppliers</CardTitle>
              <CardDescription>Preferred supplier and last cost.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Supplier</th>
                      <th className="px-3 py-2">Primary</th>
                      <th className="px-3 py-2 text-right">Lead (days)</th>
                      <th className="px-3 py-2 text-right">Min Qty</th>
                      <th className="px-3 py-2 text-right">Last Cost USD</th>
                      <th className="px-3 py-2 text-right">Last Cost LL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id} className="ui-tr-hover">
                        <td className="px-3 py-2 text-sm">{s.name}</td>
                        <td className="px-3 py-2">{s.is_primary ? <Chip variant="primary">yes</Chip> : <Chip variant="default">no</Chip>}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{String(s.lead_time_days || 0)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{String(s.min_order_qty || 0)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{String(s.last_cost_usd || 0)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{String(s.last_cost_lbp || 0)}</td>
                      </tr>
                    ))}
                    {suppliers.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
                          No suppliers linked.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <DocumentAttachments entityType="item" entityId={item.id} allowUpload={true} />
          <DocumentTimeline entityType="item" entityId={item.id} />
        </>
      ) : null}
    </div>
  );
}

