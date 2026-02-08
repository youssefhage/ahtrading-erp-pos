"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Item = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit_of_measure: string;
  tax_code_id: string | null;
  reorder_point: string | number | null;
  reorder_qty: string | number | null;
  barcode_count?: number;
};

type TaxCode = { id: string; name: string; rate: string | number };

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

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [status, setStatus] = useState<string>("");

  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [uom, setUom] = useState("EA");
  const [barcode, setBarcode] = useState("");
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editName, setEditName] = useState("");
  const [editUom, setEditUom] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editTaxCodeId, setEditTaxCodeId] = useState("");
  const [editReorderPoint, setEditReorderPoint] = useState("");
  const [editReorderQty, setEditReorderQty] = useState("");
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => {
      return (
        i.sku.toLowerCase().includes(needle) ||
        i.name.toLowerCase().includes(needle) ||
        (i.barcode || "").toLowerCase().includes(needle)
      );
    });
  }, [items, q]);

  async function load() {
    setStatus("Loading...");
    try {
      const [res, tc] = await Promise.all([
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes")
      ]);
      setItems(res.items || []);
      setTaxCodes(tc.tax_codes || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
        barcode: barcode.trim() || null
      });
      setSku("");
      setName("");
      setBarcode("");
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
    setEditUom(item.unit_of_measure || "");
    setEditBarcode(item.barcode || "");
    setEditTaxCodeId(item.tax_code_id || "");
    setEditReorderPoint(String(item.reorder_point ?? ""));
    setEditReorderQty(String(item.reorder_qty ?? ""));
    setEditOpen(true);
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
        unit_of_measure: editUom.trim(),
        barcode: editBarcode.trim(),
        tax_code_id: editTaxCodeId ? editTaxCodeId : null,
        reorder_point: Number(editReorderPoint || 0),
        reorder_qty: Number(editReorderQty || 0)
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
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
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
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
                        <label className="text-xs font-medium text-slate-700">SKU</label>
                        <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU-001" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Name</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">UOM</label>
                          <Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="EA" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Barcode (optional)</label>
                          <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="629..." />
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
                        className="h-48 w-full rounded-md border border-slate-200 bg-white p-3 text-xs font-mono text-slate-900"
                        value={importText}
                        onChange={(e) => {
                          const v = e.target.value;
                          setImportText(v);
                          recomputeImport(v);
                        }}
                        placeholder={'sku,name,unit_of_measure,barcode,tax_code,reorder_point,reorder_qty\nSKU-001,Milk 1L,EA,629...,VAT 11%,10,50'}
                      />
                      {importErrors ? (
                        <pre className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                          {importErrors}
                        </pre>
                      ) : null}
                      <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
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
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2">UOM</th>
                    <th className="px-3 py-2 text-right">Reorder</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <tr key={i.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{i.sku}</td>
                      <td className="px-3 py-2">{i.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{i.barcode || "-"}</td>
                      <td className="px-3 py-2">{i.unit_of_measure}</td>
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
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
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
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Name</label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">UOM</label>
                      <Input value={editUom} onChange={(e) => setEditUom(e.target.value)} placeholder="EA" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Primary Barcode (optional)</label>
                      <Input value={editBarcode} onChange={(e) => setEditBarcode(e.target.value)} placeholder="629..." />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Tax Code (optional)</label>
                      <select className="ui-select" value={editTaxCodeId} onChange={(e) => setEditTaxCodeId(e.target.value)}>
                        <option value="">(none)</option>
                        {taxCodes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({(Number(t.rate || 0) * 100).toFixed(2)}%)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Reorder Point</label>
                      <Input value={editReorderPoint} onChange={(e) => setEditReorderPoint(e.target.value)} placeholder="0" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Reorder Qty</label>
                      <Input value={editReorderQty} onChange={(e) => setEditReorderQty(e.target.value)} placeholder="0" />
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

                {barcodeStatus ? <pre className="whitespace-pre-wrap text-xs text-slate-700">{barcodeStatus}</pre> : null}

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
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                            No barcodes yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <form onSubmit={addBarcode} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-slate-700">Barcode</label>
                    <Input value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} placeholder="629..." />
                  </div>
                  <div className="space-y-1 md:col-span-1">
                    <label className="text-xs font-medium text-slate-700">Factor</label>
                    <Input value={newFactor} onChange={(e) => setNewFactor(e.target.value)} placeholder="12" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-slate-700">Label</label>
                    <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Case of 12" />
                  </div>
                  <div className="md:col-span-6 flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-slate-700">
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

                {supplierStatus ? <pre className="whitespace-pre-wrap text-xs text-slate-700">{supplierStatus}</pre> : null}

                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead className="ui-thead">
                      <tr>
                        <th className="px-3 py-2">Supplier</th>
                        <th className="px-3 py-2">Primary</th>
                        <th className="px-3 py-2 text-right">Lead Time</th>
                        <th className="px-3 py-2 text-right">Min Qty</th>
                        <th className="px-3 py-2 text-right">Last Cost USD</th>
                        <th className="px-3 py-2 text-right">Last Cost LBP</th>
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
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
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
                        <label className="text-xs font-medium text-slate-700">Supplier</label>
                        <select
                          className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
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
                        <label className="text-xs font-medium text-slate-700">Lead Time</label>
                        <Input value={addLeadTimeDays} onChange={(e) => setAddLeadTimeDays(e.target.value)} placeholder="0" />
                      </div>
                      <div className="space-y-1 md:col-span-1">
                        <label className="text-xs font-medium text-slate-700">Min Qty</label>
                        <Input value={addMinOrderQty} onChange={(e) => setAddMinOrderQty(e.target.value)} placeholder="0" />
                      </div>
                      <div className="space-y-1 md:col-span-1">
                        <label className="text-xs font-medium text-slate-700">Last USD</label>
                        <Input value={addLastCostUsd} onChange={(e) => setAddLastCostUsd(e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="space-y-1 md:col-span-1">
                        <label className="text-xs font-medium text-slate-700">Last LBP</label>
                        <Input value={addLastCostLbp} onChange={(e) => setAddLastCostLbp(e.target.value)} placeholder="0" />
                      </div>
                      <div className="flex items-end md:col-span-1">
                        <label className="flex items-center gap-2 text-xs text-slate-700">
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
                          <label className="text-xs font-medium text-slate-700">Lead Time (days)</label>
                          <Input value={editLeadTimeDays} onChange={(e) => setEditLeadTimeDays(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Min Order Qty</label>
                          <Input value={editMinOrderQty} onChange={(e) => setEditMinOrderQty(e.target.value)} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Last Cost USD</label>
                          <Input value={editLastCostUsd} onChange={(e) => setEditLastCostUsd(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Last Cost LBP</label>
                          <Input value={editLastCostLbp} onChange={(e) => setEditLastCostLbp(e.target.value)} />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-700">
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
