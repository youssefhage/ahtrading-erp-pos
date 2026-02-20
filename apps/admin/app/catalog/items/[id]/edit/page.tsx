"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Printer, RefreshCw } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm } from "@/lib/api";
import { generateEan13Barcode, printBarcodeStickerLabel } from "@/lib/barcode-label";
import { parseNumberInput } from "@/lib/numbers";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FileInput } from "@/components/file-input";

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
  uom_code: string | null;
  qty_factor: string | number;
  label: string | null;
  is_primary: boolean;
};

type ItemUomConversion = {
  uom_code: string;
  uom_name?: string | null;
  uom_precision?: number | null;
  to_base_factor: string | number;
  is_active: boolean;
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

type PriceSuggest = {
  item_id: string;
  target_margin_pct: string;
  rounding: { usd_step: string; lbp_step: string };
  current: {
    price_usd: string;
    price_lbp: string;
    avg_cost_usd: string;
    avg_cost_lbp: string;
    margin_usd: string | null;
    margin_lbp: string | null;
  };
  suggested: { price_usd: string | null; price_lbp: string | null };
  last_cost_change?: any;
};

type PriceListRow = {
  id: string;
  code: string;
  name: string;
  currency: "USD" | "LBP";
  is_default: boolean;
};

type PriceListItemRow = {
  id: string;
  item_id: string;
  price_usd: string | number;
  price_lbp: string | number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
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

function InlineMetric(props: { label: string; value: ReactNode; hint?: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0 border-l-2 border-border-subtle pl-3", props.className)}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">{props.label}</div>
      <div className={cn("mt-1 text-sm font-semibold text-foreground", props.mono && "data-mono")}>{props.value}</div>
      {props.hint ? <div className="mt-2 text-xs text-fg-subtle">{props.hint}</div> : null}
    </div>
  );
}

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
  const [uoms, setUoms] = useState<string[]>([]);

  const [barcodes, setBarcodes] = useState<ItemBarcode[]>([]);
  const [newBarcode, setNewBarcode] = useState("");
  const [newBarcodeUom, setNewBarcodeUom] = useState("");
  const [newFactor, setNewFactor] = useState("1");
  const [newLabel, setNewLabel] = useState("");
  const [newPrimary, setNewPrimary] = useState(false);

  const [convBaseUom, setConvBaseUom] = useState("");
  const [conversions, setConversions] = useState<ItemUomConversion[]>([]);
  const [newConvUom, setNewConvUom] = useState("");
  const [newConvFactor, setNewConvFactor] = useState("1");
  const [newConvActive, setNewConvActive] = useState(true);

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
  const [priceSuggest, setPriceSuggest] = useState<PriceSuggest | null>(null);
  const [priceBusy, setPriceBusy] = useState(false);

  // Price list override (WHOLESALE/RETAIL)
  const [priceLists, setPriceLists] = useState<PriceListRow[]>([]);
  const [defaultPriceListId, setDefaultPriceListId] = useState<string>("");
  const [selectedPriceListId, setSelectedPriceListId] = useState<string>("");
  const [plItems, setPlItems] = useState<PriceListItemRow[]>([]);
  const [plEffective, setPlEffective] = useState<PriceListItemRow | null>(null);
  const [plBusy, setPlBusy] = useState(false);
  const [plEffectiveFrom, setPlEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [plPriceUsd, setPlPriceUsd] = useState("");
  const [plPriceLbp, setPlPriceLbp] = useState("");

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
      const [it, tc, cats, uo, bc, conv, sup, links, pls, settings] = await Promise.all([
        apiGet<{ item: Item }>(`/items/${encodeURIComponent(id)}`),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes").catch(() => ({ tax_codes: [] as TaxCode[] })),
        apiGet<{ categories: Category[] }>("/item-categories").catch(() => ({ categories: [] as Category[] })),
        apiGet<{ uoms: string[] }>("/items/uoms?limit=200").catch(() => ({ uoms: [] as string[] })),
        apiGet<{ barcodes: ItemBarcode[] }>(`/items/${encodeURIComponent(id)}/barcodes`).catch(() => ({ barcodes: [] as ItemBarcode[] })),
        apiGet<{ base_uom: string; conversions: ItemUomConversion[] }>(`/items/${encodeURIComponent(id)}/uom-conversions`).catch(() => ({ base_uom: "", conversions: [] as ItemUomConversion[] })),
        apiGet<{ suppliers: SupplierRow[] }>("/suppliers").catch(() => ({ suppliers: [] as SupplierRow[] })),
        apiGet<{ suppliers: ItemSupplierLinkRow[] }>(`/suppliers/items/${encodeURIComponent(id)}`).catch(() => ({ suppliers: [] as ItemSupplierLinkRow[] })),
        apiGet<{ lists: PriceListRow[] }>("/pricing/lists").catch(() => ({ lists: [] as PriceListRow[] })),
        apiGet<{ settings: Array<{ key: string; value_json: any }> }>("/pricing/company-settings").catch(() => ({ settings: [] as any[] })),
      ]);
      const row = it.item || null;
      setItem(row);
      setTaxCodes(tc.tax_codes || []);
      setCategories(cats.categories || []);
      setUoms((uo.uoms || []).map((x) => String(x || "").trim()).filter(Boolean));
      setBarcodes(bc.barcodes || []);
      setConvBaseUom(String(conv.base_uom || row?.unit_of_measure || "").trim().toUpperCase());
      setConversions(conv.conversions || []);
      setSuppliers(sup.suppliers || []);
      setItemLinks(links.suppliers || []);

      const lists = pls.lists || [];
      setPriceLists(lists);
      const settingDefault = (settings.settings || []).find((s) => String(s?.key || "") === "default_price_list_id");
      const defIdFromSetting = String(settingDefault?.value_json?.id || "");
      const defIdFromFlag = String((lists.find((l) => l.is_default)?.id as any) || "");
      const defId = defIdFromSetting || defIdFromFlag || "";
      setDefaultPriceListId(defId);
      setSelectedPriceListId((prev) => {
        // Keep user's selection if still valid; otherwise fall back to default, otherwise first list.
        if (prev && lists.some((l) => l.id === prev)) return prev;
        if (defId && lists.some((l) => l.id === defId)) return defId;
        return lists[0]?.id || "";
      });

      if (row) {
        setEditSku(row.sku || "");
        setEditName(row.name || "");
        setEditType((row.item_type as any) || "stocked");
        setEditTags(Array.isArray(row.tags) ? row.tags.join(", ") : "");
        setEditUom(row.unit_of_measure || "");
        setNewBarcodeUom(row.unit_of_measure || "");
        setNewConvUom("");
        setNewConvFactor("1");
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

      try {
        const ps = await apiGet<PriceSuggest>(`/pricing/items/${encodeURIComponent(id)}/suggested-price`);
        setPriceSuggest(ps || null);
      } catch {
        setPriceSuggest(null);
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

  const loadPriceListRows = useCallback(async () => {
    if (!id || !selectedPriceListId) {
      setPlItems([]);
      setPlEffective(null);
      return;
    }
    setPlBusy(true);
    try {
      const res = await apiGet<{ items: PriceListItemRow[]; effective: PriceListItemRow | null }>(
        `/pricing/lists/${encodeURIComponent(selectedPriceListId)}/items/by-item/${encodeURIComponent(id)}`
      );
      setPlItems(res.items || []);
      setPlEffective(res.effective || null);
    } catch {
      setPlItems([]);
      setPlEffective(null);
    } finally {
      setPlBusy(false);
    }
  }, [id, selectedPriceListId]);

  useEffect(() => {
    loadPriceListRows();
  }, [loadPriceListRows]);

  async function addPriceListOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPriceListId) return setStatus("Pick a price list first.");
    if (!plEffectiveFrom) return setStatus("effective_from is required.");
    setPlBusy(true);
    setStatus("Saving price list override...");
    try {
      await apiPost(`/pricing/lists/${encodeURIComponent(selectedPriceListId)}/items`, {
        item_id: id,
        price_usd: toNum(plPriceUsd),
        price_lbp: toNum(plPriceLbp),
        effective_from: plEffectiveFrom,
        effective_to: null,
      });
      setPlPriceUsd("");
      setPlPriceLbp("");
      await loadPriceListRows();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setPlBusy(false);
    }
  }

  const uomOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    const cur = String(editUom || "").trim();
    if (cur && !seen.has(cur) && !(uoms || []).includes(cur)) {
      // If DB contains an unexpected/inactive UOM, still show it so the user can correct it.
      seen.add(cur);
      out.push({ value: cur, label: `${cur} (current)` });
    }
    for (const x of uoms || []) {
      const v = String(x || "").trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push({ value: v, label: v });
    }
    return out;
  }, [uoms, editUom]);

  const title = useMemo(() => {
    if (loading) return "Loading...";
    if (item) return `Edit ${item.sku}`;
    return "Edit Item";
  }, [loading, item]);

  const selectedPriceList = useMemo(() => {
    return priceLists.find((l) => l.id === selectedPriceListId) || null;
  }, [priceLists, selectedPriceListId]);

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

  async function applySuggestedPrice() {
    if (!item) return;
    if (!priceSuggest?.suggested?.price_usd && !priceSuggest?.suggested?.price_lbp) {
      setStatus("No suggested price available (missing cost or price).");
      return;
    }
    setPriceBusy(true);
    setStatus("Applying suggested price...");
    try {
      const usd = priceSuggest?.suggested?.price_usd
        ? Number(priceSuggest.suggested.price_usd)
        : Number(priceSuggest?.current?.price_usd || 0);
      const lbp = priceSuggest?.suggested?.price_lbp
        ? Number(priceSuggest.suggested.price_lbp)
        : Number(priceSuggest?.current?.price_lbp || 0);
      const today = new Date().toISOString().slice(0, 10);
      await apiPost(`/items/${encodeURIComponent(item.id)}/prices`, {
        price_usd: usd,
        price_lbp: lbp,
        effective_from: today,
        effective_to: null
      });
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setPriceBusy(false);
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
      const res = await apiPostForm<{ id: string }>("/attachments", fd);
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
        uom_code: (newBarcodeUom || editUom || "").trim().toUpperCase() || null,
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
      await apiPatch(`/items/barcodes/${encodeURIComponent(barcodeId)}`, patch);
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteBarcode(barcodeId: string) {
    setStatus("Deleting barcode...");
    try {
      await apiDelete(`/items/barcodes/${encodeURIComponent(barcodeId)}`);
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  function generateDraftBarcode() {
    setNewBarcode(generateEan13Barcode());
  }

  async function printLabelForBarcode(code: string, uom?: string | null) {
    const barcode = String(code || "").trim();
    if (!barcode) return setStatus("Enter or generate a barcode first.");
    try {
      await printBarcodeStickerLabel({
        barcode,
        sku: editSku || item?.sku || null,
        name: editName || item?.name || null,
        uom: String(uom || editUom || item?.unit_of_measure || "").trim() || null,
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function addConversion(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    const u = (newConvUom || "").trim().toUpperCase();
    if (!u) return setStatus("UOM is required.");
    const f = parseNumberInput(newConvFactor);
    if (!f.ok) return setStatus("Invalid conversion factor.");
    if (f.value <= 0) return setStatus("Conversion factor must be > 0.");
    setStatus("Adding conversion...");
    try {
      await apiPost(`/items/${encodeURIComponent(item.id)}/uom-conversions`, { uom_code: u, to_base_factor: f.value, is_active: Boolean(newConvActive) });
      setNewConvUom("");
      setNewConvFactor("1");
      setNewConvActive(true);
      await load();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  async function updateConversion(uomCode: string, patch: any) {
    if (!item) return;
    const u = (uomCode || "").trim().toUpperCase();
    if (!u) return;
    setStatus("Updating conversion...");
    try {
      await apiPatch(`/items/${encodeURIComponent(item.id)}/uom-conversions/${encodeURIComponent(u)}`, patch);
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteConversion(uomCode: string) {
    if (!item) return;
    const u = (uomCode || "").trim().toUpperCase();
    if (!u) return;
    setStatus("Deleting conversion...");
    try {
      await apiDelete(`/items/${encodeURIComponent(item.id)}/uom-conversions/${encodeURIComponent(u)}`);
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
      await apiDelete(`/suppliers/item-links/${encodeURIComponent(linkId)}`);
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
          <DocumentUtilitiesDrawer entityType="item" entityId={id} allowUploadAttachments={true} className="ml-1" />
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      {item ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Pricing</CardTitle>
                  <CardDescription>Current margin and a safe suggested sell price (v1).</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={load} disabled={priceBusy || saving || loading}>
                    Refresh
                  </Button>
                  <Button
                    type="button"
                    onClick={applySuggestedPrice}
                    disabled={priceBusy || saving || !(priceSuggest?.suggested?.price_usd || priceSuggest?.suggested?.price_lbp)}
                  >
                    Apply Suggested
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm md:grid-cols-3">
              <InlineMetric
                label="Current Price"
                value={priceSuggest?.current ? fmtUsdLbp(priceSuggest.current.price_usd, priceSuggest.current.price_lbp, { sep: " · " }) : "-"}
                hint={`Target margin: ${priceSuggest ? `${(Number(priceSuggest.target_margin_pct) * 100).toFixed(0)}%` : "-"}`}
                mono
              />
              <InlineMetric
                label="Average Cost"
                value={priceSuggest?.current ? fmtUsdLbp(priceSuggest.current.avg_cost_usd, priceSuggest.current.avg_cost_lbp, { sep: " · " }) : "-"}
                hint={
                  <>
                    Current margin (USD):{" "}
                    {priceSuggest?.current?.margin_usd != null ? `${(Number(priceSuggest.current.margin_usd) * 100).toFixed(1)}%` : "-"}
                  </>
                }
                mono
              />
              <InlineMetric
                label="Suggested Price"
                value={priceSuggest?.suggested ? fmtUsdLbp(priceSuggest.suggested.price_usd, priceSuggest.suggested.price_lbp, { sep: " · " }) : "-"}
                hint={
                  <>
                    Rounding: USD step {priceSuggest?.rounding?.usd_step || "-"} · LBP step {priceSuggest?.rounding?.lbp_step || "-"}
                  </>
                }
                mono
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Price List Override</CardTitle>
                  <CardDescription>Set WHOLESALE/RETAIL price for this item without leaving the Item page.</CardDescription>
                </div>
                {selectedPriceListId ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push(`/catalog/price-lists?open=${encodeURIComponent(selectedPriceListId)}`)}
                      disabled={saving || plBusy}
                    >
                      Open Price List
                    </Button>
                    <Button type="button" variant="outline" onClick={loadPriceListRows} disabled={saving || plBusy}>
                      Refresh
                    </Button>
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-1">
                <label className="text-xs font-medium text-fg-muted">Price List</label>
                <select
                  className="ui-select w-full"
                  value={selectedPriceListId}
                  onChange={(e) => setSelectedPriceListId(e.target.value)}
                  disabled={plBusy}
                >
                  <option value="">(pick)</option>
                  {priceLists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.code} · {pl.name}
                      {defaultPriceListId && pl.id === defaultPriceListId ? " (default)" : ""}
                    </option>
                  ))}
                </select>

                <InlineMetric
                  label="Current Effective (This List)"
                  value={plEffective ? fmtUsdLbp(plEffective.price_usd, plEffective.price_lbp, { sep: " · " }) : "-"}
                  hint={
                    <>
                      From: {plEffective?.effective_from ? String(plEffective.effective_from).slice(0, 10) : "-"}
                      {plBusy ? " · loading..." : ""}
                    </>
                  }
                  mono
                />
              </div>

              <div className="md:col-span-2">
                <form onSubmit={addPriceListOverride} className="grid gap-3 border-t border-border-subtle pt-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Effective From</label>
                      <Input value={plEffectiveFrom} onChange={(e) => setPlEffectiveFrom(e.target.value)} type="date" disabled={plBusy} />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Price USD</label>
                      <Input value={plPriceUsd} onChange={(e) => setPlPriceUsd(e.target.value)} placeholder="0" inputMode="decimal" disabled={plBusy} />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Price LL</label>
                      <Input value={plPriceLbp} onChange={(e) => setPlPriceLbp(e.target.value)} placeholder="0" inputMode="decimal" disabled={plBusy} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-fg-subtle">
                      {selectedPriceList ? (
                        <>
                          Writing into <span className="data-mono">{selectedPriceList.code}</span>. Most recent effective row wins.
                        </>
                      ) : (
                        "Pick a list to set a price."
                      )}
                    </div>
                    <Button type="submit" disabled={plBusy || !selectedPriceListId}>
                      {plBusy ? "..." : "Add Price Row"}
                    </Button>
                  </div>

                  <div className="text-xs text-fg-subtle">
                    Recent rows: {plItems.slice(0, 5).map((r) => `${String(r.effective_from).slice(0, 10)}=${Number(r.price_usd || 0).toFixed(2)}`).join(" · ") || "-"}
                  </div>
                </form>
              </div>
            </CardContent>
          </Card>

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
                  <SearchableSelect
                    value={editUom}
                    onChange={setEditUom}
                    disabled={saving}
                    placeholder="Select UOM..."
                    searchPlaceholder="Search UOMs..."
                    options={uomOptions}
                  />
                  <div className="mt-1 text-xs text-fg-subtle">
                    Missing a UOM? Add it in{" "}
                    <Link href="/system/uoms" className="underline underline-offset-2 hover:text-foreground">
                      System &rarr; UOMs
                    </Link>
                    .
                  </div>
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
                <FileInput
                  accept="image/*"
                  disabled={imageUploading || saving}
                  buttonLabel="Choose image"
                  clearAfterSelect
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) uploadImage(f);
                  }}
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
                <div className="md:col-span-4">
                  <div className="relative">
                    <Input value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} placeholder="barcode" className="pr-20 data-mono" />
                    <div className="absolute right-1 top-1 flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 px-0"
                        title="Generate barcode"
                        aria-label="Generate barcode"
                        onClick={generateDraftBarcode}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 px-0"
                        title="Print sticker label"
                        aria-label="Print sticker label"
                        onClick={() => printLabelForBarcode(newBarcode, newBarcodeUom || editUom)}
                        disabled={!newBarcode.trim()}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <SearchableSelect value={newBarcodeUom} onChange={setNewBarcodeUom} searchPlaceholder="UOM..." options={uomOptions} />
                </div>
                <div className="md:col-span-2">
                  <Input value={newFactor} onChange={(e) => setNewFactor(e.target.value)} placeholder="factor" inputMode="decimal" />
                </div>
                <div className="md:col-span-2">
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

              <div className="ui-table-scroll">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Barcode</th>
                      <th className="px-3 py-2">UOM</th>
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
                        <td className="px-3 py-2">
                          <div className="min-w-[10rem]">
                            <SearchableSelect
                              value={String(b.uom_code || editUom || "").trim()}
                              onChange={(v) => updateBarcode(b.id, { uom_code: String(v || "").trim().toUpperCase() || null })}
                              searchPlaceholder="UOM..."
                              options={uomOptions}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          <Input
                            defaultValue={String(b.qty_factor || 1)}
                            inputMode="decimal"
                            onBlur={(e) => {
                              const r = parseNumberInput(e.currentTarget.value);
                              if (!r.ok) return;
                              if (r.value <= 0) return;
                              const prev = toNum(String(b.qty_factor || 1));
                              if (Math.abs(prev - r.value) < 1e-12) return;
                              updateBarcode(b.id, { qty_factor: r.value });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 text-xs text-fg-muted">
                          <Input
                            defaultValue={b.label || ""}
                            placeholder=""
                            onBlur={(e) => {
                              const next = (e.currentTarget.value || "").trim() || null;
                              const prev = (b.label || "").trim() || null;
                              if (next === prev) return;
                              updateBarcode(b.id, { label: next });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 text-xs">{b.is_primary ? "yes" : "no"}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 px-0"
                              title="Print sticker label"
                              aria-label="Print sticker label"
                              onClick={() => printLabelForBarcode(b.barcode, b.uom_code)}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
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
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
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
              <CardTitle>UOM Conversions</CardTitle>
              <CardDescription>
                Define alternate UOMs for this item. Factor means: <span className="font-mono">base_qty = entered_qty * factor</span>. Base UOM is{" "}
                <span className="font-mono">{convBaseUom || editUom || "-"}</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form onSubmit={addConversion} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                <div className="md:col-span-4">
                  <SearchableSelect value={newConvUom} onChange={setNewConvUom} searchPlaceholder="UOM..." options={uomOptions} />
                </div>
                <div className="md:col-span-4">
                  <Input value={newConvFactor} onChange={(e) => setNewConvFactor(e.target.value)} placeholder="factor to base" inputMode="decimal" />
                </div>
                <label className="md:col-span-2 flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={newConvActive} onChange={(e) => setNewConvActive(e.target.checked)} /> Active
                </label>
                <div className="md:col-span-2 flex justify-end">
                  <Button type="submit" variant="outline">
                    Add / Update
                  </Button>
                </div>
              </form>

              <div className="ui-table-scroll">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">UOM</th>
                      <th className="px-3 py-2 text-right">Factor</th>
                      <th className="px-3 py-2">Active</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversions.map((c) => {
                      const isBase = String(c.uom_code || "").trim().toUpperCase() === String(convBaseUom || editUom || "").trim().toUpperCase();
                      return (
                        <tr key={c.uom_code} className="ui-tr-hover">
                          <td className="px-3 py-2 font-mono text-xs">{c.uom_code}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">
                            <Input
                              defaultValue={String(c.to_base_factor || 1)}
                              inputMode="decimal"
                              disabled={isBase}
                              onBlur={(e) => {
                                const r = parseNumberInput(e.currentTarget.value);
                                if (!r.ok) return;
                                if (r.value <= 0) return;
                                const prev = toNum(String(c.to_base_factor || 1));
                                if (Math.abs(prev - r.value) < 1e-12) return;
                                updateConversion(c.uom_code, { to_base_factor: r.value });
                              }}
                            />
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={Boolean(c.is_active)}
                                disabled={isBase}
                                onChange={(e) => updateConversion(c.uom_code, { is_active: e.target.checked })}
                              />
                              {c.is_active ? "yes" : "no"}
                            </label>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {!isBase ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => deleteConversion(c.uom_code)}>
                                Delete
                              </Button>
                            ) : (
                              <span className="text-xs text-fg-subtle">Base</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {conversions.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={4}>
                          No conversions yet.
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

              <div className="ui-table-scroll">
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

          {/* Attachments + audit trail are available via the right-rail utilities drawer. */}
        </>
      ) : null}
    </div>
  );
}
