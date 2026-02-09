"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DocumentAttachments } from "@/components/document-attachments";
import { DocumentTimeline } from "@/components/document-timeline";
import { ComboboxInput } from "@/components/combobox-input";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

type TaxCode = { id: string; name: string; rate: string | number };
type Category = { id: string; name: string; parent_id: string | null; is_active: boolean };

type ItemBarcode = {
  id: string;
  barcode: string;
  qty_factor: string | number;
  label: string | null;
  is_primary: boolean;
};

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  payment_terms_days: number;
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

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

function parseTags(input: string): string[] | null {
  const parts = (input || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const uniq = Array.from(new Set(parts));
  return uniq.length ? uniq : null;
}

const DEFAULT_UOMS = ["EA", "PCS", "KG", "G", "L", "ML", "BOX", "PACK", "DOZ", "SET", "M", "CM"];

export default function ItemEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<unknown>(null);

  const [item, setItem] = useState<Item | null>(null);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [barcodes, setBarcodes] = useState<ItemBarcode[]>([]);
  const [newBarcode, setNewBarcode] = useState("");
  const [newFactor, setNewFactor] = useState("1");
  const [newLabel, setNewLabel] = useState("");
  const [newPrimary, setNewPrimary] = useState(false);

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [itemLinks, setItemLinks] = useState<ItemSupplierLinkRow[]>([]);
  const [addSupplierId, setAddSupplierId] = useState("");
  const [addIsPrimary, setAddIsPrimary] = useState(false);
  const [addLeadTimeDays, setAddLeadTimeDays] = useState("0");
  const [addMinOrderQty, setAddMinOrderQty] = useState("0");
  const [addLastCostUsd, setAddLastCostUsd] = useState("0");
  const [addLastCostLbp, setAddLastCostLbp] = useState("0");

  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);

  // Editable fields
  const [editSku, setEditSku] = useState("");
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"stocked" | "service" | "bundle">("stocked");
  const [editTags, setEditTags] = useState("");
  const [editUom, setEditUom] = useState("");
  const [editTaxCodeId, setEditTaxCodeId] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editBrand, setEditBrand] = useState("");
  const [editShortName, setEditShortName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editReorderPoint, setEditReorderPoint] = useState("");
  const [editReorderQty, setEditReorderQty] = useState("");
  const [editTrackBatches, setEditTrackBatches] = useState(false);
  const [editTrackExpiry, setEditTrackExpiry] = useState(false);
  const [editDefaultShelfLifeDays, setEditDefaultShelfLifeDays] = useState("");
  const [editMinShelfLifeDaysForSale, setEditMinShelfLifeDaysForSale] = useState("");
  const [editExpiryWarningDays, setEditExpiryWarningDays] = useState("");
  const [editAllowNegativeStock, setEditAllowNegativeStock] = useState<boolean | null>(null);
  const [editActive, setEditActive] = useState(true);
  const [editImageAttachmentId, setEditImageAttachmentId] = useState("");
  const [editImageAlt, setEditImageAlt] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [it, tc, cats, bc, sup, links] = await Promise.all([
        apiGet<{ item: Item }>(`/items/${encodeURIComponent(id)}`),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes").catch(() => ({ tax_codes: [] as TaxCode[] })),
        apiGet<{ categories: Category[] }>("/item-categories").catch(() => ({ categories: [] as Category[] })),
        apiGet<{ barcodes: ItemBarcode[] }>(`/items/${encodeURIComponent(id)}/barcodes`).catch(() => ({ barcodes: [] as ItemBarcode[] })),
        apiGet<{ suppliers: SupplierRow[] }>("/suppliers").catch(() => ({ suppliers: [] as SupplierRow[] })),
        apiGet<{ suppliers: ItemSupplierLinkRow[] }>(`/suppliers/items/${encodeURIComponent(id)}`).catch(() => ({ suppliers: [] as ItemSupplierLinkRow[] })),
      ]);
      const row = it.item || null;
      setItem(row);
      setTaxCodes(tc.tax_codes || []);
      setCategories(cats.categories || []);
      setBarcodes(bc.barcodes || []);
      setSuppliers(sup.suppliers || []);
      setItemLinks(links.suppliers || []);

      if (row) {
        setEditSku(row.sku || "");
        setEditName(row.name || "");
        setEditType((row.item_type as any) || "stocked");
        setEditTags(Array.isArray(row.tags) ? row.tags.join(", ") : "");
        setEditUom(row.unit_of_measure || "");
        setEditTaxCodeId(row.tax_code_id || "");
        setEditCategoryId((row.category_id as any) || "");
        setEditBrand((row.brand as any) || "");
        setEditShortName((row.short_name as any) || "");
        setEditDescription((row.description as any) || "");
        setEditReorderPoint(String(row.reorder_point ?? ""));
        setEditReorderQty(String(row.reorder_qty ?? ""));
        setEditTrackBatches(Boolean(row.track_batches));
        setEditTrackExpiry(Boolean(row.track_expiry));
        setEditDefaultShelfLifeDays(String(row.default_shelf_life_days ?? ""));
        setEditMinShelfLifeDaysForSale(String(row.min_shelf_life_days_for_sale ?? ""));
        setEditExpiryWarningDays(String(row.expiry_warning_days ?? ""));
        setEditAllowNegativeStock(row.allow_negative_stock === undefined ? null : (row.allow_negative_stock as any));
        setEditActive(row.is_active !== false);
        setEditImageAttachmentId((row.image_attachment_id as any) || "");
        setEditImageAlt((row.image_alt as any) || "");
      }

      setStatus("");
    } catch (e) {
      setItem(null);
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
    if (item) return `Edit ${item.sku}`;
    return "Edit Item";
  }, [loading, item]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    if (!editSku.trim()) return setStatus("SKU is required.");
    if (!editName.trim()) return setStatus("Name is required.");
    if (!editUom.trim()) return setStatus("UOM is required.");

    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/items/${encodeURIComponent(item.id)}`, {
        sku: editSku.trim(),
        name: editName.trim(),
        item_type: editType,
        tags: parseTags(editTags),
        unit_of_measure: editUom.trim(),
        tax_code_id: editTaxCodeId ? editTaxCodeId : null,
        category_id: editCategoryId ? editCategoryId : null,
        brand: editBrand.trim() || null,
        short_name: editShortName.trim() || null,
        description: editDescription.trim() || null,
        reorder_point: toNum(editReorderPoint),
        reorder_qty: toNum(editReorderQty),
        track_batches: Boolean(editTrackBatches),
        track_expiry: Boolean(editTrackExpiry),
        default_shelf_life_days: editDefaultShelfLifeDays.trim() ? Number(editDefaultShelfLifeDays) : null,
        min_shelf_life_days_for_sale: editMinShelfLifeDaysForSale.trim() ? Number(editMinShelfLifeDaysForSale) : null,
        expiry_warning_days: editExpiryWarningDays.trim() ? Number(editExpiryWarningDays) : null,
        allow_negative_stock: editAllowNegativeStock,
        is_active: Boolean(editActive),
        image_attachment_id: editImageAttachmentId || null,
        image_alt: editImageAlt.trim() || null,
      });
      await load();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(file: File) {
    if (!item) return;
    setImageUploading(true);
    setStatus("Uploading image...");
    try {
      const fd = new FormData();
      fd.set("entity_type", "item_image");
      fd.set("entity_id", item.id);
      fd.set("file", file);
      const raw = await fetch(`/api/attachments`, { method: "POST", body: fd, credentials: "include" });
      if (!raw.ok) throw new Error(await raw.text());
      const res = (await raw.json()) as { id: string };
      await apiPatch(`/items/${encodeURIComponent(item.id)}`, { image_attachment_id: res.id });
      setEditImageAttachmentId(res.id);
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setImageUploading(false);
    }
  }

  async function removeImage() {
    if (!item) return;
    setImageUploading(true);
    setStatus("Removing image...");
    try {
      await apiPatch(`/items/${encodeURIComponent(item.id)}`, { image_attachment_id: null });
      setEditImageAttachmentId("");
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setImageUploading(false);
    }
  }

  async function addBarcode(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    const code = newBarcode.trim();
    if (!code) return setStatus("Barcode is required.");
    const factorRes = parseNumberInput(newFactor);
    if (!factorRes.ok) return setStatus("Invalid qty factor.");
    if (factorRes.value <= 0) return setStatus("qty factor must be > 0.");

    setStatus("Adding barcode...");
    try {
      await apiPost(`/items/${encodeURIComponent(item.id)}/barcodes`, {
        barcode: code,
        qty_factor: factorRes.value,
        label: newLabel.trim() || null,
        is_primary: Boolean(newPrimary),
      });
      setNewBarcode("");
      setNewFactor("1");
      setNewLabel("");
      setNewPrimary(false);
      await load();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  async function updateBarcode(barcodeId: string, patch: any) {
    setStatus("Updating barcode...");
    try {
      const raw = await fetch(`/api/items/barcodes/${encodeURIComponent(barcodeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      if (!raw.ok) throw new Error(await raw.text());
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteBarcode(barcodeId: string) {
    setStatus("Deleting barcode...");
    try {
      const raw = await fetch(`/api/items/barcodes/${encodeURIComponent(barcodeId)}`, { method: "DELETE", credentials: "include" });
      if (!raw.ok) throw new Error(await raw.text());
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function addSupplierLink(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    if (!addSupplierId) return setStatus("Pick a supplier.");
    const lead = Number(addLeadTimeDays || 0);
    const moqRes = parseNumberInput(addMinOrderQty);
    if (!moqRes.ok) return setStatus("Invalid min order qty.");
    const usdRes = parseNumberInput(addLastCostUsd);
    const lbpRes = parseNumberInput(addLastCostLbp);
    if (!usdRes.ok) return setStatus("Invalid last cost USD.");
    if (!lbpRes.ok) return setStatus("Invalid last cost LL.");

    setStatus("Linking supplier...");
    try {
      await apiPost(`/suppliers/${encodeURIComponent(addSupplierId)}/items`, {
        item_id: item.id,
        is_primary: Boolean(addIsPrimary),
        lead_time_days: lead,
        min_order_qty: moqRes.value,
        last_cost_usd: usdRes.value,
        last_cost_lbp: lbpRes.value,
      });
      setAddSupplierId("");
      setAddIsPrimary(false);
      setAddLeadTimeDays("0");
      setAddMinOrderQty("0");
      setAddLastCostUsd("0");
      setAddLastCostLbp("0");
      await load();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  async function updateSupplierLink(linkId: string, patch: any) {
    setStatus("Updating supplier link...");
    try {
      await apiPatch(`/suppliers/item-links/${encodeURIComponent(linkId)}`, patch);
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteSupplierLink(linkId: string) {
    setStatus("Deleting supplier link...");
    try {
      const raw = await fetch(`/api/suppliers/item-links/${encodeURIComponent(linkId)}`, { method: "DELETE", credentials: "include" });
      if (!raw.ok) throw new Error(await raw.text());
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Edit Item</h1>
            <p className="text-sm text-fg-muted">{id}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => router.push(`/catalog/items/${encodeURIComponent(id)}`)}>
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
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push(`/catalog/items/${encodeURIComponent(id)}`)} disabled={saving}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={load} disabled={saving || loading}>
            Refresh
          </Button>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      {item ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Item</CardTitle>
              <CardDescription>Core fields used by Sales, Purchasing, and Inventory.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={save} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">SKU</label>
                  <Input value={editSku} onChange={(e) => setEditSku(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1 md:col-span-4">
                  <label className="text-xs font-medium text-fg-muted">Name</label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={saving} />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">Type</label>
                  <select className="ui-select" value={editType} onChange={(e) => setEditType(e.target.value as any)} disabled={saving}>
                    <option value="stocked">stocked</option>
                    <option value="service">service</option>
                    <option value="bundle">bundle</option>
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">UOM</label>
                  <ComboboxInput
                    value={editUom}
                    onChange={setEditUom}
                    disabled={saving}
                    endpoint="/items/uoms"
                    responseKey="uoms"
                    fallbackSuggestions={DEFAULT_UOMS}
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">Tags</label>
                  <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="comma-separated" disabled={saving} />
                </div>

                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Tax Code</label>
                  <SearchableSelect
                    value={editTaxCodeId}
                    onChange={setEditTaxCodeId}
                    disabled={saving}
                    searchPlaceholder="Search tax codes..."
                    options={[
                      { value: "", label: "(none)" },
                      ...taxCodes.map((t) => ({ value: t.id, label: t.name, keywords: String(t.rate ?? "") })),
                    ]}
                  />
                </div>
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Category</label>
                  <SearchableSelect
                    value={editCategoryId}
                    onChange={setEditCategoryId}
                    disabled={saving}
                    searchPlaceholder="Search categories..."
                    options={[
                      { value: "", label: "(none)" },
                      ...categories.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                  />
                </div>

                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Brand</label>
                  <Input value={editBrand} onChange={(e) => setEditBrand(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Short Name</label>
                  <Input value={editShortName} onChange={(e) => setEditShortName(e.target.value)} disabled={saving} />
                </div>

                <div className="space-y-1 md:col-span-6">
                  <label className="text-xs font-medium text-fg-muted">Description</label>
                  <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} disabled={saving} />
                </div>

                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Reorder Point</label>
                  <Input value={editReorderPoint} onChange={(e) => setEditReorderPoint(e.target.value)} disabled={saving} inputMode="decimal" />
                </div>
                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Reorder Qty</label>
                  <Input value={editReorderQty} onChange={(e) => setEditReorderQty(e.target.value)} disabled={saving} inputMode="decimal" />
                </div>

                <label className="md:col-span-3 flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={editTrackBatches} onChange={(e) => setEditTrackBatches(e.target.checked)} disabled={saving} />
                  Track batches
                </label>
                <label className="md:col-span-3 flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={editTrackExpiry} onChange={(e) => setEditTrackExpiry(e.target.checked)} disabled={saving} />
                  Track expiry
                </label>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">Default Shelf Life (days)</label>
                  <Input value={editDefaultShelfLifeDays} onChange={(e) => setEditDefaultShelfLifeDays(e.target.value)} disabled={saving} inputMode="numeric" />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">Min Shelf Life For Sale (days)</label>
                  <Input value={editMinShelfLifeDaysForSale} onChange={(e) => setEditMinShelfLifeDaysForSale(e.target.value)} disabled={saving} inputMode="numeric" />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-fg-muted">Expiry Warning (days)</label>
                  <Input value={editExpiryWarningDays} onChange={(e) => setEditExpiryWarningDays(e.target.value)} disabled={saving} inputMode="numeric" />
                </div>

                <div className="space-y-1 md:col-span-3">
                  <label className="text-xs font-medium text-fg-muted">Allow Negative Stock</label>
                  <select
                    className="ui-select"
                    value={editAllowNegativeStock === null ? "" : editAllowNegativeStock ? "true" : "false"}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) setEditAllowNegativeStock(null);
                      else setEditAllowNegativeStock(v === "true");
                    }}
                    disabled={saving}
                  >
                    <option value="">(inherit)</option>
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </div>

                <label className="md:col-span-3 flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} disabled={saving} />
                  Active
                </label>

                <div className="md:col-span-6 flex justify-end">
                  <Button type="submit" disabled={saving}>
                    {saving ? "..." : "Save"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Image</CardTitle>
              <CardDescription>Upload an item image (stored as an attachment).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Alt text</label>
                <Input value={editImageAlt} onChange={(e) => setEditImageAlt(e.target.value)} disabled={imageUploading || saving} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  disabled={imageUploading || saving}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadImage(f);
                  }}
                  className="block text-xs"
                />
                <Button type="button" variant="outline" disabled={imageUploading || saving || !editImageAttachmentId} onClick={removeImage}>
                  Remove
                </Button>
              </div>
              {editImageAttachmentId ? (
                <div className="text-xs text-fg-muted">
                  Current image attachment: <span className="font-mono">{editImageAttachmentId}</span>
                </div>
              ) : (
                <div className="text-xs text-fg-subtle">No image.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Barcodes</CardTitle>
              <CardDescription>Add alternate barcodes and set the primary barcode.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form onSubmit={addBarcode} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                <div className="md:col-span-5">
                  <Input value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} placeholder="barcode" />
                </div>
                <div className="md:col-span-2">
                  <Input value={newFactor} onChange={(e) => setNewFactor(e.target.value)} placeholder="factor" inputMode="decimal" />
                </div>
                <div className="md:col-span-3">
                  <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="label (optional)" />
                </div>
                <label className="md:col-span-1 flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={newPrimary} onChange={(e) => setNewPrimary(e.target.checked)} /> Primary
                </label>
                <div className="md:col-span-1 flex justify-end">
                  <Button type="submit" variant="outline">
                    Add
                  </Button>
                </div>
              </form>

              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Barcode</th>
                      <th className="px-3 py-2 text-right">Factor</th>
                      <th className="px-3 py-2">Label</th>
                      <th className="px-3 py-2">Primary</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {barcodes.map((b) => (
                      <tr key={b.id} className="ui-tr-hover">
                        <td className="px-3 py-2 font-mono text-xs">{b.barcode}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{String(b.qty_factor || 1)}</td>
                        <td className="px-3 py-2 text-xs text-fg-muted">{b.label || "-"}</td>
                        <td className="px-3 py-2 text-xs">{b.is_primary ? "yes" : "no"}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-2">
                            {!b.is_primary ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => updateBarcode(b.id, { is_primary: true })}>
                                Set Primary
                              </Button>
                            ) : null}
                            <Button type="button" size="sm" variant="outline" onClick={() => deleteBarcode(b.id)}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {barcodes.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
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
              <CardDescription>Link suppliers to this item (primary supplier + last cost).</CardDescription>
            </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={addSupplierLink} className="grid grid-cols-1 gap-2 md:grid-cols-12">
              <div className="md:col-span-4">
                <SearchableSelect
                  value={addSupplierId}
                  onChange={setAddSupplierId}
                  searchPlaceholder="Search suppliers..."
                  options={[
                    { value: "", label: "Select supplier..." },
                    ...suppliers.map((s) => ({
                      value: s.id,
                      label: s.name,
                      keywords: `${s.phone || ""} ${s.email || ""}`.trim(),
                    })),
                  ]}
                />
              </div>
              <div className="md:col-span-2">
                <Input value={addLeadTimeDays} onChange={(e) => setAddLeadTimeDays(e.target.value)} placeholder="lead days" inputMode="numeric" />
              </div>
                <div className="md:col-span-2">
                  <Input value={addMinOrderQty} onChange={(e) => setAddMinOrderQty(e.target.value)} placeholder="min qty" inputMode="decimal" />
                </div>
                <div className="md:col-span-2">
                  <Input value={addLastCostUsd} onChange={(e) => setAddLastCostUsd(e.target.value)} placeholder="USD" inputMode="decimal" />
                </div>
                <div className="md:col-span-2">
                  <Input value={addLastCostLbp} onChange={(e) => setAddLastCostLbp(e.target.value)} placeholder="LL" inputMode="decimal" />
                </div>
                <label className="md:col-span-12 flex items-center justify-between gap-2 text-xs text-fg-muted">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={addIsPrimary} onChange={(e) => setAddIsPrimary(e.target.checked)} /> Set as primary supplier
                  </span>
                  <Button type="submit" variant="outline">
                    Link Supplier
                  </Button>
                </label>
              </form>

              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Supplier</th>
                      <th className="px-3 py-2">Primary</th>
                      <th className="px-3 py-2 text-right">Lead</th>
                      <th className="px-3 py-2 text-right">Min Qty</th>
                      <th className="px-3 py-2 text-right">USD</th>
                      <th className="px-3 py-2 text-right">LL</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemLinks.map((l) => (
                      <tr key={l.id} className="ui-tr-hover">
                        <td className="px-3 py-2 text-sm">{l.name}</td>
                        <td className="px-3 py-2 text-xs">{l.is_primary ? "yes" : "no"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{String(l.lead_time_days || 0)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{String(l.min_order_qty || 0)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{String(l.last_cost_usd || 0)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{String(l.last_cost_lbp || 0)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-2">
                            {!l.is_primary ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => updateSupplierLink(l.id, { is_primary: true })}>
                                Set Primary
                              </Button>
                            ) : null}
                            <Button type="button" size="sm" variant="outline" onClick={() => deleteSupplierLink(l.id)}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {itemLinks.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={7}>
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
