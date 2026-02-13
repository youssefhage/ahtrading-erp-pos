"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPatch, apiPost, getCompanyId } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { getDefaultWarehouseId } from "@/lib/op-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { ItemTypeahead, type ItemTypeaheadItem } from "@/components/item-typeahead";
import { CustomerTypeahead, type CustomerTypeaheadCustomer } from "@/components/customer-typeahead";
import { SearchableSelect } from "@/components/searchable-select";
import { Page, PageHeader } from "@/components/page";
import { ShortcutLink } from "@/components/shortcut-link";
import { getFxRateUsdToLbp } from "@/lib/fx";

type Warehouse = { id: string; name: string };
type UomConv = { uom_code: string; to_base_factor: string | number; is_active: boolean };

type InvoiceLineDraft = {
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  unit_of_measure?: string | null;
  tax_code_id?: string | null;
  standard_cost_usd?: string | number | null;
  standard_cost_lbp?: string | number | null;
  // Entered UOM context (persisted on document lines).
  uom?: string | null;
  qty_factor?: string | null; // entered -> base multiplier
  qty: string;
  pre_unit_price_usd: string;
  pre_unit_price_lbp: string;
  discount_pct: string; // UI percent (e.g. "10" == 10%)
};

type InvoiceDetail = {
  invoice: {
    id: string;
    status: string;
    customer_id: string | null;
    warehouse_id: string | null;
    invoice_date?: string | null;
    due_date?: string | null;
    reserve_stock?: boolean;
    exchange_rate: string | number;
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
    unit_price_usd: string | number;
    unit_price_lbp: string | number;
    pre_discount_unit_price_usd?: string | number;
    pre_discount_unit_price_lbp?: string | number;
    discount_pct?: string | number; // fraction (0.10 == 10%)
    discount_amount_usd?: string | number;
    discount_amount_lbp?: string | number;
  }>;
};

function toNum(v: string) {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

function clampPct(pct: number) {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

function resolveLine(l: InvoiceLineDraft, exchangeRate: number) {
  const qtyEntered = toNum(String(l.qty));
  const qtyFactor = toNum(String(l.qty_factor || "1")) || 1;
  const qtyBase = qtyEntered * qtyFactor;
  let preUsd = toNum(String(l.pre_unit_price_usd));
  let preLbp = toNum(String(l.pre_unit_price_lbp));
  const discPctUi = clampPct(toNum(String(l.discount_pct)));
  const discFrac = discPctUi / 100;

  if (exchangeRate > 0) {
    if (preUsd === 0 && preLbp > 0) preUsd = preLbp / exchangeRate;
    if (preLbp === 0 && preUsd > 0) preLbp = preUsd * exchangeRate;
  }

  const netUsd = preUsd * (1 - discFrac);
  const netLbp = preLbp * (1 - discFrac);

  const totalUsd = qtyBase * netUsd;
  const totalLbp = qtyBase * netLbp;

  const discountUsd = Math.max(0, qtyBase * (preUsd - netUsd));
  const discountLbp = Math.max(0, qtyBase * (preLbp - netLbp));

  return {
    qtyEntered,
    qtyFactor,
    qtyBase,
    preUsd,
    preLbp,
    discPctUi,
    discFrac,
    netUsd,
    netLbp,
    totalUsd,
    totalLbp,
    discountUsd,
    discountLbp,
  };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + Math.max(0, days || 0));
  return d.toISOString().slice(0, 10);
}

export function SalesInvoiceDraftEditor(props: { mode: "create" | "edit"; invoiceId?: string }) {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerTypeaheadCustomer | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => todayIso());
  const [autoDueDate, setAutoDueDate] = useState(true);
  const [dueDate, setDueDate] = useState(() => todayIso());
  const [reserveStock, setReserveStock] = useState(false);
  const [exchangeRate, setExchangeRate] = useState("0");

  const [lines, setLines] = useState<InvoiceLineDraft[]>([]);
  const [invoiceDiscountPct, setInvoiceDiscountPct] = useState("0");
  const [uomConvByItem, setUomConvByItem] = useState<Record<string, UomConv[]>>({});
  const [showSecondaryCurrency, setShowSecondaryCurrency] = useState(false);

  const [addItem, setAddItem] = useState<ItemTypeaheadItem | null>(null);
  const [addQty, setAddQty] = useState("1");
  const [addUom, setAddUom] = useState("");
  const [addQtyFactor, setAddQtyFactor] = useState("1");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");
  const [addDiscPct, setAddDiscPct] = useState("0");

  const addQtyRef = useRef<HTMLInputElement | null>(null);
  const saveHotkeyRef = useRef<() => void>(() => {});

  const ensureUomConversions = useCallback(async (itemIds: string[]) => {
    const ids = Array.from(new Set((itemIds || []).map((x) => String(x || "").trim()).filter(Boolean)));
    if (!ids.length) return;
    try {
      const res = await apiPost<{ conversions: Record<string, UomConv[]> }>("/items/uom-conversions/lookup", { item_ids: ids });
      setUomConvByItem((prev) => ({ ...prev, ...(res.conversions || {}) }));
    } catch {
      // Non-blocking: the editor still works in base UOM without this lookup.
    }
  }, []);

  const totals = useMemo(() => {
    const ex = toNum(exchangeRate);
    let subtotalUsd = 0;
    let subtotalLbp = 0;
    let discountUsd = 0;
    let discountLbp = 0;
    for (const l of lines || []) {
      const r = resolveLine(l, ex);
      subtotalUsd += r.totalUsd;
      subtotalLbp += r.totalLbp;
      discountUsd += r.discountUsd;
      discountLbp += r.discountLbp;
    }
    return {
      subtotalUsd,
      subtotalLbp,
      discountUsd,
      discountLbp,
      totalUsd: subtotalUsd,
      totalLbp: subtotalLbp,
    };
  }, [lines, exchangeRate]);

  const addUomOptions = useMemo(() => {
    if (!addItem) return [];
    const convs = uomConvByItem[addItem.id] || [];
    const seen = new Set<string>();
    const out: Array<{ value: string; label: string }> = [];
    for (const c of convs || []) {
      if (!c?.is_active) continue;
      const u = String(c.uom_code || "").trim().toUpperCase();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push({ value: u, label: u });
    }
    const base = String(addItem.unit_of_measure || "").trim().toUpperCase();
    if (base && !seen.has(base)) out.unshift({ value: base, label: `${base} (base)` });
    return out.length ? out : base ? [{ value: base, label: base }] : [];
  }, [addItem, uomConvByItem]);

  function applyInvoiceDiscountToAllLines() {
    const pct = clampPct(toNum(invoiceDiscountPct));
    setInvoiceDiscountPct(String(pct));
    setAddDiscPct(String(pct));
    setLines((prev) => prev.map((l) => ({ ...l, discount_pct: String(pct) })));
  }

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [wh, fx] = await Promise.all([
        apiGet<{ warehouses: Warehouse[] }>("/warehouses"),
        getFxRateUsdToLbp(),
      ]);
      setWarehouses(wh.warehouses || []);
      const defaultEx = Number(fx?.usd_to_lbp || 0) > 0 ? Number(fx.usd_to_lbp) : 90000;

      const firstWhId = (wh.warehouses || [])[0]?.id || "";
      const preferredWhId = (() => {
        const cid = getCompanyId();
        const pref = getDefaultWarehouseId(cid);
        return pref && (wh.warehouses || []).some((w) => w.id === pref) ? pref : "";
      })();
      if (firstWhId || preferredWhId) setWarehouseId((prev) => prev || preferredWhId || firstWhId);

      if (props.mode === "edit") {
        const id = props.invoiceId || "";
        if (!id) throw new Error("missing invoice id");
        const det = await apiGet<InvoiceDetail>(`/sales/invoices/${id}`);
        if (det.invoice.status !== "draft") throw new Error("Only draft invoices can be edited.");

      const uniq = Array.from(new Set((det.lines || []).map((l) => l.item_id).filter(Boolean)));
      const look = uniq.length
          ? await apiPost<{
              items: Array<{
                id: string;
                sku: string;
                name: string;
                unit_of_measure: string;
                tax_code_id?: string | null;
                standard_cost_usd?: string | number | null;
                standard_cost_lbp?: string | number | null;
              }>;
            }>("/items/lookup", {
              ids: uniq
            })
          : { items: [] };
      const byId = new Map((look.items || []).map((it) => [it.id, it]));
      await ensureUomConversions(uniq);

        setCustomerId(det.invoice.customer_id || "");
        if (det.invoice.customer_id) {
          try {
            const c = await apiGet<{ customer: CustomerTypeaheadCustomer }>(
              `/customers/${encodeURIComponent(det.invoice.customer_id)}`
            );
            setSelectedCustomer(c.customer || null);
          } catch {
            setSelectedCustomer(null);
          }
        } else {
          setSelectedCustomer(null);
        }
        setWarehouseId(det.invoice.warehouse_id || preferredWhId || firstWhId || "");
        setInvoiceDate(String(det.invoice.invoice_date || todayIso()).slice(0, 10));
        setAutoDueDate(false);
        setDueDate(String(det.invoice.due_date || det.invoice.invoice_date || todayIso()).slice(0, 10));
        setReserveStock(Boolean(det.invoice.reserve_stock));
        const invEx = Number(det.invoice.exchange_rate || 0);
        setExchangeRate(String(invEx > 0 ? invEx : defaultEx));
        const mapped = (det.lines || []).map((l) => {
          const qtyEntered = Number((l as any).qty_entered ?? l.qty ?? 0);
          const uom = String((l as any).uom || (l as any).unit_of_measure || byId.get(l.item_id)?.unit_of_measure || "").trim() || null;
          const qtyFactor = Number((l as any).qty_factor || 1) || 1;
          const unitUsd = Number(l.unit_price_usd || 0);
          const unitLbp = Number(l.unit_price_lbp || 0);
          const preUsd = Number((l as any).pre_discount_unit_price_usd || 0);
          const preLbp = Number((l as any).pre_discount_unit_price_lbp || 0);
          const discFrac = Number((l as any).discount_pct || 0);
          let discPctUi = discFrac > 0 ? discFrac * 100 : 0;
          if (discPctUi === 0) {
            if (preUsd > 0 && unitUsd >= 0 && preUsd !== unitUsd) discPctUi = (1 - unitUsd / preUsd) * 100;
            else if (preLbp > 0 && unitLbp >= 0 && preLbp !== unitLbp) discPctUi = (1 - unitLbp / preLbp) * 100;
          }
          discPctUi = clampPct(discPctUi);

          return {
            item_id: l.item_id,
            item_sku: (l as any).item_sku || byId.get(l.item_id)?.sku || null,
            item_name: (l as any).item_name || byId.get(l.item_id)?.name || null,
            unit_of_measure: (l as any).unit_of_measure || byId.get(l.item_id)?.unit_of_measure || null,
            tax_code_id: (byId.get(l.item_id) as any)?.tax_code_id ?? null,
            standard_cost_usd: (byId.get(l.item_id) as any)?.standard_cost_usd ?? null,
            standard_cost_lbp: (byId.get(l.item_id) as any)?.standard_cost_lbp ?? null,
            uom,
            qty_factor: String(qtyFactor),
            qty: String(qtyEntered || 0),
            pre_unit_price_usd: String(preUsd > 0 ? preUsd : unitUsd || 0),
            pre_unit_price_lbp: String(preLbp > 0 ? preLbp : unitLbp || 0),
            discount_pct: discPctUi ? String(discPctUi) : "0",
          } satisfies InvoiceLineDraft;
        });
        setLines(mapped);

        const uniqDisc = Array.from(new Set(mapped.map((x) => clampPct(toNum(x.discount_pct))).filter((n) => n > 0)));
        setInvoiceDiscountPct(uniqDisc.length === 1 ? String(uniqDisc[0]) : "0");
      } else {
        setCustomerId("");
        setSelectedCustomer(null);
        setInvoiceDate(todayIso());
        setAutoDueDate(true);
        setDueDate(todayIso());
        setReserveStock(false);
        setExchangeRate(String(defaultEx));
        setLines([]);
        setInvoiceDiscountPct("0");
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
    function isTypingTarget(t: EventTarget | null) {
      if (!(t instanceof HTMLElement)) return false;
      const tag = (t.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if ((t as any).isContentEditable) return true;
      return false;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (loading) return;
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = (e.key || "").toLowerCase();
      if (!mod) return;

      // Cmd/Ctrl+S: Save draft quickly.
      if (key === "s") {
        e.preventDefault();
        saveHotkeyRef.current?.();
        return;
      }

      // Cmd/Ctrl+Enter: Save draft quickly.
      if (key === "enter") {
        e.preventDefault();
        saveHotkeyRef.current?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading]);

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

  useEffect(() => {
    if (!autoDueDate) return;
    const invDate = invoiceDate || todayIso();
    const terms = Number(selectedCustomer?.payment_terms_days || 0);
    const next = addDays(invDate, Number.isFinite(terms) ? terms : 0);
    setDueDate(next);
  }, [autoDueDate, customerId, invoiceDate, selectedCustomer?.payment_terms_days]);

  function onPickItem(it: ItemTypeaheadItem) {
    setAddItem(it);
    // Best-effort preload conversions so the line UOM selector is ready.
    ensureUomConversions([it.id]);
    setAddQty("1");
    const baseUom = String(it.unit_of_measure || "").trim().toUpperCase();
    setAddUom(baseUom);
    setAddQtyFactor("1");
    setAddDiscPct(invoiceDiscountPct || "0");

    const usd = toNum(String((it as any).price_usd ?? ""));
    const lbp = toNum(String((it as any).price_lbp ?? ""));
    setAddUsd(usd > 0 ? String(usd) : "");
    setAddLbp(lbp > 0 ? String(lbp) : "");

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
    const uom = String(addUom || addItem.unit_of_measure || "").trim().toUpperCase() || null;
    if (!uom) return setStatus("UOM is required.");
    let unitUsd = toNum(addUsd);
    let unitLbp = toNum(addLbp);
    const ex = toNum(exchangeRate);
    if (ex > 0) {
      if (unitUsd === 0 && unitLbp > 0) unitUsd = unitLbp / ex;
      if (unitLbp === 0 && unitUsd > 0) unitLbp = unitUsd * ex;
    }
    if (unitUsd === 0 && unitLbp === 0) return setStatus("Set USD or LBP unit price.");
    setLines((prev) => [
      ...prev,
      {
        item_id: addItem.id,
        item_sku: addItem.sku,
        item_name: addItem.name,
        unit_of_measure: addItem.unit_of_measure ?? null,
        tax_code_id: (addItem as any).tax_code_id ?? null,
        standard_cost_usd: (addItem as any).standard_cost_usd ?? null,
        standard_cost_lbp: (addItem as any).standard_cost_lbp ?? null,
        uom,
        qty_factor: String(qtyFactor),
        qty: String(qtyEntered),
        pre_unit_price_usd: String(unitUsd),
        pre_unit_price_lbp: String(unitLbp),
        discount_pct: addDiscPct || "0"
      }
    ]);
    setAddItem(null);
    setAddQty("1");
    setAddUom("");
    setAddQtyFactor("1");
    setAddUsd("");
    setAddLbp("");
    setAddDiscPct(invoiceDiscountPct || "0");
    setStatus("");
  }

  function patchLine(idx: number, patch: Partial<InvoiceLineDraft>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const out: InvoiceLineDraft = { ...l, ...patch } as InvoiceLineDraft;
        const ex = toNum(exchangeRate);
        if (ex > 0) {
          const usd = toNum(out.pre_unit_price_usd);
          const lbp = toNum(out.pre_unit_price_lbp);
          if (patch.pre_unit_price_usd !== undefined && usd > 0 && lbp === 0) out.pre_unit_price_lbp = String(usd * ex);
          if (patch.pre_unit_price_lbp !== undefined && lbp > 0 && usd === 0) out.pre_unit_price_usd = String(lbp / ex);
        }
        if (patch.discount_pct !== undefined) out.discount_pct = String(clampPct(toNum(out.discount_pct)));
        return out;
      })
    );
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!warehouseId) return setStatus("warehouse is required");

    const exRes = parseNumberInput(exchangeRate);
    if (!exRes.ok && exRes.reason === "invalid") return setStatus("Invalid exchange rate.");
    const ex = exRes.ok ? exRes.value : 0;

    const linesOut: Array<{
      item_id: string;
      qty: number; // base qty
      uom?: string | null;
      qty_factor?: number | null;
      qty_entered?: number | null;
      unit_price_usd: number; // per base UOM
      unit_price_lbp: number;
      unit_price_entered_usd?: number | null; // per entered UOM
      unit_price_entered_lbp?: number | null;
      pre_discount_unit_price_usd: number;
      pre_discount_unit_price_lbp: number;
      discount_pct: number; // fraction (0.10 == 10%)
    }> = [];
    for (let i = 0; i < (lines || []).length; i++) {
      const l = lines[i];
      const qtyRes = parseNumberInput(l.qty);
      const usdRes = parseNumberInput(l.pre_unit_price_usd);
      const lbpRes = parseNumberInput(l.pre_unit_price_lbp);
      const discRes = parseNumberInput(l.discount_pct);
      if (!qtyRes.ok && qtyRes.reason === "invalid") return setStatus(`Invalid qty on line ${i + 1}.`);
      if (!usdRes.ok && usdRes.reason === "invalid") return setStatus(`Invalid unit USD on line ${i + 1}.`);
      if (!lbpRes.ok && lbpRes.reason === "invalid") return setStatus(`Invalid unit LBP on line ${i + 1}.`);
      if (!discRes.ok && discRes.reason === "invalid") return setStatus(`Invalid discount % on line ${i + 1}.`);
      const qtyEntered = qtyRes.ok ? qtyRes.value : 0;
      let preUsd = usdRes.ok ? usdRes.value : 0;
      let preLbp = lbpRes.ok ? lbpRes.value : 0;
      const discPctUi = clampPct(discRes.ok ? discRes.value : 0);
      const discFrac = discPctUi / 100;
      if (qtyEntered <= 0) return setStatus(`Qty must be > 0 (line ${i + 1}).`);

      const uom = String(l.uom || l.unit_of_measure || "").trim().toUpperCase() || null;
      if (!uom) return setStatus(`Missing UOM (line ${i + 1}).`);
      const qtyFactor = toNum(String(l.qty_factor || "1")) || 1;
      if (qtyFactor <= 0) return setStatus(`qty_factor must be > 0 (line ${i + 1}).`);
      const qtyBase = qtyEntered * qtyFactor;

      if (ex > 0) {
        if (preUsd === 0 && preLbp > 0) preUsd = preLbp / ex;
        if (preLbp === 0 && preUsd > 0) preLbp = preUsd * ex;
      }
      if (preUsd === 0 && preLbp === 0) return setStatus(`Set USD or LBP unit price (line ${i + 1}).`);

      let netUsd = preUsd * (1 - discFrac);
      let netLbp = preLbp * (1 - discFrac);
      if (ex > 0) {
        if (netUsd === 0 && netLbp > 0) netUsd = netLbp / ex;
        if (netLbp === 0 && netUsd > 0) netLbp = netUsd * ex;
      }

      linesOut.push({
        item_id: l.item_id,
        qty: qtyBase,
        uom,
        qty_factor: qtyFactor,
        qty_entered: qtyEntered,
        unit_price_usd: netUsd,
        unit_price_lbp: netLbp,
        unit_price_entered_usd: netUsd * qtyFactor,
        unit_price_entered_lbp: netLbp * qtyFactor,
        pre_discount_unit_price_usd: preUsd,
        pre_discount_unit_price_lbp: preLbp,
        discount_pct: discFrac
      });
    }

    setSaving(true);
    setStatus(props.mode === "edit" ? "Saving draft..." : "Creating draft...");
    try {
      const payload = {
        customer_id: customerId || null,
        warehouse_id: warehouseId,
        invoice_date: invoiceDate || undefined,
        due_date: dueDate || undefined,
        reserve_stock: reserveStock,
        exchange_rate: ex,
        pricing_currency: "USD",
        settlement_currency: "USD",
        lines: linesOut
      };

      if (props.mode === "edit") {
        const id = props.invoiceId || "";
        if (!id) throw new Error("missing invoice id");
        await apiPatch(`/sales/invoices/${id}`, payload);
        setStatus("");
        router.push(`/sales/invoices/${id}`);
      } else {
        const res = await apiPost<{ id: string }>("/sales/invoices/drafts", payload);
        setStatus("");
        router.push(`/sales/invoices/${res.id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  // Avoid hotkey effect re-attaching every render: keep latest save() in a ref.
  saveHotkeyRef.current = () => void save();

  const headerTitle = props.mode === "edit" ? "Edit Draft Sales Invoice" : "Create Draft Sales Invoice";
  const headerDesc = "Draft first, then Post when ready (stock + GL).";

  function IssuePill(props: { tone?: "warn" | "danger"; children: React.ReactNode }) {
    const tone = props.tone || "warn";
    const cls =
      tone === "danger"
        ? "border-danger/35 bg-danger/10 text-danger"
        : "border-border-subtle bg-bg-sunken/40 text-fg-muted";
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
        {props.children}
      </span>
    );
  }

  function lineIssues(l: InvoiceLineDraft) {
    const uom = String(l.uom || l.unit_of_measure || "").trim();
    const vatMissing = !String(l.tax_code_id || "").trim();
    const costUsd = toNum(String(l.standard_cost_usd ?? 0));
    const costLbp = toNum(String(l.standard_cost_lbp ?? 0));
    const costMissing = costUsd <= 0 && costLbp <= 0;
    return {
      uomMissing: !uom,
      vatMissing,
      costMissing,
    };
  }

  return (
    <Page width="lg">
      <PageHeader
        title={headerTitle}
        description={headerDesc}
        actions={
          <Button variant="outline" onClick={() => router.push("/sales/invoices")}>
            Back
          </Button>
        }
      />

      {status ? (
        <ErrorBanner error={status} onRetry={load} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Required fields and due date logic.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Customer (optional)</label>
                <CustomerTypeahead
                  disabled={loading}
                  onSelect={(c) => {
                    setSelectedCustomer(c);
                    setCustomerId(c.id);
                  }}
                  onClear={() => {
                    setSelectedCustomer(null);
                    setCustomerId("");
                  }}
                  placeholder="Walk-in or search customer..."
                />
                {selectedCustomer ? (
                  <div className="text-[11px] text-fg-subtle">
                    Selected: <span className="font-medium text-foreground">{selectedCustomer.name}</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-fg-subtle">Walk-in customer</div>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Warehouse</label>
                <SearchableSelect
                  value={warehouseId}
                  onChange={setWarehouseId}
                  disabled={loading}
                  placeholder="Select warehouse..."
                  searchPlaceholder="Search warehouses..."
                  options={[
                    { value: "", label: "Select warehouse..." },
                    ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                  ]}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Invoice Date</label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={loading} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Due Date</label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={loading || autoDueDate}
                />
              </div>
              <div className="md:col-span-2 flex items-end">
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={autoDueDate} onChange={(e) => setAutoDueDate(e.target.checked)} />
                  Auto-calculate from customer payment terms
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD→LBP)</label>
                <Input inputMode="decimal" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} disabled={loading} />
              </div>
              <div className="md:col-span-2 flex items-end">
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={reserveStock} onChange={(e) => setReserveStock(e.target.checked)} />
                  Reserve stock while draft (affects availability reporting)
                </label>
              </div>
            </div>

	            <Card>
	              <CardHeader>
	                <div className="flex flex-wrap items-start justify-between gap-2">
	                  <div>
	                    <CardTitle className="text-base">Items</CardTitle>
	                    <CardDescription>Add items, then Post when ready.</CardDescription>
	                  </div>
	                  <div className="flex flex-wrap items-end justify-end gap-2">
                      <label className="inline-flex items-center gap-2 text-[11px] text-fg-muted">
                        <input
                          type="checkbox"
                          checked={showSecondaryCurrency}
                          onChange={(e) => setShowSecondaryCurrency(e.target.checked)}
                        />
                        Show secondary currency (LBP)
                      </label>
	                    <div className="space-y-1">
	                      <label className="text-[11px] font-medium text-fg-muted">Invoice Disc%</label>
	                      <Input
	                        value={invoiceDiscountPct}
	                        onChange={(e) => setInvoiceDiscountPct(e.target.value)}
	                        placeholder="0"
                          inputMode="decimal"
	                        className="h-8 w-28 text-right font-mono text-xs"
	                      />
	                    </div>
	                    <Button type="button" size="sm" variant="outline" onClick={applyInvoiceDiscountToAllLines} disabled={loading}>
	                      Apply to Items
	                    </Button>
	                  </div>
	                </div>
	              </CardHeader>
              <CardContent className="space-y-3">
                <form onSubmit={addLine} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                  <div className={`space-y-1 ${showSecondaryCurrency ? "md:col-span-4" : "md:col-span-5"}`}>
                    <label className="text-xs font-medium text-fg-muted">Item (search by name or barcode)</label>
                    <ItemTypeahead
                      endpoint="/pricing/catalog/typeahead"
                      globalScan
                      onSelect={(it) => onPickItem(it)}
                      disabled={loading}
                      placeholder="Search item name / barcode..."
                    />
                    {addItem ? (
                      <p className="text-[11px] text-fg-subtle">
                        Selected: <span className="font-mono">{addItem.sku}</span> · {addItem.name}
                      </p>
                    ) : (
                      <p className="text-[11px] text-fg-subtle">Tip: scan a barcode or type a few letters of the name, then Enter.</p>
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
                  <div className={`space-y-1 ${showSecondaryCurrency ? "md:col-span-1" : "md:col-span-2"}`}>
                    <label className="text-xs font-medium text-fg-muted">Disc%</label>
                    <Input inputMode="decimal" value={addDiscPct} onChange={(e) => setAddDiscPct(e.target.value)} placeholder="0" />
                  </div>
                  <div className="md:col-span-12 text-[11px] text-fg-subtle">
                    Qty factor: <span className="font-mono">{toNum(addQtyFactor).toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
                  </div>
                  <div className="md:col-span-12 flex justify-end gap-2">
                    <Button type="submit" variant="outline" disabled={loading}>
                      Add Line
                    </Button>
                  </div>
	                </form>

	                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
	                  <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-2 text-xs text-fg-muted">
	                    <div className="flex items-center justify-between gap-2">
	                      <span>Subtotal</span>
	                      <span className="font-mono text-foreground">
	                        {totals.subtotalUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                          {showSecondaryCurrency
                            ? ` / ${totals.subtotalLbp.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                            : ""}
	                      </span>
	                    </div>
	                  </div>
	                  <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-2 text-xs text-fg-muted">
	                    <div className="flex items-center justify-between gap-2">
	                      <span>Discount</span>
	                      <span className="font-mono text-foreground">
	                        {totals.discountUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                          {showSecondaryCurrency
                            ? ` / ${totals.discountLbp.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                            : ""}
	                      </span>
	                    </div>
	                  </div>
	                  <div className="rounded-md border border-border-subtle bg-bg-elevated/60 p-2 text-xs text-fg-muted">
	                    <div className="flex items-center justify-between gap-2">
	                      <span>Total</span>
	                      <span className="font-mono text-foreground">
	                        {totals.totalUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                          {showSecondaryCurrency
                            ? ` / ${totals.totalLbp.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                            : ""}
	                      </span>
	                    </div>
	                  </div>
	                </div>

	                <div className="ui-table-scroll">
                  <table className="ui-table">
                    <thead className="ui-thead">
	                      <tr>
	                        <th className="px-3 py-2">Item</th>
	                        <th className="px-3 py-2 text-right">Qty</th>
	                        <th className="px-3 py-2">UOM</th>
	                        <th className="px-3 py-2 text-right">Unit USD</th>
	                        {showSecondaryCurrency ? <th className="px-3 py-2 text-right">Unit LBP</th> : null}
	                        <th className="px-3 py-2 text-right">Disc%</th>
	                        <th className="px-3 py-2 text-right">Net USD</th>
	                        {showSecondaryCurrency ? <th className="px-3 py-2 text-right">Net LBP</th> : null}
	                        <th className="px-3 py-2 text-right">Actions</th>
	                      </tr>
                    </thead>
                    <tbody>
	                      {lines.map((l, idx) => {
                          const issues = lineIssues(l);
	                        const r = resolveLine(l, toNum(exchangeRate));
	                        const convs = uomConvByItem[l.item_id] || [];
	                        const uomOpts = (() => {
	                          const seen = new Set<string>();
	                          const out: Array<{ value: string; label: string }> = [];
	                          for (const c of convs || []) {
	                            if (!c?.is_active) continue;
	                            const u = String(c.uom_code || "").trim().toUpperCase();
	                            if (!u || seen.has(u)) continue;
	                            seen.add(u);
	                            out.push({ value: u, label: u });
	                          }
	                          const base = String(l.unit_of_measure || "").trim().toUpperCase();
	                          if (base && !seen.has(base)) out.unshift({ value: base, label: `${base} (base)` });
	                          return out.length ? out : base ? [{ value: base, label: base }] : [];
	                        })();
	                        return (
	                          <tr key={`${l.item_id}-${idx}`} className="ui-tr-hover">
                            <td className="px-3 py-2">
                              <ShortcutLink
                                href={`/catalog/items/${encodeURIComponent(l.item_id)}`}
                                title="Open item"
                              >
                                <span className="font-mono text-xs">{l.item_sku || l.item_id.slice(0, 8)}</span>
                                {l.item_name ? <span> · {l.item_name}</span> : null}
                              </ShortcutLink>
                              {issues.uomMissing || issues.vatMissing || issues.costMissing ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {issues.uomMissing ? <IssuePill tone="danger">Missing UOM</IssuePill> : null}
                                  {issues.vatMissing ? <IssuePill>VAT template missing</IssuePill> : null}
                                  {issues.costMissing ? <IssuePill>Cost missing</IssuePill> : null}
                                </div>
                              ) : null}
                            </td>
	                            <td className="px-3 py-2 text-right">
	                              <div className="flex items-center justify-end gap-2">
	                                <Input
	                                  value={l.qty}
	                                  onChange={(e) => patchLine(idx, { qty: e.target.value })}
                                    inputMode="decimal"
                                    data-line-idx={idx}
                                    data-line-field="qty"
                                    onKeyDown={(e) => onLineKeyDown(e, idx, "qty")}
	                                  className="h-8 w-24 text-right font-mono text-xs"
	                                />
	                              </div>
	                            </td>
	                            <td className="px-3 py-2">
	                              <div className="flex items-center gap-2">
	                                <div className="min-w-[8rem]">
	                                  <SearchableSelect
	                                    value={String(l.uom || l.unit_of_measure || "").trim().toUpperCase()}
	                                    onChange={(v) => {
	                                      const u = String(v || "").trim().toUpperCase();
	                                      const hit = (convs || []).find((c) => String(c.uom_code || "").trim().toUpperCase() === u);
	                                      const f = hit ? Number(hit.to_base_factor || 1) : 1;
	                                      patchLine(idx, { uom: u, qty_factor: String(f > 0 ? f : 1) });
	                                    }}
	                                    disabled={loading}
	                                    placeholder="UOM..."
	                                    searchPlaceholder="Search UOM..."
	                                    options={uomOpts}
	                                  />
	                                </div>
	                                <span className="text-[10px] text-fg-subtle font-mono">x{r.qtyFactor}</span>
	                              </div>
	                            </td>
	                            <td className="px-3 py-2 text-right">
	                              <Input
	                                value={l.pre_unit_price_usd}
	                                onChange={(e) => patchLine(idx, { pre_unit_price_usd: e.target.value })}
	                                placeholder="0.00"
                                  inputMode="decimal"
                                  data-line-idx={idx}
                                  data-line-field="usd"
                                  onKeyDown={(e) => onLineKeyDown(e, idx, "usd")}
                                className="h-8 w-28 text-right font-mono text-xs"
                              />
                            </td>
                            {showSecondaryCurrency ? (
                              <td className="px-3 py-2 text-right">
                                <Input
                                  value={l.pre_unit_price_lbp}
                                  onChange={(e) => patchLine(idx, { pre_unit_price_lbp: e.target.value })}
                                  placeholder="0"
                                  inputMode="decimal"
                                  data-line-idx={idx}
                                  data-line-field="lbp"
                                  onKeyDown={(e) => onLineKeyDown(e, idx, "lbp")}
                                  className="h-8 w-28 text-right font-mono text-xs"
                                />
                              </td>
                            ) : null}
                            <td className="px-3 py-2 text-right">
                              <Input
                                value={l.discount_pct}
                                onChange={(e) => patchLine(idx, { discount_pct: e.target.value })}
                                placeholder="0"
                                inputMode="decimal"
                                data-line-idx={idx}
                                data-line-field="disc"
                                onKeyDown={(e) => onLineKeyDown(e, idx, "disc")}
                                className="h-8 w-20 text-right font-mono text-xs"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs">
                              {r.totalUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </td>
                            {showSecondaryCurrency ? (
                              <td className="px-3 py-2 text-right font-mono text-xs">
                                {r.totalLbp.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                              </td>
                            ) : null}
                            <td className="px-3 py-2 text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                                >
                                  Remove
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
	                      {lines.length === 0 ? (
	                        <tr>
	                          <td className="px-3 py-6 text-center text-fg-subtle" colSpan={showSecondaryCurrency ? 9 : 7}>
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
    </Page>
  );
}
