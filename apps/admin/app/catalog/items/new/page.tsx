"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, RefreshCw, Loader2, Plus, Sparkles } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { generateEan13Barcode, printBarcodeStickerLabel } from "@/lib/barcode-label";
import { PageHeader } from "@/components/business/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";
import { useToast } from "@/components/toast-provider";
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

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type TaxCode = { id: string; name: string; rate: string | number };
type Category = { id: string; name: string; parent_id: string | null; is_active: boolean };
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

  /* ---- Essential fields ---- */
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [uom, setUom] = useState("EA");
  const [barcode, setBarcode] = useState("");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [active, setActive] = useState(true);

  /* ---- Classification & Identity ---- */
  const [itemType, setItemType] = useState<"stocked" | "service" | "bundle">("stocked");
  const [brand, setBrand] = useState("");
  const [shortName, setShortName] = useState("");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");

  /* ---- Tax & Compliance ---- */
  const [taxCategory, setTaxCategory] = useState("none");
  const [isExcise, setIsExcise] = useState(false);

  /* ---- UOM & Packaging ---- */
  const [purchaseUomCode, setPurchaseUomCode] = useState("");
  const [salesUomCode, setSalesUomCode] = useState("");
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
  const skuInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tc, cats, uo] = await Promise.all([
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes").catch(() => ({ tax_codes: [] as TaxCode[] })),
        apiGet<{ categories: Category[] }>("/item-categories").catch(() => ({ categories: [] as Category[] })),
        apiGet<{ uoms: string[] }>("/items/uoms?limit=200").catch(() => ({ uoms: [] as string[] })),
      ]);
      setTaxCodes(tc.tax_codes || []);
      setCategories(cats.categories || []);
      setUoms((uo.uoms || []).map((x) => String(x || "").trim()).filter(Boolean));
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

  // Debounced dupe checks
  useEffect(() => {
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
  }, [sku, findExactDuplicates]);

  useEffect(() => {
    const token = barcode.trim();
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
  }, [barcode, findExactDuplicates]);

  function resetOptionalFields() {
    setItemType("stocked");
    setBrand("");
    setShortName("");
    setTags("");
    setDescription("");
    setTaxCategory("none");
    setIsExcise(false);
    setPurchaseUomCode("");
    setSalesUomCode("");
    setCasePackQty("");
    setInnerPackQty("");
    setStandardCostUsd("");
    setStandardCostLbp("");
    setMinMarginPct("");
    setCostingMethod("default");
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

  async function submitCreate(mode: CreateMode) {
    const nextSku = sku.trim();
    const nextName = name.trim();
    const nextUom = uom.trim();
    const nextBarcode = barcode.trim();

    setSubmitAttempted(true);
    // SKU is only required if user is providing their own (not auto-generated)
    const errs = validateRequired({ sku: skuAutoGenerated ? "auto" : nextSku, name: nextName, uom: nextUom });
    setRequiredErrors(errs);
    if (Object.keys(errs).length > 0) {
      setStatus("Please fix the highlighted fields.");
      return;
    }

    setCreating(true);
    setStatus("");
    try {
      // Skip duplicate check for auto-generated SKUs (backend handles atomically)
      if (!skuAutoGenerated && nextSku) {
        const { skuMatch, barcodeMatch } = await findExactDuplicates({ sku: nextSku, barcode: nextBarcode });
        setSkuDuplicate(skuMatch);
        setBarcodeDuplicate(barcodeMatch);
        if (skuMatch || (nextBarcode && barcodeMatch)) {
          setStatus("SKU or barcode already exists. Open the existing item from the field hints.");
          return;
        }
      } else if (nextBarcode) {
        const { barcodeMatch } = await findExactDuplicates({ barcode: nextBarcode });
        setBarcodeDuplicate(barcodeMatch);
        if (barcodeMatch) {
          setStatus("Barcode already exists. Open the existing item from the field hints.");
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
        // Tax & Compliance
        tax_category: taxCategory && taxCategory !== "none" ? taxCategory : null,
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

      if (mode === "addAnother") {
        setSku("");
        setName("");
        setBarcode("");
        setSubmitAttempted(false);
        setRequiredErrors({});
        setSkuDuplicate(null);
        setBarcodeDuplicate(null);
        setStatus("");
        setSkuAutoGenerated(true);
        resetOptionalFields();
        const skuLabel = res.sku ? ` (${res.sku})` : "";
        toast.success("Item created" + skuLabel, "Ready for the next item.");
        window.requestAnimationFrame(() => skuInputRef.current?.focus());
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

  function generateBarcode() { setBarcode(generateEan13Barcode()); }

  async function printBarcodeLabel() {
    const code = barcode.trim();
    if (!code) return setStatus("Enter or generate a barcode first.");
    try {
      await printBarcodeStickerLabel({
        barcode: code,
        sku: sku.trim() || null,
        name: name.trim() || null,
        uom: uom.trim() || null,
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  const skuError = requiredErrors.sku || (skuDuplicate ? "SKU already exists." : "");
  const nameError = requiredErrors.name || "";
  const uomError = requiredErrors.uom || "";
  const barcodeError = barcodeDuplicate ? "Barcode already exists." : "";
  const requiredFilled = (skuAutoGenerated || !!sku.trim()) && !!name.trim() && !!uom.trim();
  const hasErrors = !!skuError || !!nameError || !!uomError || !!barcodeError;
  const hasPendingChecks = checkingDupes.sku || checkingDupes.barcode;
  const submitDisabled = creating || loading || !requiredFilled || hasErrors || hasPendingChecks;

  return (
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
        {/* ESSENTIALS CARD - Always visible                                  */}
        {/* ================================================================ */}
        <Card>
          <CardHeader>
            <CardTitle>Item Details</CardTitle>
            <CardDescription>SKU, naming, and tax/category defaults</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* SKU & Name */}
            <div className="grid gap-4 sm:grid-cols-6">
              <div className="space-y-2 sm:col-span-2">
                <Label>SKU</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    ref={skuInputRef}
                    value={sku}
                    onChange={(e) => {
                      setSku(e.target.value);
                      setSkuAutoGenerated(false);
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
                    placeholder="Auto-generated"
                    disabled={creating || loading}
                    className={skuError ? "border-destructive focus-visible:ring-destructive" : ""}
                    aria-invalid={skuError ? true : undefined}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title="Auto-generate SKU"
                    onClick={() => { setSkuAutoGenerated(true); }}
                    disabled={creating || loading || skuAutoGenerated}
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </div>
                {checkingDupes.sku && !skuError ? <p className="text-xs text-muted-foreground">Checking SKU...</p> : null}
                {skuError ? (
                  <p className="text-xs text-destructive">
                    {skuError}{" "}
                    {skuDuplicate ? (
                      <Link href={`/catalog/items/${encodeURIComponent(skuDuplicate.id)}`} className="underline underline-offset-2">Open existing</Link>
                    ) : null}
                  </p>
                ) : null}
                {skuAutoGenerated && sku && !skuError ? (
                  <p className="text-xs text-muted-foreground">Auto-generated from category &amp; brand</p>
                ) : null}
              </div>
              <div className="space-y-2 sm:col-span-4">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input
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
                  disabled={creating || loading}
                  className={nameError ? "border-destructive focus-visible:ring-destructive" : ""}
                  aria-invalid={nameError ? true : undefined}
                />
                {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
              </div>
            </div>

            {/* UOM & Barcode */}
            <div className="grid gap-4 sm:grid-cols-6">
              <div className="space-y-2 sm:col-span-2">
                <Label>Unit <span className="text-destructive">*</span></Label>
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
                  Missing a unit? Add it in{" "}
                  <Link href="/system/uoms" className="underline underline-offset-2 hover:text-foreground">System &rarr; Units</Link>.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-4">
                <Label>Primary Barcode (optional)</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    placeholder="Barcode"
                    disabled={creating || loading}
                    className={`font-mono ${barcodeError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    aria-invalid={barcodeError ? true : undefined}
                  />
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Generate barcode" onClick={generateBarcode} disabled={creating || loading}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Print sticker" onClick={printBarcodeLabel} disabled={creating || loading || !barcode.trim()}>
                    <Printer className="h-4 w-4" />
                  </Button>
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
              </div>
            </div>

            {/* Tax & Category */}
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
            </div>

            {/* Active */}
            <div className="flex items-center gap-3">
              <Switch checked={active} onCheckedChange={setActive} disabled={creating || loading} />
              <Label>Active</Label>
            </div>
          </CardContent>
        </Card>

        {/* ================================================================ */}
        {/* OPTIONAL SECTIONS - Collapsible accordion                        */}
        {/* ================================================================ */}
        <Card>
          <CardHeader>
            <CardTitle>Additional Options</CardTitle>
            <CardDescription>Expand sections below to configure more details</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">

              {/* ---- Classification & Identity ---- */}
              <AccordionItem value="classification">
                <AccordionTrigger>Classification &amp; Identity</AccordionTrigger>
                <AccordionContent className="space-y-4 px-1 pt-2">
                  <div className="grid gap-4 sm:grid-cols-3">
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
                      <Label>Brand</Label>
                      <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" disabled={creating || loading} />
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

              {/* ---- Tax & Compliance ---- */}
              <AccordionItem value="tax">
                <AccordionTrigger>Tax &amp; Compliance</AccordionTrigger>
                <AccordionContent className="space-y-4 px-1 pt-2">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Tax Category</Label>
                      <Select value={taxCategory} onValueChange={setTaxCategory} disabled={creating || loading}>
                        <SelectTrigger>
                          <SelectValue placeholder="(none)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">(none)</SelectItem>
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="zero">Zero-rated</SelectItem>
                          <SelectItem value="exempt">Exempt</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end gap-3 pb-1">
                      <div className="flex items-center gap-3">
                        <Switch checked={isExcise} onCheckedChange={setIsExcise} disabled={creating || loading} />
                        <Label>Subject to Excise</Label>
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* ---- UOM & Packaging ---- */}
              <AccordionItem value="packaging">
                <AccordionTrigger>Units &amp; Packaging</AccordionTrigger>
                <AccordionContent className="space-y-4 px-1 pt-2">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Purchase Unit</Label>
                      <SearchableSelect
                        value={purchaseUomCode}
                        onChange={setPurchaseUomCode}
                        disabled={creating || loading}
                        placeholder="Same as base unit"
                        searchPlaceholder="Search units..."
                        options={[
                          { value: "", label: "(same as base unit)" },
                          ...uoms.map((x) => ({ value: x, label: x })),
                        ]}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sales Unit</Label>
                      <SearchableSelect
                        value={salesUomCode}
                        onChange={setSalesUomCode}
                        disabled={creating || loading}
                        placeholder="Same as base unit"
                        searchPlaceholder="Search units..."
                        options={[
                          { value: "", label: "(same as base unit)" },
                          ...uoms.map((x) => ({ value: x, label: x })),
                        ]}
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Case Pack Qty</Label>
                      <Input type="number" min="0" step="any" value={casePackQty} onChange={(e) => setCasePackQty(e.target.value)} placeholder="e.g. 24" disabled={creating || loading} />
                      <p className="text-xs text-muted-foreground">Units per outer case</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Inner Pack Qty</Label>
                      <Input type="number" min="0" step="any" value={innerPackQty} onChange={(e) => setInnerPackQty(e.target.value)} placeholder="e.g. 6" disabled={creating || loading} />
                      <p className="text-xs text-muted-foreground">Units per inner pack</p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* ---- Costing & Margins ---- */}
              <AccordionItem value="costing">
                <AccordionTrigger>Costing &amp; Margins</AccordionTrigger>
                <AccordionContent className="space-y-4 px-1 pt-2">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Standard Cost (USD)</Label>
                      <Input type="number" min="0" step="any" value={standardCostUsd} onChange={(e) => setStandardCostUsd(e.target.value)} placeholder="0.00" disabled={creating || loading} />
                    </div>
                    <div className="space-y-2">
                      <Label>Standard Cost (LBP)</Label>
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

              {/* ---- Inventory & Shelf Life ---- */}
              <AccordionItem value="inventory">
                <AccordionTrigger>Inventory &amp; Shelf Life</AccordionTrigger>
                <AccordionContent className="space-y-4 px-1 pt-2">
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
                </AccordionContent>
              </AccordionItem>

              {/* ---- Logistics & Supplier ---- */}
              <AccordionItem value="logistics">
                <AccordionTrigger>Logistics &amp; Supplier</AccordionTrigger>
                <AccordionContent className="space-y-4 px-1 pt-2">
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
      {/* STICKY SAVE BAR                                                  */}
      {/* ================================================================ */}
      <div className="sticky bottom-0 z-10 -mx-6 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")} disabled={creating}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => void submitCreate("addAnother")} disabled={submitDisabled}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Create & Add Another
          </Button>
          <Button type="submit" form="new-item-form" disabled={submitDisabled}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
