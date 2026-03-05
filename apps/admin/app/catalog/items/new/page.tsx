"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, RefreshCw, Loader2, Plus, HelpCircle, Info, AlertTriangle, Trash2 } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { generateEan13Barcode, printBarcodeStickerLabel } from "@/lib/barcode-label";
import { parseNumberInput } from "@/lib/numbers";
import { PageHeader } from "@/components/business/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";
import { useToast } from "@/components/toast-provider";
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
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type TaxCode = { id: string; name: string; rate: string | number };
type Category = { id: string; name: string; parent_id: string | null; is_active: boolean };
type PriceList = { id: string; code: string; name: string; is_default?: boolean };
type CompanySetting = { key: string; value_json: Record<string, unknown> | null };
type ItemLookupRow = {
  id: string;
  sku: string;
  name: string;
  barcode?: string | null;
  barcodes?: Array<{ barcode?: string | null }> | null;
};
type RequiredField = "sku" | "name" | "uom";
type RequiredErrors = Partial<Record<RequiredField, string>>;
type CreateMode = "open" | "addAnother";

/** Local-only conversion row (before item creation) */
type LocalConversion = {
  id: string;
  uom_code: string;
  to_base_factor: number;
  is_active: boolean;
};

/** Local-only barcode row (before item creation) */
type LocalBarcode = {
  id: string;
  barcode: string;
  uom_code: string;
  label: string;
  is_primary: boolean;
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function normalizeToken(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function rowHasBarcode(row: ItemLookupRow | null | undefined, token: string): boolean {
  if (!row || !token) return false;
  if (normalizeToken(row.barcode) === token) return true;
  for (const b of row.barcodes || []) {
    if (normalizeToken(b?.barcode) === token) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function NewItemPage() {
  const router = useRouter();
  const toast = useToast();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  /* ---- Reference data ---- */
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [uoms, setUoms] = useState<string[]>([]);
  const [allPriceLists, setAllPriceLists] = useState<PriceList[]>([]);
  const [defaultPriceList, setDefaultPriceList] = useState<PriceList | null>(null);
  const [selectedPriceListId, setSelectedPriceListId] = useState("");

  /* ---- Essential fields ---- */
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [uom, setUom] = useState("PC");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [active, setActive] = useState(true);

  /* ---- Selling price (added to default price list) ---- */
  const [sellingPriceUsd, setSellingPriceUsd] = useState("");
  const [sellingPriceLbp, setSellingPriceLbp] = useState("");

  /* ---- Classification & Identity ---- */
  const [itemType, setItemType] = useState<"stocked" | "service" | "bundle">("stocked");
  const [brand, setBrand] = useState("");
  const [shortName, setShortName] = useState("");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");

  /* ---- Excise ---- */
  const [isExcise, setIsExcise] = useState(false);

  /* ---- Units & Barcodes (local arrays) ---- */
  const [localConversions, setLocalConversions] = useState<LocalConversion[]>([]);
  const [newConvUom, setNewConvUom] = useState("");
  const [newConvFactor, setNewConvFactor] = useState("1");

  const [localBarcodes, setLocalBarcodes] = useState<LocalBarcode[]>([]);
  const [newBarcode, setNewBarcode] = useState("");
  const [newBarcodeUom, setNewBarcodeUom] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPrimary, setNewPrimary] = useState(false);

  /* ---- Purchase/Sales UOM (item-level fields) ---- */
  const [purchaseUomCode, setPurchaseUomCode] = useState("");
  const [salesUomCode, setSalesUomCode] = useState("");

  /* ---- Packaging ---- */
  const [casePackQty, setCasePackQty] = useState("");
  const [innerPackQty, setInnerPackQty] = useState("");

  /* ---- Costing & Margins ---- */
  const [standardCostUsd, setStandardCostUsd] = useState("");
  const [standardCostLbp, setStandardCostLbp] = useState("");
  const [minMarginPct, setMinMarginPct] = useState("");
  const [costingMethod, setCostingMethod] = useState("default");

  /* ---- Inventory & Shelf Life ---- */
  const [trackBatches, setTrackBatches] = useState(false);
  const [trackExpiry, setTrackExpiry] = useState(false);
  const [allowNegativeStock, setAllowNegativeStock] = useState("inherit");
  const [defaultShelfLifeDays, setDefaultShelfLifeDays] = useState("");
  const [minShelfLifeDaysForSale, setMinShelfLifeDaysForSale] = useState("");
  const [expiryWarningDays, setExpiryWarningDays] = useState("");
  const [reorderPoint, setReorderPoint] = useState("");
  const [reorderQty, setReorderQty] = useState("");

  /* ---- Logistics & Supplier ---- */
  const [weight, setWeight] = useState("");
  const [volume, setVolume] = useState("");
  const [preferredSupplier, setPreferredSupplier] = useState<SupplierTypeaheadSupplier | null>(null);

  /* ---- SKU auto-generation ---- */
  const [skuAutoGenerated, setSkuAutoGenerated] = useState(true);

  /* ---- Form state ---- */
  const [creating, setCreating] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [requiredErrors, setRequiredErrors] = useState<RequiredErrors>({});
  const [skuDuplicate, setSkuDuplicate] = useState<ItemLookupRow | null>(null);
  const [barcodeDuplicate, setBarcodeDuplicate] = useState<ItemLookupRow | null>(null);
  const [checkingDupes, setCheckingDupes] = useState({ sku: false, barcode: false });
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const skuInputRef = useRef<HTMLInputElement | null>(null);

  /* -------------------------------------------------------------------------- */
  /*  Computed values                                                           */
  /* -------------------------------------------------------------------------- */

  const uomOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    const cur = (uom || "").trim();
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
  }, [uoms, uom]);

  /** The primary barcode to send in the item creation POST */
  const primaryBarcode = useMemo(() => {
    const primary = localBarcodes.find((b) => b.is_primary);
    if (primary) return primary.barcode;
    if (localBarcodes.length > 0) return localBarcodes[0].barcode;
    return "";
  }, [localBarcodes]);

  /* -------------------------------------------------------------------------- */
  /*  Data loading                                                              */
  /* -------------------------------------------------------------------------- */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tc, cats, uo, settings, priceLists] = await Promise.all([
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes").catch(() => ({ tax_codes: [] as TaxCode[] })),
        apiGet<{ categories: Category[] }>("/item-categories").catch(() => ({ categories: [] as Category[] })),
        apiGet<{ uoms: string[] }>("/items/uoms?limit=200").catch(() => ({ uoms: [] as string[] })),
        apiGet<{ settings: CompanySetting[] }>("/pricing/company-settings").catch(() => ({ settings: [] as CompanySetting[] })),
        apiGet<{ lists: PriceList[] }>("/pricing/lists").catch(() => ({ lists: [] as PriceList[] })),
      ]);
      setTaxCodes(tc.tax_codes || []);
      setCategories(cats.categories || []);
      setUoms((uo.uoms || []).map((x) => String(x || "").trim()).filter(Boolean));

      // Resolve default price list
      const defaultSetting = (settings.settings || []).find((s) => s.key === "default_price_list_id");
      const defaultId = defaultSetting?.value_json?.id as string | undefined;
      const lists = priceLists.lists || [];
      setAllPriceLists(lists);
      const resolved = defaultId
        ? lists.find((pl) => pl.id === defaultId) || null
        : lists.find((pl) => pl.is_default) || null;
      setDefaultPriceList(resolved);
      if (resolved) setSelectedPriceListId(resolved.id);
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-suggest SKU when category or brand changes (only if at least one is set)
  useEffect(() => {
    if (!skuAutoGenerated) return;
    const brandVal = brand.trim();
    if (!categoryId && !brandVal) {
      setSku("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (categoryId) params.set("category_id", categoryId);
        if (brandVal) params.set("brand", brandVal);
        const res = await apiGet<{ sku: string }>(`/items/suggest-sku?${params.toString()}`);
        if (!cancelled && res.sku) {
          setSku(res.sku);
        }
      } catch {
        // silent — suggestion is best-effort
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [categoryId, brand, skuAutoGenerated]);

  /* -------------------------------------------------------------------------- */
  /*  Validation                                                                */
  /* -------------------------------------------------------------------------- */

  const validateRequired = useCallback(
    (candidate?: { sku?: string; name?: string; uom?: string }): RequiredErrors => {
      const nextSku = (candidate?.sku ?? sku).trim();
      const nextName = (candidate?.name ?? name).trim();
      const nextUom = (candidate?.uom ?? uom).trim();
      const errs: RequiredErrors = {};
      if (!nextSku) errs.sku = "SKU is required.";
      if (!nextName) errs.name = "Name is required.";
      if (!nextUom) errs.uom = "Unit is required.";
      return errs;
    },
    [sku, name, uom]
  );

  const findExactDuplicates = useCallback(async (candidate: { sku?: string; barcode?: string }) => {
    const skuToken = normalizeToken(candidate.sku);
    const barcodeToken = normalizeToken(candidate.barcode);
    const queryTokens = Array.from(new Set([skuToken, barcodeToken].filter(Boolean)));
    if (!queryTokens.length) return { skuMatch: null as ItemLookupRow | null, barcodeMatch: null as ItemLookupRow | null };

    const batches = await Promise.all(
      queryTokens.map(async (token) => {
        const enc = encodeURIComponent(token);
        const res = await apiGet<{ items: ItemLookupRow[] }>(`/items/typeahead?q=${enc}&limit=60&include_inactive=true`).catch(() => ({ items: [] as ItemLookupRow[] }));
        return Array.isArray(res.items) ? res.items : [];
      })
    );

    const byId = new Map<string, ItemLookupRow>();
    for (const list of batches) {
      for (const row of list) {
        const id = String(row?.id || "").trim();
        if (!id) continue;
        byId.set(id, row);
      }
    }
    const rows = Array.from(byId.values());
    const skuMatch = skuToken ? rows.find((row) => normalizeToken(row?.sku) === skuToken) || null : null;
    const barcodeMatch = barcodeToken ? rows.find((row) => rowHasBarcode(row, barcodeToken)) || null : null;
    return { skuMatch, barcodeMatch };
  }, []);

  /* -------------------------------------------------------------------------- */
  /*  Debounced duplicate checks                                                */
  /* -------------------------------------------------------------------------- */

  useEffect(() => {
    if (skuAutoGenerated) { setSkuDuplicate(null); return; }
    const token = sku.trim();
    if (!token) { setSkuDuplicate(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCheckingDupes((prev) => ({ ...prev, sku: true }));
      try {
        const { skuMatch } = await findExactDuplicates({ sku: token });
        if (cancelled) return;
        setSkuDuplicate(skuMatch);
      } finally {
        if (!cancelled) setCheckingDupes((prev) => ({ ...prev, sku: false }));
      }
    }, 280);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sku, skuAutoGenerated, findExactDuplicates]);

  useEffect(() => {
    const token = newBarcode.trim();
    if (!token) { setBarcodeDuplicate(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCheckingDupes((prev) => ({ ...prev, barcode: true }));
      try {
        const { barcodeMatch } = await findExactDuplicates({ barcode: token });
        if (cancelled) return;
        setBarcodeDuplicate(barcodeMatch);
      } finally {
        if (!cancelled) setCheckingDupes((prev) => ({ ...prev, barcode: false }));
      }
    }, 280);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [newBarcode, findExactDuplicates]);

  /* -------------------------------------------------------------------------- */
  /*  Reset helpers                                                             */
  /* -------------------------------------------------------------------------- */

  function resetOptionalFields() {
    setItemType("stocked");
    setBrand("");
    setShortName("");
    setTags("");
    setDescription("");
    setTaxCodeId("");
    setIsExcise(false);
    setSellingPriceUsd("");
    setSellingPriceLbp("");
    if (defaultPriceList) setSelectedPriceListId(defaultPriceList.id);
    // Units & Barcodes
    setLocalConversions([]);
    setLocalBarcodes([]);
    setNewConvUom("");
    setNewConvFactor("1");
    setNewBarcode("");
    setNewBarcodeUom("");
    setNewLabel("");
    setNewPrimary(false);
    setPurchaseUomCode("");
    setSalesUomCode("");
    setCasePackQty("");
    setInnerPackQty("");
    // Costing
    setStandardCostUsd("");
    setStandardCostLbp("");
    setMinMarginPct("");
    setCostingMethod("default");
    // Inventory
    setTrackBatches(false);
    setTrackExpiry(false);
    setAllowNegativeStock("inherit");
    setDefaultShelfLifeDays("");
    setMinShelfLifeDaysForSale("");
    setExpiryWarningDays("");
    setReorderPoint("");
    setReorderQty("");
    setWeight("");
    setVolume("");
    setPreferredSupplier(null);
  }

  /* -------------------------------------------------------------------------- */
  /*  Local conversion handlers                                                 */
  /* -------------------------------------------------------------------------- */

  function addLocalConversion(e: React.FormEvent) {
    e.preventDefault();
    const u = (newConvUom || "").trim().toUpperCase();
    if (!u) return setStatus("Select a unit for the conversion.");
    if (u === uom.trim().toUpperCase()) return setStatus("Cannot add a conversion for the base unit — it's already shown.");
    if (localConversions.some((c) => c.uom_code === u)) return setStatus(`Conversion for ${u} already exists.`);
    const f = parseNumberInput(newConvFactor);
    if (!f.ok) return setStatus("Invalid conversion factor. You can type fractions like 1/48.");
    if (f.value <= 0) return setStatus("Conversion factor must be greater than 0.");
    setLocalConversions((prev) => [...prev, {
      id: crypto.randomUUID(),
      uom_code: u,
      to_base_factor: f.value,
      is_active: true,
    }]);
    setNewConvUom("");
    setNewConvFactor("1");
    setStatus("");
  }

  function updateLocalConversion(id: string, patch: Partial<LocalConversion>) {
    setLocalConversions((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
  }

  function deleteLocalConversion(id: string) {
    const conv = localConversions.find((c) => c.id === id);
    if (conv) {
      if (purchaseUomCode === conv.uom_code) setPurchaseUomCode("");
      if (salesUomCode === conv.uom_code) setSalesUomCode("");
    }
    setLocalConversions((prev) => prev.filter((c) => c.id !== id));
  }

  /* -------------------------------------------------------------------------- */
  /*  Local barcode handlers                                                    */
  /* -------------------------------------------------------------------------- */

  function addLocalBarcode(e: React.FormEvent) {
    e.preventDefault();
    const code = (newBarcode || "").trim();
    if (!code) return setStatus("Barcode is required.");
    if (localBarcodes.some((b) => b.barcode === code)) return setStatus("This barcode is already in the list.");
    if (barcodeDuplicate) return setStatus("This barcode already exists in another item.");
    const bcUom = (newBarcodeUom || uom || "").trim().toUpperCase();
    const isPrimary = newPrimary || localBarcodes.length === 0;
    setLocalBarcodes((prev) => {
      let next = [...prev];
      if (isPrimary) {
        next = next.map((b) => ({ ...b, is_primary: false }));
      }
      next.push({
        id: crypto.randomUUID(),
        barcode: code,
        uom_code: bcUom,
        label: (newLabel || "").trim(),
        is_primary: isPrimary,
      });
      return next;
    });
    setNewBarcode("");
    setNewBarcodeUom("");
    setNewLabel("");
    setNewPrimary(false);
    setBarcodeDuplicate(null);
    setStatus("");
  }

  function updateLocalBarcode(id: string, patch: Partial<LocalBarcode>) {
    setLocalBarcodes((prev) => {
      let next = prev.map((b) => b.id === id ? { ...b, ...patch } : b);
      if (patch.is_primary) {
        next = next.map((b) => b.id === id ? b : { ...b, is_primary: false });
      }
      return next;
    });
  }

  function deleteLocalBarcode(id: string) {
    setLocalBarcodes((prev) => {
      const next = prev.filter((b) => b.id !== id);
      if (next.length > 0 && !next.some((b) => b.is_primary)) {
        next[0] = { ...next[0], is_primary: true };
      }
      return next;
    });
  }

  function generateDraftBarcode() {
    setNewBarcode(generateEan13Barcode());
  }

  async function printLabelForBarcode(code: string, barcodeUom?: string | null) {
    const bc = String(code || "").trim();
    if (!bc) return setStatus("Enter or generate a barcode first.");
    try {
      await printBarcodeStickerLabel({
        barcode: bc,
        sku: sku.trim() || null,
        name: name.trim() || null,
        uom: String(barcodeUom || uom || "").trim() || null,
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  /* -------------------------------------------------------------------------- */
  /*  Submit                                                                    */
  /* -------------------------------------------------------------------------- */

  async function submitCreate(mode: CreateMode) {
    const nextSku = sku.trim();
    const nextName = name.trim();
    const nextUom = uom.trim();
    const nextBarcode = primaryBarcode.trim();

    setSubmitAttempted(true);
    const errs = validateRequired({ sku: skuAutoGenerated ? "auto" : nextSku, name: nextName, uom: nextUom });
    setRequiredErrors(errs);
    if (Object.keys(errs).length > 0) {
      setStatus("Please fix the highlighted fields.");
      return;
    }

    setCreating(true);
    setStatus("");
    try {
      // Duplicate check — SKU
      if (!skuAutoGenerated && nextSku) {
        const { skuMatch } = await findExactDuplicates({ sku: nextSku });
        setSkuDuplicate(skuMatch);
        if (skuMatch) {
          setStatus("SKU already exists. Open the existing item from the field hints.");
          return;
        }
      }
      // Duplicate check — all barcodes
      const allBarcodeValues = localBarcodes.map((b) => b.barcode.trim()).filter(Boolean);
      for (const bc of allBarcodeValues) {
        const { barcodeMatch } = await findExactDuplicates({ barcode: bc });
        if (barcodeMatch) {
          setBarcodeDuplicate(barcodeMatch);
          setStatus(`Barcode "${bc}" already exists in another item.`);
          return;
        }
      }

      const parsedTags = tags.trim()
        ? Array.from(new Set(tags.split(",").map((t) => t.trim()).filter(Boolean)))
        : null;

      const res = await apiPost<{ id: string; sku?: string }>("/items", {
        sku: skuAutoGenerated ? "" : nextSku,
        name: nextName,
        unit_of_measure: nextUom,
        barcode: nextBarcode || null,
        tax_code_id: taxCodeId || null,
        category_id: categoryId || null,
        is_active: active,
        // Classification & Identity
        item_type: itemType,
        brand: brand.trim() || null,
        short_name: shortName.trim() || null,
        tags: parsedTags,
        description: description.trim() || null,
        // Excise
        is_excise: isExcise,
        // UOM & Packaging
        purchase_uom_code: purchaseUomCode || null,
        sales_uom_code: salesUomCode || null,
        case_pack_qty: casePackQty ? Number(casePackQty) : null,
        inner_pack_qty: innerPackQty ? Number(innerPackQty) : null,
        // Costing & Margins
        standard_cost_usd: standardCostUsd ? Number(standardCostUsd) : null,
        standard_cost_lbp: standardCostLbp ? Number(standardCostLbp) : null,
        min_margin_pct: minMarginPct ? Number(minMarginPct) / 100 : null,
        costing_method: costingMethod && costingMethod !== "default" ? costingMethod : null,
        // Inventory & Shelf Life
        track_batches: trackBatches,
        track_expiry: trackExpiry,
        allow_negative_stock: allowNegativeStock === "inherit" ? null : allowNegativeStock === "allowed",
        default_shelf_life_days: defaultShelfLifeDays ? Number(defaultShelfLifeDays) : null,
        min_shelf_life_days_for_sale: minShelfLifeDaysForSale ? Number(minShelfLifeDaysForSale) : null,
        expiry_warning_days: expiryWarningDays ? Number(expiryWarningDays) : null,
        reorder_point: reorderPoint ? Number(reorderPoint) : null,
        reorder_qty: reorderQty ? Number(reorderQty) : null,
        // Logistics & Supplier
        weight: weight ? Number(weight) : null,
        volume: volume ? Number(volume) : null,
        preferred_supplier_id: preferredSupplier?.id || null,
      });

      // Post-creation: create UOM conversions
      const conversionPromises = localConversions.map((c) =>
        apiPost(`/items/${encodeURIComponent(res.id)}/uom-conversions`, {
          uom_code: c.uom_code,
          to_base_factor: c.to_base_factor,
          is_active: c.is_active,
        }).catch(() => { /* best-effort — user can fix on edit page */ })
      );
      if (conversionPromises.length) await Promise.all(conversionPromises);

      // Post-creation: create additional barcodes (primary was already created by POST /items)
      const additionalBarcodes = localBarcodes.filter((b) => b.barcode.trim() !== nextBarcode);
      const barcodePromises = additionalBarcodes.map((b) => {
        const conv = localConversions.find(
          (c) => c.uom_code.toUpperCase() === (b.uom_code || "").toUpperCase()
        );
        const qtyFactor = conv ? conv.to_base_factor : 1;
        return apiPost(`/items/${encodeURIComponent(res.id)}/barcodes`, {
          barcode: b.barcode,
          uom_code: b.uom_code || null,
          qty_factor: qtyFactor,
          label: b.label || null,
          is_primary: b.is_primary,
        }).catch(() => { /* best-effort */ });
      });
      if (barcodePromises.length) await Promise.all(barcodePromises);

      // Post-creation: add selling price to price list
      const priceListTarget = selectedPriceListId || defaultPriceList?.id;
      if (priceListTarget && (sellingPriceUsd || sellingPriceLbp)) {
        const today = new Date().toISOString().slice(0, 10);
        await apiPost(`/pricing/lists/${encodeURIComponent(priceListTarget)}/items`, {
          item_id: res.id,
          price_usd: Number(sellingPriceUsd || 0),
          price_lbp: Number(sellingPriceLbp || 0),
          effective_from: today,
        }).catch(() => { /* best-effort */ });
      }

      if (mode === "addAnother") {
        setSku("");
        setName("");
        setCategoryId("");
        setBrand("");
        setSubmitAttempted(false);
        setRequiredErrors({});
        setSkuDuplicate(null);
        setBarcodeDuplicate(null);
        setStatus("");
        setSkuAutoGenerated(true);
        resetOptionalFields();
        const skuLabel = res.sku ? ` (${res.sku})` : "";
        toast.success("Item created" + skuLabel, "Ready for the next item.");
        window.requestAnimationFrame(() => nameInputRef.current?.focus());
        return;
      }

      setStatus("");
      router.push(`/catalog/items/${encodeURIComponent(res.id)}`);
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setCreating(false);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*  Derived UI state                                                          */
  /* -------------------------------------------------------------------------- */

  const skuError = !skuAutoGenerated ? (requiredErrors.sku || (skuDuplicate ? "SKU already exists." : "")) : "";
  const nameError = requiredErrors.name || "";
  const uomError = requiredErrors.uom || "";
  const barcodeError = barcodeDuplicate ? "Barcode already exists." : "";
  const requiredFilled = (skuAutoGenerated || !!sku.trim()) && !!name.trim() && !!uom.trim();
  const hasErrors = !!skuError || !!nameError || !!uomError;
  const hasPendingChecks = checkingDupes.sku || checkingDupes.barcode;
  const submitDisabled = creating || loading || !requiredFilled || hasErrors || hasPendingChecks;

  /* -------------------------------------------------------------------------- */
  /*  Render                                                                    */
  /* -------------------------------------------------------------------------- */

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <PageHeader
          title="New Item"
          description="Create a catalog item"
          backHref="/catalog/items/list"
        />

        {status ? (
          <Alert variant="destructive">
            <AlertDescription>{status}</AlertDescription>
          </Alert>
        ) : null}

        <form
          id="new-item-form"
          onSubmit={(e) => { e.preventDefault(); void submitCreate("open"); }}
          className="space-y-6"
        >
          {/* ================================================================ */}
          {/* ESSENTIALS CARD                                                  */}
          {/* ================================================================ */}
          <Card>
            <CardHeader>
              <CardTitle>Item Details</CardTitle>
              <CardDescription>Fill in the basics to create a catalog item</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* ---- Name (first & most important) ---- */}
              <div className="space-y-2">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input
                  ref={nameInputRef}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!submitAttempted) return;
                    setRequiredErrors((prev) => {
                      const next = { ...prev };
                      if (e.target.value.trim()) delete next.name; else next.name = "Name is required.";
                      return next;
                    });
                  }}
                  onBlur={() => {
                    setSubmitAttempted(true);
                    setRequiredErrors((prev) => {
                      const next = { ...prev };
                      if (name.trim()) delete next.name; else next.name = "Name is required.";
                      return next;
                    });
                  }}
                  placeholder="Item name"
                  autoFocus
                  disabled={creating || loading}
                  className={nameError ? "border-destructive focus-visible:ring-destructive" : ""}
                  aria-invalid={nameError ? true : undefined}
                />
                {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
              </div>

              {/* ---- Unit of Measure ---- */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Unit of Measure <span className="text-destructive">*</span></Label>
                  <SearchableSelect
                    value={uom}
                    onChange={(value) => {
                      setUom(value);
                      if (!submitAttempted) return;
                      setRequiredErrors((prev) => {
                        const next = { ...prev };
                        if (String(value || "").trim()) delete next.uom; else next.uom = "Unit is required.";
                        return next;
                      });
                    }}
                    disabled={creating || loading}
                    placeholder="Select unit..."
                    searchPlaceholder="Search units..."
                    options={(uoms || []).map((x) => ({ value: x, label: x }))}
                  />
                  {uomError ? <p className="text-xs text-destructive">{uomError}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    PC = Piece, KG = Kilogram, BOX = Box.{" "}
                    <Link href="/system/uoms" className="underline underline-offset-2 hover:text-foreground">Manage units</Link>
                  </p>
                </div>
              </div>

              {/* ---- Category + Brand ---- */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <SearchableSelect
                    value={categoryId}
                    onChange={setCategoryId}
                    disabled={creating || loading}
                    searchPlaceholder="Search categories..."
                    options={[
                      { value: "", label: "(none)" },
                      ...categories.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Brand</Label>
                  <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" disabled={creating || loading} />
                </div>
              </div>

              {/* ---- Tax Code ---- */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tax Code</Label>
                  <SearchableSelect
                    value={taxCodeId}
                    onChange={setTaxCodeId}
                    disabled={creating || loading}
                    searchPlaceholder="Search tax codes..."
                    options={[
                      { value: "", label: "(none)" },
                      ...taxCodes.map((t) => ({ value: t.id, label: t.name, keywords: String(t.rate ?? "") })),
                    ]}
                  />
                </div>
              </div>

              {/* ---- Selling Price ---- */}
              <Separator />
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Selling Price</p>
                  {allPriceLists.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>Add to price list:</span>
                      {allPriceLists.length === 1 ? (
                        <span className="font-medium text-foreground">{allPriceLists[0].name}</span>
                      ) : (
                        <SearchableSelect
                          value={selectedPriceListId}
                          onChange={setSelectedPriceListId}
                          disabled={creating || loading}
                          placeholder="Select price list..."
                          searchPlaceholder="Search price lists..."
                          controlClassName="h-7 w-[180px] rounded-md border border-input bg-background px-2 text-xs"
                          options={allPriceLists.map((pl) => ({
                            value: pl.id,
                            label: pl.name + (pl.id === defaultPriceList?.id ? " (default)" : ""),
                          }))}
                        />
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No price lists found.{" "}
                      <Link href="/catalog/price-lists" className="underline underline-offset-2 hover:text-foreground">Create one</Link>{" "}
                      to set selling prices.
                    </p>
                  )}
                </div>
                {(allPriceLists.length > 0) ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Price (USD)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={sellingPriceUsd}
                        onChange={(e) => setSellingPriceUsd(e.target.value)}
                        placeholder="0.00"
                        disabled={creating || loading}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Price (LBP)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={sellingPriceLbp}
                        onChange={(e) => setSellingPriceLbp(e.target.value)}
                        placeholder="0"
                        disabled={creating || loading}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* ---- SKU Section ---- */}
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={skuAutoGenerated}
                    onCheckedChange={(checked) => {
                      setSkuAutoGenerated(checked);
                      if (checked) {
                        setSkuDuplicate(null);
                        setRequiredErrors((prev) => {
                          const next = { ...prev };
                          delete next.sku;
                          return next;
                        });
                      } else {
                        window.requestAnimationFrame(() => skuInputRef.current?.focus());
                      }
                    }}
                    disabled={creating || loading}
                  />
                  <Label className="font-medium">Auto-generate SKU</Label>
                </div>

                {skuAutoGenerated ? (
                  <div className="rounded-md bg-muted/50 px-3 py-2">
                    {sku ? (
                      <p className="text-sm text-muted-foreground">
                        Preview: <span className="font-mono font-medium text-foreground">{sku}</span>
                        <span className="ml-2 text-xs">Based on category &amp; brand</span>
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        SKU will be assigned on save.
                        {!categoryId && !brand.trim() ? " Set a category or brand for a meaningful SKU." : ""}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Input
                      ref={skuInputRef}
                      value={sku}
                      onChange={(e) => {
                        setSku(e.target.value);
                        if (!submitAttempted) return;
                        setRequiredErrors((prev) => {
                          const next = { ...prev };
                          if (e.target.value.trim()) delete next.sku; else next.sku = "SKU is required.";
                          return next;
                        });
                      }}
                      onBlur={() => {
                        if (submitAttempted) {
                          setRequiredErrors((prev) => {
                            const next = { ...prev };
                            if (sku.trim()) delete next.sku; else next.sku = "SKU is required.";
                            return next;
                          });
                        }
                      }}
                      placeholder="Enter SKU"
                      disabled={creating || loading}
                      className={skuError ? "border-destructive focus-visible:ring-destructive" : ""}
                      aria-invalid={skuError ? true : undefined}
                    />
                    {checkingDupes.sku && !skuError ? <p className="text-xs text-muted-foreground">Checking SKU...</p> : null}
                    {skuError ? (
                      <p className="text-xs text-destructive">
                        {skuError}{" "}
                        {skuDuplicate ? (
                          <Link href={`/catalog/items/${encodeURIComponent(skuDuplicate.id)}`} className="underline underline-offset-2">Open existing</Link>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              {/* ---- Active & Excise toggles ---- */}
              <Separator />
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <Switch checked={active} onCheckedChange={setActive} disabled={creating || loading} />
                  <Label>Active</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={isExcise} onCheckedChange={setIsExcise} disabled={creating || loading} />
                  <Label className="flex items-center gap-1.5">
                    Subject to Excise
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Items subject to government excise duties (e.g. tobacco, alcohol)</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ================================================================ */}
          {/* UNITS & BARCODES CARD                                            */}
          {/* ================================================================ */}
          <Card>
            <CardHeader>
              <CardTitle>Units & Barcodes</CardTitle>
              <CardDescription>
                Define how this item is measured, then assign barcodes. Base unit: <span className="font-semibold">{uom || "—"}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* ── Unit Conversions ── */}
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">Unit Conversions</h4>
                  {localConversions.length > 0 && <Badge variant="secondary" className="text-xs">{localConversions.length}</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  How many <span className="font-semibold">{uom || "base"}</span> in 1 of each unit? You can type fractions like <span className="font-mono">1/48</span>.
                </p>
              </div>

              {/* Add conversion — sentence-style */}
              <form onSubmit={addLocalConversion} className="flex flex-wrap items-center gap-2">
                <span className="flex h-9 items-center text-sm text-muted-foreground">1</span>
                <div className="w-32">
                  <SearchableSelect value={newConvUom} onChange={setNewConvUom} searchPlaceholder="Unit..." options={uomOptions} />
                </div>
                <span className="flex h-9 items-center text-sm text-muted-foreground">=</span>
                <Input
                  value={newConvFactor}
                  onChange={(e) => setNewConvFactor(e.target.value)}
                  placeholder="e.g. 48"
                  inputMode="decimal"
                  className="w-24 text-center font-mono"
                />
                <span className="flex h-9 items-center text-sm font-semibold">{uom || "base"}</span>
                <Button type="submit" variant="outline" size="sm" disabled={creating || loading}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Add
                </Button>
              </form>

              {/* Base UOM row (always shown) + local conversions */}
              <div className="space-y-2">
                {/* Base UOM row — always present, not editable */}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="whitespace-nowrap font-mono text-sm">1 {uom || "BASE"} =</span>
                  <Input value="1" disabled className="w-20 text-center font-mono text-sm" />
                  <span className="text-sm font-semibold">{uom || "base"}</span>
                  <div className="flex-1" />
                  <Badge variant="secondary" className="text-xs">Base</Badge>
                </div>

                {/* Local conversions */}
                {localConversions.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                    <span className="whitespace-nowrap font-mono text-sm">1 {c.uom_code} =</span>
                    <Input
                      defaultValue={String(c.to_base_factor)}
                      inputMode="decimal"
                      className="w-20 text-center font-mono text-sm"
                      onBlur={(e) => {
                        const r = parseNumberInput(e.currentTarget.value);
                        if (!r.ok || r.value <= 0) return;
                        if (Math.abs(c.to_base_factor - r.value) < 1e-12) return;
                        updateLocalConversion(c.id, { to_base_factor: r.value });
                      }}
                    />
                    <span className="text-sm font-semibold">{uom || "base"}</span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-1.5">
                      <Switch checked={c.is_active} onCheckedChange={(v) => updateLocalConversion(c.id, { is_active: v })} />
                      <span className="text-xs text-muted-foreground">Active</span>
                    </div>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteLocalConversion(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}

                {localConversions.length === 0 && (
                  <p className="py-3 text-center text-sm text-muted-foreground">No unit conversions yet. Add one above.</p>
                )}
              </div>

              <Separator />

              {/* ── Barcodes ── */}
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">Barcodes</h4>
                  {localBarcodes.length > 0 && <Badge variant="secondary" className="text-xs">{localBarcodes.length}</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Each barcode is linked to a unit. Conversion factors sync automatically from above.
                </p>
              </div>

              {/* Add barcode form */}
              <form onSubmit={addLocalBarcode} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px] flex-1">
                    <Input
                      value={newBarcode}
                      onChange={(e) => setNewBarcode(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                      placeholder="Scan or type barcode"
                      className="pr-16 font-mono"
                      disabled={creating || loading}
                    />
                    <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Generate EAN-13" onClick={generateDraftBarcode} disabled={creating || loading}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Print label" onClick={() => printLabelForBarcode(newBarcode, newBarcodeUom || uom)} disabled={!newBarcode.trim() || creating || loading}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="w-28">
                    <SearchableSelect value={newBarcodeUom} onChange={setNewBarcodeUom} searchPlaceholder="Unit..." options={uomOptions} />
                  </div>
                  <Button type="submit" variant="outline" size="sm" disabled={creating || loading}>
                    <Plus className="mr-1 h-3.5 w-3.5" />Add
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3 pl-0.5">
                  <Input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Optional label (e.g. inner pack)"
                    className="h-8 w-56 text-xs"
                    disabled={creating || loading}
                  />
                  <div className="flex items-center gap-1.5">
                    <Switch checked={newPrimary} onCheckedChange={setNewPrimary} disabled={creating || loading} />
                    <span className="text-xs text-muted-foreground">Primary</span>
                  </div>
                </div>
                {checkingDupes.barcode && !barcodeError ? <p className="text-xs text-muted-foreground">Checking barcode...</p> : null}
                {barcodeError ? (
                  <p className="text-xs text-destructive">
                    {barcodeError}{" "}
                    {barcodeDuplicate ? (
                      <Link href={`/catalog/items/${encodeURIComponent(barcodeDuplicate.id)}`} className="underline underline-offset-2">Open existing</Link>
                    ) : null}
                  </p>
                ) : null}
              </form>

              {/* Existing local barcodes table */}
              {localBarcodes.length > 0 ? (
                <div className="rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Barcode</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Unit</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Label</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground" />
                      </tr>
                    </thead>
                    <tbody>
                      {localBarcodes.map((b) => (
                        <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs">{b.barcode}</span>
                              {b.is_primary && <Badge variant="default" className="px-1.5 py-0 text-[10px]">Primary</Badge>}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="w-24">
                              <SearchableSelect
                                value={b.uom_code}
                                onChange={(v) => updateLocalBarcode(b.id, { uom_code: String(v || "").trim().toUpperCase() })}
                                searchPlaceholder="Unit..."
                                options={uomOptions}
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              defaultValue={b.label || ""}
                              placeholder="—"
                              className="h-8 text-xs"
                              onBlur={(e) => {
                                const next = (e.currentTarget.value || "").trim();
                                if (next === (b.label || "")) return;
                                updateLocalBarcode(b.id, { label: next });
                              }}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Print label" onClick={() => printLabelForBarcode(b.barcode, b.uom_code)}>
                                <Printer className="h-3.5 w-3.5" />
                              </Button>
                              {!b.is_primary && (
                                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => updateLocalBarcode(b.id, { is_primary: true })}>
                                  Set Primary
                                </Button>
                              )}
                              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteLocalBarcode(b.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
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

          {/* ================================================================ */}
          {/* OPTIONAL SECTIONS - Collapsible accordion (3 sections)           */}
          {/* ================================================================ */}
          <Card>
            <CardHeader>
              <CardTitle>Additional Options</CardTitle>
              <CardDescription>Expand sections below to configure more details</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="multiple" className="w-full">

                {/* ---- Classification ---- */}
                <AccordionItem value="classification">
                  <AccordionTrigger>Classification</AccordionTrigger>
                  <AccordionContent className="space-y-4 px-1 pt-2">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Item Type</Label>
                        <Select value={itemType} onValueChange={(v) => setItemType(v as typeof itemType)} disabled={creating || loading}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="stocked">Stocked</SelectItem>
                            <SelectItem value="service">Service</SelectItem>
                            <SelectItem value="bundle">Bundle</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Short Name</Label>
                        <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Short display name" disabled={creating || loading} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Tags</Label>
                      <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tag1, tag2, tag3" disabled={creating || loading} />
                      <p className="text-xs text-muted-foreground">Comma-separated list of tags</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Item description..."
                        rows={3}
                        disabled={creating || loading}
                      />
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* ---- Cost Defaults ---- */}
                <AccordionItem value="costing">
                  <AccordionTrigger>Cost Defaults</AccordionTrigger>
                  <AccordionContent className="space-y-4 px-1 pt-2">
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        These are <span className="font-medium">cost</span> defaults (what you pay), not selling prices (what customers pay).
                        Use the Selling Price fields above to set your customer-facing price.
                      </AlertDescription>
                    </Alert>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Cost Price (USD)</Label>
                        <Input type="number" min="0" step="any" value={standardCostUsd} onChange={(e) => setStandardCostUsd(e.target.value)} placeholder="0.00" disabled={creating || loading} />
                      </div>
                      <div className="space-y-2">
                        <Label>Cost Price (LBP)</Label>
                        <Input type="number" min="0" step="any" value={standardCostLbp} onChange={(e) => setStandardCostLbp(e.target.value)} placeholder="0" disabled={creating || loading} />
                      </div>
                      <div className="space-y-2">
                        <Label>Min Margin %</Label>
                        <Input type="number" min="0" max="100" step="0.1" value={minMarginPct} onChange={(e) => setMinMarginPct(e.target.value)} placeholder="e.g. 20" disabled={creating || loading} />
                        <p className="text-xs text-muted-foreground">Minimum margin percentage</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Costing Method</Label>
                      <Select value={costingMethod} onValueChange={setCostingMethod} disabled={creating || loading}>
                        <SelectTrigger className="w-full sm:w-[200px]">
                          <SelectValue placeholder="(company default)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">(company default)</SelectItem>
                          <SelectItem value="avg">Weighted Average</SelectItem>
                          <SelectItem value="fifo">FIFO</SelectItem>
                          <SelectItem value="standard">Standard Cost</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* ---- Inventory & Logistics ---- */}
                <AccordionItem value="inventory">
                  <AccordionTrigger>Inventory &amp; Logistics</AccordionTrigger>
                  <AccordionContent className="space-y-4 px-1 pt-2">

                    {/* ---- Packaging ---- */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Purchase Unit</Label>
                        <SearchableSelect
                          value={purchaseUomCode}
                          onChange={setPurchaseUomCode}
                          disabled={creating || loading}
                          placeholder={`Same as ${uom || "PC"}`}
                          searchPlaceholder="Search units..."
                          options={[
                            { value: "", label: `(same as ${uom || "PC"})` },
                            ...localConversions.map((c) => ({ value: c.uom_code, label: c.uom_code })),
                          ]}
                        />
                        <p className="text-xs text-muted-foreground">Unit used on purchase orders</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Sales Unit</Label>
                        <SearchableSelect
                          value={salesUomCode}
                          onChange={setSalesUomCode}
                          disabled={creating || loading}
                          placeholder={`Same as ${uom || "PC"}`}
                          searchPlaceholder="Search units..."
                          options={[
                            { value: "", label: `(same as ${uom || "PC"})` },
                            ...localConversions.map((c) => ({ value: c.uom_code, label: c.uom_code })),
                          ]}
                        />
                        <p className="text-xs text-muted-foreground">Unit used at point of sale</p>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Case Pack Qty</Label>
                        <Input type="number" min="0" step="any" value={casePackQty} onChange={(e) => setCasePackQty(e.target.value)} placeholder="e.g. 24" disabled={creating || loading} />
                        <p className="text-xs text-muted-foreground">How many {uom || "PC"} per outer case</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Inner Pack Qty</Label>
                        <Input type="number" min="0" step="any" value={innerPackQty} onChange={(e) => setInnerPackQty(e.target.value)} placeholder="e.g. 6" disabled={creating || loading} />
                        <p className="text-xs text-muted-foreground">How many {uom || "PC"} per inner pack</p>
                      </div>
                    </div>

                    <Separator />

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="flex items-center gap-3">
                        <Switch checked={trackBatches} onCheckedChange={setTrackBatches} disabled={creating || loading} />
                        <Label>Track Batches</Label>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch checked={trackExpiry} onCheckedChange={setTrackExpiry} disabled={creating || loading} />
                        <Label>Track Expiry</Label>
                      </div>
                      <div className="space-y-2">
                        <Label>Allow Negative Stock</Label>
                        <Select value={allowNegativeStock} onValueChange={setAllowNegativeStock} disabled={creating || loading}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">Use company default</SelectItem>
                            <SelectItem value="allowed">Allowed</SelectItem>
                            <SelectItem value="blocked">Blocked</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Default Shelf Life (days)</Label>
                        <Input type="number" min="0" value={defaultShelfLifeDays} onChange={(e) => setDefaultShelfLifeDays(e.target.value)} placeholder="e.g. 365" disabled={creating || loading} />
                      </div>
                      <div className="space-y-2">
                        <Label>Min Shelf Life for Sale (days)</Label>
                        <Input type="number" min="0" value={minShelfLifeDaysForSale} onChange={(e) => setMinShelfLifeDaysForSale(e.target.value)} placeholder="e.g. 30" disabled={creating || loading} />
                      </div>
                      <div className="space-y-2">
                        <Label>Expiry Warning (days)</Label>
                        <Input type="number" min="0" value={expiryWarningDays} onChange={(e) => setExpiryWarningDays(e.target.value)} placeholder="e.g. 14" disabled={creating || loading} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Reorder Point</Label>
                        <Input type="number" min="0" step="any" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} placeholder="0" disabled={creating || loading} />
                        <p className="text-xs text-muted-foreground">Trigger reorder when stock falls below this level</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Reorder Qty</Label>
                        <Input type="number" min="0" step="any" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} placeholder="0" disabled={creating || loading} />
                        <p className="text-xs text-muted-foreground">Default quantity to reorder</p>
                      </div>
                    </div>

                    <Separator />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Weight (kg)</Label>
                        <Input type="number" min="0" step="any" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.00" disabled={creating || loading} />
                      </div>
                      <div className="space-y-2">
                        <Label>Volume (L)</Label>
                        <Input type="number" min="0" step="any" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="0.00" disabled={creating || loading} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Preferred Supplier</Label>
                      <SupplierTypeahead
                        value={preferredSupplier}
                        onSelect={setPreferredSupplier}
                        onClear={() => setPreferredSupplier(null)}
                        disabled={creating || loading}
                      />
                    </div>
                  </AccordionContent>
                </AccordionItem>

              </Accordion>
            </CardContent>
          </Card>

        </form>

        {/* ================================================================ */}
        {/* STICKY SAVE BAR with inline error                                */}
        {/* ================================================================ */}
        <div className="sticky bottom-0 z-10 -mx-6 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center gap-2">
            {status ? (
              <p className="mr-auto flex items-center gap-1.5 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="truncate">{status}</span>
              </p>
            ) : (
              <div className="mr-auto" />
            )}
            <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")} disabled={creating}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => void submitCreate("addAnother")} disabled={submitDisabled}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create &amp; Add Another
            </Button>
            <Button type="submit" form="new-item-form" disabled={submitDisabled}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
