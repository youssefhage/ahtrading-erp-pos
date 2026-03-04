"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Printer, RefreshCw, Trash2, Plus, Save, Loader2, Package, ChevronDown } from "lucide-react";
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
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";

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
  purchase_uom_code?: string | null;
  sales_uom_code?: string | null;
  case_pack_qty?: string | number | null;
  inner_pack_qty?: string | number | null;
  standard_cost_usd?: string | number | null;
  standard_cost_lbp?: string | number | null;
  min_margin_pct?: string | number | null;
  costing_method?: string | null;
  is_excise?: boolean;
  preferred_supplier_id?: string | null;
  weight?: string | number | null;
  volume?: string | number | null;
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

type PriceByListRow = {
  list_id: string;
  list_code: string;
  list_name: string;
  currency: string;
  is_default: boolean;
  price_usd: string | number | null;
  price_lbp: string | number | null;
  effective_from: string | null;
};

type PriceEditDraft = {
  usd: string;
  lbp: string;
  dirty: boolean;
  saving: boolean;
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

  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams?.get("tab") || "";
    return ["details", "pricing", "units", "suppliers"].includes(t) ? t : "details";
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [priceSuggest, setPriceSuggest] = useState<PriceSuggest | null>(null);
  const [priceBusy, setPriceBusy] = useState(false);

  const [priceLists, setPriceLists] = useState<PriceListRow[]>([]);
  const [defaultPriceListId, setDefaultPriceListId] = useState<string>("");
  const [pricesByList, setPricesByList] = useState<PriceByListRow[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, PriceEditDraft>>({});
  const [priceEffFrom, setPriceEffFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [plBusy, setPlBusy] = useState(false);
  // Keep legacy state for backward compatibility with existing hooks
  const [selectedPriceListId, setSelectedPriceListId] = useState<string>("");

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
  const [editPurchaseUomCode, setEditPurchaseUomCode] = useState("");
  const [editSalesUomCode, setEditSalesUomCode] = useState("");
  const [editCasePackQty, setEditCasePackQty] = useState("");
  const [editInnerPackQty, setEditInnerPackQty] = useState("");
  const [editStandardCostUsd, setEditStandardCostUsd] = useState("");
  const [editStandardCostLbp, setEditStandardCostLbp] = useState("");
  const [editMinMarginPct, setEditMinMarginPct] = useState("");
  const [editCostingMethod, setEditCostingMethod] = useState("");
  const [editIsExcise, setEditIsExcise] = useState(false);
  const [editWeight, setEditWeight] = useState("");
  const [editVolume, setEditVolume] = useState("");
  const [editPreferredSupplier, setEditPreferredSupplier] = useState<SupplierTypeaheadSupplier | null>(null);

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

      // Fetch all prices for this item across all lists (single call)
      const pbl = await apiGet<{ prices: PriceByListRow[] }>(
        `/pricing/items/${encodeURIComponent(id)}/prices-by-list`
      ).catch(() => ({ prices: [] as PriceByListRow[] }));
      const prices = pbl.prices || [];
      setPricesByList(prices);
      // Initialize drafts from current effective prices
      const drafts: Record<string, PriceEditDraft> = {};
      for (const p of prices) {
        drafts[p.list_id] = {
          usd: p.price_usd != null && Number(p.price_usd) > 0 ? String(Number(p.price_usd)) : "",
          lbp: p.price_lbp != null && Number(p.price_lbp) > 0 ? String(Number(p.price_lbp)) : "",
          dirty: false,
          saving: false,
        };
      }
      setPriceDrafts(drafts);

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
        setEditPurchaseUomCode((row.purchase_uom_code as any) || "");
        setEditSalesUomCode((row.sales_uom_code as any) || "");
        setEditCasePackQty(row.case_pack_qty != null ? String(row.case_pack_qty) : "");
        setEditInnerPackQty(row.inner_pack_qty != null ? String(row.inner_pack_qty) : "");
        setEditStandardCostUsd(row.standard_cost_usd != null ? String(row.standard_cost_usd) : "");
        setEditStandardCostLbp(row.standard_cost_lbp != null ? String(row.standard_cost_lbp) : "");
        setEditMinMarginPct(row.min_margin_pct != null ? String(Number(row.min_margin_pct) * 100) : "");
        setEditCostingMethod((row.costing_method as any) || "");
        setEditIsExcise(Boolean(row.is_excise));
        setEditWeight(row.weight != null ? String(row.weight) : "");
        setEditVolume(row.volume != null ? String(row.volume) : "");
        if (row.preferred_supplier_id) {
          const match = (sup.suppliers || []).find((s) => s.id === row.preferred_supplier_id);
          setEditPreferredSupplier(match ? { id: match.id, code: (match as any).code, name: match.name } : { id: row.preferred_supplier_id, name: "(unknown)" });
        } else {
          setEditPreferredSupplier(null);
        }
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

  /* ---- Price list inline editing ---- */
  function updateDraft(listId: string, field: "usd" | "lbp", value: string) {
    setPriceDrafts((prev) => ({
      ...prev,
      [listId]: { ...prev[listId], [field]: value, dirty: true },
    }));
  }

  async function savePriceForList(listId: string) {
    if (!id || !listId) return;
    if (!priceEffFrom) return setStatus("Effective from date is required.");
    const draft = priceDrafts[listId];
    if (!draft) return;
    setPriceDrafts((prev) => ({ ...prev, [listId]: { ...prev[listId], saving: true } }));
    setStatus("");
    try {
      await apiPost(`/pricing/lists/${encodeURIComponent(listId)}/items`, {
        item_id: id,
        price_usd: toNum(draft.usd),
        price_lbp: toNum(draft.lbp),
        effective_from: priceEffFrom,
        effective_to: null,
      });
      // Refresh all prices
      const pbl = await apiGet<{ prices: PriceByListRow[] }>(
        `/pricing/items/${encodeURIComponent(id)}/prices-by-list`
      ).catch(() => ({ prices: [] as PriceByListRow[] }));
      const prices = pbl.prices || [];
      setPricesByList(prices);
      // Reset this draft to new effective values
      const updated = prices.find((p) => p.list_id === listId);
      setPriceDrafts((prev) => ({
        ...prev,
        [listId]: {
          usd: updated?.price_usd != null && Number(updated.price_usd) > 0 ? String(Number(updated.price_usd)) : "",
          lbp: updated?.price_lbp != null && Number(updated.price_lbp) > 0 ? String(Number(updated.price_lbp)) : "",
          dirty: false,
          saving: false,
        },
      }));
      // Also refresh suggested price
      try {
        const ps = await apiGet<PriceSuggest>(`/pricing/items/${encodeURIComponent(id)}/suggested-price`);
        setPriceSuggest(ps || null);
      } catch { /* ignore */ }
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
      setPriceDrafts((prev) => ({ ...prev, [listId]: { ...prev[listId], saving: false } }));
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
    if (!editName.trim()) return setStatus("Name is required.");
    if (!editUom.trim()) return setStatus("UOM is required.");

    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/items/${encodeURIComponent(item.id)}`, {
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
        purchase_uom_code: editPurchaseUomCode || null,
        sales_uom_code: editSalesUomCode || null,
        case_pack_qty: editCasePackQty ? Number(editCasePackQty) : null,
        inner_pack_qty: editInnerPackQty ? Number(editInnerPackQty) : null,
        standard_cost_usd: editStandardCostUsd ? Number(editStandardCostUsd) : null,
        standard_cost_lbp: editStandardCostLbp ? Number(editStandardCostLbp) : null,
        min_margin_pct: editMinMarginPct ? Number(editMinMarginPct) / 100 : null,
        costing_method: editCostingMethod || null,
        is_excise: editIsExcise,
        preferred_supplier_id: editPreferredSupplier?.id || null,
        weight: editWeight ? Number(editWeight) : null,
        volume: editVolume ? Number(editVolume) : null,
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
    // SKU confirmation above is sufficient safety check
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
    const bcUom = (newBarcodeUom || editUom || "").trim().toUpperCase() || null;
    // Auto-derive factor from UOM conversions
    const conv = conversions.find((c) => String(c.uom_code || "").trim().toUpperCase() === bcUom);
    const factor = conv ? toNum(String(conv.to_base_factor || 1)) : 1;
    setStatus("Adding barcode...");
    try {
      await apiPost(`/items/${encodeURIComponent(item.id)}/barcodes`, {
        barcode: code,
        uom_code: bcUom,
        qty_factor: factor,
        label: newLabel.trim() || null,
        is_primary: Boolean(newPrimary),
      });
      setNewBarcode("");
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
    if (!lbpRes.ok) return setStatus("Invalid last cost LBP.");
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

      {/* ================================================================ */}
      {/* TABS                                                              */}
      {/* ================================================================ */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="units">Units & Barcodes</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>

        {/* ============================================================== */}
        {/* DETAILS TAB                                                     */}
        {/* ============================================================== */}
        <TabsContent value="details" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Item Details</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={save} id="item-form" className="space-y-6">
                {/* Identity */}
                <div className="grid gap-4 sm:grid-cols-6">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>SKU</Label>
                    <Input value={editSku} readOnly disabled className="bg-muted cursor-not-allowed" />
                  </div>
                  <div className="space-y-2 sm:col-span-4">
                    <Label>Name <span className="text-destructive">*</span></Label>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={saving} />
                  </div>
                </div>

                {/* Type, Unit, Tags */}
                <div className="grid gap-4 sm:grid-cols-6">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Type</Label>
                    <Select value={editType} onValueChange={(v) => setEditType(v as any)} disabled={saving}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stocked">Stocked</SelectItem>
                        <SelectItem value="service">Service</SelectItem>
                        <SelectItem value="bundle">Bundle</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Unit <span className="text-destructive">*</span></Label>
                    <SearchableSelect value={editUom} onChange={setEditUom} disabled={saving} placeholder="Select unit..." searchPlaceholder="Search units..." options={uomOptions} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Tags</Label>
                    <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="comma-separated" disabled={saving} />
                  </div>
                </div>

                {/* Category, Brand */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <SearchableSelect value={editCategoryId} onChange={setEditCategoryId} disabled={saving} searchPlaceholder="Search categories..." options={[{ value: "", label: "(none)" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
                  </div>
                  <div className="space-y-2">
                    <Label>Brand</Label>
                    <Input value={editBrand} onChange={(e) => setEditBrand(e.target.value)} disabled={saving} />
                  </div>
                </div>

                {/* Tax Code, Active */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tax Code</Label>
                    <SearchableSelect value={editTaxCodeId} onChange={setEditTaxCodeId} disabled={saving} searchPlaceholder="Search tax codes..." options={[{ value: "", label: "(none)" }, ...taxCodes.map((t) => ({ value: t.id, label: t.name, keywords: String(t.rate ?? "") }))]} />
                  </div>
                  <div className="flex items-end pb-1">
                    <div className="flex items-center gap-3">
                      <Switch checked={editActive} onCheckedChange={setEditActive} disabled={saving} />
                      <Label>Active</Label>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} disabled={saving} rows={2} />
                </div>

                {/* Image inline */}
                <Separator />
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Image</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <FileInput accept="image/*" disabled={imageUploading || saving} buttonLabel="Choose image" clearAfterSelect onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) uploadImage(f); }} />
                    <Button type="button" variant="outline" size="sm" disabled={imageUploading || saving || !editImageAttachmentId} onClick={removeImage}>Remove</Button>
                    {editImageAttachmentId ? (
                      <span className="text-xs text-muted-foreground">Uploaded</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No image</span>
                    )}
                  </div>
                </div>

                {/* ── Advanced Settings ── */}
                <Separator />
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="flex w-full items-center justify-between px-0 hover:bg-transparent">
                      <span className="text-sm font-medium">Advanced Settings</span>
                      <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-6 pt-4">
                    {/* Short Name */}
                    <div className="space-y-2">
                      <Label>Short Name</Label>
                      <Input value={editShortName} onChange={(e) => setEditShortName(e.target.value)} disabled={saving} className="max-w-sm" />
                    </div>

                    {/* Inventory */}
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
                      <div className="space-y-2">
                        <Label>Allow Negative Stock</Label>
                        <Select value={editAllowNegativeStock === null ? "default" : editAllowNegativeStock ? "true" : "false"} onValueChange={(v) => { if (v === "default") setEditAllowNegativeStock(null); else setEditAllowNegativeStock(v === "true"); }} disabled={saving}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Use company default</SelectItem>
                            <SelectItem value="false">No</SelectItem>
                            <SelectItem value="true">Yes</SelectItem>
                          </SelectContent>
                        </Select>
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

                    {/* Excise */}
                    <div className="flex items-center gap-3">
                      <Switch checked={editIsExcise} onCheckedChange={setEditIsExcise} disabled={saving} />
                      <Label>Subject to Excise</Label>
                    </div>

                    {/* Packaging */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Purchase Unit</Label>
                        <SearchableSelect value={editPurchaseUomCode} onChange={setEditPurchaseUomCode} disabled={saving} placeholder="Same as base" searchPlaceholder="Search units..." options={[{ value: "", label: "(same as base)" }, ...uomOptions]} />
                      </div>
                      <div className="space-y-2">
                        <Label>Sales Unit</Label>
                        <SearchableSelect value={editSalesUomCode} onChange={setEditSalesUomCode} disabled={saving} placeholder="Same as base" searchPlaceholder="Search units..." options={[{ value: "", label: "(same as base)" }, ...uomOptions]} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Case Pack Qty</Label>
                        <Input type="number" min="0" step="any" value={editCasePackQty} onChange={(e) => setEditCasePackQty(e.target.value)} placeholder="Units per case" disabled={saving} />
                      </div>
                      <div className="space-y-2">
                        <Label>Inner Pack Qty</Label>
                        <Input type="number" min="0" step="any" value={editInnerPackQty} onChange={(e) => setEditInnerPackQty(e.target.value)} placeholder="Units per inner pack" disabled={saving} />
                      </div>
                    </div>

                    {/* Costing & Margins */}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Standard Cost (USD)</Label>
                        <Input type="number" min="0" step="any" value={editStandardCostUsd} onChange={(e) => setEditStandardCostUsd(e.target.value)} placeholder="0.00" disabled={saving} />
                      </div>
                      <div className="space-y-2">
                        <Label>Standard Cost (LBP)</Label>
                        <Input type="number" min="0" step="any" value={editStandardCostLbp} onChange={(e) => setEditStandardCostLbp(e.target.value)} placeholder="0" disabled={saving} />
                      </div>
                      <div className="space-y-2">
                        <Label>Min Margin %</Label>
                        <Input type="number" min="0" max="100" step="0.1" value={editMinMarginPct} onChange={(e) => setEditMinMarginPct(e.target.value)} placeholder="e.g. 20" disabled={saving} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Costing Method</Label>
                      <Select value={editCostingMethod || "default"} onValueChange={(v) => setEditCostingMethod(v === "default" ? "" : v)} disabled={saving}>
                        <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">(company default)</SelectItem>
                          <SelectItem value="avg">Weighted Average</SelectItem>
                          <SelectItem value="fifo">FIFO</SelectItem>
                          <SelectItem value="standard">Standard Cost</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Logistics */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Weight (kg)</Label>
                        <Input type="number" min="0" step="any" value={editWeight} onChange={(e) => setEditWeight(e.target.value)} placeholder="0.00" disabled={saving} />
                      </div>
                      <div className="space-y-2">
                        <Label>Volume (L)</Label>
                        <Input type="number" min="0" step="any" value={editVolume} onChange={(e) => setEditVolume(e.target.value)} placeholder="0.00" disabled={saving} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Preferred Supplier</Label>
                      <SupplierTypeahead
                        value={editPreferredSupplier}
                        onSelect={(s) => setEditPreferredSupplier(s)}
                        onClear={() => setEditPreferredSupplier(null)}
                        disabled={saving}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </form>
            </CardContent>
          </Card>

          {/* Danger Zone — visually separated */}
          <div className="rounded-lg border border-destructive/30 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-destructive">Danger Zone</p>
                <p className="text-xs text-muted-foreground">Permanently delete this item and all its data.</p>
              </div>
              <Button type="button" variant="destructive" size="sm" onClick={hardDeleteItem} disabled={saving}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete Item
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ============================================================== */}
        {/* PRICING TAB                                                     */}
        {/* ============================================================== */}
        <TabsContent value="pricing" className="space-y-6">
          {/* Pricing Summary */}
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

          {/* Set Prices — all lists inline */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle>Set Prices</CardTitle>
                <CardDescription>
                  Edit prices across all lists
                  {item?.unit_of_measure ? <> · per <span className="font-mono font-medium">{item.unit_of_measure}</span></> : null}
                </CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Effective from</Label>
                <Input className="w-[150px] h-8 text-xs" value={priceEffFrom} onChange={(e) => setPriceEffFrom(e.target.value)} type="date" />
              </div>
            </CardHeader>
            <CardContent>
              {pricesByList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No price lists found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="pb-2 pr-3 text-left font-medium">List</th>
                        <th className="pb-2 pr-3 text-right font-medium w-[100px]">Current USD</th>
                        <th className="pb-2 pr-3 text-right font-medium w-[100px]">Current LBP</th>
                        <th className="pb-2 pr-1 text-left font-medium w-[120px]">New USD</th>
                        <th className="pb-2 pr-1 text-left font-medium w-[120px]">New LBP</th>
                        <th className="pb-2 font-medium w-[70px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricesByList.map((p) => {
                        const draft = priceDrafts[p.list_id] || { usd: "", lbp: "", dirty: false, saving: false };
                        return (
                          <tr key={p.list_id} className={cn("border-b last:border-0", p.is_default && "bg-muted/50")}>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-medium">{p.list_code}</span>
                                {p.is_default ? <Badge variant="default" className="text-[10px] px-1.5 py-0">Default</Badge> : null}
                              </div>
                              <p className="text-xs text-muted-foreground">{p.list_name}</p>
                            </td>
                            <td className="py-2 pr-3 text-right font-mono text-xs text-muted-foreground">
                              {p.price_usd != null && Number(p.price_usd) > 0 ? `$${Number(p.price_usd).toFixed(2)}` : "—"}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono text-xs text-muted-foreground">
                              {p.price_lbp != null && Number(p.price_lbp) > 0 ? Number(p.price_lbp).toLocaleString() : "—"}
                            </td>
                            <td className="py-2 pr-1">
                              <Input
                                className="h-8 text-xs font-mono w-[110px]"
                                value={draft.usd}
                                onChange={(e) => updateDraft(p.list_id, "usd", e.target.value)}
                                placeholder="0.00"
                                inputMode="decimal"
                                disabled={draft.saving}
                              />
                            </td>
                            <td className="py-2 pr-1">
                              <Input
                                className="h-8 text-xs font-mono w-[110px]"
                                value={draft.lbp}
                                onChange={(e) => updateDraft(p.list_id, "lbp", e.target.value)}
                                placeholder="0"
                                inputMode="decimal"
                                disabled={draft.saving}
                              />
                            </td>
                            <td className="py-2 text-right">
                              <Button
                                type="button"
                                variant={draft.dirty ? "default" : "outline"}
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => savePriceForList(p.list_id)}
                                disabled={draft.saving || !draft.dirty}
                              >
                                {draft.saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================== */}
        {/* UNITS & BARCODES TAB                                            */}
        {/* ============================================================== */}
        <TabsContent value="units" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Units & Barcodes</CardTitle>
              <CardDescription>
                Define how this item is measured, then assign barcodes. Base unit: <span className="font-semibold">{convBaseUom || editUom || "—"}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* ── Unit Conversions ── */}
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">Unit Conversions</h4>
                  {conversions.length > 0 && <Badge variant="secondary" className="text-xs">{conversions.length}</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  How many <span className="font-semibold">{convBaseUom || editUom || "base"}</span> in 1 of each unit? You can type fractions like <span className="font-mono">1/48</span>.
                </p>
              </div>

              {/* Add conversion — sentence-style */}
              <form onSubmit={addConversion} className="flex flex-wrap items-center gap-2">
                <span className="flex h-9 items-center text-sm text-muted-foreground">1</span>
                <div className="w-32">
                  <SearchableSelect value={newConvUom} onChange={setNewConvUom} searchPlaceholder="Unit..." options={uomOptions} />
                </div>
                <span className="flex h-9 items-center text-sm text-muted-foreground">=</span>
                <Input value={newConvFactor} onChange={(e) => setNewConvFactor(e.target.value)} placeholder="e.g. 48" inputMode="decimal" className="w-24 text-center font-mono" />
                <span className="flex h-9 items-center text-sm font-semibold">{convBaseUom || editUom || "base"}</span>
                <Button type="submit" variant="outline" size="sm"><Plus className="mr-1 h-3.5 w-3.5" />Add</Button>
              </form>

              {/* Existing conversions — card-style rows */}
              {conversions.length > 0 ? (
                <div className="space-y-2">
                  {conversions.map((c) => {
                    const isBase = String(c.uom_code || "").trim().toUpperCase() === String(convBaseUom || editUom || "").trim().toUpperCase();
                    return (
                      <div key={c.uom_code} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                        <span className="whitespace-nowrap font-mono text-sm">1 {c.uom_code} =</span>
                        <Input
                          defaultValue={String(c.to_base_factor || 1)}
                          inputMode="decimal"
                          disabled={isBase}
                          className="w-20 text-center font-mono text-sm"
                          onBlur={(e) => { const r = parseNumberInput(e.currentTarget.value); if (!r.ok || r.value <= 0) return; const prev = toNum(String(c.to_base_factor || 1)); if (Math.abs(prev - r.value) < 1e-12) return; updateConversion(c.uom_code, { to_base_factor: r.value }); }}
                        />
                        <span className="text-sm font-semibold">{convBaseUom || editUom || "base"}</span>
                        <div className="flex-1" />
                        {!isBase && (
                          <div className="flex items-center gap-1.5">
                            <Switch checked={Boolean(c.is_active)} onCheckedChange={(v) => updateConversion(c.uom_code, { is_active: v })} />
                            <span className="text-xs text-muted-foreground">Active</span>
                          </div>
                        )}
                        {isBase ? (
                          <Badge variant="secondary" className="text-xs">Base</Badge>
                        ) : (
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteConversion(c.uom_code)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-3 text-center text-sm text-muted-foreground">No unit conversions yet. Add one above.</p>
              )}

              <Separator />

              {/* ── Barcodes ── */}
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">Barcodes</h4>
                  {barcodes.length > 0 && <Badge variant="secondary" className="text-xs">{barcodes.length}</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Each barcode is linked to a unit. Conversion factors sync automatically from above.
                </p>
              </div>

              {/* Add barcode */}
              <form onSubmit={addBarcode} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px] flex-1">
                    <Input value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} placeholder="Scan or type barcode" className="pr-16 font-mono" />
                    <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Generate EAN-13" onClick={generateDraftBarcode}><RefreshCw className="h-3.5 w-3.5" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Print label" onClick={() => printLabelForBarcode(newBarcode, newBarcodeUom || editUom)} disabled={!newBarcode.trim()}><Printer className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  <div className="w-28">
                    <SearchableSelect value={newBarcodeUom} onChange={setNewBarcodeUom} searchPlaceholder="Unit..." options={uomOptions} />
                  </div>
                  <Button type="submit" variant="outline" size="sm"><Plus className="mr-1 h-3.5 w-3.5" />Add</Button>
                </div>
                <div className="flex flex-wrap items-center gap-3 pl-0.5">
                  <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Optional label (e.g. inner pack)" className="h-8 w-56 text-xs" />
                  <div className="flex items-center gap-1.5">
                    <Switch checked={newPrimary} onCheckedChange={setNewPrimary} />
                    <span className="text-xs text-muted-foreground">Primary</span>
                  </div>
                </div>
              </form>

              {/* Existing barcodes */}
              {barcodes.length > 0 ? (
                <div className="rounded-lg border">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Barcode</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Unit</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Label</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground" />
                    </tr></thead>
                    <tbody>
                      {barcodes.map((b) => (
                        <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs">{b.barcode}</span>
                              {b.is_primary && <Badge variant="default" className="px-1.5 py-0 text-[10px]">Primary</Badge>}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="w-24">
                              <SearchableSelect value={String(b.uom_code || editUom || "").trim()} onChange={(v) => updateBarcode(b.id, { uom_code: String(v || "").trim().toUpperCase() || null })} searchPlaceholder="Unit..." options={uomOptions} />
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Input defaultValue={b.label || ""} placeholder="—" className="h-8 text-xs" onBlur={(e) => { const next = (e.currentTarget.value || "").trim() || null; const prev = (b.label || "").trim() || null; if (next === prev) return; updateBarcode(b.id, { label: next }); }} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Print label" onClick={() => printLabelForBarcode(b.barcode, b.uom_code)}><Printer className="h-3.5 w-3.5" /></Button>
                              {!b.is_primary && <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => updateBarcode(b.id, { is_primary: true })}>Set Primary</Button>}
                              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteBarcode(b.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-3 text-center text-sm text-muted-foreground">No barcodes yet. Scan or add one above.</p>
              )}

            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================== */}
        {/* SUPPLIERS TAB                                                   */}
        {/* ============================================================== */}
        <TabsContent value="suppliers" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Suppliers</CardTitle>
              <CardDescription>Link suppliers to this item with cost and lead time info</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={addSupplierLink} className="space-y-4">
                <div className="space-y-2">
                  <Label>Supplier</Label>
                  <SearchableSelect value={addSupplierId} onChange={setAddSupplierId} searchPlaceholder="Search suppliers..." options={[{ value: "", label: "Select supplier..." }, ...suppliers.map((s) => ({ value: s.id, label: s.name, keywords: `${s.phone || ""} ${s.email || ""}`.trim() }))]} />
                </div>
                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-2">
                    <Label>Lead Time (days)</Label>
                    <Input value={addLeadTimeDays} onChange={(e) => setAddLeadTimeDays(e.target.value)} placeholder="0" inputMode="numeric" />
                  </div>
                  <div className="space-y-2">
                    <Label>Min Order Qty</Label>
                    <Input value={addMinOrderQty} onChange={(e) => setAddMinOrderQty(e.target.value)} placeholder="0" inputMode="decimal" />
                  </div>
                  <div className="space-y-2">
                    <Label>Last Cost (USD)</Label>
                    <Input value={addLastCostUsd} onChange={(e) => setAddLastCostUsd(e.target.value)} placeholder="0.00" inputMode="decimal" />
                  </div>
                  <div className="space-y-2">
                    <Label>Last Cost (LBP)</Label>
                    <Input value={addLastCostLbp} onChange={(e) => setAddLastCostLbp(e.target.value)} placeholder="0" inputMode="decimal" />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch checked={addIsPrimary} onCheckedChange={setAddIsPrimary} />
                    <span className="text-xs text-muted-foreground">Set as primary supplier</span>
                  </div>
                  <Button type="submit" variant="outline" size="sm">Link Supplier</Button>
                </div>
              </form>

              {itemLinks.length > 0 ? (
                <div className="rounded-lg border">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Supplier</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Lead (days)</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Min Qty</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Cost USD</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Cost LBP</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground" />
                    </tr></thead>
                    <tbody>
                      {itemLinks.map((l) => (
                        <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{l.name}</span>
                              {l.is_primary && <Badge variant="default" className="px-1.5 py-0 text-[10px]">Primary</Badge>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{l.lead_time_days || 0}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{String(l.min_order_qty || 0)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{String(l.last_cost_usd || 0)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{String(l.last_cost_lbp || 0)}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              {!l.is_primary ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => updateSupplierLink(l.id, { is_primary: true })}>Set Primary</Button> : null}
                              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteSupplierLink(l.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">No suppliers linked yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ================================================================ */}
      {/* STICKY SAVE BAR                                                   */}
      {/* ================================================================ */}
      <div className="sticky bottom-0 z-10 -mx-6 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-3">
          <Button variant="outline" size="sm" onClick={load} disabled={saving || loading}>Discard Changes</Button>
          <Button type="submit" form="item-form" disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
