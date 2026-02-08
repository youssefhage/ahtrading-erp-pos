"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };

type AdjustDraft = {
  item_id: string;
  warehouse_id: string;
  qty_in: string;
  qty_out: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
  reason: string;
};

type TransferDraft = {
  item_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  qty: string;
  unit_cost_usd: string;
  unit_cost_lbp: string;
  reason: string;
};

type CycleCountLineDraft = { item_id: string; counted_qty: string };

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function InventoryOpsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [status, setStatus] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);

  const [adjust, setAdjust] = useState<AdjustDraft>({
    item_id: "",
    warehouse_id: "",
    qty_in: "0",
    qty_out: "0",
    unit_cost_usd: "0",
    unit_cost_lbp: "0",
    reason: ""
  });

  const [transfer, setTransfer] = useState<TransferDraft>({
    item_id: "",
    from_warehouse_id: "",
    to_warehouse_id: "",
    qty: "1",
    unit_cost_usd: "0",
    unit_cost_lbp: "0",
    reason: ""
  });

  const [cycleWarehouseId, setCycleWarehouseId] = useState("");
  const [cycleReason, setCycleReason] = useState("");
  const [cycleLines, setCycleLines] = useState<CycleCountLineDraft[]>([{ item_id: "", counted_qty: "0" }]);

  const [openingWarehouseId, setOpeningWarehouseId] = useState("");
  const [openingPostingDate, setOpeningPostingDate] = useState(() => todayIso());
  const [openingImportId, setOpeningImportId] = useState("");
  const [openingCsv, setOpeningCsv] = useState("");
  const [openingPreview, setOpeningPreview] = useState<
    { sku: string; qty: number; unit_cost_usd: number; unit_cost_lbp: number; batch_no?: string | null; expiry_date?: string | null }[]
  >([]);
  const [openingErrors, setOpeningErrors] = useState("");
  const [openingResult, setOpeningResult] = useState<{
    import_id: string;
    already_applied: boolean;
    lines?: number;
    journal_id?: string;
    warnings?: string[];
  } | null>(null);

  const [submitting, setSubmitting] = useState<string>("");

  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function load() {
    setStatus("Loading...");
    try {
      const [i, w] = await Promise.all([
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses")
      ]);
      setItems(i.items || []);
      setWarehouses(w.warehouses || []);
      if (!openingWarehouseId && (w.warehouses || []).length) setOpeningWarehouseId(w.warehouses[0].id);
      if (!cycleWarehouseId && (w.warehouses || []).length) setCycleWarehouseId(w.warehouses[0].id);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function addCycleLine() {
    setCycleLines((prev) => [...prev, { item_id: "", counted_qty: "0" }]);
  }

  function removeCycleLine(idx: number) {
    setCycleLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateCycleLine(idx: number, patch: Partial<CycleCountLineDraft>) {
    setCycleLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
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

  function recomputeOpeningPreview(text: string) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      setOpeningPreview([]);
      setOpeningErrors("");
      return;
    }
    try {
      const rows = parseCsv(trimmed);
      if (rows.length < 2) {
        setOpeningPreview([]);
        setOpeningErrors("CSV must have a header row + at least 1 data row.");
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

      const skuIdx = idx(["sku", "item_sku"]);
      const qtyIdx = idx(["qty", "quantity", "on_hand_qty"]);
      const usdIdx = idx(["unit_cost_usd", "cost_usd", "avg_cost_usd"]);
      const lbpIdx = idx(["unit_cost_lbp", "cost_lbp", "avg_cost_lbp"]);
      const batchIdx = idx(["batch_no", "batch"]);
      const expIdx = idx(["expiry_date", "expiry", "exp_date"]);

      if (skuIdx < 0 || qtyIdx < 0) {
        setOpeningPreview([]);
        setOpeningErrors("Missing required headers: sku, qty");
        return;
      }

      const preview: { sku: string; qty: number; unit_cost_usd: number; unit_cost_lbp: number; batch_no?: string | null; expiry_date?: string | null }[] =
        [];
      const errs: string[] = [];

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const sku = (row[skuIdx] || "").trim();
        const qty = Number((row[qtyIdx] || "").trim() || 0);
        if (!sku) {
          errs.push(`Row ${r + 1}: sku is required`);
          continue;
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          errs.push(`Row ${r + 1}: qty must be > 0`);
          continue;
        }
        const unitUsd = usdIdx >= 0 ? Number((row[usdIdx] || "").trim() || 0) : 0;
        const unitLbp = lbpIdx >= 0 ? Number((row[lbpIdx] || "").trim() || 0) : 0;
        if (!Number.isFinite(unitUsd) || unitUsd < 0) {
          errs.push(`Row ${r + 1}: unit_cost_usd must be >= 0`);
          continue;
        }
        if (!Number.isFinite(unitLbp) || unitLbp < 0) {
          errs.push(`Row ${r + 1}: unit_cost_lbp must be >= 0`);
          continue;
        }
        const batchNo = batchIdx >= 0 ? (row[batchIdx] || "").trim() : "";
        const exp = expIdx >= 0 ? (row[expIdx] || "").trim() : "";
        if (exp && !/^\d{4}-\d{2}-\d{2}/.test(exp)) {
          errs.push(`Row ${r + 1}: expiry_date must be YYYY-MM-DD (got ${JSON.stringify(exp)})`);
          continue;
        }
        preview.push({
          sku,
          qty,
          unit_cost_usd: unitUsd,
          unit_cost_lbp: unitLbp,
          batch_no: batchNo || null,
          expiry_date: exp ? exp.slice(0, 10) : null
        });
      }

      setOpeningPreview(preview);
      setOpeningErrors(errs.join("\n"));
    } catch (e) {
      setOpeningPreview([]);
      setOpeningErrors(e instanceof Error ? e.message : String(e));
    }
  }

  function openOpeningImport() {
    if (!warehouses.length) {
      setStatus("Create at least one warehouse first (System → Warehouses).");
      return;
    }
    setOpeningResult(null);
    setOpeningErrors("");
    setOpeningCsv("");
    setOpeningPreview([]);
    setOpeningPostingDate(todayIso());
    try {
      // Keep an explicit id for safe retries (idempotent import).
      setOpeningImportId((globalThis.crypto as any)?.randomUUID?.() || "");
    } catch {
      setOpeningImportId("");
    }
    setOpeningWarehouseId(openingWarehouseId || warehouses[0].id);
    setOpeningOpen(true);
  }

  async function submitOpeningImport(e: React.FormEvent) {
    e.preventDefault();
    if (!openingWarehouseId) return setStatus("warehouse is required");
    if (!openingPreview.length) return setStatus("paste CSV with at least 1 valid row");
    if (openingErrors.trim()) return setStatus("fix CSV errors first");

    setSubmitting("opening");
    setStatus("Importing opening stock...");
    setOpeningResult(null);
    try {
      const res = await apiPost<{
        ok: boolean;
        import_id: string;
        already_applied: boolean;
        journal_id?: string;
        lines?: number;
        warnings?: string[];
      }>("/inventory/opening-stock/import", {
        import_id: openingImportId.trim() || undefined,
        warehouse_id: openingWarehouseId,
        posting_date: openingPostingDate || undefined,
        lines: openingPreview.map((l) => ({
          sku: l.sku,
          qty: l.qty,
          unit_cost_usd: l.unit_cost_usd,
          unit_cost_lbp: l.unit_cost_lbp,
          batch_no: l.batch_no || undefined,
          expiry_date: l.expiry_date || undefined
        }))
      });
      setOpeningResult({
        import_id: res.import_id,
        already_applied: Boolean(res.already_applied),
        lines: res.lines,
        journal_id: res.journal_id,
        warnings: res.warnings || []
      });
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSubmitting("");
    }
  }

  async function submitAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!adjust.item_id) return setStatus("item is required");
    if (!adjust.warehouse_id) return setStatus("warehouse is required");
    const qtyIn = toNum(adjust.qty_in);
    const qtyOut = toNum(adjust.qty_out);
    if (qtyIn <= 0 && qtyOut <= 0) return setStatus("qty_in or qty_out must be > 0");
    if (qtyIn > 0 && qtyOut > 0) return setStatus("qty_in and qty_out cannot both be > 0");

    setSubmitting("adjust");
    setStatus("Posting adjustment...");
    try {
      await apiPost("/inventory/adjust", {
        item_id: adjust.item_id,
        warehouse_id: adjust.warehouse_id,
        qty_in: qtyIn,
        qty_out: qtyOut,
        unit_cost_usd: toNum(adjust.unit_cost_usd),
        unit_cost_lbp: toNum(adjust.unit_cost_lbp),
        reason: adjust.reason || undefined
      });
      setAdjust((prev) => ({ ...prev, qty_in: "0", qty_out: "0", unit_cost_usd: "0", unit_cost_lbp: "0", reason: "" }));
      setAdjustOpen(false);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSubmitting("");
    }
  }

  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!transfer.item_id) return setStatus("item is required");
    if (!transfer.from_warehouse_id) return setStatus("from warehouse is required");
    if (!transfer.to_warehouse_id) return setStatus("to warehouse is required");
    if (transfer.from_warehouse_id === transfer.to_warehouse_id) return setStatus("warehouses must differ");
    const qty = toNum(transfer.qty);
    if (qty <= 0) return setStatus("qty must be > 0");

    setSubmitting("transfer");
    setStatus("Posting transfer...");
    try {
      await apiPost("/inventory/transfer", {
        item_id: transfer.item_id,
        from_warehouse_id: transfer.from_warehouse_id,
        to_warehouse_id: transfer.to_warehouse_id,
        qty,
        unit_cost_usd: toNum(transfer.unit_cost_usd),
        unit_cost_lbp: toNum(transfer.unit_cost_lbp),
        reason: transfer.reason || undefined
      });
      setTransfer((prev) => ({ ...prev, qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0", reason: "" }));
      setTransferOpen(false);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSubmitting("");
    }
  }

  async function submitCycleCount(e: React.FormEvent) {
    e.preventDefault();
    if (!cycleWarehouseId) return setStatus("warehouse is required");
    const validLines = cycleLines.filter((l) => l.item_id);
    if (validLines.length === 0) return setStatus("at least one line is required");

    setSubmitting("cycle");
    setStatus("Posting cycle count...");
    try {
      await apiPost("/inventory/cycle-count", {
        warehouse_id: cycleWarehouseId,
        reason: cycleReason || undefined,
        lines: validLines.map((l) => ({
          item_id: l.item_id,
          counted_qty: toNum(l.counted_qty)
        }))
      });
      setCycleReason("");
      setCycleLines([{ item_id: "", counted_qty: "0" }]);
      setCycleOpen(false);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSubmitting("");
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

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Opening Stock Import</CardTitle>
              <CardDescription>Go-live: bulk load on-hand + unit cost, with idempotency.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-end">
              <Dialog open={openingOpen} onOpenChange={setOpeningOpen}>
                <Button onClick={openOpeningImport}>Import Opening Stock</Button>
                <DialogContent className="max-w-5xl">
                  <DialogHeader>
                    <DialogTitle>Opening Stock Import</DialogTitle>
                    <DialogDescription>
                      Paste CSV with headers: <span className="font-mono">sku, qty, unit_cost_usd, unit_cost_lbp, batch_no, expiry_date</span>.
                      Costs can be 0, but valuation will be 0 until corrected.
                    </DialogDescription>
                  </DialogHeader>

                  <form onSubmit={submitOpeningImport} className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                      <div className="space-y-1 md:col-span-3">
                        <label className="text-xs font-medium text-slate-700">Warehouse</label>
                        <select className="ui-select" value={openingWarehouseId} onChange={(e) => setOpeningWarehouseId(e.target.value)}>
                          <option value="">Select warehouse...</option>
                          {warehouses.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-slate-700">Posting Date</label>
                        <Input type="date" value={openingPostingDate} onChange={(e) => setOpeningPostingDate(e.target.value)} />
                      </div>
                      <div className="space-y-1 md:col-span-6">
                        <label className="text-xs font-medium text-slate-700">Import ID (UUID, for safe retries)</label>
                        <div className="flex flex-wrap items-center gap-2">
                          <Input value={openingImportId} onChange={(e) => setOpeningImportId(e.target.value)} placeholder="leave blank to auto-generate" />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              try {
                                setOpeningImportId((globalThis.crypto as any)?.randomUUID?.() || "");
                              } catch {
                                setOpeningImportId("");
                              }
                            }}
                          >
                            New ID
                          </Button>
                        </div>
                        <p className="text-xs text-slate-500">
                          If you run the same import twice with the same Import ID, the server will return “already applied”.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">CSV</label>
                        <textarea
                          className="ui-textarea min-h-[220px]"
                          value={openingCsv}
                          onChange={(e) => {
                            const next = e.target.value;
                            setOpeningCsv(next);
                            recomputeOpeningPreview(next);
                          }}
                          placeholder={`sku,qty,unit_cost_usd,unit_cost_lbp,batch_no,expiry_date\nSKU-001,10,1.25,0,,\nSKU-002,5,0,0,BATCH-A,2026-12-31`}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
                          <div className="flex items-center justify-between gap-2">
                            <span>Warehouse</span>
                            <span className="font-mono">{whById.get(openingWarehouseId)?.name || "-"}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span>Valid lines</span>
                            <span className="font-mono">{openingPreview.length}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span>Total qty</span>
                            <span className="font-mono">
                              {openingPreview.reduce((a, l) => a + Number(l.qty || 0), 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                            </span>
                          </div>
                        </div>

                        {openingErrors ? (
                          <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
                            <p className="text-xs font-semibold text-rose-800">CSV errors</p>
                            <pre className="mt-2 whitespace-pre-wrap text-xs text-rose-900">{openingErrors}</pre>
                          </div>
                        ) : null}

                        {openingResult ? (
                          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                            <p className="text-xs font-semibold text-emerald-900">Import result</p>
                            <div className="mt-2 space-y-1 text-xs text-emerald-900">
                              <div>
                                Import ID: <span className="font-mono">{openingResult.import_id}</span>
                              </div>
                              <div>
                                Status:{" "}
                                <span className="font-medium">{openingResult.already_applied ? "Already applied" : "Applied"}</span>
                              </div>
                              {openingResult.journal_id ? (
                                <div>
                                  Journal: <span className="font-mono">{openingResult.journal_id}</span>
                                </div>
                              ) : null}
                              {openingResult.warnings?.length ? (
                                <div className="mt-2">
                                  <p className="text-xs font-semibold">Warnings</p>
                                  <ul className="mt-1 list-disc pl-5 text-xs">
                                    {openingResult.warnings.map((w, i) => (
                                      <li key={i}>{w}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setOpeningOpen(false)}>
                        Close
                      </Button>
                      <Button type="submit" disabled={submitting === "opening"}>
                        {submitting === "opening" ? "..." : "Import"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inventory Adjustment</CardTitle>
              <CardDescription>Stock move + GL posting (Inventory vs INV_ADJ).</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-end">
              <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
                <DialogTrigger asChild>
                  <Button>New Adjustment</Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl">
                  <DialogHeader>
                    <DialogTitle>Inventory Adjustment</DialogTitle>
                    <DialogDescription>
                      Creates a stock move + GL posting. If unit cost is 0, server uses moving-average cost.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={submitAdjust} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">Item</label>
                      <select
                        className="ui-select"
                        value={adjust.item_id}
                        onChange={(e) => setAdjust((p) => ({ ...p, item_id: e.target.value }))}
                      >
                        <option value="">Select item...</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.sku} · {it.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">Warehouse</label>
                      <select
                        className="ui-select"
                        value={adjust.warehouse_id}
                        onChange={(e) => setAdjust((p) => ({ ...p, warehouse_id: e.target.value }))}
                      >
                        <option value="">Select warehouse...</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-700">Qty In</label>
                      <Input value={adjust.qty_in} onChange={(e) => setAdjust((p) => ({ ...p, qty_in: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-700">Qty Out</label>
                      <Input value={adjust.qty_out} onChange={(e) => setAdjust((p) => ({ ...p, qty_out: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Unit Cost USD</label>
                      <Input value={adjust.unit_cost_usd} onChange={(e) => setAdjust((p) => ({ ...p, unit_cost_usd: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Unit Cost LBP</label>
                      <Input value={adjust.unit_cost_lbp} onChange={(e) => setAdjust((p) => ({ ...p, unit_cost_lbp: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-4">
                      <label className="text-xs font-medium text-slate-700">Reason (optional)</label>
                      <Input value={adjust.reason} onChange={(e) => setAdjust((p) => ({ ...p, reason: e.target.value }))} placeholder="shrinkage / damaged / correction" />
                    </div>
                    <div className="md:col-span-6 flex justify-end">
                      <Button type="submit" disabled={submitting === "adjust"}>
                        {submitting === "adjust" ? "..." : "Post Adjustment"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Warehouse Transfer</CardTitle>
              <CardDescription>Moves stock between warehouses (no GL impact).</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-end">
              <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
                <DialogTrigger asChild>
                  <Button>New Transfer</Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl">
                  <DialogHeader>
                    <DialogTitle>Warehouse Transfer</DialogTitle>
                    <DialogDescription>
                      Moves stock between warehouses. If cost is 0, server uses moving-average cost from the source warehouse.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={submitTransfer} className="grid grid-cols-1 gap-3 md:grid-cols-6">
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">Item</label>
                      <select
                        className="ui-select"
                        value={transfer.item_id}
                        onChange={(e) => setTransfer((p) => ({ ...p, item_id: e.target.value }))}
                      >
                        <option value="">Select item...</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.sku} · {it.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">From Warehouse</label>
                      <select
                        className="ui-select"
                        value={transfer.from_warehouse_id}
                        onChange={(e) => setTransfer((p) => ({ ...p, from_warehouse_id: e.target.value }))}
                      >
                        <option value="">Select warehouse...</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">To Warehouse</label>
                      <select
                        className="ui-select"
                        value={transfer.to_warehouse_id}
                        onChange={(e) => setTransfer((p) => ({ ...p, to_warehouse_id: e.target.value }))}
                      >
                        <option value="">Select warehouse...</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-700">Qty</label>
                      <Input value={transfer.qty} onChange={(e) => setTransfer((p) => ({ ...p, qty: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Reason (optional)</label>
                      <Input value={transfer.reason} onChange={(e) => setTransfer((p) => ({ ...p, reason: e.target.value }))} placeholder="putaway / rebalancing" />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">Unit Cost USD (optional)</label>
                      <Input value={transfer.unit_cost_usd} onChange={(e) => setTransfer((p) => ({ ...p, unit_cost_usd: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-slate-700">Unit Cost LBP (optional)</label>
                      <Input value={transfer.unit_cost_lbp} onChange={(e) => setTransfer((p) => ({ ...p, unit_cost_lbp: e.target.value }))} />
                    </div>
                    <div className="md:col-span-6 flex justify-end">
                      <Button type="submit" disabled={submitting === "transfer"}>
                        {submitting === "transfer" ? "..." : "Post Transfer"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cycle Count</CardTitle>
              <CardDescription>Adjusts on-hand to counted quantities (posts Inventory vs INV_ADJ).</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-end">
              <Dialog open={cycleOpen} onOpenChange={setCycleOpen}>
                <DialogTrigger asChild>
                  <Button>New Count</Button>
                </DialogTrigger>
                <DialogContent className="max-w-5xl">
                  <DialogHeader>
                    <DialogTitle>Cycle Count</DialogTitle>
                    <DialogDescription>Counts items in a warehouse and posts the adjustment.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={submitCycleCount} className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="space-y-1 md:col-span-1">
                        <label className="text-xs font-medium text-slate-700">Warehouse</label>
                        <select
                          className="ui-select"
                          value={cycleWarehouseId}
                          onChange={(e) => setCycleWarehouseId(e.target.value)}
                        >
                          <option value="">Select warehouse...</option>
                          {warehouses.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-slate-700">Reason (optional)</label>
                        <Input value={cycleReason} onChange={(e) => setCycleReason(e.target.value)} placeholder="month-end count / spot check" />
                      </div>
                    </div>

                    <div className="ui-table-wrap">
                      <table className="ui-table">
                        <thead className="ui-thead">
                          <tr>
                            <th className="px-3 py-2">Item</th>
                            <th className="px-3 py-2 text-right">Counted Qty</th>
                            <th className="px-3 py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cycleLines.map((l, idx) => (
                            <tr key={idx} className="ui-tr-hover">
                              <td className="px-3 py-2">
                                <select
                                  className="ui-select ui-control-sm"
                                  value={l.item_id}
                                  onChange={(e) => updateCycleLine(idx, { item_id: e.target.value })}
                                >
                                  <option value="">Select item...</option>
                                  {items.map((it) => (
                                    <option key={it.id} value={it.id}>
                                      {it.sku} · {it.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Input value={l.counted_qty} onChange={(e) => updateCycleLine(idx, { counted_qty: e.target.value })} />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => removeCycleLine(idx)}
                                  disabled={cycleLines.length <= 1}
                                >
                                  Remove
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Button type="button" variant="outline" onClick={addCycleLine}>
                        Add Line
                      </Button>
                      <Button type="submit" disabled={submitting === "cycle"}>
                        {submitting === "cycle" ? "..." : "Post Cycle Count"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </div>
      </div>);
}
