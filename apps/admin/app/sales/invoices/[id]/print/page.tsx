"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { applyPrintPageSettings, applyPrintSettingsFromQuery } from "@/lib/print/page-settings";
import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";

const OFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const UNOFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000002";

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
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
      const k = `admin.print.sales_invoice.${paperKey}.printer`;
      const saved = window.localStorage.getItem(k) || "";
      if (saved) setSelectedPrinter((cur) => cur || saved);
    } catch {
      // ignore
    }
  }, [directPrintOk, paper]);

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
          `Sales Invoice\n${inv?.invoice_no || "(draft)"}\nDate ${fmtIso(inv?.invoice_date)}\n` +
          `------------------------------\n${lines}\n` +
          `------------------------------\nTotal USD: ${fmtUsd(inv?.total_usd || 0)}\nTotal LBP: ${fmtLbp(inv?.total_lbp || 0)}\n`;
        await tauriInvoke("print_text", { text: txt, printer, copies: c });
      } else {
        const res = await fetch(`/exports/sales-invoices/${encodeURIComponent(id)}/pdf?inline=1`, { credentials: "include" });
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
        const k = `admin.print.sales_invoice.${paperKey}.printer`;
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
                <h1 className="text-base font-semibold tracking-tight">Sales Invoice</h1>
                <div className="mt-1 font-mono text-[10px] text-black/70">{detail.invoice.invoice_no || "(draft)"}</div>
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
                <div className="border-t border-black/10 pt-2 font-mono">Invoice ID: {detail.invoice.id}</div>
              </footer>
            </div>
          ) : (
            <div className="space-y-6">
              {company?.id === OFFICIAL_COMPANY_ID ? (
                <div className="space-y-1 text-xs text-black/70">
                  <div className="text-sm font-semibold text-black">{company.legal_name || company.name}</div>
                  {company.vat_no ? <div>VAT No: <span className="font-mono">{company.vat_no}</span></div> : null}
                  {company.registration_no ? <div>Reg No: <span className="font-mono">{company.registration_no}</span></div> : null}
                </div>
              ) : null}

              <header className="space-y-2 border-b border-black/15 pb-4">
                <h1 className="text-2xl font-semibold tracking-tight">Sales Invoice</h1>
                <div className="flex flex-wrap items-start justify-between gap-4 text-xs text-black/70">
                  <div className="font-mono">{detail.invoice.invoice_no || "(draft)"}</div>
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
                  <span className="font-mono">Invoice ID: {detail.invoice.id}</span>
                  <span className="font-mono">Generated: {new Date().toISOString().slice(0, 19).replace("T", " ")}</span>
                </div>
              </footer>
            </div>
          )
        )}
      </div>
    </div>
  );
}
