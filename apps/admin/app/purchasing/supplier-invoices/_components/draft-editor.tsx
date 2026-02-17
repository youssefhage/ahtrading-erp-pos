"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPatch, apiPost, apiPostForm, apiUrl } from "@/lib/api";
import { getFxRateUsdToLbp } from "@/lib/fx";
import { parseNumberInput } from "@/lib/numbers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ItemTypeahead, type ItemTypeaheadItem } from "@/components/item-typeahead";
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";
import { SearchableSelect } from "@/components/searchable-select";
import { ErrorBanner } from "@/components/error-banner";
import { FileInput } from "@/components/file-input";
type AttachmentRow = { id: string; filename: string; content_type: string; size_bytes: number; uploaded_at: string };
type ImportLineRow = {
  id: string;
  line_no: number;
  qty: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  supplier_item_code: string | null;
  supplier_item_name: string | null;
  description: string | null;
  suggested_item_id: string | null;
  suggested_sku: string | null;
  suggested_name: string | null;
  suggested_confidence: string | number;
  resolved_item_id: string | null;
  resolved_sku: string | null;
  resolved_name: string | null;
  status: string;
};

type TaxCode = {
  id: string;
  name: string;
  rate: string | number;
  tax_type: string;
  reporting_currency: string;
};

type UomConv = { uom_code: string; to_base_factor: string | number; is_active: boolean };

type InvoiceLineDraft = {
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  unit_of_measure?: string | null;
  uom?: string | null;
  qty_factor?: string | null;
  qty: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
  batch_no: string;
  expiry_date: string;
  goods_receipt_line_id?: string | null;
  supplier_item_code?: string | null;
  supplier_item_name?: string | null;
};

type InvoiceDetail = {
  invoice: {
    id: string;
    status: string;
    supplier_id: string | null;
    supplier_name?: string | null;
    invoice_no: string;
    supplier_ref?: string | null;
    exchange_rate: string | number;
    tax_code_id?: string | null;
    goods_receipt_id?: string | null;
    invoice_date: string;
    due_date: string;
    import_status?: string | null;
    import_error?: string | null;
    import_started_at?: string | null;
    import_finished_at?: string | null;
    import_attachment_id?: string | null;
  };
  lines: Array<{
    item_id: string;
    item_sku?: string | null;
    item_name?: string | null;
    unit_of_measure?: string | null;
    qty: string | number;
    uom?: string | null;
    qty_factor?: string | number | null;
    qty_entered?: string | number | null;
    unit_cost_usd: string | number;
    unit_cost_lbp: string | number;
    unit_cost_entered_usd?: string | number | null;
    unit_cost_entered_lbp?: string | number | null;
    batch_no: string | null;
    expiry_date: string | null;
    goods_receipt_line_id?: string | null;
    supplier_item_code?: string | null;
    supplier_item_name?: string | null;
  }>;
};

type InvoiceNavRow = {
  id: string;
  attachment_count?: number;
  import_status?: string | null;
};

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function buildUomOptions(base: string | null | undefined, convs: UomConv[]) {
  const seen = new Set<string>();
  const out: Array<{ value: string; label: string }> = [];
  for (const c of convs || []) {
    if (!c?.is_active) continue;
    const u = String(c.uom_code || "").trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push({ value: u, label: u });
  }
  const baseUom = String(base || "").trim().toUpperCase();
  if (baseUom && !seen.has(baseUom)) out.unshift({ value: baseUom, label: `${baseUom} (base)` });
  return out.length ? out : baseUom ? [{ value: baseUom, label: baseUom }] : [];
}

function supportsInlinePreview(contentType: string) {
  const ct = String(contentType || "").toLowerCase();
  return ct.startsWith("image/") || ct === "application/pdf";
}

function isTypingEventTarget(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false;
  const tag = (t.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((t as any).isContentEditable) return true;
  return false;
}

export function SupplierInvoiceDraftEditor(props: { mode: "create" | "edit"; invoiceId?: string }) {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPickKey, setImportPickKey] = useState(0);
  const [importAutoCreateSupplier, setImportAutoCreateSupplier] = useState(true);
  // Default off: require human mapping before creating new items.
  const [importAutoCreateItems, setImportAutoCreateItems] = useState(false);
  // Dev helper to test the end-to-end review/apply flow without OPENAI.
  const [importMockExtract, setImportMockExtract] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [previewAttachmentId, setPreviewAttachmentId] = useState("");
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentPickKey, setAttachmentPickKey] = useState(0);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);

  const [nameSuggestOpen, setNameSuggestOpen] = useState(false);
  const [nameSuggestLoading, setNameSuggestLoading] = useState(false);
  const [nameSuggestItemId, setNameSuggestItemId] = useState("");
  const [nameSuggestRaw, setNameSuggestRaw] = useState("");
  const [nameSuggestSuggestions, setNameSuggestSuggestions] = useState<string[]>([]);
  const [showSecondaryCurrency, setShowSecondaryCurrency] = useState(false);

  const [supplierId, setSupplierId] = useState("");
  const [supplierLabel, setSupplierLabel] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => todayIso());
  const [dueDate, setDueDate] = useState("");
  const [exchangeRate, setExchangeRate] = useState("90000");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [goodsReceiptId, setGoodsReceiptId] = useState("");

  const [lines, setLines] = useState<InvoiceLineDraft[]>([]);
  const [uomConvByItem, setUomConvByItem] = useState<Record<string, UomConv[]>>({});
  const [importStatus, setImportStatus] = useState("");
  const [importError, setImportError] = useState("");
  const [importLines, setImportLines] = useState<ImportLineRow[]>([]);
  const [importLinesLoading, setImportLinesLoading] = useState(false);
  const [importApplying, setImportApplying] = useState(false);

  const [addItem, setAddItem] = useState<ItemTypeaheadItem | null>(null);
  const [addQty, setAddQty] = useState("1");
  const [addUom, setAddUom] = useState("");
  const [addQtyFactor, setAddQtyFactor] = useState("1");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");
  const [addBatchNo, setAddBatchNo] = useState("");
  const [addExpiry, setAddExpiry] = useState("");
  const addQtyRef = useRef<HTMLInputElement | null>(null);
  const saveHotkeyRef = useRef<() => void>(() => {});
  const markReviewedHotkeyRef = useRef<() => void>(() => {});
  const supplierFieldRef = useRef<HTMLDivElement | null>(null);
  const supplierRefInputRef = useRef<HTMLInputElement | null>(null);
  const addItemRootRef = useRef<HTMLDivElement | null>(null);
  const autoFocusPendingRef = useRef(false);
  const supplierCostCache = useRef(new Map<string, { usd: number; lbp: number } | null>());
  const [prevDraftId, setPrevDraftId] = useState("");
  const [nextDraftId, setNextDraftId] = useState("");
  const [navLoading, setNavLoading] = useState(false);
  const [markReviewing, setMarkReviewing] = useState(false);
  const lineCount = lines.length;
  const importStatusLower = String(importStatus || "").toLowerCase();
  const canMarkReviewed = props.mode === "edit" && importStatusLower !== "pending" && importStatusLower !== "processing";

  const ensureUomConversions = useCallback(async (itemIds: string[]) => {
    const ids = Array.from(new Set((itemIds || []).map((x) => String(x || "").trim()).filter(Boolean)));
    if (!ids.length) return;
    try {
      const res = await apiPost<{ conversions: Record<string, UomConv[]> }>("/items/uom-conversions/lookup", { item_ids: ids });
      setUomConvByItem((prev) => ({ ...prev, ...(res.conversions || {}) }));
    } catch {
      // Non-blocking; base UOM still works without conversion data.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [tc, fx] = await Promise.all([
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes"),
        getFxRateUsdToLbp(),
      ]);
      setTaxCodes(tc.tax_codes || []);
      const defaultEx = Number(fx?.usd_to_lbp || 0) > 0 ? Number(fx.usd_to_lbp) : 90000;

      if (props.mode === "edit") {
        const id = props.invoiceId || "";
        if (!id) throw new Error("missing invoice id");
        const det = await apiGet<InvoiceDetail>(`/purchases/invoices/${id}`);
        if (det.invoice.status !== "draft") throw new Error("Only draft invoices can be edited.");

        setImportStatus(String((det.invoice as any).import_status || ""));
        setImportError(String((det.invoice as any).import_error || ""));

        setSupplierId(det.invoice.supplier_id || "");
        setSupplierLabel(String((det.invoice as any).supplier_name || ""));
        setInvoiceNo(det.invoice.invoice_no || "");
        setSupplierRef(String((det.invoice as any).supplier_ref || ""));
        setInvoiceDate(String(det.invoice.invoice_date || todayIso()).slice(0, 10));
        setDueDate(String(det.invoice.due_date || "").slice(0, 10));
        const ex = Number(det.invoice.exchange_rate || 0);
        setExchangeRate(String(ex > 0 ? ex : defaultEx));
        setTaxCodeId(String(det.invoice.tax_code_id || ""));
        setGoodsReceiptId(String(det.invoice.goods_receipt_id || ""));
        const mapped = (det.lines || []).map((l) => {
          const qtyFactor = Number((l as any).qty_factor || 1) || 1;
          const qtyEntered = Number((l as any).qty_entered ?? l.qty ?? 0);
          const uom = String((l as any).uom || (l as any).unit_of_measure || "").trim() || null;
          const unitUsdBase = Number(l.unit_cost_usd || 0);
          const unitLbpBase = Number(l.unit_cost_lbp || 0);
          const unitUsdEntered = Number((l as any).unit_cost_entered_usd ?? unitUsdBase * qtyFactor);
          const unitLbpEntered = Number((l as any).unit_cost_entered_lbp ?? unitLbpBase * qtyFactor);
          return {
            item_id: l.item_id,
            item_sku: (l as any).item_sku || null,
            item_name: (l as any).item_name || null,
            unit_of_measure: (l as any).unit_of_measure || null,
            uom,
            qty_factor: String(qtyFactor),
            qty: String(qtyEntered || 0),
            unit_cost_usd: String(unitUsdEntered || 0),
            unit_cost_lbp: String(unitLbpEntered || 0),
            batch_no: String(l.batch_no || ""),
            expiry_date: String(l.expiry_date || ""),
            goods_receipt_line_id: (l.goods_receipt_line_id as any) || null,
            supplier_item_code: (l.supplier_item_code as any) || null,
            supplier_item_name: (l.supplier_item_name as any) || null
          } satisfies InvoiceLineDraft;
        });
        setLines(mapped);
        await ensureUomConversions(Array.from(new Set(mapped.map((l) => l.item_id).filter(Boolean))));

        // Attachments are optional; don't block editing if the user lacks access.
        await reloadAttachments(id);

        const st = String((det.invoice as any).import_status || "").toLowerCase();
        if (st === "pending_review") {
          setImportLinesLoading(true);
          try {
            const il = await apiGet<{ import_lines: ImportLineRow[] }>(`/purchases/invoices/${id}/import-lines`);
            setImportLines(il.import_lines || []);
          } catch {
            setImportLines([]);
          } finally {
            setImportLinesLoading(false);
          }
        } else {
          setImportLines([]);
          setImportLinesLoading(false);
        }
        autoFocusPendingRef.current = true;
      } else {
        setSupplierId("");
        setSupplierLabel("");
        setInvoiceNo("");
        setSupplierRef("");
        setInvoiceDate(todayIso());
        setDueDate("");
        setExchangeRate(String(defaultEx));
        setTaxCodeId("");
        setGoodsReceiptId("");
        setLines([]);
        setUomConvByItem({});
        setAttachments([]);
        setImportStatus("");
        setImportError("");
        setImportLines([]);
        setImportLinesLoading(false);
        autoFocusPendingRef.current = false;
      }

      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [props.mode, props.invoiceId, ensureUomConversions]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (loading) return;
      if (isTypingEventTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = (e.key || "").toLowerCase();
      if (!mod) return;

      if (key === "s") {
        e.preventDefault();
        saveHotkeyRef.current?.();
        return;
      }
      if (key === "enter" && e.shiftKey) {
        if (!canMarkReviewed) return;
        e.preventDefault();
        markReviewedHotkeyRef.current?.();
        return;
      }
      if (key === "enter") {
        e.preventDefault();
        saveHotkeyRef.current?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, canMarkReviewed]);

  useEffect(() => {
    if (!attachments.length) {
      setPreviewAttachmentId("");
      return;
    }
    if (!previewAttachmentId || !attachments.some((a) => String(a.id) === String(previewAttachmentId))) {
      setPreviewAttachmentId(String(attachments[0].id || ""));
    }
  }, [attachments, previewAttachmentId]);

  const refreshDraftNeighbors = useCallback(async () => {
    if (props.mode !== "edit") return;
    const currentId = (props.invoiceId || "").trim();
    if (!currentId) {
      setPrevDraftId("");
      setNextDraftId("");
      return;
    }
    setNavLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("status", "draft");
      qs.set("sort", "created_at");
      qs.set("dir", "desc");
      const st = String(importStatus || "").trim().toLowerCase();
      if (st && st !== "none") qs.set("import_status", st);
      const res = await apiGet<{ invoices: InvoiceNavRow[] }>(`/purchases/invoices?${qs.toString()}`);
      const invoices = (res.invoices || []).filter((r) => String(r?.id || "").trim());
      const withAttachments = invoices.filter((r) => Number(r.attachment_count || 0) > 0);
      const source = withAttachments.length ? withAttachments : invoices;
      const idx = source.findIndex((r) => String(r.id) === currentId);
      if (idx < 0) {
        setPrevDraftId("");
        setNextDraftId("");
        return;
      }
      setPrevDraftId(String(source[idx - 1]?.id || ""));
      setNextDraftId(String(source[idx + 1]?.id || ""));
    } catch {
      setPrevDraftId("");
      setNextDraftId("");
    } finally {
      setNavLoading(false);
    }
  }, [props.mode, props.invoiceId, importStatus]);

  useEffect(() => {
    if (props.mode !== "edit") return;
    if (loading) return;
    void refreshDraftNeighbors();
  }, [props.mode, loading, refreshDraftNeighbors]);

  useEffect(() => {
    if (props.mode !== "edit") return;
    if (loading) return;
    if (!autoFocusPendingRef.current) return;

    const focusWithin = (root: HTMLElement | null) => {
      const input = root?.querySelector<HTMLInputElement>("input:not([type='hidden']):not([disabled])");
      if (!input) return false;
      input.focus();
      try {
        input.select?.();
      } catch {
        // ignore
      }
      return true;
    };

    let focused = false;
    if (!String(supplierId || "").trim()) {
      focused = focusWithin(supplierFieldRef.current);
    } else if (!String(supplierRef || "").trim()) {
      if (supplierRefInputRef.current) {
        supplierRefInputRef.current.focus();
        try {
          supplierRefInputRef.current.select?.();
        } catch {
          // ignore
        }
        focused = true;
      }
    } else if (lineCount === 0) {
      focused = focusWithin(addItemRootRef.current);
    }

    autoFocusPendingRef.current = false;
    if (!focused) return;
  }, [props.mode, loading, supplierId, supplierRef, lineCount]);

  useEffect(() => {
    if (props.mode !== "edit") return;
    function onKeyDown(e: KeyboardEvent) {
      if (loading || saving || navLoading) return;
      if (isTypingEventTarget(e.target)) return;
      const key = (e.key || "").toLowerCase();
      if ((e.altKey && key === "arrowup") || key === "[") {
        if (!prevDraftId) return;
        e.preventDefault();
        router.push(`/purchasing/supplier-invoices/${encodeURIComponent(prevDraftId)}/edit`);
        return;
      }
      if ((e.altKey && key === "arrowdown") || key === "]") {
        if (!nextDraftId) return;
        e.preventDefault();
        router.push(`/purchasing/supplier-invoices/${encodeURIComponent(nextDraftId)}/edit`);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.mode, loading, saving, navLoading, prevDraftId, nextDraftId, router]);

  // If this draft was created via async import, poll until the worker fills it.
  useEffect(() => {
    if (props.mode !== "edit") return;
    const st = (importStatus || "").toLowerCase();
    if (st !== "pending" && st !== "processing") return;
    const t = window.setTimeout(() => {
      load();
    }, 2000);
    return () => window.clearTimeout(t);
  }, [props.mode, importStatus, load]);

  async function setImportLineResolvedId(lineId: string, resolvedItemId: string | null) {
    const invId = props.invoiceId || "";
    if (!invId) return;
    setStatus("Saving import mapping...");
    try {
      await apiPatch(`/purchases/invoices/${encodeURIComponent(invId)}/import-lines/${encodeURIComponent(lineId)}`, {
        resolved_item_id: resolvedItemId,
      });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function setImportLineSkipped(lineId: string, skipped: boolean) {
    const invId = props.invoiceId || "";
    if (!invId) return;
    setStatus("Saving import mapping...");
    try {
      await apiPatch(`/purchases/invoices/${encodeURIComponent(invId)}/import-lines/${encodeURIComponent(lineId)}`, {
        status: skipped ? "skipped" : "pending",
        resolved_item_id: null,
      });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function applyImportLines() {
    const invId = props.invoiceId || "";
    if (!invId) return;
    setImportApplying(true);
    setStatus("Applying import lines...");
    try {
      await apiPost(`/purchases/invoices/${encodeURIComponent(invId)}/import-lines/apply`, {});
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setImportApplying(false);
    }
  }

  async function fetchSupplierLastCost(itemId: string): Promise<{ usd: number; lbp: number } | null> {
    const sup = (supplierId || "").trim();
    if (!sup) return null;
    const key = `${sup}:${itemId}`;
    if (supplierCostCache.current.has(key)) return supplierCostCache.current.get(key) || null;
    try {
      const res = await apiGet<{
        suppliers: Array<{ supplier_id: string; last_cost_usd: string | number | null; last_cost_lbp: string | number | null }>;
      }>(`/suppliers/items/${encodeURIComponent(itemId)}`);
      const row = (res.suppliers || []).find((r) => r.supplier_id === sup);
      const usd = row ? toNum(String(row.last_cost_usd ?? "")) : 0;
      const lbp = row ? toNum(String(row.last_cost_lbp ?? "")) : 0;
      const val = usd > 0 || lbp > 0 ? { usd, lbp } : null;
      supplierCostCache.current.set(key, val);
      return val;
    } catch {
      supplierCostCache.current.set(key, null);
      return null;
    }
  }

  const addUomOptions = useMemo(() => {
    if (!addItem) return [];
    const convs = uomConvByItem[addItem.id] || [];
    return buildUomOptions((addItem as any).unit_of_measure ?? null, convs);
  }, [addItem, uomConvByItem]);

  async function onPickItem(it: ItemTypeaheadItem) {
    setAddItem(it);
    await ensureUomConversions([it.id]);
    setAddQty("1");
    const baseUom = String((it as any).unit_of_measure || "").trim().toUpperCase();
    setAddUom(baseUom);
    setAddQtyFactor("1");
    setAddBatchNo("");
    setAddExpiry("");

    // Prefer supplier-specific last cost when available.
    const last = await fetchSupplierLastCost(it.id);
    setAddUsd(last?.usd ? String(last.usd) : "");
    setAddLbp(last?.lbp ? String(last.lbp) : "");

    setStatus("");
    setTimeout(() => addQtyRef.current?.focus(), 0);
  }

  function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!addItem) return setStatus("Select an item.");
    const qtyEntered = toNum(addQty);
    if (qtyEntered <= 0) return setStatus("qty must be > 0");
    const qtyFactor = toNum(addQtyFactor || "1") || 1;
    if (qtyFactor <= 0) return setStatus("qty factor must be > 0");
    let unitUsd = toNum(addUsd);
    let unitLbp = toNum(addLbp);
    const ex = toNum(exchangeRate);
    if (ex > 0) {
      if (unitUsd === 0 && unitLbp > 0) unitUsd = unitLbp / ex;
      if (unitLbp === 0 && unitUsd > 0) unitLbp = unitUsd * ex;
    }
    if (unitUsd === 0 && unitLbp === 0) return setStatus("Set USD or LBP unit cost.");
    const uom = String(addUom || (addItem as any).unit_of_measure || "").trim().toUpperCase() || null;
    if (!uom) return setStatus("UOM is required.");
    setLines((prev) => [
      ...prev,
      {
        item_id: addItem.id,
        item_sku: addItem.sku,
        item_name: addItem.name,
        unit_of_measure: (addItem as any).unit_of_measure ?? null,
        uom,
        qty_factor: String(qtyFactor),
        qty: String(qtyEntered),
        unit_cost_usd: String(unitUsd),
        unit_cost_lbp: String(unitLbp),
        batch_no: addBatchNo || "",
        expiry_date: addExpiry || "",
        supplier_item_code: null,
        supplier_item_name: null
      }
    ]);
    setAddItem(null);
    setAddQty("1");
    setAddUom("");
    setAddQtyFactor("1");
    setAddUsd("");
    setAddLbp("");
    setAddBatchNo("");
    setAddExpiry("");
    setStatus("");
  }

  function patchLine(idx: number, patch: Partial<InvoiceLineDraft>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const out = { ...l, ...patch };
        const ex = toNum(exchangeRate);
        if (ex > 0) {
          const usd = toNum(String(out.unit_cost_usd || 0));
          const lbp = toNum(String(out.unit_cost_lbp || 0));
          if (patch.unit_cost_usd !== undefined && usd > 0 && lbp === 0) out.unit_cost_lbp = String(usd * ex);
          if (patch.unit_cost_lbp !== undefined && lbp > 0 && usd === 0) out.unit_cost_usd = String(lbp / ex);
        }
        return out;
      })
    );
  }

  function focusLineInput(nextIdx: number, field: string) {
    const sel = `[data-line-idx="${nextIdx}"][data-line-field="${field}"]`;
    const el = document.querySelector<HTMLInputElement>(sel);
    el?.focus();
    el?.select?.();
  }

  function onLineKeyDown(e: React.KeyboardEvent<HTMLInputElement>, idx: number, field: string) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusLineInput(Math.min(lines.length - 1, idx + 1), field);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusLineInput(Math.max(0, idx - 1), field);
      return;
    }
  }

  async function save(
    e?: React.FormEvent,
    opts?: { navigateOnEdit?: boolean; onSaved?: () => Promise<void> | void; throwOnError?: boolean }
  ) {
    e?.preventDefault();
    if (!supplierId) return setStatus("supplier is required");
    const navigateOnEdit = opts?.navigateOnEdit ?? true;

    const exRes = parseNumberInput(exchangeRate);
    if (!exRes.ok && exRes.reason === "invalid") return setStatus("Invalid exchange rate.");
    const ex = exRes.ok ? exRes.value : 0;

    const linesOut: Array<{
      item_id: string;
      goods_receipt_line_id?: string;
      qty: number; // base qty
      uom?: string | null;
      qty_factor?: number | null;
      qty_entered?: number | null;
      unit_cost_usd: number;
      unit_cost_lbp: number;
      unit_cost_entered_usd?: number | null;
      unit_cost_entered_lbp?: number | null;
      batch_no?: string;
      expiry_date?: string;
      supplier_item_code?: string | null;
      supplier_item_name?: string | null;
    }> = [];
    for (let i = 0; i < (lines || []).length; i++) {
      const l = lines[i];
      const qtyRes = parseNumberInput(l.qty);
      const usdRes = parseNumberInput(l.unit_cost_usd);
      const lbpRes = parseNumberInput(l.unit_cost_lbp);
      if (!qtyRes.ok && qtyRes.reason === "invalid") return setStatus(`Invalid qty on item ${i + 1}.`);
      if (!usdRes.ok && usdRes.reason === "invalid") return setStatus(`Invalid unit USD on item ${i + 1}.`);
      if (!lbpRes.ok && lbpRes.reason === "invalid") return setStatus(`Invalid unit LBP on item ${i + 1}.`);
      const qtyEntered = qtyRes.ok ? qtyRes.value : 0;
      const qtyFactor = toNum(String(l.qty_factor || "1")) || 1;
      let unitEnteredUsd = usdRes.ok ? usdRes.value : 0;
      let unitEnteredLbp = lbpRes.ok ? lbpRes.value : 0;
      if (qtyEntered <= 0) return setStatus(`Qty must be > 0 (item ${i + 1}).`);
      if (qtyFactor <= 0) return setStatus(`qty_factor must be > 0 (item ${i + 1}).`);
      const uom = String(l.uom || l.unit_of_measure || "").trim().toUpperCase() || null;
      if (!uom) return setStatus(`Missing UOM (item ${i + 1}).`);
      if (ex > 0) {
        if (unitEnteredUsd === 0 && unitEnteredLbp > 0) unitEnteredUsd = unitEnteredLbp / ex;
        if (unitEnteredLbp === 0 && unitEnteredUsd > 0) unitEnteredLbp = unitEnteredUsd * ex;
      }
      if (unitEnteredUsd === 0 && unitEnteredLbp === 0) return setStatus(`Set USD or LBP unit cost (item ${i + 1}).`);
      const qtyBase = qtyEntered * qtyFactor;
      const unitUsd = unitEnteredUsd / qtyFactor;
      const unitLbp = unitEnteredLbp / qtyFactor;
      linesOut.push({
        item_id: l.item_id,
        goods_receipt_line_id: l.goods_receipt_line_id || undefined,
        qty: qtyBase,
        uom,
        qty_factor: qtyFactor,
        qty_entered: qtyEntered,
        unit_cost_usd: unitUsd,
        unit_cost_lbp: unitLbp,
        unit_cost_entered_usd: unitEnteredUsd,
        unit_cost_entered_lbp: unitEnteredLbp,
        batch_no: (l.batch_no || "").trim() || undefined,
        expiry_date: (l.expiry_date || "").trim() || undefined,
        supplier_item_code: (l.supplier_item_code || null) as any,
        supplier_item_name: (l.supplier_item_name || null) as any
      });
    }

    setSaving(true);
    setStatus(props.mode === "edit" ? "Saving draft..." : "Creating draft...");
    try {
      const payload = {
        supplier_id: supplierId,
        invoice_no: invoiceNo || undefined,
        supplier_ref: supplierRef.trim() || undefined,
        exchange_rate: ex,
        invoice_date: invoiceDate || undefined,
        due_date: dueDate || undefined,
        tax_code_id: taxCodeId || undefined,
        goods_receipt_id: goodsReceiptId || undefined,
        lines: linesOut
      };

      if (props.mode === "edit") {
        const id = props.invoiceId || "";
        if (!id) throw new Error("missing invoice id");
        await apiPatch(`/purchases/invoices/${id}/draft`, payload);
        setStatus("");
        if (typeof opts?.onSaved === "function") await opts.onSaved();
        if (navigateOnEdit) {
          router.push(`/purchasing/supplier-invoices/${id}`);
        }
      } else {
        const res = await apiPost<{ id: string }>("/purchases/invoices/drafts", payload);
        setStatus("");
        if (typeof opts?.onSaved === "function") await opts.onSaved();
        router.push(`/purchasing/supplier-invoices/${res.id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
      if (opts?.throwOnError) throw err;
    } finally {
      setSaving(false);
    }
  }

  // Avoid hotkey effect re-attaching every render: keep latest save() in a ref.
  saveHotkeyRef.current = () => void save();
  markReviewedHotkeyRef.current = () => void markReviewedAndNext();

  const title = props.mode === "edit" ? "Edit Draft Supplier Invoice" : "Create Draft Supplier Invoice";
  const previewAttachment = useMemo(() => {
    if (!attachments.length) return null;
    const selected = attachments.find((a) => String(a.id) === String(previewAttachmentId));
    return selected || attachments[0] || null;
  }, [attachments, previewAttachmentId]);
  const previewUrl = previewAttachment ? apiUrl(`/attachments/${encodeURIComponent(previewAttachment.id)}/view`) : "";
  const hasInlinePreview = previewAttachment ? supportsInlinePreview(String(previewAttachment.content_type || "")) : false;

  async function markReviewedAndNext() {
    if (props.mode !== "edit") return;
    const id = (props.invoiceId || "").trim();
    if (!id) return;

    setMarkReviewing(true);
    setStatus("Saving + marking reviewed...");
    let marked = false;
    try {
      await save(undefined, {
        navigateOnEdit: false,
        throwOnError: true,
        onSaved: async () => {
          const res = await apiPost<{ ok: boolean; import_status?: string; line_count?: number }>(
            `/purchases/invoices/${encodeURIComponent(id)}/import-review/mark`,
            {}
          );
          setImportStatus(String(res.import_status || ""));
          marked = true;
        },
      });
      if (!marked) return;
      if (nextDraftId) {
        router.push(`/purchasing/supplier-invoices/${encodeURIComponent(nextDraftId)}/edit`);
        return;
      }
      await refreshDraftNeighbors();
      setStatus("Marked reviewed. No next draft in the current queue.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setMarkReviewing(false);
    }
  }

  async function reloadAttachments(id: string) {
    try {
      const a = await apiGet<{ attachments: AttachmentRow[] }>(`/attachments?entity_type=supplier_invoice&entity_id=${encodeURIComponent(id)}`);
      setAttachments(a.attachments || []);
    } catch {
      setAttachments([]);
    }
  }

  async function importFromFile(e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.querySelector<HTMLInputElement>("input[name='import_file']");
    const f = input?.files?.[0];
    if (!f) return setStatus("Pick a file to import.");

    setImporting(true);
    setStatus("Uploading and extracting...");
    try {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("exchange_rate", exchangeRate || "0");
      if (taxCodeId) fd.set("tax_code_id", taxCodeId);
      fd.set("auto_create_supplier", importAutoCreateSupplier ? "true" : "false");
      fd.set("auto_create_items", importAutoCreateItems ? "true" : "false");
      if (importMockExtract) fd.set("mock_extract", "true");

      const res = await apiPostForm<{ id: string; invoice_no: string; queued?: boolean; ai_extracted?: boolean; warnings?: string[] }>(
        "/purchases/invoices/drafts/import-file",
        fd
      );
      if (Array.isArray(res.warnings) && res.warnings.length) {
        setStatus(`Imported with warnings:\n${res.warnings.slice(0, 10).join("\n")}`);
      } else {
        setStatus("");
      }
      router.push(`/purchasing/supplier-invoices/${res.id}/edit`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setImporting(false);
      setImportPickKey((k) => k + 1);
    }
  }

  async function uploadAttachment(e: React.FormEvent) {
    e.preventDefault();
    const id = props.invoiceId || "";
    if (!id) return setStatus("missing invoice id");
    const form = e.target as HTMLFormElement;
    const input = form.querySelector<HTMLInputElement>("input[name='attachment_file']");
    const f = input?.files?.[0];
    if (!f) return setStatus("Pick a file to attach.");

    setAttachmentUploading(true);
    setStatus("Uploading attachment...");
    try {
      const fd = new FormData();
      fd.set("entity_type", "supplier_invoice");
      fd.set("entity_id", id);
      fd.set("file", f);

      await apiPostForm<{ id: string }>("/attachments", fd);
      await reloadAttachments(id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setAttachmentUploading(false);
      setAttachmentPickKey((k) => k + 1);
    }
  }

  async function openNameSuggestions(line: InvoiceLineDraft) {
    const raw = String(line.supplier_item_name || line.item_name || "").trim();
    if (!raw) return setStatus("No item name to suggest from.");
    setNameSuggestItemId(line.item_id);
    setNameSuggestRaw(raw);
    setNameSuggestSuggestions([]);
    setNameSuggestOpen(true);
    setNameSuggestLoading(true);
    setStatus("Generating name suggestions...");
    try {
      const res = await apiPost<{ suggestions: string[] }>("/items/name-suggestions", { raw_name: raw, count: 5 });
      setNameSuggestSuggestions((res.suggestions || []).filter((s) => String(s || "").trim()));
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
      setNameSuggestOpen(false);
    } finally {
      setNameSuggestLoading(false);
    }
  }

  async function applyNameSuggestion(nextName: string) {
    const itemId = (nameSuggestItemId || "").trim();
    const name = String(nextName || "").trim();
    if (!itemId || !name) return;
    setNameSuggestLoading(true);
    setStatus("Updating item name...");
    try {
      await apiPatch(`/items/${encodeURIComponent(itemId)}`, { name });
      setLines((prev) => prev.map((l) => (l.item_id === itemId ? { ...l, item_name: name } : l)));
      setStatus("");
      setNameSuggestOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setNameSuggestLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-fg-muted">Draft first, then Post when ready (stock + GL).</p>
        </div>
        <div className="flex items-center gap-2">
          {props.mode === "edit" ? (
            <>
              <Button
                variant="outline"
                onClick={() => prevDraftId && router.push(`/purchasing/supplier-invoices/${encodeURIComponent(prevDraftId)}/edit`)}
                disabled={!prevDraftId || loading || saving || navLoading}
                title="Shortcut: [ or Alt+Up"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => nextDraftId && router.push(`/purchasing/supplier-invoices/${encodeURIComponent(nextDraftId)}/edit`)}
                disabled={!nextDraftId || loading || saving || navLoading}
                title="Shortcut: ] or Alt+Down"
              >
                Next
              </Button>
              <Button
                onClick={() => void markReviewedAndNext()}
                disabled={!canMarkReviewed || loading || saving || markReviewing}
                title="Save draft, mark reviewed, then open next draft"
              >
                {markReviewing ? "Reviewing..." : "Mark Reviewed + Next"}
              </Button>
            </>
          ) : null}
          <Button variant="outline" onClick={() => router.push("/purchasing/supplier-invoices")}>
            Back
          </Button>
        </div>
      </div>

      {status ? (
        <ErrorBanner error={status} onRetry={load} />
      ) : null}

      <div
        className={
          props.mode === "edit"
            ? "grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_34rem] 2xl:grid-cols-[minmax(0,1fr)_38rem]"
            : "space-y-6"
        }
      >
      <div className="space-y-6">

      {props.mode === "edit" && importStatus ? (
        <Card>
          <CardHeader>
            <CardTitle>Import Status</CardTitle>
            <CardDescription>
              {String(importStatus).toLowerCase() === "pending" || String(importStatus).toLowerCase() === "processing"
                ? "Import is in progress. This page will refresh automatically."
                : String(importStatus).toLowerCase() === "pending_review"
                ? "Import is ready for review. Map each imported row to an item, then apply."
                : "Import has finished."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-fg-subtle">Status:</span> <span className="font-mono text-xs">{importStatus}</span>
            </div>
            {importError ? (
              <div className="rounded-md border border-border bg-bg-sunken/30 p-2 text-xs whitespace-pre-wrap">
                {importError}
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={load} disabled={loading}>
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {props.mode === "edit" && String(importStatus).toLowerCase() === "pending_review" ? (
        <Card>
          <CardHeader>
            <CardTitle>Imported Items (Review)</CardTitle>
            <CardDescription>Confirm item matches before we create invoice lines.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {importLinesLoading ? <div className="text-sm text-fg-muted">Loading import lines...</div> : null}
            {!importLinesLoading && importLines.length === 0 ? (
              <div className="text-sm text-fg-muted">No import lines found.</div>
            ) : null}

            {importLines.length ? (
              <div className="ui-table-scroll">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">Line</th>
                      <th className="px-3 py-2">Supplier Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit USD</th>
                      <th className="px-3 py-2 text-right">Unit LBP</th>
                      <th className="px-3 py-2">Suggested</th>
                      <th className="px-3 py-2">Resolved Item</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importLines.map((l) => {
                      const st = String(l.status || "").toLowerCase();
                      const skipped = st === "skipped";
                      const resolved = st === "resolved" && !!l.resolved_item_id;
                      const suggestedLabel = l.suggested_sku ? `${l.suggested_sku} — ${l.suggested_name || ""}` : l.suggested_name || "-";
                      const resolvedLabel = l.resolved_sku ? `${l.resolved_sku} — ${l.resolved_name || ""}` : l.resolved_name || "-";
                      return (
                        <tr key={l.id} className="border-t border-border-subtle">
                          <td className="px-3 py-2 font-mono text-xs">{l.line_no}</td>
                          <td className="px-3 py-2 text-xs">
                            <div className="font-mono text-xs text-fg-muted">{l.supplier_item_code || "-"}</div>
                            <div className="font-medium">{l.supplier_item_name || l.description || "-"}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.unit_cost_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.unit_cost_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                          <td className="px-3 py-2 text-xs">
                            <div className="text-fg-muted">{suggestedLabel}</div>
                            {Number(l.suggested_confidence || 0) ? (
                              <div className="font-mono text-xs text-fg-subtle">conf {Number(l.suggested_confidence || 0).toFixed(2)}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <div className="mb-1 text-fg-muted">{resolved ? resolvedLabel : skipped ? "(skipped)" : "-"}</div>
                            {!skipped ? (
                              <ItemTypeahead
                                disabled={loading || saving || importApplying}
                                onSelect={(it) => void setImportLineResolvedId(l.id, it.id)}
                                onClear={() => void setImportLineResolvedId(l.id, null)}
                              />
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right text-xs">
                            <div className="flex justify-end gap-2">
                              {l.suggested_item_id && !l.resolved_item_id && !skipped ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={loading || saving || importApplying}
                                  onClick={() => void setImportLineResolvedId(l.id, String(l.suggested_item_id))}
                                >
                                  Use Suggestion
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={loading || saving || importApplying}
                                onClick={() => setImportLineSkipped(l.id, !skipped)}
                              >
                                {skipped ? "Unskip" : "Skip"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={load} disabled={loading || importApplying}>
                Refresh
              </Button>
              <Button type="button" onClick={applyImportLines} disabled={loading || importApplying || importLinesLoading}>
                {importApplying ? "Applying..." : "Apply Items"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {props.mode === "create" ? (
        <Card>
          <CardHeader>
            <CardTitle>AI Import</CardTitle>
            <CardDescription>Upload a supplier invoice image/PDF. We attach the original and try to fill the draft automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={importFromFile} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="md:col-span-2 space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Invoice Image/PDF (max configured, 5MB default)</label>
                  <FileInput
                    key={importPickKey}
                    name="import_file"
                    accept="image/*,application/pdf"
                    disabled={importing || loading}
                    buttonLabel="Choose invoice"
                    wrapperClassName="w-full"
                  />
                </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD→LBP)</label>
                <Input inputMode="decimal" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} disabled={importing || loading} />
              </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={importAutoCreateSupplier} onChange={(e) => setImportAutoCreateSupplier(e.target.checked)} />
                  Auto-create supplier if missing
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={importAutoCreateItems} onChange={(e) => setImportAutoCreateItems(e.target.checked)} />
                  Auto-create items if missing (not recommended)
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={importMockExtract} onChange={(e) => setImportMockExtract(e.target.checked)} />
                  Mock extraction (dev)
                </label>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={importing || loading}>
                    {importing ? "Importing..." : "Import"}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-fg-subtle">
                The uploaded file is always attached to the draft invoice so you can audit it later. By default, imports require a human review step before creating invoice lines.
              </p>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {props.mode === "edit" ? (
        <Card>
          <CardHeader>
            <CardTitle>Attachments</CardTitle>
            <CardDescription>Reference the uploaded supplier invoice while you edit the draft.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={uploadAttachment} className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Add attachment (max configured, 5MB default)</label>
                <FileInput
                  key={attachmentPickKey}
                  name="attachment_file"
                  disabled={attachmentUploading || loading || saving}
                  buttonLabel="Choose file"
                  wrapperClassName="w-full"
                />
              </div>
              <Button type="submit" variant="outline" disabled={attachmentUploading || loading || saving}>
                {attachmentUploading ? "Uploading..." : "Upload"}
              </Button>
            </form>
            {attachments.length ? (
              <div className="ui-table-scroll">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">File</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2 text-right">Size</th>
                      <th className="px-3 py-2">Uploaded</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attachments.map((a) => {
                      const selected = String(a.id) === String(previewAttachmentId);
                      return (
                      <tr key={a.id} className={`border-t border-border-subtle ${selected ? "bg-bg-elevated/40" : ""}`}>
                        <td className="px-3 py-2 text-xs">{a.filename || a.id}</td>
                        <td className="px-3 py-2 font-mono text-xs text-fg-muted">{a.content_type}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-fg-muted">{Math.max(0, Number(a.size_bytes || 0)).toLocaleString("en-US")}</td>
                        <td className="px-3 py-2 font-mono text-xs text-fg-muted">{String(a.uploaded_at || "")}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant={selected ? "default" : "outline"}
                              size="sm"
                              onClick={() => setPreviewAttachmentId(String(a.id))}
                            >
                              Preview
                            </Button>
                            <Button asChild variant="outline" size="sm">
                              <a href={apiUrl(`/attachments/${a.id}/view`)} target="_blank" rel="noreferrer">
                                View
                              </a>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                              <a href={apiUrl(`/attachments/${a.id}/download`)} target="_blank" rel="noreferrer">
                                Download
                              </a>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-fg-muted">No attachments.</div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Supplier, dates, and tax.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2" ref={supplierFieldRef}>
                <label className="text-xs font-medium text-fg-muted">Supplier</label>
                <SupplierTypeahead
                  disabled={loading}
                  onSelect={(s) => {
                    setSupplierId(s.id);
                    setSupplierLabel(s.name);
                  }}
                />
                {supplierId ? <div className="text-xs text-fg-subtle">Selected: {supplierLabel || supplierId}</div> : null}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Internal Doc No (optional)</label>
                <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Auto if blank (recommended)" disabled={loading} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Supplier Ref (optional)</label>
                <Input
                  ref={supplierRefInputRef}
                  value={supplierRef}
                  onChange={(e) => setSupplierRef(e.target.value)}
                  placeholder="Vendor invoice number / reference"
                  disabled={loading}
                />
                <p className="text-xs text-fg-subtle">When set, we enforce uniqueness per supplier (helps avoid duplicate postings).</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Invoice Date</label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={loading} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Due Date (optional)</label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={loading} />
                <p className="text-xs text-fg-subtle">If empty, the backend auto-calculates from supplier payment terms.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD→LBP)</label>
                <Input inputMode="decimal" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} disabled={loading} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Tax Code (optional)</label>
                <select className="ui-select" value={taxCodeId} onChange={(e) => setTaxCodeId(e.target.value)} disabled={loading}>
                  <option value="">No tax</option>
                  {taxCodes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({String(t.tax_type)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Goods Receipt ID (optional)</label>
                <Input value={goodsReceiptId} onChange={(e) => setGoodsReceiptId(e.target.value)} placeholder="Optional link (advanced)" disabled={loading} />
              </div>
            </div>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">Items</CardTitle>
                    <CardDescription>Add items and costs. Batch/expiry required if item tracking is enabled.</CardDescription>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={showSecondaryCurrency}
                      onChange={(e) => setShowSecondaryCurrency(e.target.checked)}
                    />
                    Show secondary currency (LBP)
                  </label>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <form onSubmit={addLine} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                  <div ref={addItemRootRef} className={`space-y-1 ${showSecondaryCurrency ? "md:col-span-5" : "md:col-span-7"}`}>
                    <label className="text-xs font-medium text-fg-muted">Item (search by SKU, name, or barcode)</label>
                    <ItemTypeahead globalScan disabled={loading} onSelect={(it) => void onPickItem(it)} />
                    {addItem ? (
                      <p className="text-xs text-fg-subtle">
                        Selected: <span className="font-mono">{addItem.sku}</span> · {addItem.name}
                      </p>
                    ) : (
                      <p className="text-xs text-fg-subtle">Tip: pick the item first, then type qty and cost.</p>
                    )}
                  </div>
                  <div className="space-y-1 md:col-span-1">
                    <label className="text-xs font-medium text-fg-muted">Qty</label>
                    <Input inputMode="decimal" ref={addQtyRef} value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">UOM</label>
                    <SearchableSelect
                      value={addUom}
                      onChange={(v) => {
                        const u = String(v || "").trim().toUpperCase();
                        const convs = addItem ? (uomConvByItem[addItem.id] || []) : [];
                        const hit = convs.find((c) => String(c.uom_code || "").trim().toUpperCase() === u);
                        const f = hit ? Number(hit.to_base_factor || 1) : 1;
                        setAddUom(u);
                        setAddQtyFactor(String(f > 0 ? f : 1));
                      }}
                      disabled={loading || !addItem}
                      placeholder="UOM..."
                      searchPlaceholder="Search UOM..."
                      options={addUomOptions}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Unit USD</label>
                    <Input inputMode="decimal" value={addUsd} onChange={(e) => setAddUsd(e.target.value)} placeholder="0.00" />
                  </div>
                  {showSecondaryCurrency ? (
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">Unit LBP</label>
                      <Input inputMode="decimal" value={addLbp} onChange={(e) => setAddLbp(e.target.value)} placeholder="0" />
                    </div>
                  ) : null}
                  <div className="md:col-span-12 text-xs text-fg-subtle">
                    Qty factor: <span className="font-mono">{toNum(addQtyFactor).toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
                  </div>
                  <div className="space-y-1 md:col-span-6">
                    <label className="text-xs font-medium text-fg-muted">Batch No (optional)</label>
                    <Input value={addBatchNo} onChange={(e) => setAddBatchNo(e.target.value)} placeholder="BATCH-001" />
                  </div>
                  <div className="space-y-1 md:col-span-6">
                    <label className="text-xs font-medium text-fg-muted">Expiry Date (optional)</label>
                    <Input type="date" value={addExpiry} onChange={(e) => setAddExpiry(e.target.value)} />
                  </div>
                  <div className="md:col-span-12 flex justify-end gap-2">
                      <Button type="submit" variant="outline" disabled={loading}>
                      Add Item
                    </Button>
                  </div>
                </form>

                <div className="ui-table-scroll">
                  <table className="ui-table">
                    <thead className="ui-thead">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2">UOM</th>
                        <th className="px-3 py-2 text-right">Unit USD</th>
                        {showSecondaryCurrency ? <th className="px-3 py-2 text-right">Unit LBP</th> : null}
                        <th className="px-3 py-2">Batch</th>
                        <th className="px-3 py-2">Expiry</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, idx) => {
                        const unitUsd = toNum(String(l.unit_cost_usd));
                        const unitLbp = toNum(String(l.unit_cost_lbp));
                        const costMissing = unitUsd === 0 && unitLbp === 0;
                        const convs = uomConvByItem[l.item_id] || [];
                        const uomOptions = buildUomOptions(l.unit_of_measure ?? null, convs);
                        const qtyFactor = toNum(String(l.qty_factor || "1")) || 1;
                        return (
                          <tr key={`${l.item_id}-${idx}`} className="ui-tr-hover">
                            <td className="px-3 py-2">
                              <div>
                                <div>
                                  <span className="font-mono text-xs">{l.item_sku || l.item_id}</span>
                                  {l.item_name ? <span> · {l.item_name}</span> : null}
                                </div>
                                {costMissing ? (
                                  <div className="mt-1 text-xs text-danger">Missing unit cost</div>
                                ) : null}
                                {l.supplier_item_code || l.supplier_item_name ? (
                                  <div className="mt-1 text-xs text-fg-subtle">
                                    Supplier: <span className="font-mono">{l.supplier_item_code || "-"}</span>
                                    {l.supplier_item_name ? <span> · {l.supplier_item_name}</span> : null}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Input
                                value={l.qty}
                                onChange={(e) => patchLine(idx, { qty: e.target.value })}
                                inputMode="decimal"
                                data-line-idx={idx}
                                data-line-field="qty"
                                onKeyDown={(e) => onLineKeyDown(e, idx, "qty")}
                                className="h-8 w-24 text-right font-mono text-xs"
                                disabled={loading || saving}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="min-w-[8rem]">
                                  <SearchableSelect
                                    value={String(l.uom || l.unit_of_measure || "").trim().toUpperCase()}
                                    onChange={(v) => {
                                      const u = String(v || "").trim().toUpperCase();
                                      const hit = convs.find((c) => String(c.uom_code || "").trim().toUpperCase() === u);
                                      const f = hit ? Number(hit.to_base_factor || 1) : 1;
                                      patchLine(idx, { uom: u, qty_factor: String(f > 0 ? f : 1) });
                                    }}
                                    disabled={loading || saving}
                                    placeholder="UOM..."
                                    searchPlaceholder="Search UOM..."
                                    options={uomOptions}
                                  />
                                </div>
                                <span className="text-xs font-mono text-fg-subtle">x{qtyFactor.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Input
                                value={l.unit_cost_usd}
                                onChange={(e) => patchLine(idx, { unit_cost_usd: e.target.value })}
                                inputMode="decimal"
                                data-line-idx={idx}
                                data-line-field="usd"
                                onKeyDown={(e) => onLineKeyDown(e, idx, "usd")}
                                className="h-8 w-28 text-right font-mono text-xs"
                                disabled={loading || saving}
                              />
                            </td>
                            {showSecondaryCurrency ? (
                              <td className="px-3 py-2 text-right">
                                <Input
                                  value={l.unit_cost_lbp}
                                  onChange={(e) => patchLine(idx, { unit_cost_lbp: e.target.value })}
                                  inputMode="decimal"
                                  data-line-idx={idx}
                                  data-line-field="lbp"
                                  onKeyDown={(e) => onLineKeyDown(e, idx, "lbp")}
                                  className="h-8 w-28 text-right font-mono text-xs"
                                  disabled={loading || saving}
                                />
                              </td>
                            ) : null}
                            <td className="px-3 py-2">
                              <Input
                                value={l.batch_no}
                                onChange={(e) => patchLine(idx, { batch_no: e.target.value })}
                                className="h-8 min-w-[8rem] font-mono text-xs"
                                disabled={loading || saving}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="date"
                                value={l.expiry_date ? String(l.expiry_date).slice(0, 10) : ""}
                                onChange={(e) => patchLine(idx, { expiry_date: e.target.value })}
                                className="h-8 min-w-[9rem] font-mono text-xs"
                                disabled={loading || saving}
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex justify-end gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => void openNameSuggestions(l)} disabled={nameSuggestLoading}>
                                  AI name
                                </Button>
                                <Button type="button" size="sm" variant="outline" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}>
                                  Remove
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {lines.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-fg-subtle" colSpan={showSecondaryCurrency ? 8 : 7}>
                            No items yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="button" onClick={() => save()} disabled={saving || loading}>
                {saving ? "..." : props.mode === "edit" ? "Save Draft" : "Create Draft"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      </div>

      {props.mode === "edit" ? (
        <div className="space-y-4 xl:sticky xl:top-6 xl:h-fit">
          <Card>
            <CardHeader>
              <CardTitle>Document Preview</CardTitle>
              <CardDescription>
                Compare the source document on the right while editing the real invoice fields on the left.
                Use <span className="font-mono text-xs">[</span> / <span className="font-mono text-xs">]</span> (or Alt+Up/Down) to move between drafts.
                Use <span className="font-mono text-xs">Cmd/Ctrl+Shift+Enter</span> to mark reviewed and continue.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!previewAttachment ? (
                <div className="rounded-md border border-dashed border-border-subtle p-4 text-sm text-fg-muted">
                  No attachment selected yet.
                </div>
              ) : (
                <>
                  <div className="rounded-md border border-border-subtle bg-bg-elevated/40 p-3">
                    <div className="truncate text-sm font-medium">{previewAttachment.filename || previewAttachment.id}</div>
                    <div className="mt-1 font-mono text-xs text-fg-subtle">
                      {previewAttachment.content_type} · {Math.max(0, Number(previewAttachment.size_bytes || 0)).toLocaleString("en-US")} bytes
                    </div>
                  </div>
                  {attachments.length > 1 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {attachments.map((a, idx) => {
                        const selected = String(a.id) === String(previewAttachment.id);
                        return (
                          <Button
                            key={a.id}
                            type="button"
                            size="sm"
                            variant={selected ? "default" : "outline"}
                            className="h-7 px-2 text-xs"
                            onClick={() => setPreviewAttachmentId(String(a.id))}
                          >
                            {idx + 1}
                          </Button>
                        );
                      })}
                    </div>
                  ) : null}
                  {hasInlinePreview ? (
                    <iframe
                      title={previewAttachment.filename || "Attachment preview"}
                      src={previewUrl}
                      className="h-[78vh] w-full rounded-md border border-border-subtle"
                    />
                  ) : (
                    <div className="rounded-md border border-dashed border-border-subtle p-4 text-sm text-fg-muted">
                      This file type cannot be previewed inline.
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button asChild variant="outline" size="sm">
                      <a href={previewUrl} target="_blank" rel="noreferrer">
                        Open full size
                      </a>
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
      </div>

      <Dialog open={nameSuggestOpen} onOpenChange={(o) => setNameSuggestOpen(o)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>AI Item Name Suggestions</DialogTitle>
            <DialogDescription>
              Source name: <span className="font-mono text-xs">{nameSuggestRaw || "-"}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {!nameSuggestSuggestions.length ? (
              <p className="text-sm text-fg-muted">{nameSuggestLoading ? "Generating..." : "No suggestions yet."}</p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {nameSuggestSuggestions.map((s, i) => (
                  <Button key={`${s}-${i}`} type="button" variant="outline" onClick={() => void applyNameSuggestion(s)} disabled={nameSuggestLoading}>
                    {s}
                  </Button>
                ))}
              </div>
            )}
            <p className="text-xs text-fg-subtle">
              Applying a suggestion updates the Item master name (affects future documents). Supplier item code/name is preserved separately on the invoice line.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
