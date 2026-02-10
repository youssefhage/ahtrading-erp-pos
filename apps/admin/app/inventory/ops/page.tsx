"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { SearchableSelect } from "@/components/searchable-select";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Item = { id: string; sku: string; name: string };
type Warehouse = { id: string; name: string };
type Location = { id: string; code: string; name: string | null; is_active: boolean };

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
  from_location_id: string;
  to_location_id: string;
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
    from_location_id: "",
    to_location_id: "",
    qty: "1",
    unit_cost_usd: "0",
    unit_cost_lbp: "0",
    reason: ""
  });

  const [fromLocations, setFromLocations] = useState<Location[]>([]);
  const [toLocations, setToLocations] = useState<Location[]>([]);

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

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [i, w] = await Promise.all([
        apiGet<{ items: Item[] }>("/items"),
        apiGet<{ warehouses: Warehouse[] }>("/warehouses")
      ]);
      setItems(i.items || []);
      setWarehouses(w.warehouses || []);
      const firstWhId = (w.warehouses || [])[0]?.id || "";
      if (firstWhId) {
        setOpeningWarehouseId((prev) => prev || firstWhId);
        setCycleWarehouseId((prev) => prev || firstWhId);
      }
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadLocations = useCallback(async (warehouseId: string, set: (rows: Location[]) => void) => {
    const wid = (warehouseId || "").trim();
    if (!wid) return set([]);
    try {
      const res = await apiGet<{ locations: Location[] }>(`/inventory/warehouses/${encodeURIComponent(wid)}/locations`);
      set(res.locations || []);
    } catch {
      set([]);
    }
  }, []);

  useEffect(() => {
    loadLocations(transfer.from_warehouse_id, setFromLocations);
    // Reset invalid selections when switching warehouses.
    setTransfer((p) => ({ ...p, from_location_id: "" }));
  }, [transfer.from_warehouse_id, loadLocations]);

  useEffect(() => {
    loadLocations(transfer.to_warehouse_id, setToLocations);
    setTransfer((p) => ({ ...p, to_location_id: "" }));
  }, [transfer.to_warehouse_id, loadLocations]);

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
    if (transfer.from_warehouse_id === transfer.to_warehouse_id) {
      if (transfer.from_location_id === transfer.to_location_id) return setStatus("for intra-warehouse moves, location must change");
      if (!transfer.from_location_id && !transfer.to_location_id) return setStatus("for intra-warehouse moves, set from/to location");
    }
    const qty = toNum(transfer.qty);
    if (qty <= 0) return setStatus("qty must be > 0");

    setSubmitting("transfer");
    setStatus("Posting transfer...");
    try {
      await apiPost("/inventory/transfer", {
        item_id: transfer.item_id,
        from_warehouse_id: transfer.from_warehouse_id,
        to_warehouse_id: transfer.to_warehouse_id,
        from_location_id: transfer.from_location_id || null,
        to_location_id: transfer.to_location_id || null,
        qty,
        unit_cost_usd: toNum(transfer.unit_cost_usd),
        unit_cost_lbp: toNum(transfer.unit_cost_lbp),
        reason: transfer.reason || undefined
      });
      setTransfer((prev) => ({ ...prev, qty: "1", unit_cost_usd: "0", unit_cost_lbp: "0", reason: "", from_location_id: "", to_location_id: "" }));
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
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

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
                        <label className="text-xs font-medium text-fg-muted">Warehouse</label>
                        <SearchableSelect
                          value={openingWarehouseId}
                          onChange={setOpeningWarehouseId}
                          placeholder="Select warehouse..."
                          searchPlaceholder="Search warehouses..."
                          options={[
                            { value: "", label: "Select warehouse..." },
                            ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                          ]}
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-fg-muted">Posting Date</label>
                        <Input type="date" value={openingPostingDate} onChange={(e) => setOpeningPostingDate(e.target.value)} />
                      </div>
                      <div className="space-y-1 md:col-span-6">
                        <label className="text-xs font-medium text-fg-muted">Import ID (UUID, for safe retries)</label>
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
                        <p className="text-xs text-fg-subtle">
                          If you run the same import twice with the same Import ID, the server will return “already applied”.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">CSV</label>
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
                        <div className="rounded-md border border-border bg-bg-elevated p-3 text-xs text-fg-muted">
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
                          <Banner
                            variant="danger"
                            size="sm"
                            title="CSV errors"
                            description="Fix the issues below and try again."
                          >
                            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-danger/20 bg-danger/5 p-2 text-[11px] leading-4 text-danger">
                              {openingErrors}
                            </pre>
                          </Banner>
                        ) : null}

                        {openingResult ? (
                          <Banner
                            variant={openingResult.already_applied ? "info" : "success"}
                            size="sm"
                            title="Import result"
                            description={openingResult.already_applied ? "This import ID was already applied." : "Import applied successfully."}
                          >
                            <dl className="grid grid-cols-1 gap-1 text-xs text-fg-muted">
                              <div className="flex items-center justify-between gap-2">
                                <dt>Import ID</dt>
                                <dd className="font-mono text-foreground">{openingResult.import_id}</dd>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <dt>Status</dt>
                                <dd className="font-medium text-foreground">
                                  {openingResult.already_applied ? "Already applied" : "Applied"}
                                </dd>
                              </div>
                              {openingResult.journal_id ? (
                                <div className="flex items-center justify-between gap-2">
                                  <dt>Journal</dt>
                                  <dd className="font-mono text-foreground">{openingResult.journal_id}</dd>
                                </div>
                              ) : null}
                            </dl>

                            {openingResult.warnings?.length ? (
                              <div className="mt-2">
                                <div className="text-xs font-semibold text-foreground">Warnings</div>
                                <ul className="mt-1 list-disc pl-5 text-xs text-fg-muted">
                                  {openingResult.warnings.map((w, i) => (
                                    <li key={i}>{w}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </Banner>
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
                      <label className="text-xs font-medium text-fg-muted">Item</label>
                      <SearchableSelect
                        value={adjust.item_id}
                        onChange={(v) => setAdjust((p) => ({ ...p, item_id: v }))}
                        placeholder="Select item..."
                        searchPlaceholder="Search items..."
                        maxOptions={120}
                        options={[
                          { value: "", label: "Select item..." },
                          ...items.map((it) => ({ value: it.id, label: `${it.sku} · ${it.name}`, keywords: `${it.sku} ${it.name}` })),
                        ]}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Warehouse</label>
                      <SearchableSelect
                        value={adjust.warehouse_id}
                        onChange={(v) => setAdjust((p) => ({ ...p, warehouse_id: v }))}
                        placeholder="Select warehouse..."
                        searchPlaceholder="Search warehouses..."
                        options={[
                          { value: "", label: "Select warehouse..." },
                          ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                        ]}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Qty In</label>
                      <Input value={adjust.qty_in} onChange={(e) => setAdjust((p) => ({ ...p, qty_in: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Qty Out</label>
                      <Input value={adjust.qty_out} onChange={(e) => setAdjust((p) => ({ ...p, qty_out: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">Unit Cost USD</label>
                      <Input value={adjust.unit_cost_usd} onChange={(e) => setAdjust((p) => ({ ...p, unit_cost_usd: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">Unit Cost LL</label>
                      <Input value={adjust.unit_cost_lbp} onChange={(e) => setAdjust((p) => ({ ...p, unit_cost_lbp: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-4">
                      <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
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
              <CardDescription>Moves stock between warehouses or bins (no GL impact).</CardDescription>
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
                      <label className="text-xs font-medium text-fg-muted">Item</label>
                      <SearchableSelect
                        value={transfer.item_id}
                        onChange={(v) => setTransfer((p) => ({ ...p, item_id: v }))}
                        placeholder="Select item..."
                        searchPlaceholder="Search items..."
                        maxOptions={120}
                        options={[
                          { value: "", label: "Select item..." },
                          ...items.map((it) => ({ value: it.id, label: `${it.sku} · ${it.name}`, keywords: `${it.sku} ${it.name}` })),
                        ]}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">From Warehouse</label>
                      <SearchableSelect
                        value={transfer.from_warehouse_id}
                        onChange={(v) => setTransfer((p) => ({ ...p, from_warehouse_id: v }))}
                        placeholder="Select warehouse..."
                        searchPlaceholder="Search warehouses..."
                        options={[
                          { value: "", label: "Select warehouse..." },
                          ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                        ]}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">From Location (optional)</label>
                      <SearchableSelect
                        value={transfer.from_location_id}
                        onChange={(v) => setTransfer((p) => ({ ...p, from_location_id: v }))}
                        placeholder="No bin"
                        searchPlaceholder="Search bins..."
                        maxOptions={120}
                        options={[
                          { value: "", label: "No bin" },
                          ...fromLocations
                            .filter((l) => l.is_active)
                            .map((l) => ({ value: l.id, label: `${l.code}${l.name ? ` - ${l.name}` : ""}`, keywords: `${l.code} ${l.name || ""}`.trim() })),
                        ]}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">To Warehouse</label>
                      <SearchableSelect
                        value={transfer.to_warehouse_id}
                        onChange={(v) => setTransfer((p) => ({ ...p, to_warehouse_id: v }))}
                        placeholder="Select warehouse..."
                        searchPlaceholder="Search warehouses..."
                        options={[
                          { value: "", label: "Select warehouse..." },
                          ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                        ]}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">To Location (optional)</label>
                      <SearchableSelect
                        value={transfer.to_location_id}
                        onChange={(v) => setTransfer((p) => ({ ...p, to_location_id: v }))}
                        placeholder="No bin"
                        searchPlaceholder="Search bins..."
                        maxOptions={120}
                        options={[
                          { value: "", label: "No bin" },
                          ...toLocations
                            .filter((l) => l.is_active)
                            .map((l) => ({ value: l.id, label: `${l.code}${l.name ? ` - ${l.name}` : ""}`, keywords: `${l.code} ${l.name || ""}`.trim() })),
                        ]}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-fg-muted">Qty</label>
                      <Input value={transfer.qty} onChange={(e) => setTransfer((p) => ({ ...p, qty: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
                      <Input value={transfer.reason} onChange={(e) => setTransfer((p) => ({ ...p, reason: e.target.value }))} placeholder="putaway / rebalancing" />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Unit Cost USD (optional)</label>
                      <Input value={transfer.unit_cost_usd} onChange={(e) => setTransfer((p) => ({ ...p, unit_cost_usd: e.target.value }))} />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-xs font-medium text-fg-muted">Unit Cost LL (optional)</label>
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
                        <label className="text-xs font-medium text-fg-muted">Warehouse</label>
                        <SearchableSelect
                          value={cycleWarehouseId}
                          onChange={setCycleWarehouseId}
                          placeholder="Select warehouse..."
                          searchPlaceholder="Search warehouses..."
                          options={[
                            { value: "", label: "Select warehouse..." },
                            ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                          ]}
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
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
                                <SearchableSelect
                                  value={l.item_id}
                                  onChange={(v) => updateCycleLine(idx, { item_id: v })}
                                  placeholder="Select item..."
                                  searchPlaceholder="Search items..."
                                  maxOptions={120}
                                  controlClassName="ui-select ui-control-sm"
                                  options={[
                                    { value: "", label: "Select item..." },
                                    ...items.map((it) => ({ value: it.id, label: `${it.sku} · ${it.name}`, keywords: `${it.sku} ${it.name}` })),
                                  ]}
                                />
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
