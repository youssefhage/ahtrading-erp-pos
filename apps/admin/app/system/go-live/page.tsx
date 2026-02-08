"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type RateRow = { rate_date: string; rate_type: string; usd_to_lbp: string | number };

type OpeningArRow = {
  customer_id?: string;
  customer_code?: string;
  invoice_no?: string;
  invoice_date: string;
  due_date?: string;
  amount_usd?: number;
  amount_lbp?: number;
};

type OpeningApRow = {
  supplier_id?: string;
  supplier_code?: string;
  invoice_no?: string;
  invoice_date: string;
  due_date?: string;
  amount_usd?: number;
  amount_lbp?: number;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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

function numOrUndef(v: string): number | undefined {
  const t = (v || "").trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export default function GoLivePage() {
  const [status, setStatus] = useState("");

  const [rateType, setRateType] = useState("market");
  const [exchangeRate, setExchangeRate] = useState("90000");

  const [arOpen, setArOpen] = useState(false);
  const [arText, setArText] = useState("");
  const [arPreview, setArPreview] = useState<OpeningArRow[]>([]);
  const [arErrors, setArErrors] = useState("");
  const [arImporting, setArImporting] = useState(false);

  const [apOpen, setApOpen] = useState(false);
  const [apText, setApText] = useState("");
  const [apPreview, setApPreview] = useState<OpeningApRow[]>([]);
  const [apErrors, setApErrors] = useState("");
  const [apImporting, setApImporting] = useState(false);

  const cards = useMemo(
    () => [
      {
        title: "Items",
        desc: "Create/import SKUs, barcodes, reorder points, supplier links.",
        href: "/catalog/items",
        cta: "Open Items"
      },
      {
        title: "Opening Stock",
        desc: "Import on-hand + unit cost per warehouse (idempotent).",
        href: "/inventory/ops",
        cta: "Open Inventory Ops"
      },
      {
        title: "Account Defaults",
        desc: "Verify AR/AP/INVENTORY/COGS/VAT + OPENING_BALANCE mappings.",
        href: "/system/config",
        cta: "Open Config"
      },
      {
        title: "Sales Invoices",
        desc: "Draft-first invoices, post when ready; payments are separate.",
        href: "/sales/invoices",
        cta: "Open Sales Invoices"
      },
      {
        title: "Supplier Invoices",
        desc: "Draft-first supplier invoices; link to goods receipts when needed.",
        href: "/purchasing/supplier-invoices",
        cta: "Open Supplier Invoices"
      }
    ],
    []
  );

  function recomputeAr(text: string) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      setArPreview([]);
      setArErrors("");
      return;
    }
    try {
      const rows = parseCsv(trimmed);
      if (rows.length < 2) {
        setArPreview([]);
        setArErrors("CSV must have a header row + at least 1 data row.");
        return;
      }
      const headers = rows[0].map((h) => (h || "").trim().toLowerCase());
      const idx = (names: string[]) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;

      const custIdIdx = idx(["customer_id"]);
      const custCodeIdx = idx(["customer_code", "customer"]);
      const invNoIdx = idx(["invoice_no", "invoice"]);
      const invDateIdx = idx(["invoice_date", "date"]);
      const dueDateIdx = idx(["due_date", "due"]);
      const usdIdx = idx(["amount_usd", "usd"]);
      const lbpIdx = idx(["amount_lbp", "lbp"]);

      if ((custCodeIdx < 0 && custIdIdx < 0) || invDateIdx < 0) {
        setArPreview([]);
        setArErrors("Missing required headers: (customer_code or customer_id), invoice_date");
        return;
      }

      const preview: OpeningArRow[] = [];
      const errs: string[] = [];

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const customer_id = custIdIdx >= 0 ? (row[custIdIdx] || "").trim() : "";
        const customer_code = (row[custCodeIdx] || "").trim();
        const invoice_date = (row[invDateIdx] || "").trim();
        const invoice_no = invNoIdx >= 0 ? (row[invNoIdx] || "").trim() : "";
        const due_date = dueDateIdx >= 0 ? (row[dueDateIdx] || "").trim() : "";
        const amount_usd = usdIdx >= 0 ? numOrUndef(row[usdIdx] || "") : undefined;
        const amount_lbp = lbpIdx >= 0 ? numOrUndef(row[lbpIdx] || "") : undefined;

        if (!customer_id && !customer_code) errs.push(`Row ${r + 1}: customer_code or customer_id is required`);
        if (!invoice_date) errs.push(`Row ${r + 1}: invoice_date is required`);
        if ((amount_usd ?? 0) <= 0 && (amount_lbp ?? 0) <= 0) errs.push(`Row ${r + 1}: amount_usd or amount_lbp must be > 0`);

        preview.push({
          customer_id: customer_id || undefined,
          customer_code,
          invoice_no: invoice_no || undefined,
          invoice_date: invoice_date || todayIso(),
          due_date: due_date || undefined,
          amount_usd,
          amount_lbp
        });
      }

      setArPreview(preview.slice(0, 200));
      setArErrors(errs.join("\n"));
    } catch (e) {
      setArPreview([]);
      setArErrors(e instanceof Error ? e.message : String(e));
    }
  }

  function recomputeAp(text: string) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      setApPreview([]);
      setApErrors("");
      return;
    }
    try {
      const rows = parseCsv(trimmed);
      if (rows.length < 2) {
        setApPreview([]);
        setApErrors("CSV must have a header row + at least 1 data row.");
        return;
      }
      const headers = rows[0].map((h) => (h || "").trim().toLowerCase());
      const idx = (names: string[]) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;

      const suppIdIdx = idx(["supplier_id"]);
      const suppCodeIdx = idx(["supplier_code", "supplier"]);
      const invNoIdx = idx(["invoice_no", "invoice"]);
      const invDateIdx = idx(["invoice_date", "date"]);
      const dueDateIdx = idx(["due_date", "due"]);
      const usdIdx = idx(["amount_usd", "usd"]);
      const lbpIdx = idx(["amount_lbp", "lbp"]);

      if ((suppCodeIdx < 0 && suppIdIdx < 0) || invDateIdx < 0) {
        setApPreview([]);
        setApErrors("Missing required headers: (supplier_code or supplier_id), invoice_date");
        return;
      }

      const preview: OpeningApRow[] = [];
      const errs: string[] = [];

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const supplier_id = suppIdIdx >= 0 ? (row[suppIdIdx] || "").trim() : "";
        const supplier_code = (row[suppCodeIdx] || "").trim();
        const invoice_date = (row[invDateIdx] || "").trim();
        const invoice_no = invNoIdx >= 0 ? (row[invNoIdx] || "").trim() : "";
        const due_date = dueDateIdx >= 0 ? (row[dueDateIdx] || "").trim() : "";
        const amount_usd = usdIdx >= 0 ? numOrUndef(row[usdIdx] || "") : undefined;
        const amount_lbp = lbpIdx >= 0 ? numOrUndef(row[lbpIdx] || "") : undefined;

        if (!supplier_id && !supplier_code) errs.push(`Row ${r + 1}: supplier_code or supplier_id is required`);
        if (!invoice_date) errs.push(`Row ${r + 1}: invoice_date is required`);
        if ((amount_usd ?? 0) <= 0 && (amount_lbp ?? 0) <= 0) errs.push(`Row ${r + 1}: amount_usd or amount_lbp must be > 0`);

        preview.push({
          supplier_id: supplier_id || undefined,
          supplier_code,
          invoice_no: invoice_no || undefined,
          invoice_date: invoice_date || todayIso(),
          due_date: due_date || undefined,
          amount_usd,
          amount_lbp
        });
      }

      setApPreview(preview.slice(0, 200));
      setApErrors(errs.join("\n"));
    } catch (e) {
      setApPreview([]);
      setApErrors(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadDefaults() {
    try {
      const res = await apiGet<{ rates: RateRow[] }>("/config/exchange-rates");
      const market = (res.rates || []).find((r) => (r.rate_type || "").toLowerCase() === "market");
      if (market && market.usd_to_lbp) setExchangeRate(String(market.usd_to_lbp));
    } catch (e) {
      // non-blocking
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    loadDefaults();
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Errors will show here.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Go-Live Checklist</CardTitle>
          <CardDescription>Get data in, then verify reports and day-close flows.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {cards.map((c) => (
            <div key={c.href} className="rounded-lg border border-border bg-bg-elevated p-4">
              <div className="text-sm font-semibold">{c.title}</div>
              <div className="mt-1 text-xs text-fg-muted">{c.desc}</div>
              <div className="mt-3">
                <Button asChild variant="outline">
                  <Link href={c.href}>{c.cta}</Link>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Opening Balances</CardTitle>
          <CardDescription>Import outstanding AR/AP so Aging reports and payments are correct.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted">Rate Type</label>
            <Input value={rateType} onChange={(e) => setRateType(e.target.value)} placeholder="market" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted">Exchange Rate (USD to LL)</label>
            <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="90000" />
          </div>
          <div className="flex items-end gap-2">
            <Dialog open={arOpen} onOpenChange={setArOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Import Opening AR</Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Import Opening AR</DialogTitle>
                  <DialogDescription>
                    CSV headers:{" "}
                    <span className="font-mono text-xs">
                      customer_code (or customer_id),invoice_no,invoice_date,due_date,amount_usd,amount_lbp
                    </span>
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <textarea
                      className="h-64 w-full rounded-md border border-border bg-bg-elevated p-3 font-mono text-xs"
                      placeholder={
                        "customer_code,invoice_no,invoice_date,due_date,amount_usd,amount_lbp\nCUST-001,OPEN-1001,2026-02-01,2026-02-15,120.00,\nCUST-002,OPEN-1002,2026-02-01,, ,8950000"
                      }
                      value={arText}
                      onChange={(e) => {
                        setArText(e.target.value);
                        recomputeAr(e.target.value);
                      }}
                    />
                    {arErrors ? (
                      <pre className="whitespace-pre-wrap rounded-md border border-border bg-bg-sunken p-2 text-xs text-fg-muted">
                        {arErrors}
                      </pre>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-fg-muted">Preview (first {arPreview.length})</div>
                    <div className="ui-table-wrap">
                      <table className="ui-table">
                        <thead className="ui-thead">
                          <tr>
                            <th className="px-3 py-2">Customer</th>
                            <th className="px-3 py-2">Invoice</th>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2 text-right">USD</th>
                            <th className="px-3 py-2 text-right">LL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {arPreview.map((r, i) => (
                            <tr key={i} className="ui-tr-hover">
                              <td className="px-3 py-2 font-mono text-xs">{r.customer_code || r.customer_id || "-"}</td>
                              <td className="px-3 py-2 font-mono text-xs">{r.invoice_no || "(auto)"}</td>
                              <td className="px-3 py-2 font-mono text-xs">{r.invoice_date}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs">{r.amount_usd ?? "-"}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs">{r.amount_lbp ?? "-"}</td>
                            </tr>
                          ))}
                          {arPreview.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-3 py-6 text-center text-fg-subtle">
                                Paste CSV to preview.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setArText("");
                          setArPreview([]);
                          setArErrors("");
                        }}
                      >
                        Clear
                      </Button>
                      <Button
                        disabled={arImporting || !!arErrors || arPreview.length === 0}
                        onClick={async () => {
                          setArImporting(true);
                          setStatus("");
                          try {
                            const payload = {
                              rate_type: rateType,
                              exchange_rate: Number(exchangeRate || 0),
                              rows: arPreview.map((r) => ({
                                customer_id: r.customer_id,
                                customer_code: r.customer_code,
                                invoice_no: r.invoice_no,
                                invoice_date: r.invoice_date,
                                due_date: r.due_date,
                                amount_usd: r.amount_usd ?? 0,
                                amount_lbp: r.amount_lbp ?? 0
                              }))
                            };
                            const res = await apiPost<{ created: number; skipped: number }>("/accounting/opening/ar/import", payload);
                            setArOpen(false);
                            setStatus(`Opening AR import OK. created=${res.created} skipped=${res.skipped}`);
                          } catch (e) {
                            setStatus(e instanceof Error ? e.message : String(e));
                          } finally {
                            setArImporting(false);
                          }
                        }}
                      >
                        {arImporting ? "Importing..." : "Import"}
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={apOpen} onOpenChange={setApOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Import Opening AP</Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Import Opening AP</DialogTitle>
                  <DialogDescription>
                    CSV headers:{" "}
                    <span className="font-mono text-xs">
                      supplier_code (or supplier_id),invoice_no,invoice_date,due_date,amount_usd,amount_lbp
                    </span>
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <textarea
                      className="h-64 w-full rounded-md border border-border bg-bg-elevated p-3 font-mono text-xs"
                      placeholder={
                        "supplier_code,invoice_no,invoice_date,due_date,amount_usd,amount_lbp\nSUP-001,OPEN-2001,2026-02-01,2026-02-20,300.00,\nSUP-002,OPEN-2002,2026-02-01,, ,26850000"
                      }
                      value={apText}
                      onChange={(e) => {
                        setApText(e.target.value);
                        recomputeAp(e.target.value);
                      }}
                    />
                    {apErrors ? (
                      <pre className="whitespace-pre-wrap rounded-md border border-border bg-bg-sunken p-2 text-xs text-fg-muted">
                        {apErrors}
                      </pre>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-fg-muted">Preview (first {apPreview.length})</div>
                    <div className="ui-table-wrap">
                      <table className="ui-table">
                        <thead className="ui-thead">
                          <tr>
                            <th className="px-3 py-2">Supplier</th>
                            <th className="px-3 py-2">Invoice</th>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2 text-right">USD</th>
                            <th className="px-3 py-2 text-right">LL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apPreview.map((r, i) => (
                            <tr key={i} className="ui-tr-hover">
                              <td className="px-3 py-2 font-mono text-xs">{r.supplier_code || r.supplier_id || "-"}</td>
                              <td className="px-3 py-2 font-mono text-xs">{r.invoice_no || "(auto)"}</td>
                              <td className="px-3 py-2 font-mono text-xs">{r.invoice_date}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs">{r.amount_usd ?? "-"}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs">{r.amount_lbp ?? "-"}</td>
                            </tr>
                          ))}
                          {apPreview.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-3 py-6 text-center text-fg-subtle">
                                Paste CSV to preview.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setApText("");
                          setApPreview([]);
                          setApErrors("");
                        }}
                      >
                        Clear
                      </Button>
                      <Button
                        disabled={apImporting || !!apErrors || apPreview.length === 0}
                        onClick={async () => {
                          setApImporting(true);
                          setStatus("");
                          try {
                            const payload = {
                              rate_type: rateType,
                              exchange_rate: Number(exchangeRate || 0),
                              rows: apPreview.map((r) => ({
                                supplier_id: r.supplier_id,
                                supplier_code: r.supplier_code,
                                invoice_no: r.invoice_no,
                                invoice_date: r.invoice_date,
                                due_date: r.due_date,
                                amount_usd: r.amount_usd ?? 0,
                                amount_lbp: r.amount_lbp ?? 0
                              }))
                            };
                            const res = await apiPost<{ created: number; skipped: number }>("/accounting/opening/ap/import", payload);
                            setApOpen(false);
                            setStatus(`Opening AP import OK. created=${res.created} skipped=${res.skipped}`);
                          } catch (e) {
                            setStatus(e instanceof Error ? e.message : String(e));
                          } finally {
                            setApImporting(false);
                          }
                        }}
                      >
                        {apImporting ? "Importing..." : "Import"}
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>After Import</CardTitle>
          <CardDescription>Verify AR/AP Aging, Trial Balance, and VAT.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/accounting/reports/ar-aging">AR Aging</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/accounting/reports/ap-aging">AP Aging</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/accounting/reports/trial-balance">Trial Balance</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/accounting/reports/general-ledger">General Ledger</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
