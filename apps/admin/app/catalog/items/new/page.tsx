"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, RefreshCw, Loader2, Plus, ArrowLeft } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { generateEan13Barcode, printBarcodeStickerLabel } from "@/lib/barcode-label";
import { PageHeader } from "@/components/business/page-header";
import { SearchableSelect } from "@/components/searchable-select";
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
import { Switch } from "@/components/ui/switch";
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

  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [uoms, setUoms] = useState<string[]>([]);

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [uom, setUom] = useState("EA");
  const [barcode, setBarcode] = useState("");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [active, setActive] = useState(true);
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

  const validateRequired = useCallback(
    (candidate?: { sku?: string; name?: string; uom?: string }): RequiredErrors => {
      const nextSku = (candidate?.sku ?? sku).trim();
      const nextName = (candidate?.name ?? name).trim();
      const nextUom = (candidate?.uom ?? uom).trim();
      const errs: RequiredErrors = {};
      if (!nextSku) errs.sku = "SKU is required.";
      if (!nextName) errs.name = "Name is required.";
      if (!nextUom) errs.uom = "Unit of measure is required.";
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

  async function submitCreate(mode: CreateMode) {
    const nextSku = sku.trim();
    const nextName = name.trim();
    const nextUom = uom.trim();
    const nextBarcode = barcode.trim();

    setSubmitAttempted(true);
    const errs = validateRequired({ sku: nextSku, name: nextName, uom: nextUom });
    setRequiredErrors(errs);
    if (Object.keys(errs).length > 0) {
      setStatus("Please fix the highlighted fields.");
      return;
    }

    setCreating(true);
    setStatus("");
    try {
      const { skuMatch, barcodeMatch } = await findExactDuplicates({ sku: nextSku, barcode: nextBarcode });
      setSkuDuplicate(skuMatch);
      setBarcodeDuplicate(barcodeMatch);
      if (skuMatch || (nextBarcode && barcodeMatch)) {
        setStatus("SKU or barcode already exists. Open the existing item from the field hints.");
        return;
      }

      const res = await apiPost<{ id: string }>("/items", {
        sku: nextSku,
        name: nextName,
        unit_of_measure: nextUom,
        barcode: nextBarcode || null,
        tax_code_id: taxCodeId || null,
        category_id: categoryId || null,
        is_active: active,
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
        toast.success("Item created", "Ready for the next item.");
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
  const requiredFilled = !!sku.trim() && !!name.trim() && !!uom.trim();
  const hasErrors = !!skuError || !!nameError || !!uomError || !!barcodeError;
  const hasPendingChecks = checkingDupes.sku || checkingDupes.barcode;
  const submitDisabled = creating || loading || !requiredFilled || hasErrors || hasPendingChecks;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
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

      <Card>
        <CardHeader>
          <CardTitle>Item Details</CardTitle>
          <CardDescription>SKU, naming, and tax/category defaults</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => { e.preventDefault(); void submitCreate("open"); }}
            className="space-y-6"
          >
            {/* SKU & Name */}
            <div className="grid gap-4 sm:grid-cols-6">
              <div className="space-y-2 sm:col-span-2">
                <Label>SKU <span className="text-destructive">*</span></Label>
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
                    setSubmitAttempted(true);
                    setRequiredErrors((prev) => {
                      const next = { ...prev };
                      if (sku.trim()) delete next.sku; else next.sku = "SKU is required.";
                      return next;
                    });
                  }}
                  placeholder="SKU-001"
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
                <Label>UOM <span className="text-destructive">*</span></Label>
                <SearchableSelect
                  value={uom}
                  onChange={(value) => {
                    setUom(value);
                    if (!submitAttempted) return;
                    setRequiredErrors((prev) => {
                      const next = { ...prev };
                      if (String(value || "").trim()) delete next.uom; else next.uom = "Unit of measure is required.";
                      return next;
                    });
                  }}
                  disabled={creating || loading}
                  placeholder="Select UOM..."
                  searchPlaceholder="Search UOMs..."
                  options={(uoms || []).map((x) => ({ value: x, label: x }))}
                />
                {uomError ? <p className="text-xs text-destructive">{uomError}</p> : null}
                <p className="text-xs text-muted-foreground">
                  Missing a UOM? Add it in{" "}
                  <Link href="/system/uoms" className="underline underline-offset-2 hover:text-foreground">System &rarr; UOMs</Link>.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-4">
                <Label>Primary Barcode (optional)</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
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

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")} disabled={creating}>
                Cancel
              </Button>
              <Button type="button" variant="outline" onClick={() => void submitCreate("addAnother")} disabled={submitDisabled}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create &amp; Add Another
              </Button>
              <Button type="submit" disabled={submitDisabled}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
