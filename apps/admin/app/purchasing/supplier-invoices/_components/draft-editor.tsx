"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Supplier = { id: string; name: string };
type Item = { id: string; sku: string; name: string };

type TaxCode = {
  id: string;
  name: string;
  rate: string | number;
  tax_type: string;
  reporting_currency: string;
};

type InvoiceLineDraft = {
  item_id: string;
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
      invoice_no: string;
      supplier_ref?: string | null;
      exchange_rate: string | number;
      tax_code_id?: string | null;
      goods_receipt_id?: string | null;
      invoice_date: string;
      due_date: string;
  };
  lines: Array<{
    item_id: string;
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

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);

  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => todayIso());
  const [dueDate, setDueDate] = useState("");
  const [exchangeRate, setExchangeRate] = useState("90000");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [goodsReceiptId, setGoodsReceiptId] = useState("");

  const [lines, setLines] = useState<InvoiceLineDraft[]>([]);

  const [addSku, setAddSku] = useState("");
  const [addItemId, setAddItemId] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");
  const [addBatchNo, setAddBatchNo] = useState("");
  const [addExpiry, setAddExpiry] = useState("");

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const itemBySku = useMemo(() => new Map(items.map((i) => [i.sku.toUpperCase(), i])), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [s, i, tc] = await Promise.all([
        apiGet<{ suppliers: Supplier[] }>("/suppliers"),
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes")
      ]);
      setSuppliers(s.suppliers || []);
      setItems(i.items || []);
      setTaxCodes(tc.tax_codes || []);

      if (props.mode === "edit") {
        const id = props.invoiceId || "";
        if (!id) throw new Error("missing invoice id");
        const det = await apiGet<InvoiceDetail>(`/purchases/invoices/${id}`);
        if (det.invoice.status !== "draft") throw new Error("Only draft invoices can be edited.");

        setSupplierId(det.invoice.supplier_id || "");
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
      } else {
        setSupplierId("");
        setInvoiceNo("");
        setSupplierRef("");
        setInvoiceDate(todayIso());
        setDueDate("");
        setExchangeRate("90000");
        setTaxCodeId("");
        setGoodsReceiptId("");
        setLines([]);
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

  function onSkuChange(next: string) {
    const token = (next || "").trim().toUpperCase();
    setAddSku(token);
    const it = itemBySku.get(token);
    setAddItemId(it?.id || "");
  }

  function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!addItemId) return setStatus("Pick a valid SKU/item.");
    const q = toNum(addQty);
    if (q <= 0) return setStatus("qty must be > 0");
    if (toNum(addUsd) === 0 && toNum(addLbp) === 0) return setStatus("Set USD or LL unit cost.");
    setLines((prev) => [
      ...prev,
      {
        item_id: addItemId,
        qty: String(q),
        unit_cost_usd: String(toNum(addUsd)),
        unit_cost_lbp: String(toNum(addLbp)),
        batch_no: addBatchNo || "",
        expiry_date: addExpiry || "",
        supplier_item_code: null,
        supplier_item_name: null
      }
    ]);
    setAddSku("");
    setAddItemId("");
    setAddQty("1");
    setAddUsd("");
    setAddLbp("");
    setAddBatchNo("");
    setAddExpiry("");
    setStatus("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
      const res = (await raw.json()) as { id: string; invoice_no: string; ai_extracted: boolean; warnings?: string[] };
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
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Fix the issue and try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
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

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Supplier, dates, and tax.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Supplier</label>
                <select className="ui-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={loading}>
                  <option value="">Select supplier...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
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
                <form onSubmit={addLine} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-fg-muted">SKU</label>
                    <Input value={addSku} onChange={(e) => onSkuChange(e.target.value)} placeholder="SKU-001" />
                    <p className="text-[11px] text-fg-subtle">
                      Match:{" "}
                      {addItemId ? (
                        <span className="font-mono">{itemById.get(addItemId)?.sku || addItemId}</span>
                      ) : (
                        <span className="text-fg-subtle">none</span>
                      )}
                    </p>
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-fg-muted">Item</label>
                    <select
                      className="ui-select"
                      value={addItemId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setAddItemId(id);
                        const it = itemById.get(id);
                        if (it) setAddSku(it.sku);
                      }}
                    >
                      <option value="">Select item...</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.sku} · {it.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Qty</label>
                    <Input value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Unit USD</label>
                    <Input value={addUsd} onChange={(e) => setAddUsd(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-fg-muted">Unit LL</label>
                    <Input value={addLbp} onChange={(e) => setAddLbp(e.target.value)} placeholder="0" />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-fg-muted">Batch No (optional)</label>
                    <Input value={addBatchNo} onChange={(e) => setAddBatchNo(e.target.value)} placeholder="BATCH-001" />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-fg-muted">Expiry Date (optional)</label>
                    <Input type="date" value={addExpiry} onChange={(e) => setAddExpiry(e.target.value)} />
                  </div>
                  <div className="md:col-span-6 flex justify-end gap-2">
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
                        const it = itemById.get(l.item_id);
                        const qty = toNum(String(l.qty));
                        const unitUsd = toNum(String(l.unit_cost_usd));
                        const unitLbp = toNum(String(l.unit_cost_lbp));
                        return (
                          <tr key={`${l.item_id}-${idx}`} className="ui-tr-hover">
                            <td className="px-3 py-2">
                              {it ? (
                                <div>
                                  <div>
                                    <span className="font-mono text-xs">{it.sku}</span> · {it.name}
                                  </div>
                                  {l.supplier_item_code || l.supplier_item_name ? (
                                    <div className="mt-1 text-[10px] text-fg-subtle">
                                      Supplier:{" "}
                                      <span className="font-mono">{l.supplier_item_code || "-"}</span>
                                      {l.supplier_item_name ? <span> · {l.supplier_item_name}</span> : null}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="font-mono text-xs">{l.item_id}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right data-mono text-xs">{qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                            <td className="px-3 py-2 text-right data-mono text-xs">{unitUsd.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                            <td className="px-3 py-2 text-right data-mono text-xs">{unitLbp.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                            <td className="px-3 py-2 font-mono text-xs">{l.batch_no || "-"}</td>
                            <td className="px-3 py-2 font-mono text-xs">{l.expiry_date ? String(l.expiry_date).slice(0, 10) : "-"}</td>
                            <td className="px-3 py-2 text-right">
                              <Button type="button" size="sm" variant="outline" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}>
                                Remove
                              </Button>
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
              <Button type="submit" disabled={saving || loading}>
                {saving ? "..." : props.mode === "edit" ? "Save Draft" : "Create Draft"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
