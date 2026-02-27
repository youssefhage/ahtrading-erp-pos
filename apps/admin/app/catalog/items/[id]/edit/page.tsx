"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Printer, RefreshCw, Trash2, Plus, Save, Loader2, Package } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm } from "@/lib/api";
import { generateEan13Barcode, printBarcodeStickerLabel } from "@/lib/barcode-label";
import { parseNumberInput } from "@/lib/numbers";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { KpiCard } from "@/components/business/kpi-card";
import { EmptyState } from "@/components/business/empty-state";
import { ConfirmDialog } from "@/components/business/confirm-dialog";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { SearchableSelect } from "@/components/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import { FileInput } from "@/components/file-input";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

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
  id: string;
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

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

function parseTags(input: string): string[] | null {
  const parts = (input || "").split(",").map((t) => t.trim()).filter(Boolean);
  const uniq = Array.from(new Set(parts));
  return uniq.length ? uniq : null;
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                            */
/* -------------------------------------------------------------------------- */

export default function ItemEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string>("");

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

  /* ---- Data Loading ---- */
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr("");
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
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /* ---- Price list rows ---- */
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

  useEffect(() => { loadPriceListRows(); }, [loadPriceListRows]);

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

  /* ---- UOM options ---- */
  const uomOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    const cur = String(editUom || "").trim();
    if (cur && !seen.has(cur) && !(uoms || []).includes(cur)) {
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

  const selectedPriceList = useMemo(() => priceLists.find((l) => l.id === selectedPriceListId) || null, [priceLists, selectedPriceListId]);

  /* ---- CRUD operations ---- */

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

  async function hardDeleteItem() {
    if (!item) return;
    const expectedSku = String(item.sku || "").trim();
    if (!expectedSku) return setStatus("This item has no SKU; cannot confirm delete.");
    const typed = window.prompt(`Type SKU to permanently delete this item:\n${expectedSku}`, "");
    if (typed === null) return;
    const confirmSku = String(typed || "").trim();
    if (!confirmSku) return setStatus("Delete cancelled: confirmation SKU is required.");
    if (confirmSku.toUpperCase() !== expectedSku.toUpperCase()) {
      return setStatus(`Delete cancelled: SKU mismatch (expected ${expectedSku}).`);
    }
    const confirmed = window.confirm(`Permanently delete ${expectedSku} (${item.name || "item"})?\nThis cannot be undone.`);
    if (!confirmed) return;
    setSaving(true);
    setStatus("Deleting item permanently...");
    try {
      await apiDelete(`/items/${encodeURIComponent(item.id)}?confirm_sku=${encodeURIComponent(confirmSku)}`);
      router.push("/catalog/items/list");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
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
      const usd = priceSuggest?.suggested?.price_usd ? Number(priceSuggest.suggested.price_usd) : Number(priceSuggest?.current?.price_usd || 0);
      const lbp = priceSuggest?.suggested?.price_lbp ? Number(priceSuggest.suggested.price_lbp) : Number(priceSuggest?.current?.price_lbp || 0);
      const today = new Date().toISOString().slice(0, 10);
      await apiPost(`/items/${encodeURIComponent(item.id)}/prices`, {
        price_usd: usd,
        price_lbp: lbp,
        effective_from: today,
        effective_to: null,
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

  function generateDraftBarcode() { setNewBarcode(generateEan13Barcode()); }

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
    setStatus("Updating conversion...");
    try {
      await apiPatch(`/items/${encodeURIComponent(item.id)}/uom-conversions/${encodeURIComponent(uomCode.trim().toUpperCase())}`, patch);
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteConversion(uomCode: string) {
    if (!item) return;
    setStatus("Deleting conversion...");
    try {
      await apiDelete(`/items/${encodeURIComponent(item.id)}/uom-conversions/${encodeURIComponent(uomCode.trim().toUpperCase())}`);
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

  /* ---- Error ---- */
  if (err) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <PageHeader title="Edit Item" description={id} backHref={`/catalog/items/${encodeURIComponent(id)}`} />
        <Card>
          <CardContent className="py-8">
            <EmptyState
              title="Failed to load item"
              description={err}
              action={{ label: "Retry", onClick: load }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!loading && !item) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <PageHeader title="Item not found" backHref="/catalog/items/list" />
        <Card>
          <CardContent className="py-8">
            <EmptyState icon={Package} title="Item not found" description="This item may have been deleted." action={{ label: "Back", onClick: () => router.push("/catalog/items/list") }} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading && !item) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  if (!item) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <PageHeader
        title={`Edit ${item.sku}`}
        backHref={`/catalog/items/${encodeURIComponent(id)}`}
        badge={<StatusBadge status={item.is_active === false ? "inactive" : "active"} />}
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={saving || loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <DocumentUtilitiesDrawer entityType="item" entityId={id} allowUploadAttachments={true} />
          </>
        }
      >
        <p className="font-mono text-xs text-muted-foreground">{id}</p>
      </PageHeader>

      {status ? (
        <Alert variant={status.startsWith("Saving") || status.startsWith("Deleting") || status.startsWith("Loading") || status.startsWith("Uploading") || status.startsWith("Adding") || status.startsWith("Updating") || status.startsWith("Linking") || status.startsWith("Removing") || status.startsWith("Applying") ? "default" : "destructive"}>
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      ) : null}

      {/* Pricing Card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Pricing</CardTitle>
            <CardDescription>Current margin and suggested sell price</CardDescription>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={applySuggestedPrice}
            disabled={priceBusy || saving || !(priceSuggest?.suggested?.price_usd || priceSuggest?.suggested?.price_lbp)}
          >
            {priceBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Apply Suggested
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Current Price</p>
              <p className="font-mono text-sm font-semibold">
                {priceSuggest?.current ? fmtUsdLbp(priceSuggest.current.price_usd, priceSuggest.current.price_lbp, { sep: " / " }) : "-"}
              </p>
              <p className="text-xs text-muted-foreground">Target margin: {priceSuggest ? `${(Number(priceSuggest.target_margin_pct) * 100).toFixed(0)}%` : "-"}</p>
            </div>
            <div className="space-y-1 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Average Cost</p>
              <p className="font-mono text-sm font-semibold">
                {priceSuggest?.current ? fmtUsdLbp(priceSuggest.current.avg_cost_usd, priceSuggest.current.avg_cost_lbp, { sep: " / " }) : "-"}
              </p>
              <p className="text-xs text-muted-foreground">
                Margin: {priceSuggest?.current?.margin_usd != null ? `${(Number(priceSuggest.current.margin_usd) * 100).toFixed(1)}%` : "-"}
              </p>
            </div>
            <div className="space-y-1 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Suggested Price</p>
              <p className="font-mono text-sm font-semibold">
                {priceSuggest?.suggested ? fmtUsdLbp(priceSuggest.suggested.price_usd, priceSuggest.suggested.price_lbp, { sep: " / " }) : "-"}
              </p>
              <p className="text-xs text-muted-foreground">
                Rounding: USD {priceSuggest?.rounding?.usd_step || "-"} / LBP {priceSuggest?.rounding?.lbp_step || "-"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Price List Override */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Price List Override</CardTitle>
            <CardDescription>Set prices directly on a specific list</CardDescription>
          </div>
          {selectedPriceListId ? (
            <Button variant="outline" size="sm" onClick={() => router.push(`/catalog/price-lists?open=${encodeURIComponent(selectedPriceListId)}`)}>
              Open Price List
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Price List</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={selectedPriceListId} onChange={(e) => setSelectedPriceListId(e.target.value)} disabled={plBusy}>
                <option value="">(pick)</option>
                {priceLists.map((pl) => (
                  <option key={pl.id} value={pl.id}>{pl.code} - {pl.name}{defaultPriceListId && pl.id === defaultPriceListId ? " (default)" : ""}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Current Effective</p>
              <p className="font-mono text-sm font-semibold">{plEffective ? fmtUsdLbp(plEffective.price_usd, plEffective.price_lbp, { sep: " / " }) : "-"}</p>
              <p className="text-xs text-muted-foreground">From: {plEffective?.effective_from ? String(plEffective.effective_from).slice(0, 10) : "-"}{plBusy ? " loading..." : ""}</p>
            </div>
          </div>

          <form onSubmit={addPriceListOverride} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Effective From</Label>
                <Input value={plEffectiveFrom} onChange={(e) => setPlEffectiveFrom(e.target.value)} type="date" disabled={plBusy} />
              </div>
              <div className="space-y-1">
                <Label>Price USD</Label>
                <Input value={plPriceUsd} onChange={(e) => setPlPriceUsd(e.target.value)} placeholder="0" inputMode="decimal" disabled={plBusy} />
              </div>
              <div className="space-y-1">
                <Label>Price LBP</Label>
                <Input value={plPriceLbp} onChange={(e) => setPlPriceLbp(e.target.value)} placeholder="0" inputMode="decimal" disabled={plBusy} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {selectedPriceList ? <>Writing into <span className="font-mono">{selectedPriceList.code}</span>. Most recent effective row wins.</> : "Pick a list to set a price."}
              </p>
              <Button type="submit" size="sm" disabled={plBusy || !selectedPriceListId}>
                {plBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Add Price Row
              </Button>
            </div>
            {plItems.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Recent: {plItems.slice(0, 5).map((r) => `${String(r.effective_from).slice(0, 10)}=$${Number(r.price_usd || 0).toFixed(2)}`).join(", ")}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {/* Core Item Fields */}
      <Card>
        <CardHeader>
          <CardTitle>Item Details</CardTitle>
          <CardDescription>Core fields used by Sales, Purchasing, and Inventory</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-6">
            {/* Identity */}
            <div className="grid gap-4 sm:grid-cols-6">
              <div className="space-y-2 sm:col-span-2">
                <Label>SKU <span className="text-destructive">*</span></Label>
                <Input value={editSku} onChange={(e) => setEditSku(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-2 sm:col-span-4">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={saving} />
              </div>
            </div>

            {/* Type, UOM, Tags */}
            <div className="grid gap-4 sm:grid-cols-6">
              <div className="space-y-2 sm:col-span-2">
                <Label>Type</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={editType} onChange={(e) => setEditType(e.target.value as any)} disabled={saving}>
                  <option value="stocked">Stocked</option>
                  <option value="service">Service</option>
                  <option value="bundle">Bundle</option>
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>UOM <span className="text-destructive">*</span></Label>
                <SearchableSelect value={editUom} onChange={setEditUom} disabled={saving} placeholder="Select UOM..." searchPlaceholder="Search UOMs..." options={uomOptions} />
                <p className="text-xs text-muted-foreground">Missing UOM? Add in <Link href="/system/uoms" className="underline underline-offset-2 hover:text-foreground">System &rarr; UOMs</Link></p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Tags</Label>
                <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="comma-separated" disabled={saving} />
              </div>
            </div>

            {/* Tax & Category */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tax Code</Label>
                <SearchableSelect value={editTaxCodeId} onChange={setEditTaxCodeId} disabled={saving} searchPlaceholder="Search tax codes..." options={[{ value: "", label: "(none)" }, ...taxCodes.map((t) => ({ value: t.id, label: t.name, keywords: String(t.rate ?? "") }))]} />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <SearchableSelect value={editCategoryId} onChange={setEditCategoryId} disabled={saving} searchPlaceholder="Search categories..." options={[{ value: "", label: "(none)" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
              </div>
            </div>

            {/* Brand, Short Name */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Brand</Label>
                <Input value={editBrand} onChange={(e) => setEditBrand(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label>Short Name</Label>
                <Input value={editShortName} onChange={(e) => setEditShortName(e.target.value)} disabled={saving} />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} disabled={saving} rows={3} />
            </div>

            <Separator />

            {/* Reorder */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Reorder Point</Label>
                <Input value={editReorderPoint} onChange={(e) => setEditReorderPoint(e.target.value)} disabled={saving} inputMode="decimal" />
              </div>
              <div className="space-y-2">
                <Label>Reorder Qty</Label>
                <Input value={editReorderQty} onChange={(e) => setEditReorderQty(e.target.value)} disabled={saving} inputMode="decimal" />
              </div>
            </div>

            {/* Toggles */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex items-center gap-3">
                <Switch checked={editTrackBatches} onCheckedChange={setEditTrackBatches} disabled={saving} />
                <Label>Track Batches</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={editTrackExpiry} onCheckedChange={setEditTrackExpiry} disabled={saving} />
                <Label>Track Expiry</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={editActive} onCheckedChange={setEditActive} disabled={saving} />
                <Label>Active</Label>
              </div>
            </div>

            {/* Shelf life */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Shelf Life (days)</Label>
                <Input value={editDefaultShelfLifeDays} onChange={(e) => setEditDefaultShelfLifeDays(e.target.value)} disabled={saving} inputMode="numeric" />
              </div>
              <div className="space-y-2">
                <Label>Min Shelf Life for Sale (days)</Label>
                <Input value={editMinShelfLifeDaysForSale} onChange={(e) => setEditMinShelfLifeDaysForSale(e.target.value)} disabled={saving} inputMode="numeric" />
              </div>
              <div className="space-y-2">
                <Label>Expiry Warning (days)</Label>
                <Input value={editExpiryWarningDays} onChange={(e) => setEditExpiryWarningDays(e.target.value)} disabled={saving} inputMode="numeric" />
              </div>
            </div>

            {/* Negative stock */}
            <div className="space-y-2">
              <Label>Allow Negative Stock</Label>
              <select className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={editAllowNegativeStock === null ? "" : editAllowNegativeStock ? "true" : "false"} onChange={(e) => { const v = e.target.value; if (!v) setEditAllowNegativeStock(null); else setEditAllowNegativeStock(v === "true"); }} disabled={saving}>
                <option value="">(inherit)</option>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </div>

            <Separator />

            {/* Actions */}
            <div className="flex items-center justify-between">
              <Button type="button" variant="destructive" size="sm" onClick={hardDeleteItem} disabled={saving}>
                <Trash2 className="mr-2 h-4 w-4" /> Hard Delete
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Image */}
      <Card>
        <CardHeader>
          <CardTitle>Image</CardTitle>
          <CardDescription>Upload an item image (stored as an attachment)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Alt text</Label>
            <Input value={editImageAlt} onChange={(e) => setEditImageAlt(e.target.value)} disabled={imageUploading || saving} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FileInput accept="image/*" disabled={imageUploading || saving} buttonLabel="Choose image" clearAfterSelect onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) uploadImage(f); }} />
            <Button type="button" variant="outline" size="sm" disabled={imageUploading || saving || !editImageAttachmentId} onClick={removeImage}>Remove</Button>
          </div>
          {editImageAttachmentId ? (
            <p className="text-xs text-muted-foreground">Current: <span className="font-mono">{editImageAttachmentId}</span></p>
          ) : (
            <p className="text-xs text-muted-foreground">No image.</p>
          )}
        </CardContent>
      </Card>

      {/* Barcodes */}
      <Card>
        <CardHeader>
          <CardTitle>Barcodes</CardTitle>
          <CardDescription>Manage primary and alternate barcodes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addBarcode} className="grid gap-3 sm:grid-cols-12">
            <div className="sm:col-span-4">
              <div className="relative">
                <Input value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} placeholder="Barcode" className="pr-20 font-mono" />
                <div className="absolute right-1 top-1 flex items-center gap-0.5">
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Generate barcode" onClick={generateDraftBarcode}><RefreshCw className="h-3.5 w-3.5" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Print label" onClick={() => printLabelForBarcode(newBarcode, newBarcodeUom || editUom)} disabled={!newBarcode.trim()}><Printer className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </div>
            <div className="sm:col-span-2">
              <SearchableSelect value={newBarcodeUom} onChange={setNewBarcodeUom} searchPlaceholder="UOM..." options={uomOptions} />
            </div>
            <div className="sm:col-span-2">
              <Input value={newFactor} onChange={(e) => setNewFactor(e.target.value)} placeholder="Factor" inputMode="decimal" />
            </div>
            <div className="sm:col-span-2">
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label" />
            </div>
            <div className="flex items-center gap-2 sm:col-span-1">
              <Switch checked={newPrimary} onCheckedChange={setNewPrimary} />
              <span className="text-xs">Pri</span>
            </div>
            <div className="flex justify-end sm:col-span-1">
              <Button type="submit" variant="outline" size="sm"><Plus className="h-4 w-4" /></Button>
            </div>
          </form>

          {barcodes.length > 0 ? (
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Barcode</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">UOM</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Factor</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Label</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Primary</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr></thead>
                <tbody>
                  {barcodes.map((b) => (
                    <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs">{b.barcode}</td>
                      <td className="px-3 py-2">
                        <div className="min-w-[8rem]">
                          <SearchableSelect value={String(b.uom_code || editUom || "").trim()} onChange={(v) => updateBarcode(b.id, { uom_code: String(v || "").trim().toUpperCase() || null })} searchPlaceholder="UOM..." options={uomOptions} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input defaultValue={String(b.qty_factor || 1)} inputMode="decimal" className="w-20 text-right font-mono text-xs" onBlur={(e) => { const r = parseNumberInput(e.currentTarget.value); if (!r.ok || r.value <= 0) return; const prev = toNum(String(b.qty_factor || 1)); if (Math.abs(prev - r.value) < 1e-12) return; updateBarcode(b.id, { qty_factor: r.value }); }} />
                      </td>
                      <td className="px-3 py-2">
                        <Input defaultValue={b.label || ""} placeholder="" className="text-xs" onBlur={(e) => { const next = (e.currentTarget.value || "").trim() || null; const prev = (b.label || "").trim() || null; if (next === prev) return; updateBarcode(b.id, { label: next }); }} />
                      </td>
                      <td className="px-3 py-2">{b.is_primary ? <Badge variant="default">Yes</Badge> : <Badge variant="secondary">No</Badge>}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Print" onClick={() => printLabelForBarcode(b.barcode, b.uom_code)}><Printer className="h-3.5 w-3.5" /></Button>
                          {!b.is_primary ? <Button type="button" size="sm" variant="outline" onClick={() => updateBarcode(b.id, { is_primary: true })}>Set Primary</Button> : null}
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteBarcode(b.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">No barcodes.</p>
          )}
        </CardContent>
      </Card>

      {/* UOM Conversions */}
      <Card>
        <CardHeader>
          <CardTitle>UOM Conversions</CardTitle>
          <CardDescription>
            Factor: <span className="font-mono">base_qty = entered_qty * factor</span>. Base UOM: <span className="font-mono">{convBaseUom || editUom || "-"}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addConversion} className="grid gap-3 sm:grid-cols-12">
            <div className="sm:col-span-4">
              <SearchableSelect value={newConvUom} onChange={setNewConvUom} searchPlaceholder="UOM..." options={uomOptions} />
            </div>
            <div className="sm:col-span-4">
              <Input value={newConvFactor} onChange={(e) => setNewConvFactor(e.target.value)} placeholder="Factor" inputMode="decimal" />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch checked={newConvActive} onCheckedChange={setNewConvActive} />
              <span className="text-xs">Active</span>
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" variant="outline" size="sm">Add / Update</Button>
            </div>
          </form>

          {conversions.length > 0 ? (
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">UOM</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Factor</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Active</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr></thead>
                <tbody>
                  {conversions.map((c) => {
                    const isBase = String(c.uom_code || "").trim().toUpperCase() === String(convBaseUom || editUom || "").trim().toUpperCase();
                    return (
                      <tr key={c.uom_code} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs">{c.uom_code}</td>
                        <td className="px-3 py-2 text-right">
                          <Input defaultValue={String(c.to_base_factor || 1)} inputMode="decimal" disabled={isBase} className="w-24 text-right font-mono text-xs" onBlur={(e) => { const r = parseNumberInput(e.currentTarget.value); if (!r.ok || r.value <= 0) return; const prev = toNum(String(c.to_base_factor || 1)); if (Math.abs(prev - r.value) < 1e-12) return; updateConversion(c.uom_code, { to_base_factor: r.value }); }} />
                        </td>
                        <td className="px-3 py-2">
                          <Switch checked={Boolean(c.is_active)} disabled={isBase} onCheckedChange={(v) => updateConversion(c.uom_code, { is_active: v })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {!isBase ? <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteConversion(c.uom_code)}><Trash2 className="h-3.5 w-3.5" /></Button> : <span className="text-xs text-muted-foreground">Base</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">No conversions yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Suppliers */}
      <Card>
        <CardHeader>
          <CardTitle>Suppliers</CardTitle>
          <CardDescription>Link suppliers to this item</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addSupplierLink} className="grid gap-3 sm:grid-cols-12">
            <div className="sm:col-span-4">
              <SearchableSelect value={addSupplierId} onChange={setAddSupplierId} searchPlaceholder="Search suppliers..." options={[{ value: "", label: "Select supplier..." }, ...suppliers.map((s) => ({ value: s.id, label: s.name, keywords: `${s.phone || ""} ${s.email || ""}`.trim() }))]} />
            </div>
            <div className="sm:col-span-2">
              <Input value={addLeadTimeDays} onChange={(e) => setAddLeadTimeDays(e.target.value)} placeholder="Lead days" inputMode="numeric" />
            </div>
            <div className="sm:col-span-2">
              <Input value={addMinOrderQty} onChange={(e) => setAddMinOrderQty(e.target.value)} placeholder="Min qty" inputMode="decimal" />
            </div>
            <div className="sm:col-span-2">
              <Input value={addLastCostUsd} onChange={(e) => setAddLastCostUsd(e.target.value)} placeholder="USD" inputMode="decimal" />
            </div>
            <div className="sm:col-span-2">
              <Input value={addLastCostLbp} onChange={(e) => setAddLastCostLbp(e.target.value)} placeholder="LBP" inputMode="decimal" />
            </div>
            <div className="flex items-center justify-between sm:col-span-12">
              <div className="flex items-center gap-2">
                <Switch checked={addIsPrimary} onCheckedChange={setAddIsPrimary} />
                <span className="text-xs text-muted-foreground">Set as primary</span>
              </div>
              <Button type="submit" variant="outline" size="sm">Link Supplier</Button>
            </div>
          </form>

          {itemLinks.length > 0 ? (
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Supplier</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Primary</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Lead</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Min Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">USD</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">LBP</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr></thead>
                <tbody>
                  {itemLinks.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{l.name}</td>
                      <td className="px-3 py-2">{l.is_primary ? <Badge variant="default">Yes</Badge> : <Badge variant="secondary">No</Badge>}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{l.lead_time_days || 0}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{String(l.min_order_qty || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{String(l.last_cost_usd || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{String(l.last_cost_lbp || 0)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {!l.is_primary ? <Button type="button" size="sm" variant="outline" onClick={() => updateSupplierLink(l.id, { is_primary: true })}>Set Primary</Button> : null}
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteSupplierLink(l.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">No suppliers linked.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
