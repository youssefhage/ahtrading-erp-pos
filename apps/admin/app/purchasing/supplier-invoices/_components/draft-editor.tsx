"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ItemTypeahead, type ItemTypeaheadItem } from "@/components/item-typeahead";
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";
import { ErrorBanner } from "@/components/error-banner";
type AttachmentRow = { id: string; filename: string; content_type: string; size_bytes: number; uploaded_at: string };

type TaxCode = {
  id: string;
  name: string;
  rate: string | number;
  tax_type: string;
  reporting_currency: string;
};

type InvoiceLineDraft = {
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  unit_of_measure?: string | null;
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
    qty: string | number;
    unit_cost_usd: string | number;
    unit_cost_lbp: string | number;
    batch_no: string | null;
    expiry_date: string | null;
    goods_receipt_line_id?: string | null;
    supplier_item_code?: string | null;
    supplier_item_name?: string | null;
  }>;
};

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function SupplierInvoiceDraftEditor(props: { mode: "create" | "edit"; invoiceId?: string }) {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importAutoCreateSupplier, setImportAutoCreateSupplier] = useState(true);
  const [importAutoCreateItems, setImportAutoCreateItems] = useState(true);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);

  const [nameSuggestOpen, setNameSuggestOpen] = useState(false);
  const [nameSuggestLoading, setNameSuggestLoading] = useState(false);
  const [nameSuggestItemId, setNameSuggestItemId] = useState("");
  const [nameSuggestRaw, setNameSuggestRaw] = useState("");
  const [nameSuggestSuggestions, setNameSuggestSuggestions] = useState<string[]>([]);

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
  const [importStatus, setImportStatus] = useState("");
  const [importError, setImportError] = useState("");

  const [addItem, setAddItem] = useState<ItemTypeaheadItem | null>(null);
  const [addQty, setAddQty] = useState("1");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");
  const [addBatchNo, setAddBatchNo] = useState("");
  const [addExpiry, setAddExpiry] = useState("");
  const addQtyRef = useRef<HTMLInputElement | null>(null);
  const supplierCostCache = useRef(new Map<string, { usd: number; lbp: number } | null>());

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const tc = await apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes");
      setTaxCodes(tc.tax_codes || []);

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
        setExchangeRate(String(det.invoice.exchange_rate || 0));
        setTaxCodeId(String(det.invoice.tax_code_id || ""));
        setGoodsReceiptId(String(det.invoice.goods_receipt_id || ""));
        setLines(
          (det.lines || []).map((l) => ({
            item_id: l.item_id,
            item_sku: (l as any).item_sku || null,
            item_name: (l as any).item_name || null,
            unit_of_measure: null,
            qty: String(l.qty || 0),
            unit_cost_usd: String(l.unit_cost_usd || 0),
            unit_cost_lbp: String(l.unit_cost_lbp || 0),
            batch_no: String(l.batch_no || ""),
            expiry_date: String(l.expiry_date || ""),
            goods_receipt_line_id: (l.goods_receipt_line_id as any) || null,
            supplier_item_code: (l.supplier_item_code as any) || null,
            supplier_item_name: (l.supplier_item_name as any) || null
          }))
        );

        // Attachments are optional; don't block editing if the user lacks access.
        await reloadAttachments(id);
      } else {
        setSupplierId("");
        setSupplierLabel("");
        setInvoiceNo("");
        setSupplierRef("");
        setInvoiceDate(todayIso());
        setDueDate("");
        setExchangeRate("90000");
        setTaxCodeId("");
        setGoodsReceiptId("");
        setLines([]);
        setAttachments([]);
        setImportStatus("");
        setImportError("");
      }

      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [props.mode, props.invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

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

  async function onPickItem(it: ItemTypeaheadItem) {
    setAddItem(it);
    setAddQty("1");
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
    const q = toNum(addQty);
    if (q <= 0) return setStatus("qty must be > 0");
    let unitUsd = toNum(addUsd);
    let unitLbp = toNum(addLbp);
    const ex = toNum(exchangeRate);
    if (ex > 0) {
      if (unitUsd === 0 && unitLbp > 0) unitUsd = unitLbp / ex;
      if (unitLbp === 0 && unitUsd > 0) unitLbp = unitUsd * ex;
    }
    if (unitUsd === 0 && unitLbp === 0) return setStatus("Set USD or LL unit cost.");
    setLines((prev) => [
      ...prev,
      {
        item_id: addItem.id,
        item_sku: addItem.sku,
        item_name: addItem.name,
        unit_of_measure: (addItem as any).unit_of_measure ?? null,
        qty: String(q),
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
    setAddUsd("");
    setAddLbp("");
    setAddBatchNo("");
    setAddExpiry("");
    setStatus("");
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!supplierId) return setStatus("supplier is required");

    const exRes = parseNumberInput(exchangeRate);
    if (!exRes.ok && exRes.reason === "invalid") return setStatus("Invalid exchange rate.");
    const ex = exRes.ok ? exRes.value : 0;

    const linesOut: Array<{
      item_id: string;
      goods_receipt_line_id?: string;
      qty: number;
      unit_cost_usd: number;
      unit_cost_lbp: number;
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
      if (!qtyRes.ok && qtyRes.reason === "invalid") return setStatus(`Invalid qty on line ${i + 1}.`);
      if (!usdRes.ok && usdRes.reason === "invalid") return setStatus(`Invalid unit USD on line ${i + 1}.`);
      if (!lbpRes.ok && lbpRes.reason === "invalid") return setStatus(`Invalid unit LL on line ${i + 1}.`);
      const qty = qtyRes.ok ? qtyRes.value : 0;
      const unitUsd = usdRes.ok ? usdRes.value : 0;
      const unitLbp = lbpRes.ok ? lbpRes.value : 0;
      if (qty <= 0) return setStatus(`Qty must be > 0 (line ${i + 1}).`);
      if (unitUsd === 0 && unitLbp === 0) return setStatus(`Set USD or LL unit cost (line ${i + 1}).`);
      linesOut.push({
        item_id: l.item_id,
        goods_receipt_line_id: l.goods_receipt_line_id || undefined,
        qty,
        unit_cost_usd: unitUsd,
        unit_cost_lbp: unitLbp,
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
        router.push(`/purchasing/supplier-invoices/${id}`);
      } else {
        const res = await apiPost<{ id: string }>("/purchases/invoices/drafts", payload);
        setStatus("");
        router.push(`/purchasing/supplier-invoices/${res.id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  const title = props.mode === "edit" ? "Edit Draft Supplier Invoice" : "Create Draft Supplier Invoice";

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

      const raw = await fetch("/api/purchases/invoices/drafts/import-file", { method: "POST", body: fd, credentials: "include" });
      if (!raw.ok) throw new Error(await raw.text());
      const res = (await raw.json()) as { id: string; invoice_no: string; queued?: boolean; ai_extracted?: boolean; warnings?: string[] };
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
      if (input) input.value = "";
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

      const raw = await fetch("/api/attachments", { method: "POST", body: fd, credentials: "include" });
      if (!raw.ok) throw new Error(await raw.text());
      await reloadAttachments(id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setAttachmentUploading(false);
      if (input) input.value = "";
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-fg-muted">Draft first, then Post when ready (stock + GL).</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/purchasing/supplier-invoices")}>
            Back
          </Button>
        </div>
      </div>

      {status ? (
        <ErrorBanner error={status} onRetry={load} />
      ) : null}

      {props.mode === "edit" && importStatus ? (
        <Card>
          <CardHeader>
            <CardTitle>Import Status</CardTitle>
            <CardDescription>
              {String(importStatus).toLowerCase() === "pending" || String(importStatus).toLowerCase() === "processing"
                ? "Import is in progress. This page will refresh automatically."
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
                  <label className="text-xs font-medium text-fg-muted">Invoice Image/PDF (max 5MB)</label>
                  <input
                    name="import_file"
                    type="file"
                    accept="image/*,application/pdf"
                    disabled={importing || loading}
                    className="block w-full text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD→LL)</label>
                  <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} disabled={importing || loading} />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={importAutoCreateSupplier} onChange={(e) => setImportAutoCreateSupplier(e.target.checked)} />
                  Auto-create supplier if missing
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={importAutoCreateItems} onChange={(e) => setImportAutoCreateItems(e.target.checked)} />
                  Auto-create items if missing
                </label>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={importing || loading}>
                    {importing ? "Importing..." : "Import"}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-fg-subtle">
                The uploaded file is always attached to the draft invoice so you can audit it later.
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
                <label className="text-xs font-medium text-fg-muted">Add attachment (max 5MB)</label>
                <input name="attachment_file" type="file" disabled={attachmentUploading || loading || saving} className="block w-full text-xs" />
              </div>
              <Button type="submit" variant="outline" disabled={attachmentUploading || loading || saving}>
                {attachmentUploading ? "Uploading..." : "Upload"}
              </Button>
            </form>
            {attachments.length ? (
              <div className="ui-table-wrap">
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
                    {attachments.map((a) => (
                      <tr key={a.id} className="border-t border-border-subtle">
                        <td className="px-3 py-2 text-xs">{a.filename || a.id}</td>
                        <td className="px-3 py-2 font-mono text-xs text-fg-muted">{a.content_type}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-fg-muted">{Math.max(0, Number(a.size_bytes || 0)).toLocaleString("en-US")}</td>
                        <td className="px-3 py-2 font-mono text-xs text-fg-muted">{String(a.uploaded_at || "")}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button asChild variant="outline" size="sm">
                              <a href={`/api/attachments/${a.id}/view`} target="_blank" rel="noreferrer">
                                View
                              </a>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                              <a href={`/api/attachments/${a.id}/download`} target="_blank" rel="noreferrer">
                                Download
                              </a>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
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
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Supplier</label>
                <SupplierTypeahead
                  disabled={loading}
                  onSelect={(s) => {
                    setSupplierId(s.id);
                    setSupplierLabel(s.name);
                  }}
                />
                {supplierId ? <div className="text-[11px] text-fg-subtle">Selected: {supplierLabel || supplierId}</div> : null}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Internal Doc No (optional)</label>
                <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Auto if blank (recommended)" disabled={loading} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Supplier Ref (optional)</label>
                <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="Vendor invoice number / reference" disabled={loading} />
                <p className="text-[11px] text-fg-subtle">When set, we enforce uniqueness per supplier (helps avoid duplicate postings).</p>
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
                <p className="text-[11px] text-fg-subtle">If empty, the backend auto-calculates from supplier payment terms.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD→LL)</label>
                <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} disabled={loading} />
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
                <CardTitle className="text-base">Lines</CardTitle>
                <CardDescription>Add items and costs. Batch/expiry required if item tracking is enabled.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <form onSubmit={addLine} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                  <div className="space-y-1 md:col-span-6">
                    <label className="text-xs font-medium text-fg-muted">Item (search by SKU, name, or barcode)</label>
                    <ItemTypeahead disabled={loading} onSelect={(it) => void onPickItem(it)} />
                    {addItem ? (
                      <p className="text-[11px] text-fg-subtle">
                        Selected: <span className="font-mono">{addItem.sku}</span> · {addItem.name}
                      </p>
                    ) : (
                      <p className="text-[11px] text-fg-subtle">Tip: pick the item first, then type qty and cost.</p>
                    )}
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Qty</label>
                    <div className="relative">
                      <Input ref={addQtyRef} value={addQty} onChange={(e) => setAddQty(e.target.value)} className="pr-14" />
                      {(addItem as any)?.unit_of_measure ? (
                        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-fg-subtle">
                          {String((addItem as any).unit_of_measure)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Unit USD</label>
                    <Input value={addUsd} onChange={(e) => setAddUsd(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Unit LL</label>
                    <Input value={addLbp} onChange={(e) => setAddLbp(e.target.value)} placeholder="0" />
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
                      Add Line
                    </Button>
                  </div>
                </form>

                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead className="ui-thead">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Unit USD</th>
                        <th className="px-3 py-2 text-right">Unit LL</th>
                        <th className="px-3 py-2">Batch</th>
                        <th className="px-3 py-2">Expiry</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, idx) => {
                        const qty = toNum(String(l.qty));
                        const unitUsd = toNum(String(l.unit_cost_usd));
                        const unitLbp = toNum(String(l.unit_cost_lbp));
                        return (
                          <tr key={`${l.item_id}-${idx}`} className="ui-tr-hover">
                            <td className="px-3 py-2">
                              <div>
                                <div>
                                  <span className="font-mono text-xs">{l.item_sku || l.item_id}</span>
                                  {l.item_name ? <span> · {l.item_name}</span> : null}
                                </div>
                                {l.supplier_item_code || l.supplier_item_name ? (
                                  <div className="mt-1 text-[10px] text-fg-subtle">
                                    Supplier: <span className="font-mono">{l.supplier_item_code || "-"}</span>
                                    {l.supplier_item_name ? <span> · {l.supplier_item_name}</span> : null}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right data-mono text-xs">
                              {qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}{" "}
                              {l.unit_of_measure ? <span className="text-[10px] text-fg-subtle">{String(l.unit_of_measure)}</span> : null}
                            </td>
                            <td className="px-3 py-2 text-right data-mono text-xs">{unitUsd.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                            <td className="px-3 py-2 text-right data-mono text-xs">{unitLbp.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                            <td className="px-3 py-2 font-mono text-xs">{l.batch_no || "-"}</td>
                            <td className="px-3 py-2 font-mono text-xs">{l.expiry_date ? String(l.expiry_date).slice(0, 10) : "-"}</td>
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
                          <td className="px-3 py-6 text-center text-fg-subtle" colSpan={7}>
                            No lines yet.
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
            <p className="text-[11px] text-fg-subtle">
              Applying a suggestion updates the Item master name (affects future documents). Supplier item code/name is preserved separately on the invoice line.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
