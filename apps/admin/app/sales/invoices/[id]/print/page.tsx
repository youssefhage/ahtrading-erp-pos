"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { applyPrintPageSettings, applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

const OFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const UNOFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000002";

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  receipt_no?: string | null;
  receipt_meta?: unknown;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  subtotal_usd?: string | number;
  subtotal_lbp?: string | number;
  discount_total_usd?: string | number;
  discount_total_lbp?: string | number;
  exchange_rate: string | number;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  pricing_currency: string;
  settlement_currency: string;
  branch_id?: string | null;
  invoice_date?: string;
  due_date?: string | null;
  created_at: string;
};

type InvoiceLine = {
  id: string;
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  qty: string | number;
  uom?: string | null;
  qty_factor?: string | number | null;
  qty_entered?: string | number | null;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
  unit_price_entered_usd?: string | number | null;
  unit_price_entered_lbp?: string | number | null;
  discount_pct?: string | number | null;
  discount_amount_usd?: string | number | null;
  discount_amount_lbp?: string | number | null;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

type SalesPayment = {
  id: string;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  created_at: string;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  base_usd: string | number;
  base_lbp: string | number;
  tax_usd: string | number;
  tax_lbp: string | number;
  tax_date: string | null;
  created_at: string;
};

type InvoiceDetail = {
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  payments: SalesPayment[];
  tax_lines: TaxLine[];
};

type Company = {
  id: string;
  name: string;
  legal_name?: string | null;
  registration_no?: string | null;
  vat_no?: string | null;
};

type Customer = {
  id: string;
  code?: string | null;
  name: string;
  legal_name?: string | null;
  tax_id?: string | null;
  vat_no?: string | null;
  phone?: string | null;
};

type PartyAddress = {
  id: string;
  label?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  postal_code?: string | null;
  is_default?: boolean;
};

type PrinterInfo = { name: string; is_default?: boolean };

function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const inv = (globalThis as any)?.__TAURI_INTERNALS__?.invoke;
  if (typeof inv !== "function") return Promise.reject(new Error("tauri_unavailable"));
  return inv(cmd, args);
}

function canDirectPrint() {
  return typeof (globalThis as any)?.__TAURI_INTERNALS__?.invoke === "function";
}

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

function sum<T>(arr: T[], f: (v: T) => number): number {
  let out = 0;
  for (const v of arr) out += f(v);
  return out;
}

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtPlainMoney(v: unknown) {
  return toNum(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPlainQty(v: unknown) {
  return toNum(v).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function fmtUsDate(iso?: string | null) {
  const raw = String(iso || "").trim();
  if (!raw) return "-";
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${mm}/${dd}/${yyyy}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw.slice(5, 7)}/${raw.slice(8, 10)}/${raw.slice(0, 4)}`;
  }
  return raw;
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function metaString(meta: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const v = meta[key];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function paymentTerms(invoiceDate?: string, dueDate?: string | null) {
  const invDate = String(invoiceDate || "").slice(0, 10);
  const due = String(dueDate || "").slice(0, 10);
  if (!due || !invDate) return "Pay immediately";
  const invTs = Date.parse(`${invDate}T00:00:00Z`);
  const dueTs = Date.parse(`${due}T00:00:00Z`);
  if (Number.isNaN(invTs) || Number.isNaN(dueTs)) return "Pay immediately";
  const diff = Math.round((dueTs - invTs) / 86400000);
  if (diff <= 0) return "Pay immediately";
  return `Net ${diff} day${diff === 1 ? "" : "s"}`;
}

const SMALL = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function intToWords(n: number): string {
  if (n < 20) return SMALL[n] || "zero";
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r ? `${TENS[t]} ${SMALL[r]}` : TENS[t];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return r ? `${SMALL[h]} hundred ${intToWords(r)}` : `${SMALL[h]} hundred`;
  }
  const units: Array<[number, string]> = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"],
  ];
  for (const [unit, label] of units) {
    if (n >= unit) {
      const head = Math.floor(n / unit);
      const rest = n % unit;
      return rest ? `${intToWords(head)} ${label} ${intToWords(rest)}` : `${intToWords(head)} ${label}`;
    }
  }
  return "zero";
}

function amountInWordsUsd(amount: unknown) {
  const n = Math.max(0, toNum(amount));
  const dollars = Math.floor(n);
  const cents = Math.round((n - dollars) * 100);
  const words = intToWords(dollars);
  return `Only ${words.charAt(0).toUpperCase() + words.slice(1)} and ${String(cents).padStart(2, "0")}/100 USD`;
}

export default function SalesInvoicePrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [addresses, setAddresses] = useState<PartyAddress[]>([]);
  const [queryPrint, setQueryPrint] = useState(() => ({
    paper: "a4" as "a4" | "receipt",
    landscape: false,
    hasExplicitPaper: false,
    hasExplicitLandscape: false,
  }));
  const [directPrintOk, setDirectPrintOk] = useState(() => canDirectPrint());
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState("");
  const [copies, setCopies] = useState(1);
  const [directStatus, setDirectStatus] = useState("");
  const [directError, setDirectError] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const det = await apiGet<InvoiceDetail>(`/sales/invoices/${id}`);
      setDetail(det);

      // Best-effort: hydrate print header metadata (company + customer + address).
      // Prints should still work even if these auxiliary calls fail.
      const me = await apiGet<{ active_company_id?: string | null }>("/auth/me").catch(() => ({ active_company_id: null }));
      const activeCompanyId = String(me.active_company_id || "").trim();
      if (activeCompanyId) {
        const c = await apiGet<{ company: Company }>(`/companies/${encodeURIComponent(activeCompanyId)}`).catch(() => null);
        setCompany(c?.company || null);
      } else {
        setCompany(null);
      }

      const customerId = det.invoice.customer_id ? String(det.invoice.customer_id) : "";
      if (customerId) {
        const c = await apiGet<{ customer: Customer }>(`/customers/${encodeURIComponent(customerId)}`).catch(() => null);
        setCustomer(c?.customer || null);
        const a = await apiGet<{ addresses: PartyAddress[] }>(
          `/party-addresses?party_kind=customer&party_id=${encodeURIComponent(customerId)}`
        ).catch(() => null);
        setAddresses(a?.addresses || []);
      } else {
        setCustomer(null);
        setAddresses([]);
      }

      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetail(null);
      setCompany(null);
      setCustomer(null);
      setAddresses([]);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const q = applyPrintSettingsFromQuery();
    setQueryPrint(q);

    // Optional: allow kiosk-style auto print via ?autoprint=1.
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("autoprint") === "1") setTimeout(() => window.print(), 250);
    } catch {
      // ignore
    }
  }, []);

  const isUnofficial = useMemo(() => {
    if (!company) return false;
    if (company.id === UNOFFICIAL_COMPANY_ID) return true;
    const n = (company.name || "").toLowerCase();
    return n.includes("unofficial");
  }, [company]);

  // If the caller didn't explicitly pick a paper size via query params,
  // default to receipt paper for Unofficial and A4 for Official.
  useEffect(() => {
    if (queryPrint.hasExplicitPaper) return;
    if (!company) return;
    applyPrintPageSettings({ paper: isUnofficial ? "receipt" : "a4", landscape: queryPrint.landscape });
  }, [company, isUnofficial, queryPrint.hasExplicitPaper, queryPrint.landscape]);

  const paper = queryPrint.hasExplicitPaper ? queryPrint.paper : isUnofficial ? "receipt" : "a4";
  const docTitle = "Sales Invoice";
  const primaryDocNo = detail?.invoice?.invoice_no || "(draft)";
  const printerPreferenceKeyPrefix = "sales_invoice";
  const pdfInlineRoute = `/exports/sales-invoices/${encodeURIComponent(id)}/pdf?inline=1`;

  useEffect(() => {
    // Best-effort: load printers when running inside Admin Desktop (Tauri).
    if (!canDirectPrint()) return;
    setDirectPrintOk(true);
    (async () => {
      try {
        const res = await tauriInvoke<{ printers?: PrinterInfo[]; default_printer?: string | null; error?: string | null }>("list_printers");
        const list = Array.isArray(res?.printers) ? res.printers : [];
        setPrinters(list);
        const def = String(res?.default_printer || "").trim();
        if (def) setSelectedPrinter((cur) => cur || def);
        const err = String(res?.error || "").trim();
        if (err) setDirectError(err);
      } catch {
        setDirectPrintOk(false);
      }
    })();
  }, []);

  useEffect(() => {
    // Remember mapping per device + paper mode.
    if (!directPrintOk) return;
    if (typeof window === "undefined") return;
    try {
      const paperKey = paper === "receipt" ? "receipt" : "a4";
      const k = `admin.print.${printerPreferenceKeyPrefix}.${paperKey}.printer`;
      const saved = window.localStorage.getItem(k) || "";
      if (saved) setSelectedPrinter((cur) => cur || saved);
    } catch {
      // ignore
    }
  }, [directPrintOk, paper, printerPreferenceKeyPrefix]);

  async function directPrint() {
    if (!directPrintOk) {
      setDirectError("Direct print requires Admin Desktop (Tauri).");
      return;
    }
    setDirectError("");
    setDirectStatus("Printing...");
    try {
      const paperKey = paper === "receipt" ? "receipt" : "a4";
      const printer = (selectedPrinter || "").trim() || null;
      const c = Math.max(1, Math.min(10, Number(copies || 1)));

      if (paperKey === "receipt") {
        const inv = detail?.invoice;
        const ls = detail?.lines || [];
        const lines = ls
          .map((l) => {
            const name = (l.item_name || l.item_sku || l.item_id || "").toString().trim();
            const qty = Number((l.qty_entered ?? l.qty) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
            const amt = fmtUsd(l.line_total_usd);
            return `${name}\n  ${qty}  ${amt}`;
          })
          .join("\n");
        const txt =
          `${docTitle}\n${inv?.invoice_no || "(draft)"}\nDate ${fmtIso(inv?.invoice_date)}\n` +
          `------------------------------\n${lines}\n` +
          `------------------------------\nTotal USD: ${fmtUsd(inv?.total_usd || 0)}\nTotal LBP: ${fmtLbp(inv?.total_lbp || 0)}\n`;
        await tauriInvoke("print_text", { text: txt, printer, copies: c });
      } else {
        const res = await fetch(pdfInlineRoute, { credentials: "include" });
        if (!res.ok) throw new Error(`PDF fetch failed (${res.status})`);
        const buf = new Uint8Array(await res.arrayBuffer());
        // Chunked base64 encoding to avoid call stack limits.
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) {
          bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        }
        const pdf_base64 = btoa(bin);
        await tauriInvoke("print_pdf_base64", { pdf_base64, printer, copies: c });
      }

      try {
        const k = `admin.print.${printerPreferenceKeyPrefix}.${paperKey}.printer`;
        window.localStorage.setItem(k, (selectedPrinter || "").trim());
      } catch {
        // ignore
      }
      setDirectStatus("Printed.");
      setTimeout(() => setDirectStatus(""), 1200);
    } catch (e) {
      setDirectStatus("");
      setDirectError(e instanceof Error ? e.message : String(e));
    }
  }

  const totals = useMemo(() => {
    const inv = detail?.invoice;
    const payments = detail?.payments || [];
    const paidUsd = sum(payments, (p) => Number(p.amount_usd || 0));
    const paidLbp = sum(payments, (p) => Number(p.amount_lbp || 0));
    const totalUsd = Number(inv?.total_usd || 0);
    const totalLbp = Number(inv?.total_lbp || 0);
    return {
      paidUsd,
      paidLbp,
      balUsd: totalUsd - paidUsd,
      balLbp: totalLbp - paidLbp
    };
  }, [detail]);

  const defaultAddress = useMemo(() => {
    const list = addresses || [];
    if (!list.length) return null;
    return list.find((a) => a.is_default) || list[0] || null;
  }, [addresses]);

  function addressLines(a: PartyAddress | null): string[] {
    if (!a) return [];
    const lines: string[] = [];
    const l1 = String(a.line1 || "").trim();
    const l2 = String(a.line2 || "").trim();
    const city = String(a.city || "").trim();
    const region = String(a.region || "").trim();
    const country = String(a.country || "").trim();
    const postal = String(a.postal_code || "").trim();
    if (l1) lines.push(l1);
    if (l2) lines.push(l2);
    const place = [city, region, postal].filter(Boolean).join(", ");
    if (place) lines.push(place);
    if (country) lines.push(country);
    return lines;
  }

  const officialMeta = useMemo(() => parseMeta(detail?.invoice?.receipt_meta), [detail?.invoice?.receipt_meta]);
  const officialPrimaryLines = useMemo(() => addressLines(defaultAddress), [defaultAddress]);
  const officialDeliveryLines = useMemo(() => {
    const candidate = officialMeta.delivery_address || officialMeta.deliveryAddress || officialMeta.ship_to || null;
    if (typeof candidate === "string") {
      return candidate
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean);
    }
    if (candidate && typeof candidate === "object") {
      const obj = candidate as Record<string, unknown>;
      const line1 = String(obj.line1 || obj.address1 || "").trim();
      const line2 = String(obj.line2 || obj.address2 || "").trim();
      const city = String(obj.city || "").trim();
      const region = String(obj.region || obj.state || "").trim();
      const country = String(obj.country || "").trim();
      const postal = String(obj.postal_code || obj.postal || "").trim();
      const out: string[] = [];
      if (line1) out.push(line1);
      if (line2) out.push(line2);
      const place = [city, region, postal].filter(Boolean).join(", ");
      if (place) out.push(place);
      if (country) out.push(country);
      if (out.length) return out;
    }
    return officialPrimaryLines;
  }, [officialMeta, officialPrimaryLines]);
  const officialCustomerNo = String(customer?.code || detail?.invoice?.customer_id || "-");
  const officialCustomerName = detail?.invoice?.customer_id
    ? String(customer?.legal_name || customer?.name || detail?.invoice?.customer_name || detail?.invoice?.customer_id)
    : "Walk-in";
  const officialCustomerPhone = String(customer?.phone || "").trim() || "-";
  const officialTotalQty = sum(detail?.lines || [], (l) => Number((l.qty_entered ?? l.qty) || 0));
  const officialTaxUsd = sum(detail?.tax_lines || [], (t) => Number(t.tax_usd || 0));
  const officialTotalUsd = toNum(detail?.invoice?.total_usd || 0);
  const officialBeforeVatComputed = toNum(detail?.invoice?.subtotal_usd || 0) - toNum(detail?.invoice?.discount_total_usd || 0);
  const officialBeforeVat = Math.abs(officialTotalUsd - officialTaxUsd) > 0.009 ? officialTotalUsd - officialTaxUsd : officialBeforeVatComputed;
  const officialVatPct = officialBeforeVat > 0 ? (officialTaxUsd / officialBeforeVat) * 100 : 0;
  const officialVatPctLabel = officialVatPct > 0 ? `${officialVatPct.toFixed(officialVatPct % 1 === 0 ? 0 : 2)}%` : "";

  return (
    <div className="print-paper min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/sales/invoices/${encodeURIComponent(id)}`}>Back</Link>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </Button>
            {directPrintOk ? (
              <>
                <select
                  className="h-10 rounded-md border border-border bg-bg-elevated px-2 text-xs"
                  value={selectedPrinter}
                  onChange={(e) => setSelectedPrinter((e.target as HTMLSelectElement).value)}
                  title="Printer"
                >
                  <option value="">(Default printer)</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}{p.is_default ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                <Button variant="outline" onClick={directPrint} disabled={loading}>
                  Direct Print
                </Button>
              </>
            ) : null}
            <Button onClick={() => window.print()}>Print / Save PDF</Button>
          </div>
        </div>
        {directStatus || directError ? (
          <div className="mx-auto max-w-4xl px-4 pb-3 text-xs">
            {directStatus ? <span className="text-black/70">{directStatus}</span> : null}
            {directError ? <span className="text-danger">{directStatus ? " · " : ""}{directError}</span> : null}
          </div>
        ) : null}
      </div>

      <div className={paper === "receipt" ? "mx-auto print-receipt px-2 py-4" : "mx-auto max-w-4xl px-4 py-6"}>
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        {!detail ? (
          <div className="py-16 text-sm text-black/70">{loading ? "Loading..." : "No data."}</div>
        ) : (
          paper === "receipt" ? (
            <div className="space-y-3 text-[11px]">
              <header className="text-center">
                <h1 className="text-base font-semibold tracking-tight">{docTitle}</h1>
                <div className="mt-1 font-mono text-[10px] text-black/70">{primaryDocNo}</div>
                <div className="mt-1 text-[10px] text-black/60">
                  {fmtIso(detail.invoice.invoice_date)} · {detail.invoice.status}
                </div>
              </header>

              <div className="space-y-1 text-black/70">
                <div className="flex items-start justify-between gap-2">
                  <span>Customer</span>
                  <span className="text-right font-mono">
                    {detail.invoice.customer_id ? customer?.name || detail.invoice.customer_name || detail.invoice.customer_id : "Walk-in"}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span>Due</span>
                  <span className="text-right font-mono">{fmtIso(detail.invoice.due_date)}</span>
                </div>
              </div>

              <div className="border-t border-dashed border-black/30" />

              <table className="w-full border-collapse">
                <thead className="text-[10px] uppercase tracking-wider text-black/60">
                  <tr>
                    <th className="py-1 text-left">Item</th>
                    <th className="py-1 text-right">Qty</th>
                    <th className="py-1 text-right">USD</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.lines || []).map((l) => (
                    <tr key={l.id} className="border-t border-black/10 align-top">
                      <td className="py-1 pr-2">
                        <div className="text-[11px]">{l.item_name || l.item_sku || l.item_id}</div>
                        <div className="font-mono text-[10px] text-black/60">{l.item_sku || l.item_id}</div>
                      </td>
                      <td className="py-1 text-right font-mono text-[10px] text-black/70">
                        {Number((l.qty_entered ?? l.qty) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                        {l.uom ? <span className="ml-1 text-black/50">{String(l.uom).trim()}</span> : null}
                      </td>
                      <td className="py-1 text-right font-mono text-[10px] text-black/70">{fmtUsd(l.line_total_usd)}</td>
                    </tr>
                  ))}
                  {(detail.lines || []).length === 0 ? (
                    <tr>
                      <td className="py-4 text-center text-black/60" colSpan={3}>
                        No lines.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              <div className="border-t border-dashed border-black/30" />

              <section className="space-y-1 text-black/70">
                <div className="flex items-center justify-between gap-2">
                  <span>Subtotal</span>
                  <span className="font-mono">{fmtUsd(detail.invoice.subtotal_usd ?? detail.invoice.total_usd)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>VAT</span>
                  <span className="font-mono">
                    {fmtUsd(sum(detail.tax_lines || [], (t) => Number(t.tax_usd || 0)))}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="font-medium">Total</span>
                  <span className="font-mono font-semibold">{fmtUsd(detail.invoice.total_usd)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-black/60">
                  <span>Total LBP</span>
                  <span className="font-mono">{fmtLbp(detail.invoice.total_lbp)}</span>
                </div>

                {(detail.payments || []).length ? (
                  <>
                    <div className="mt-2 border-t border-black/10 pt-2" />
                    <div className="flex items-center justify-between gap-2">
                      <span>Paid</span>
                      <span className="font-mono">{fmtUsdLbp(totals.paidUsd, totals.paidLbp)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">Balance</span>
                      <span className="font-mono font-semibold">{fmtUsdLbp(totals.balUsd, totals.balLbp)}</span>
                    </div>
                  </>
                ) : null}
              </section>

              <footer className="pt-2 text-[10px] text-black/50">
                <div className="border-t border-black/10 pt-2 font-mono">Document ID: {detail.invoice.id}</div>
              </footer>
            </div>
          ) : company?.id === OFFICIAL_COMPANY_ID ? (
            <div className="space-y-5 text-[11px] leading-tight text-black">
              <section className="flex items-start justify-between gap-8">
                <div className="w-[56%] space-y-1">
                  <h1 className="text-[28px] font-bold tracking-tight">{company.legal_name || company.name}</h1>
                  <div className="grid grid-cols-[120px_1fr] gap-x-2">
                    <span>P.O. Box</span>
                    <span className="font-mono">-</span>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-x-2">
                    <span>Tel</span>
                    <span className="font-mono">-</span>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-x-2">
                    <span>Fax</span>
                    <span className="font-mono">-</span>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-x-2">
                    <span>R.C</span>
                    <span className="font-mono">{company.registration_no || "-"}</span>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-x-2">
                    <span>VAT Registration No.</span>
                    <span className="font-mono">{company.vat_no || "-"}</span>
                  </div>
                </div>

                <div className="w-[38%] pt-1 text-center">
                  <div className="text-[24px] font-bold">Invoice</div>
                  <div className="mt-2 font-mono text-[20px] font-bold">{primaryDocNo}</div>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-8">
                <div className="space-y-1">
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Sales order No.</span>
                    <span className="font-mono">{detail.invoice.receipt_no || primaryDocNo}</span>
                  </div>
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Sales Person</span>
                    <span className="font-mono">{metaString(parseMeta(detail.invoice.receipt_meta), "sales_person", "salesperson") || "-"}</span>
                  </div>
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Route</span>
                    <span className="font-mono">{metaString(parseMeta(detail.invoice.receipt_meta), "route", "route_name") || "-"}</span>
                  </div>
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Reference</span>
                    <span className="font-mono">{metaString(parseMeta(detail.invoice.receipt_meta), "reference", "po_no") || detail.invoice.id.slice(0, 12)}</span>
                  </div>

                  <div className="pt-2 text-[12px] font-bold underline">Primary Address</div>
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Customer No.</span>
                    <span className="font-mono">{officialCustomerNo}</span>
                  </div>
                  <div>{officialCustomerName}</div>
                  {officialPrimaryLines.map((ln, idx) => (
                    <div key={`official-primary-${idx}`}>{ln}</div>
                  ))}
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Tel</span>
                    <span className="font-mono">{officialCustomerPhone}</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Document Date</span>
                    <span className="font-mono">{fmtUsDate(detail.invoice.invoice_date)}</span>
                  </div>
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Due Date</span>
                    <span className="font-mono">{fmtUsDate(detail.invoice.due_date)}</span>
                  </div>
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Payment Terms</span>
                    <span className="font-mono">{paymentTerms(detail.invoice.invoice_date, detail.invoice.due_date)}</span>
                  </div>
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Currency</span>
                    <span className="font-mono">{detail.invoice.settlement_currency || detail.invoice.pricing_currency || "USD"}</span>
                  </div>

                  <div className="pt-2 text-[12px] font-bold underline">Delivery Address</div>
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Customer No.</span>
                    <span className="font-mono">{officialCustomerNo}</span>
                  </div>
                  <div>{officialCustomerName}</div>
                  {officialDeliveryLines.map((ln, idx) => (
                    <div key={`official-delivery-${idx}`}>{ln}</div>
                  ))}
                  <div className="grid grid-cols-[102px_1fr] gap-x-2">
                    <span className="font-semibold">Tel</span>
                    <span className="font-mono">{officialCustomerPhone}</span>
                  </div>
                </div>
              </section>

              <section className="border border-black/45">
                <table className="w-full border-collapse text-[10px]">
                  <thead className="bg-black/[0.06]">
                    <tr className="border-b border-black/45 text-[10px] font-bold">
                      <th className="border-r border-black/30 px-1 py-1 text-left">Item</th>
                      <th className="border-r border-black/30 px-1 py-1 text-left">Description</th>
                      <th className="border-r border-black/30 px-1 py-1 text-right">Quantity</th>
                      <th className="border-r border-black/30 px-1 py-1 text-center">UOM</th>
                      <th className="border-r border-black/30 px-1 py-1 text-right">Unit price</th>
                      <th className="border-r border-black/30 px-1 py-1 text-center">Discount %</th>
                      <th className="border-r border-black/30 px-1 py-1 text-right">Discount Amount</th>
                      <th className="px-1 py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.lines || []).map((l) => {
                      const rawPct = Number(l.discount_pct || 0);
                      const pct = rawPct <= 1 ? rawPct * 100 : rawPct;
                      const pctText = pct === 0 ? "0%" : `${pct.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
                      return (
                        <tr key={l.id} className="border-t border-black/20 align-top">
                          <td className="border-r border-black/20 px-1 py-1 font-mono text-[9px]">{l.item_sku || String(l.item_id).slice(0, 12)}</td>
                          <td className="border-r border-black/20 px-1 py-1">{l.item_name || "-"}</td>
                          <td className="border-r border-black/20 px-1 py-1 text-right font-mono">{fmtPlainQty(l.qty_entered ?? l.qty)}</td>
                          <td className="border-r border-black/20 px-1 py-1 text-center">{String(l.uom || "").trim() || "-"}</td>
                          <td className="border-r border-black/20 px-1 py-1 text-right font-mono">{fmtPlainMoney(l.unit_price_entered_usd ?? l.unit_price_usd)}</td>
                          <td className="border-r border-black/20 px-1 py-1 text-center font-mono">{pctText}</td>
                          <td className="border-r border-black/20 px-1 py-1 text-right font-mono">{fmtPlainMoney(l.discount_amount_usd || 0)}</td>
                          <td className="px-1 py-1 text-right font-mono">{fmtPlainMoney(l.line_total_usd)}</td>
                        </tr>
                      );
                    })}
                    {(detail.lines || []).length === 0 ? (
                      <tr>
                        <td className="py-4 text-center text-black/60" colSpan={8}>
                          No lines.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </section>

              <section className="grid grid-cols-[1fr_360px] gap-4">
                <div className="space-y-2">
                  <div className="font-semibold">Total Qty HL   {fmtPlainQty(officialTotalQty)}</div>
                  <div className="italic">{amountInWordsUsd(officialTotalUsd)}</div>
                  <div className="pt-3 text-[10px]">Amount to be Cashed in USD Notes and VAT to be paid in LBP at Sayrafa rate.</div>
                </div>

                <div className="border border-black/45">
                  <div className="flex items-center justify-between border-b border-black/25 px-2 py-1.5">
                    <span className="font-semibold">Total Amount Before VAT</span>
                    <span className="font-mono font-semibold">{fmtPlainMoney(officialBeforeVat)}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-black/25 px-2 py-1.5">
                    <span className="font-semibold">{`VAT ${officialVatPctLabel}`.trim()}</span>
                    <span className="font-mono font-semibold">{fmtPlainMoney(officialTaxUsd)}</span>
                  </div>
                  <div className="flex items-center justify-between bg-black/[0.06] px-2 py-1.5">
                    <span className="text-[12px] font-bold">Total Amount Incl. VAT</span>
                    <span className="font-mono text-[12px] font-bold">{fmtPlainMoney(officialTotalUsd)}</span>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-16 pt-10 text-center text-[11px] font-semibold">
                <div className="border-t border-black/30 pt-3">Receiver&apos;s Name & Signature</div>
                <div className="border-t border-black/30 pt-3">Stamp Duty Paid</div>
              </section>

              <footer className="text-right font-mono text-[10px] text-black/50">
                Document ID: {detail.invoice.id} · Generated: {formatDateTime(new Date())}
              </footer>
            </div>
          ) : (
            <div className="space-y-6">
              <header className="space-y-2 border-b border-black/15 pb-4">
                <h1 className="text-2xl font-semibold tracking-tight">{docTitle}</h1>
                <div className="flex flex-wrap items-start justify-between gap-4 text-xs text-black/70">
                  <div className="font-mono">{primaryDocNo}</div>
                  <div className="text-right">
                    <div className="font-mono">Date {fmtIso(detail.invoice.invoice_date)}</div>
                    <div className="font-mono">Due {fmtIso(detail.invoice.due_date)}</div>
                  </div>
                </div>
              </header>

              <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-md border border-black/15 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-black/60">Customer</p>
                  <p className="mt-1 text-sm font-medium">
                    {detail.invoice.customer_id ? customer?.name || detail.invoice.customer_name || detail.invoice.customer_id : "Walk-in"}
                  </p>
                  {detail.invoice.customer_id && (customer?.tax_id || customer?.vat_no) ? (
                    <p className="mt-1 font-mono text-[11px] text-black/70">
                      {customer.tax_id ? `Tax ID: ${customer.tax_id}` : `VAT: ${customer.vat_no}`}
                    </p>
                  ) : null}
                  {detail.invoice.customer_id && defaultAddress ? (
                    <div className="mt-2 space-y-0.5 text-[11px] text-black/60">
                      {addressLines(defaultAddress).map((ln, idx) => (
                        <div key={idx}>{ln}</div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-md border border-black/15 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-black/60">Warehouse / Currency</p>
                  <p className="mt-1 text-sm font-medium">{detail.invoice.warehouse_name || detail.invoice.warehouse_id || "-"}</p>
                  <p className="mt-1 text-[11px] text-black/70">
                    Pricing <span className="font-mono">{detail.invoice.pricing_currency}</span> · Settlement{" "}
                    <span className="font-mono">{detail.invoice.settlement_currency}</span>
                  </p>
                </div>
              </section>

              <section className="rounded-md border border-black/15">
                <div className="border-b border-black/10 px-4 py-3">
                  <h2 className="text-sm font-semibold">Items</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-black/[0.02] text-[11px] uppercase tracking-wider text-black/60">
                      <tr>
                        <th className="px-4 py-2 text-left">Code</th>
                        <th className="px-3 py-2 text-left">Description</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-4 py-2 text-right">Total (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.lines || []).map((l) => (
                        <tr key={l.id} className="border-t border-black/10 align-top">
                          <td className="px-4 py-2 font-mono text-[11px] text-black/70">{l.item_sku || l.item_id}</td>
                          <td className="px-3 py-2 text-sm">{l.item_name || "-"}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">
                            {Number((l.qty_entered ?? l.qty) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}{" "}
                            <span className="text-black/60">{String(l.uom || "").trim() || ""}</span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-[11px]">{fmtUsd(l.line_total_usd)}</td>
                        </tr>
                      ))}
                      {(detail.lines || []).length === 0 ? (
                        <tr>
                          <td className="px-4 py-8 text-center text-black/60" colSpan={4}>
                            No lines.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-md border border-black/15 p-3">
                  <h2 className="text-sm font-semibold">Payments</h2>
                  <div className="mt-2 space-y-1 text-xs text-black/70">
                    {(detail.payments || []).map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{p.method}</span>
                        <span className="font-mono">{fmtUsdLbp(p.amount_usd, p.amount_lbp)}</span>
                      </div>
                    ))}
                    {(detail.payments || []).length === 0 ? <p className="text-black/60">No payments.</p> : null}
                  </div>
                </div>

                <div className="rounded-md border border-black/15 p-3">
                  <h2 className="text-sm font-semibold">Totals</h2>
                  <div className="mt-2 space-y-1 text-xs text-black/70">
                    <div className="flex items-center justify-between gap-2">
                      <span>Subtotal</span>
                      <span className="font-mono">
                        {fmtUsdLbp(detail.invoice.subtotal_usd ?? detail.invoice.total_usd, detail.invoice.subtotal_lbp ?? detail.invoice.total_lbp)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>Discount</span>
                      <span className="font-mono">{fmtUsdLbp(detail.invoice.discount_total_usd ?? 0, detail.invoice.discount_total_lbp ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>Total</span>
                      <span className="font-mono">{fmtUsdLbp(detail.invoice.total_usd, detail.invoice.total_lbp)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>Paid</span>
                      <span className="font-mono">{fmtUsdLbp(totals.paidUsd, totals.paidLbp)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-2">
                      <span className="font-medium">Balance</span>
                      <span className="font-mono font-semibold">{fmtUsdLbp(totals.balUsd, totals.balLbp)}</span>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-black/10 pt-3">
                    <h3 className="text-sm font-semibold">Tax</h3>
                    <div className="mt-2 space-y-1 text-xs text-black/70">
                      {(detail.tax_lines || []).map((t) => (
                        <div key={t.id} className="flex items-center justify-between gap-2">
                          <span className="font-mono">{t.tax_code_id}</span>
                          <span className="font-mono">{fmtUsdLbp(t.tax_usd, t.tax_lbp)}</span>
                        </div>
                      ))}
                      {(detail.tax_lines || []).length === 0 ? <p className="text-black/60">No tax lines.</p> : null}
                    </div>
                  </div>
                </div>
              </section>

              <footer className="pt-2 text-[11px] text-black/60">
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/15 pt-3">
                  <span className="font-mono">Document ID: {detail.invoice.id}</span>
                  <span className="font-mono">Generated: {formatDateTime(new Date())}</span>
                </div>
              </footer>
            </div>
          )
        )}
      </div>
    </div>
  );
}
