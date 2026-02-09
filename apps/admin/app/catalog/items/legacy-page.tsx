"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

import { apiGet, apiPatch, apiPost, apiPostForm, apiUrl } from "@/lib/api";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { ErrorBanner } from "@/components/error-banner";
import { ViewRaw } from "@/components/view-raw";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Item = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  item_type?: "stocked" | "service" | "bundle";
  tags?: string[] | null;
  unit_of_measure: string;
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
  barcode_count?: number;
  image_attachment_id?: string | null;
  image_alt?: string | null;
};

type TaxCode = { id: string; name: string; rate: string | number };
type Category = { id: string; name: string; parent_id: string | null; is_active: boolean };

type BulkItemIn = {
  sku: string;
  name: string;
  unit_of_measure: string;
  barcode?: string | null;
  tax_code_name?: string | null;
  reorder_point?: number;
  reorder_qty?: number;
};

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

type AiRecRow = {
  id: string;
  agent_code: string;
  status: string;
  recommendation_json: any;
  created_at: string;
};

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [uoms, setUoms] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");

  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [uom, setUom] = useState("EA");
  const [barcode, setBarcode] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editName, setEditName] = useState("");
  const [editItemType, setEditItemType] = useState<"stocked" | "service" | "bundle">("stocked");
  const [editTags, setEditTags] = useState("");
  const [nameSuggestions, setNameSuggestions] = useState<Array<{ name: string; reason?: string }>>([]);
  const [suggestingName, setSuggestingName] = useState(false);
  const [editUom, setEditUom] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editTaxCodeId, setEditTaxCodeId] = useState("");
  const [editReorderPoint, setEditReorderPoint] = useState("");
  const [editReorderQty, setEditReorderQty] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editBrand, setEditBrand] = useState("");
  const [editShortName, setEditShortName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTrackBatches, setEditTrackBatches] = useState(false);
  const [editTrackExpiry, setEditTrackExpiry] = useState(false);
  const [editDefaultShelfLifeDays, setEditDefaultShelfLifeDays] = useState("");
  const [editMinShelfLifeDaysForSale, setEditMinShelfLifeDaysForSale] = useState("");
  const [editExpiryWarningDays, setEditExpiryWarningDays] = useState("");
  const [editImageAttachmentId, setEditImageAttachmentId] = useState("");
  const [editImageAlt, setEditImageAlt] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [editing, setEditing] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<BulkItemIn[]>([]);
  const [importErrors, setImportErrors] = useState<string>("");
  const [importing, setImporting] = useState(false);

  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeItem, setBarcodeItem] = useState<Item | null>(null);
  const [barcodes, setBarcodes] = useState<ItemBarcode[]>([]);
  const [barcodeStatus, setBarcodeStatus] = useState("");
  const [newBarcode, setNewBarcode] = useState("");
  const [newFactor, setNewFactor] = useState("1");
  const [newLabel, setNewLabel] = useState("");
  const [newPrimary, setNewPrimary] = useState(false);

  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierItem, setSupplierItem] = useState<Item | null>(null);
  const [supplierStatus, setSupplierStatus] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [itemLinks, setItemLinks] = useState<ItemSupplierLinkRow[]>([]);
  const [addSupplierId, setAddSupplierId] = useState("");
  const [addIsPrimary, setAddIsPrimary] = useState(false);
  const [addLeadTimeDays, setAddLeadTimeDays] = useState("0");
  const [addMinOrderQty, setAddMinOrderQty] = useState("0");
  const [addLastCostUsd, setAddLastCostUsd] = useState("0");
  const [addLastCostLbp, setAddLastCostLbp] = useState("0");
  const [addingLink, setAddingLink] = useState(false);

  const [editLinkOpen, setEditLinkOpen] = useState(false);
  const [editLink, setEditLink] = useState<ItemSupplierLinkRow | null>(null);
  const [editIsPrimary, setEditIsPrimary] = useState(false);
  const [editLeadTimeDays, setEditLeadTimeDays] = useState("0");
  const [editMinOrderQty, setEditMinOrderQty] = useState("0");
  const [editLastCostUsd, setEditLastCostUsd] = useState("0");
  const [editLastCostLbp, setEditLastCostLbp] = useState("0");
  const [savingLink, setSavingLink] = useState(false);
  const [aiHygiene, setAiHygiene] = useState<AiRecRow[]>([]);

  const filtered = useMemo(() => {
    return filterAndRankByFuzzy(items || [], q, (i) => `${i.sku} ${i.name} ${i.barcode || ""} ${i.id}`);
  }, [items, q]);

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  async function load() {
    setStatus("Loading...");
    try {
      const [res, tc, cats, uo] = await Promise.all([
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes"),
        apiGet<{ categories: Category[] }>("/item-categories"),
        apiGet<{ uoms: string[] }>("/items/uoms?limit=200").catch(() => ({ uoms: [] as string[] }))
      ]);
      setItems(res.items || []);
      setTaxCodes(tc.tax_codes || []);
      setCategories(cats.categories || []);
      setUoms((uo.uoms || []).map((x) => String(x || "").trim()).filter(Boolean));

      // AI is optional: don't block the Items page if the user lacks ai:read or if AI endpoints fail.
      try {
        const ai = await apiGet<{ recommendations: AiRecRow[] }>(
          "/ai/recommendations?status=pending&agent_code=AI_DATA_HYGIENE&limit=10"
        );
        setAiHygiene(ai.recommendations || []);
      } catch {
        setAiHygiene([]);
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // UOM is a strict pick-list: if current value isn't supported, clear it.
  useEffect(() => {
    const cur = String(uom || "").trim();
    if (!cur) return;
    if (!uoms.length) return;
    if (uoms.includes(cur)) return;
    setUom("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uoms]);

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

  function parseTags(input: string): string[] | null {
    const parts = (input || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const uniq = Array.from(new Set(parts));
    return uniq.length ? uniq : null;
  }

  function parseCsv(input: string): string[][] {
    const out: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let i = 0;
    let inQuotes = false;
    const s = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    function pushCell() {
      row.push(cell);
      cell = "";
    }
    function pushRow() {
      // Skip trailing empty line.
      const allEmpty = row.every((c) => !String(c || "").trim());
      if (!allEmpty) out.push(row);
      row = [];
    }

    while (i < s.length) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          const next = s[i + 1];
          if (next === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        cell += ch;
        i += 1;
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        pushCell();
        i += 1;
        continue;
      }
      if (ch === "\n") {
        pushCell();
        pushRow();
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
    }
    pushCell();
    pushRow();
    return out;
  }

  function recomputeImport(text: string) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      setImportPreview([]);
      setImportErrors("");
      return;
    }
    try {
      const rows = parseCsv(trimmed);
      if (rows.length < 2) {
        setImportPreview([]);
        setImportErrors("CSV must have a header row + at least 1 data row.");
        return;
      }
      const headers = rows[0].map((h) => (h || "").trim().toLowerCase());
      const idx = (names: string[]) => {
        for (const n of names) {
          const i = headers.indexOf(n);
          if (i >= 0) return i;
        }
        return -1;
      };
      const skuIdx = idx(["sku"]);
      const nameIdx = idx(["name"]);
      const uomIdx = idx(["unit_of_measure", "uom"]);
      const bcIdx = idx(["barcode"]);
      const taxIdx = idx(["tax_code_name", "tax_code", "tax"]);
      const rpIdx = idx(["reorder_point", "rop"]);
      const rqIdx = idx(["reorder_qty", "roq", "reorder_quantity"]);
      if (skuIdx < 0 || nameIdx < 0) {
        setImportPreview([]);
        setImportErrors("Missing required headers: sku, name");
        return;
      }

      const preview: BulkItemIn[] = [];
      const errs: string[] = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const sku = (row[skuIdx] || "").trim();
        const name = (row[nameIdx] || "").trim();
        if (!sku || !name) {
          errs.push(`Row ${r + 1}: sku and name are required`);
          continue;
        }
        const uom = (uomIdx >= 0 ? row[uomIdx] : "")?.trim() || "EA";
        const barcode = bcIdx >= 0 ? (row[bcIdx] || "").trim() : "";
        const tax = taxIdx >= 0 ? (row[taxIdx] || "").trim() : "";
        const reorder_point = rpIdx >= 0 ? Number((row[rpIdx] || "").trim() || 0) : 0;
        const reorder_qty = rqIdx >= 0 ? Number((row[rqIdx] || "").trim() || 0) : 0;
        if (!Number.isFinite(reorder_point) || reorder_point < 0) errs.push(`Row ${r + 1}: reorder_point must be >= 0`);
        if (!Number.isFinite(reorder_qty) || reorder_qty < 0) errs.push(`Row ${r + 1}: reorder_qty must be >= 0`);
        preview.push({
          sku,
          name,
          unit_of_measure: uom,
          barcode: barcode || null,
          tax_code_name: tax || null,
          reorder_point: Number.isFinite(reorder_point) ? reorder_point : 0,
          reorder_qty: Number.isFinite(reorder_qty) ? reorder_qty : 0
        });
      }

      setImportPreview(preview);
      setImportErrors(errs.slice(0, 30).join("\n"));
    } catch (e) {
      setImportPreview([]);
      setImportErrors(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importPreview.length) {
      setImportErrors("Nothing to import.");
      return;
    }
    setImporting(true);
    setStatus("Importing...");
    try {
      await apiPost("/items/bulk", { items: importPreview });
      setImportOpen(false);
      setImportText("");
      setImportPreview([]);
      setImportErrors("");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setImporting(false);
    }
  }

  async function createItem(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !name.trim() || !uom.trim()) {
      setStatus("sku, name, and unit_of_measure are required");
      return;
    }
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/items", {
        sku: sku.trim(),
        name: name.trim(),
        unit_of_measure: uom.trim(),
        barcode: barcode.trim() || null,
        category_id: categoryId || null,
        is_active: isActive
      });
      setSku("");
      setName("");
      setBarcode("");
      setCategoryId("");
      setIsActive(true);
      setCreateOpen(false);
      setStatus("Created.");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(item: Item) {
    setEditItem(item);
    setEditName(item.name || "");
    setNameSuggestions([]);
    setEditItemType((item.item_type as any) || "stocked");
    setEditTags(Array.isArray(item.tags) ? item.tags.join(", ") : "");
    setEditUom(item.unit_of_measure || "");
    setEditBarcode(item.barcode || "");
    setEditTaxCodeId(item.tax_code_id || "");
    setEditReorderPoint(String(item.reorder_point ?? ""));
    setEditReorderQty(String(item.reorder_qty ?? ""));
    setEditIsActive(item.is_active !== false);
    setEditCategoryId((item.category_id as any) || "");
    setEditBrand((item.brand as any) || "");
    setEditShortName((item.short_name as any) || "");
    setEditDescription((item.description as any) || "");
    setEditTrackBatches(Boolean(item.track_batches));
    setEditTrackExpiry(Boolean(item.track_expiry));
    setEditDefaultShelfLifeDays(String(item.default_shelf_life_days ?? ""));
    setEditMinShelfLifeDaysForSale(String(item.min_shelf_life_days_for_sale ?? ""));
    setEditExpiryWarningDays(String(item.expiry_warning_days ?? ""));
    setEditImageAttachmentId((item.image_attachment_id as any) || "");
    setEditImageAlt((item.image_alt as any) || "");
    setEditOpen(true);
  }

  async function suggestBetterName() {
    const raw = (editName || "").trim();
    if (!raw) return;
    setSuggestingName(true);
    setStatus("Suggesting name...");
    try {
      const res = await apiPost<{ suggestions: Array<{ name: string; reason?: string }> }>("/items/name-suggestions", { raw_name: raw, count: 4 });
      setNameSuggestions(res.suggestions || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSuggestingName(false);
    }
  }

  async function uploadItemImage(file: File) {
    if (!editItem) return;
    setImageUploading(true);
    setStatus("Uploading image...");
    try {
      const fd = new FormData();
      fd.set("entity_type", "item_image");
      fd.set("entity_id", editItem.id);
      fd.set("file", file);
      const res = await apiPostForm<{ id: string }>("/attachments", fd);

      // Persist immediately so a user doesn't lose the upload if they close the dialog.
      await apiPatch(`/items/${editItem.id}`, { image_attachment_id: res.id });
      setEditImageAttachmentId(res.id);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setImageUploading(false);
    }
  }

  async function removeItemImage() {
    if (!editItem) return;
    setImageUploading(true);
    setStatus("Removing image...");
    try {
      await apiPatch(`/items/${editItem.id}`, { image_attachment_id: null });
      setEditImageAttachmentId("");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setImageUploading(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editItem) return;
    if (!editName.trim()) return setStatus("name is required");
    if (!editUom.trim()) return setStatus("unit_of_measure is required");

    setEditing(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/items/${editItem.id}`, {
        name: editName.trim(),
        item_type: editItemType,
        tags: parseTags(editTags),
        unit_of_measure: editUom.trim(),
        barcode: editBarcode.trim(),
        tax_code_id: editTaxCodeId ? editTaxCodeId : null,
        reorder_point: Number(editReorderPoint || 0),
        reorder_qty: Number(editReorderQty || 0),
        is_active: editIsActive,
        category_id: editCategoryId || null,
        brand: editBrand.trim() || null,
        short_name: editShortName.trim() || null,
        description: editDescription.trim() || null,
        track_batches: !!editTrackBatches,
        track_expiry: !!editTrackExpiry,
        default_shelf_life_days: editDefaultShelfLifeDays.trim() ? Number(editDefaultShelfLifeDays) : null,
        min_shelf_life_days_for_sale: editMinShelfLifeDaysForSale.trim() ? Number(editMinShelfLifeDaysForSale) : null,
        expiry_warning_days: editExpiryWarningDays.trim() ? Number(editExpiryWarningDays) : null,
        image_attachment_id: editImageAttachmentId || null,
        image_alt: editImageAlt.trim() || null
      });
      setEditOpen(false);
      setEditItem(null);
      setStatus("");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setEditing(false);
    }
  }

  async function openBarcodeManager(item: Item) {
    setBarcodeItem(item);
    setBarcodeStatus("Loading...");
    setBarcodeOpen(true);
    try {
      const res = await apiGet<{ barcodes: ItemBarcode[] }>(`/items/${item.id}/barcodes`);
      setBarcodes(res.barcodes || []);
      setBarcodeStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBarcodeStatus(message);
    }
  }

  async function openSupplierManager(item: Item) {
    setSupplierItem(item);
    setSupplierStatus("Loading...");
    setSupplierOpen(true);
    setSuppliers([]);
    setItemLinks([]);
    setAddSupplierId("");
    setAddIsPrimary(false);
    setAddLeadTimeDays("0");
    setAddMinOrderQty("0");
    setAddLastCostUsd("0");
    setAddLastCostLbp("0");
    try {
      const [s, links] = await Promise.all([
        apiGet<{ suppliers: SupplierRow[] }>("/suppliers"),
        apiGet<{ suppliers: ItemSupplierLinkRow[] }>(`/suppliers/items/${item.id}`)
      ]);
      setSuppliers(s.suppliers || []);
      setItemLinks(links.suppliers || []);
      setSupplierStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSupplierStatus(message);
    }
  }

  async function refreshSupplierManager() {
    if (!supplierItem) return;
    setSupplierStatus("Loading...");
    try {
      const links = await apiGet<{ suppliers: ItemSupplierLinkRow[] }>(`/suppliers/items/${supplierItem.id}`);
      setItemLinks(links.suppliers || []);
      setSupplierStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSupplierStatus(message);
    }
  }

  async function addSupplierLink(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierItem) return;
    if (!addSupplierId) return setSupplierStatus("Pick a supplier.");
    setAddingLink(true);
    setSupplierStatus("Saving...");
    try {
      await apiPost(`/suppliers/${addSupplierId}/items`, {
        item_id: supplierItem.id,
        is_primary: !!addIsPrimary,
        lead_time_days: Number(addLeadTimeDays || 0),
        min_order_qty: Number(addMinOrderQty || 0),
        last_cost_usd: Number(addLastCostUsd || 0),
        last_cost_lbp: Number(addLastCostLbp || 0)
      });
      setAddSupplierId("");
      setAddIsPrimary(false);
      setAddLeadTimeDays("0");
      setAddMinOrderQty("0");
      setAddLastCostUsd("0");
      setAddLastCostLbp("0");
      await refreshSupplierManager();
      setSupplierStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSupplierStatus(message);
    } finally {
      setAddingLink(false);
    }
  }

  function openEditSupplierLink(link: ItemSupplierLinkRow) {
    setEditLink(link);
    setEditIsPrimary(!!link.is_primary);
    setEditLeadTimeDays(String(link.lead_time_days ?? 0));
    setEditMinOrderQty(String(link.min_order_qty ?? 0));
    setEditLastCostUsd(String(link.last_cost_usd ?? 0));
    setEditLastCostLbp(String(link.last_cost_lbp ?? 0));
    setEditLinkOpen(true);
  }

  async function saveEditSupplierLink(e: React.FormEvent) {
    e.preventDefault();
    if (!editLink) return;
    setSavingLink(true);
    setSupplierStatus("Saving...");
    try {
      await apiPatch(`/suppliers/item-links/${editLink.id}`, {
        is_primary: !!editIsPrimary,
        lead_time_days: Number(editLeadTimeDays || 0),
        min_order_qty: Number(editMinOrderQty || 0),
        last_cost_usd: Number(editLastCostUsd || 0),
        last_cost_lbp: Number(editLastCostLbp || 0)
      });
      setEditLinkOpen(false);
      setEditLink(null);
      await refreshSupplierManager();
      setSupplierStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSupplierStatus(message);
    } finally {
      setSavingLink(false);
    }
  }

  async function deleteSupplierLink(linkId: string) {
    setSupplierStatus("Deleting...");
    try {
      await fetch(`/api/suppliers/item-links/${linkId}`, { method: "DELETE", credentials: "include" }).then(
        async (r) => {
          if (!r.ok) throw new Error(await r.text());
        }
      );
      await refreshSupplierManager();
      setSupplierStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSupplierStatus(message);
    }
  }

  async function addBarcode(e: React.FormEvent) {
    e.preventDefault();
    if (!barcodeItem) return;
    const bc = newBarcode.trim();
    if (!bc) {
      setBarcodeStatus("barcode is required");
      return;
    }
    const factor = Number(newFactor || 0);
    if (!Number.isFinite(factor) || factor <= 0) {
      setBarcodeStatus("qty_factor must be > 0");
      return;
    }
    setBarcodeStatus("Saving...");
    try {
      await apiPost(`/items/${barcodeItem.id}/barcodes`, {
        barcode: bc,
        qty_factor: factor,
        label: newLabel.trim() || null,
        is_primary: newPrimary
      });
      setNewBarcode("");
      setNewFactor("1");
      setNewLabel("");
      setNewPrimary(false);
      await openBarcodeManager(barcodeItem);
      await load();
      setBarcodeStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBarcodeStatus(message);
    }
  }

  async function setPrimary(barcodeId: string) {
    if (!barcodeItem) return;
    setBarcodeStatus("Updating...");
    try {
      await apiPatch(`/items/barcodes/${barcodeId}`, { is_primary: true });
      await openBarcodeManager(barcodeItem);
      await load();
      setBarcodeStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBarcodeStatus(message);
    }
  }

  async function removeBarcode(barcodeId: string) {
    if (!barcodeItem) return;
    setBarcodeStatus("Deleting...");
    try {
      await fetch(`/api/items/barcodes/${barcodeId}`, { method: "DELETE", credentials: "include" }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
      });
      await openBarcodeManager(barcodeItem);
      await load();
      setBarcodeStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBarcodeStatus(message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
	        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

	        {aiHygiene.length ? (
	          <Card>
	            <CardHeader>
	              <CardTitle className="text-base">AI: Data Hygiene</CardTitle>
	              <CardDescription>
	                {aiHygiene.length} pending suggestions (items missing key master data).
	              </CardDescription>
	            </CardHeader>
	            <CardContent className="space-y-2">
	              <div className="ui-table-wrap">
	                <table className="ui-table">
	                  <thead className="ui-thead">
	                    <tr>
	                      <th className="px-3 py-2">Item</th>
	                      <th className="px-3 py-2">Issues</th>
	                      <th className="px-3 py-2">Created</th>
	                    </tr>
	                  </thead>
	                  <tbody>
	                    {aiHygiene.slice(0, 8).map((r) => {
	                      const j = (r as any).recommendation_json || {};
	                      const issues = Array.isArray(j.issues) ? j.issues : [];
	                      const issueCodes = issues.map((x: any) => x?.code).filter(Boolean);
	                      return (
	                        <tr key={r.id} className="border-t border-border-subtle align-top">
	                          <td className="px-3 py-2">
	                            <div className="font-mono text-xs">{j.sku || j.entity_id || "-"}</div>
	                            <div className="text-xs text-fg-muted">{j.name || ""}</div>
	                          </td>
	                          <td className="px-3 py-2 font-mono text-xs text-fg-muted">
	                            {issueCodes.length ? issueCodes.join(", ") : String(issues.length || 0)}
	                          </td>
	                          <td className="px-3 py-2 font-mono text-xs text-fg-muted">{r.created_at}</td>
	                        </tr>
	                      );
	                    })}
	                  </tbody>
	                </table>
	              </div>
	              <div className="flex justify-end">
	                <Button asChild variant="outline" size="sm">
	                  <a href="/automation/ai-hub">Open AI Hub</a>
	                </Button>
	              </div>
	            </CardContent>
	          </Card>
	        ) : null}

	        <Card>
	          <CardHeader>
	            <CardTitle>Catalog</CardTitle>
	            <CardDescription>{items.length} items</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-80">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sku/name/barcode..." />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={load}>
                  Refresh
                </Button>
                <Dialog
                  open={createOpen}
                  onOpenChange={(o) => {
                    setCreateOpen(o);
                    if (!o) {
                      setSku("");
                      setName("");
                      setUom("EA");
                      setBarcode("");
                      setCategoryId("");
                      setIsActive(true);
                    }
                  }}
                >
                  <DialogTrigger asChild>
                    <Button>New Item</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create Item</DialogTitle>
                      <DialogDescription>SKU, name, UOM, barcode.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={createItem} className="grid grid-cols-1 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">SKU</label>
                        <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU-001" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Name</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">UOM</label>
                          <SearchableSelect
                            value={uom}
                            onChange={setUom}
                            placeholder="Select UOM..."
                            searchPlaceholder="Search UOMs..."
                            options={(uoms || []).map((x) => ({ value: x, label: x }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Barcode (optional)</label>
                          <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="629..." />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Category (optional)</label>
                          <SearchableSelect
                            value={categoryId}
                            onChange={setCategoryId}
                            searchPlaceholder="Search categories..."
                            options={[
                              { value: "", label: "(none)" },
                              ...categories.map((c) => ({ value: c.id, label: c.name })),
                            ]}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Active?</label>
                          <select className="ui-select" value={isActive ? "yes" : "no"} onChange={(e) => setIsActive(e.target.value === "yes")}>
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button type="submit" disabled={creating}>
                          {creating ? "..." : "Create"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
                <Dialog
                  open={importOpen}
                  onOpenChange={(o) => {
                    setImportOpen(o);
                    if (!o) {
                      setImportText("");
                      setImportPreview([]);
                      setImportErrors("");
                    }
                  }}
                >
                  <DialogTrigger asChild>
                    <Button variant="outline">Import CSV</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Import Items (CSV)</DialogTitle>
                      <DialogDescription>
                        Header required. Columns: <span className="font-mono text-xs">sku,name,unit_of_measure,barcode,tax_code,reorder_point,reorder_qty</span>.
                        Tax code matches by name.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={submitImport} className="space-y-3">
                      <textarea
                        className="h-48 w-full rounded-md border border-border bg-bg-elevated p-3 text-xs font-mono text-foreground"
                        value={importText}
                        onChange={(e) => {
                          const v = e.target.value;
                          setImportText(v);
                          recomputeImport(v);
                        }}
                        placeholder={'sku,name,unit_of_measure,barcode,tax_code,reorder_point,reorder_qty\nSKU-001,Milk 1L,EA,629...,VAT 11%,10,50'}
                      />
                      {importErrors ? (
                        <pre className="whitespace-pre-wrap rounded-md border border-border bg-bg-sunken p-3 text-xs text-fg-muted">
                          {importErrors}
                        </pre>
                      ) : null}
                      <div className="rounded-md border border-border bg-bg-elevated p-3 text-xs text-fg-muted">
                        Parsed rows: <span className="font-mono">{importPreview.length}</span>
                      </div>
                      <div className="flex justify-end">
                        <Button type="submit" disabled={importing}>
                          {importing ? "..." : "Import"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Image</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2">UOM</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2 text-right">Reorder</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <tr key={i.id} className="ui-tr-hover">
                      <td className="px-3 py-2">
                        {i.image_attachment_id ? (
                          // Uses backend inline endpoint for thumbnails
                          <Image
                            src={apiUrl(`/attachments/${i.image_attachment_id}/view`)}
                            alt={i.image_alt || i.name}
                            width={32}
                            height={32}
                            // Attachments are permissioned (cookie/session). Avoid Next.js optimization fetching without auth.
                            unoptimized
                            className="h-8 w-8 rounded-md border border-border-subtle object-cover"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-md border border-border-subtle bg-bg-sunken/40" />
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{i.sku}</td>
                      <td className="px-3 py-2">{i.name}</td>
                      <td className="px-3 py-2">{i.category_id ? categoryNameById.get(i.category_id) || "-" : "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{i.barcode || "-"}</td>
                      <td className="px-3 py-2">{i.unit_of_measure}</td>
                      <td className="px-3 py-2">{i.is_active === false ? <span className="text-fg-subtle">No</span> : "Yes"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(i.reorder_point || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })} /{" "}
                        {Number(i.reorder_qty || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => openEdit(i)}>
                            Edit
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => openBarcodeManager(i)}>
                            Barcodes
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => openSupplierManager(i)}>
                            Suppliers
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={9}>
                        No items found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <Dialog
              open={editOpen}
              onOpenChange={(o) => {
                setEditOpen(o);
                if (!o) {
                  setEditItem(null);
                  setEditing(false);
                }
              }}
            >
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Edit Item</DialogTitle>
                  <DialogDescription>
                    {editItem ? (
                      <span className="font-mono text-xs">{editItem.sku}</span>
                    ) : (
                      "Update catalog fields safely."
                    )}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-fg-muted">Name</label>
                        <Button type="button" size="sm" variant="outline" onClick={suggestBetterName} disabled={suggestingName || !editName.trim()}>
                          {suggestingName ? "..." : "AI Suggest"}
                        </Button>
                      </div>
                      <Input
                        value={editName}
                        onChange={(e) => {
                          setEditName(e.target.value);
                          if (nameSuggestions.length) setNameSuggestions([]);
                        }}
                      />
                      {nameSuggestions.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {nameSuggestions.slice(0, 4).map((s, idx) => (
                            <Button
                              key={`${s.name}-${idx}`}
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditName(s.name);
                                setNameSuggestions([]);
                              }}
                              title={s.reason || ""}
                            >
                              {s.name}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Item Type</label>
                      <select className="ui-select" value={editItemType} onChange={(e) => setEditItemType(e.target.value as any)}>
                        <option value="stocked">Stocked</option>
                        <option value="service">Service</option>
                        <option value="bundle">Bundle/Kit</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">UOM</label>
                      <SearchableSelect
                        value={editUom}
                        onChange={setEditUom}
                        placeholder="Select UOM..."
                        searchPlaceholder="Search UOMs..."
                        options={uomOptions}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Primary Barcode (optional)</label>
                      <Input value={editBarcode} onChange={(e) => setEditBarcode(e.target.value)} placeholder="629..." />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Tax Code (optional)</label>
                      <SearchableSelect
                        value={editTaxCodeId}
                        onChange={setEditTaxCodeId}
                        searchPlaceholder="Search tax codes..."
                        options={[
                          { value: "", label: "(none)" },
                          ...taxCodes.map((t) => ({
                            value: t.id,
                            label: `${t.name} (${(Number(t.rate || 0) * 100).toFixed(2)}%)`,
                            keywords: String(t.rate ?? ""),
                          })),
                        ]}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Reorder Point</label>
                      <Input value={editReorderPoint} onChange={(e) => setEditReorderPoint(e.target.value)} placeholder="0" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Reorder Qty</label>
                      <Input value={editReorderQty} onChange={(e) => setEditReorderQty(e.target.value)} placeholder="0" />
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-bg-elevated p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-fg-muted">Item Image</div>
                      {editImageAttachmentId ? (
                        <Button type="button" size="sm" variant="outline" disabled={imageUploading} onClick={removeItemImage}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[120px_1fr]">
                      <div className="flex items-start">
                        {editImageAttachmentId ? (
                          <Image
                            src={apiUrl(`/attachments/${editImageAttachmentId}/view`)}
                            alt={editImageAlt || editName || "Item image"}
                            width={96}
                            height={96}
                            // Attachments are permissioned (cookie/session). Avoid Next.js optimization fetching without auth.
                            unoptimized
                            className="h-24 w-24 rounded-md border border-border object-cover"
                          />
                        ) : (
                          <div className="h-24 w-24 rounded-md border border-border bg-bg-sunken/20" />
                        )}
                      </div>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Upload (PNG/JPG, max 5MB)</label>
                          <input
                            type="file"
                            accept="image/*"
                            disabled={imageUploading || !editItem}
                            className="block w-full text-xs"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              // allow re-uploading the same file later
                              e.currentTarget.value = "";
                              if (!f) return;
                              await uploadItemImage(f);
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Alt Text (for website/app)</label>
                          <Input value={editImageAlt} onChange={(e) => setEditImageAlt(e.target.value)} placeholder="e.g. 'Milk 1L bottle'" />
                        </div>
                        <div className="text-[11px] text-fg-subtle">
                          Tip: keep the background clean and the product centered. This will be used as consumer metadata later.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-bg-elevated p-3">
                    <div className="text-xs font-medium text-fg-muted">Master Data</div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Category</label>
                        <SearchableSelect
                          value={editCategoryId}
                          onChange={setEditCategoryId}
                          searchPlaceholder="Search categories..."
                          options={[
                            { value: "", label: "(none)" },
                            ...categories.map((c) => ({ value: c.id, label: c.name })),
                          ]}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Active?</label>
                        <select className="ui-select" value={editIsActive ? "yes" : "no"} onChange={(e) => setEditIsActive(e.target.value === "yes")}>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Brand</label>
                        <Input value={editBrand} onChange={(e) => setEditBrand(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Short Name</label>
                        <Input value={editShortName} onChange={(e) => setEditShortName(e.target.value)} placeholder="Optional (POS label)" />
                      </div>

                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-fg-muted">Description</label>
                        <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Optional" />
                      </div>

                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-fg-muted">Tags (comma-separated)</label>
                        <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="e.g. dairy, chilled, local" />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Track Batches?</label>
                        <select
                          className="ui-select"
                          value={editTrackBatches ? "yes" : "no"}
                          onChange={(e) => setEditTrackBatches(e.target.value === "yes")}
                        >
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Track Expiry?</label>
                        <select
                          className="ui-select"
                          value={editTrackExpiry ? "yes" : "no"}
                          onChange={(e) => setEditTrackExpiry(e.target.value === "yes")}
                        >
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Default Shelf Life (days)</label>
                        <Input value={editDefaultShelfLifeDays} onChange={(e) => setEditDefaultShelfLifeDays(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Min Shelf Life For Sale (days)</label>
                        <Input
                          value={editMinShelfLifeDaysForSale}
                          onChange={(e) => setEditMinShelfLifeDaysForSale(e.target.value)}
                          placeholder="Optional"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-fg-muted">Expiry Warning (days)</label>
                        <Input value={editExpiryWarningDays} onChange={(e) => setEditExpiryWarningDays(e.target.value)} placeholder="Optional" />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={editing || !editItem}>
                      {editing ? "..." : "Save"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog
              open={barcodeOpen}
              onOpenChange={(o) => {
                setBarcodeOpen(o);
                if (!o) {
                  setBarcodeItem(null);
                  setBarcodes([]);
                  setBarcodeStatus("");
                }
              }}
            >
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Item Barcodes</DialogTitle>
                  <DialogDescription>
                    {barcodeItem ? (
                      <span className="font-mono text-xs">
                        {barcodeItem.sku} · {barcodeItem.name}
                      </span>
                    ) : (
                      "Manage scan codes (EA/CASE/PACK)."
                    )}
                  </DialogDescription>
                </DialogHeader>

                {barcodeStatus ? <ViewRaw value={barcodeStatus} label="Details" /> : null}

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
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(b.qty_factor || 1).toLocaleString("en-US")}</td>
                          <td className="px-3 py-2">{b.label || "-"}</td>
                          <td className="px-3 py-2">{b.is_primary ? "Yes" : "No"}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => setPrimary(b.id)} disabled={b.is_primary}>
                                Set Primary
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => removeBarcode(b.id)}>
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {barcodes.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                            No barcodes yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <form onSubmit={addBarcode} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-fg-muted">Barcode</label>
                    <Input value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} placeholder="629..." />
                  </div>
                  <div className="space-y-1 md:col-span-1">
                    <label className="text-xs font-medium text-fg-muted">Factor</label>
                    <Input value={newFactor} onChange={(e) => setNewFactor(e.target.value)} placeholder="12" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Label</label>
                    <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Case of 12" />
                  </div>
                  <div className="md:col-span-6 flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-fg-muted">
                      <input type="checkbox" checked={newPrimary} onChange={(e) => setNewPrimary(e.target.checked)} />
                      Make primary
                    </label>
                    <Button type="submit" disabled={!barcodeItem}>
                      Add
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog
              open={supplierOpen}
              onOpenChange={(o) => {
                setSupplierOpen(o);
                if (!o) {
                  setSupplierItem(null);
                  setSuppliers([]);
                  setItemLinks([]);
                  setSupplierStatus("");
                }
              }}
            >
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Item Suppliers</DialogTitle>
                  <DialogDescription>
                    {supplierItem ? (
                      <span className="font-mono text-xs">
                        {supplierItem.sku} · {supplierItem.name}
                      </span>
                    ) : (
                      "Link suppliers to items for purchasing + AI demand recommendations."
                    )}
                  </DialogDescription>
                </DialogHeader>

                {supplierStatus ? <ViewRaw value={supplierStatus} label="Details" /> : null}

                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead className="ui-thead">
                      <tr>
                        <th className="px-3 py-2">Supplier</th>
                        <th className="px-3 py-2">Primary</th>
                        <th className="px-3 py-2 text-right">Lead Time</th>
                        <th className="px-3 py-2 text-right">Min Qty</th>
                        <th className="px-3 py-2 text-right">Last Cost USD</th>
                        <th className="px-3 py-2 text-right">Last Cost LL</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemLinks.map((l) => (
                        <tr key={l.id} className="ui-tr-hover">
                          <td className="px-3 py-2">{l.name}</td>
                          <td className="px-3 py-2 text-xs">{l.is_primary ? "Yes" : "No"}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.lead_time_days || 0)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.min_order_qty || 0).toLocaleString("en-US")}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.last_cost_usd || 0).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.last_cost_lbp || 0).toLocaleString("en-US")}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => openEditSupplierLink(l)}>
                                Edit
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => deleteSupplierLink(l.id)}>
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {itemLinks.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-fg-subtle" colSpan={7}>
                            No suppliers linked yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Add Supplier Link</CardTitle>
                    <CardDescription>Pick a supplier and optionally set a primary.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={addSupplierLink} className="grid grid-cols-1 gap-3 md:grid-cols-8">
                      <div className="space-y-1 md:col-span-3">
                        <label className="text-xs font-medium text-fg-muted">Supplier</label>
                        <select
                          className="h-10 w-full rounded-md border border-border bg-bg-elevated px-3 text-sm"
                          value={addSupplierId}
                          onChange={(e) => setAddSupplierId(e.target.value)}
                        >
                          <option value="">Select supplier...</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1 md:col-span-1">
                        <label className="text-xs font-medium text-fg-muted">Lead Time</label>
                        <Input value={addLeadTimeDays} onChange={(e) => setAddLeadTimeDays(e.target.value)} placeholder="0" />
                      </div>
                      <div className="space-y-1 md:col-span-1">
                        <label className="text-xs font-medium text-fg-muted">Min Qty</label>
                        <Input value={addMinOrderQty} onChange={(e) => setAddMinOrderQty(e.target.value)} placeholder="0" />
                      </div>
                      <div className="space-y-1 md:col-span-1">
                        <label className="text-xs font-medium text-fg-muted">Last USD</label>
                        <Input value={addLastCostUsd} onChange={(e) => setAddLastCostUsd(e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="space-y-1 md:col-span-1">
                        <label className="text-xs font-medium text-fg-muted">Last LL</label>
                        <Input value={addLastCostLbp} onChange={(e) => setAddLastCostLbp(e.target.value)} placeholder="0" />
                      </div>
                      <div className="flex items-end md:col-span-1">
                        <label className="flex items-center gap-2 text-xs text-fg-muted">
                          <input type="checkbox" checked={addIsPrimary} onChange={(e) => setAddIsPrimary(e.target.checked)} />
                          Primary
                        </label>
                      </div>
                      <div className="md:col-span-8 flex justify-end">
                        <Button type="submit" disabled={addingLink}>
                          {addingLink ? "..." : "Add / Update"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>

                <Dialog open={editLinkOpen} onOpenChange={setEditLinkOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit Link</DialogTitle>
                      <DialogDescription>Update purchasing fields and primary supplier.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={saveEditSupplierLink} className="grid grid-cols-1 gap-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Lead Time (days)</label>
                          <Input value={editLeadTimeDays} onChange={(e) => setEditLeadTimeDays(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Min Order Qty</label>
                          <Input value={editMinOrderQty} onChange={(e) => setEditMinOrderQty(e.target.value)} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Last Cost USD</label>
                          <Input value={editLastCostUsd} onChange={(e) => setEditLastCostUsd(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Last Cost LL</label>
                          <Input value={editLastCostLbp} onChange={(e) => setEditLastCostLbp(e.target.value)} />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-fg-muted">
                        <input type="checkbox" checked={editIsPrimary} onChange={(e) => setEditIsPrimary(e.target.checked)} />
                        Primary supplier for this item
                      </label>
                      <div className="flex justify-end">
                        <Button type="submit" disabled={savingLink}>
                          {savingLink ? "..." : "Save"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>);
}
