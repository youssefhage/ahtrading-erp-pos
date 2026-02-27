"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle, RefreshCw, Rocket } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { FALLBACK_FX_RATE_USD_LBP } from "@/lib/constants";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type RateRow = { rate_date: string; rate_type: string; usd_to_lbp: string | number };
type PreflightRes = { ok: boolean; checks: Array<{ name: string; status: string; detail: string }> };

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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [rateType, setRateType] = useState("market");
  const [exchangeRate, setExchangeRate] = useState(String(FALLBACK_FX_RATE_USD_LBP));

  const [preflight, setPreflight] = useState<PreflightRes | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [demoSeeding, setDemoSeeding] = useState(false);

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
        cta: "Open Items",
      },
      {
        title: "Opening Stock",
        desc: "Import on-hand + unit cost per warehouse (idempotent).",
        href: "/inventory/ops",
        cta: "Open Inventory Ops",
      },
      {
        title: "Account Defaults",
        desc: "Verify AR/AP/INVENTORY/COGS/VAT + OPENING_BALANCE mappings.",
        href: "/system/config",
        cta: "Open Config",
      },
      {
        title: "Sales Invoices",
        desc: "Draft-first invoices, post when ready; payments are separate.",
        href: "/sales/invoices",
        cta: "Open Sales Invoices",
      },
      {
        title: "Supplier Invoices",
        desc: "Draft-first supplier invoices; link to goods receipts when needed.",
        href: "/purchasing/supplier-invoices",
        cta: "Open Supplier Invoices",
      },
    ],
    [],
  );

  const preflightColumns = useMemo<ColumnDef<{ name: string; status: string; detail: string }>[]>(
    () => [
      {
        id: "name",
        accessorFn: (c) => c.name,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Check" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.name}</span>,
      },
      {
        id: "status",
        accessorFn: (c) => c.status,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "detail",
        accessorFn: (c) => c.detail,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Details" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.detail}</span>,
      },
    ],
    [],
  );

  const arPreviewColumns = useMemo<ColumnDef<OpeningArRow>[]>(
    () => [
      {
        id: "customer",
        accessorFn: (r) => r.customer_code || r.customer_id || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.customer_code || row.original.customer_id || "-"}</span>,
      },
      {
        id: "invoice_no",
        accessorFn: (r) => r.invoice_no || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.invoice_no || "(auto)"}</span>,
      },
      {
        id: "invoice_date",
        accessorFn: (r) => r.invoice_date,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.invoice_date}</span>,
      },
      {
        id: "amount_usd",
        accessorFn: (r) => Number(r.amount_usd || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="USD" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.amount_usd ?? "-"}</span>,
      },
      {
        id: "amount_lbp",
        accessorFn: (r) => Number(r.amount_lbp || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="LL" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.amount_lbp ?? "-"}</span>,
      },
    ],
    [],
  );

  const apPreviewColumns = useMemo<ColumnDef<OpeningApRow>[]>(
    () => [
      {
        id: "supplier",
        accessorFn: (r) => r.supplier_code || r.supplier_id || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.supplier_code || row.original.supplier_id || "-"}</span>,
      },
      {
        id: "invoice_no",
        accessorFn: (r) => r.invoice_no || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.invoice_no || "(auto)"}</span>,
      },
      {
        id: "invoice_date",
        accessorFn: (r) => r.invoice_date,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.invoice_date}</span>,
      },
      {
        id: "amount_usd",
        accessorFn: (r) => Number(r.amount_usd || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="USD" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.amount_usd ?? "-"}</span>,
      },
      {
        id: "amount_lbp",
        accessorFn: (r) => Number(r.amount_lbp || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="LL" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.amount_lbp ?? "-"}</span>,
      },
    ],
    [],
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
          amount_lbp,
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
          amount_lbp,
        });
      }

      setApPreview(preview.slice(0, 200));
      setApErrors(errs.join("\n"));
    } catch (e) {
      setApPreview([]);
      setApErrors(e instanceof Error ? e.message : String(e));
    }
  }

  async function reloadPreflight() {
    setPreflightLoading(true);
    try {
      const res = await apiGet<PreflightRes>("/config/preflight");
      setPreflight(res);
      setError("");
    } catch (e) {
      setPreflight(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreflightLoading(false);
    }
  }

  async function seedDemoData() {
    setDemoSeeding(true);
    setError("");
    setNotice("");
    try {
      await apiPost("/devtools/demo-data/import", { size: "small", with_opening_stock: true });
      setNotice("Demo data seeded. You can now test invoices and stock flows.");
      await reloadPreflight();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDemoSeeding(false);
    }
  }

  async function loadDefaults() {
    try {
      const res = await apiGet<{ rates: RateRow[] }>("/config/exchange-rates");
      const market = (res.rates || []).find((r) => (r.rate_type || "").toLowerCase() === "market");
      if (market && market.usd_to_lbp) setExchangeRate(String(market.usd_to_lbp));
    } catch (e) {
      // non-blocking
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    loadDefaults();
    reloadPreflight();
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Go-Live"
        description="Pre-flight checks, demo data seeding, and opening balance imports."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError("");
              loadDefaults();
              reloadPreflight();
            }}
            disabled={preflightLoading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${preflightLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError("");
                loadDefaults();
                reloadPreflight();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {notice && (
        <Card className="border-success/50 bg-success/5">
          <CardContent className="py-3">
            <p className="text-sm text-muted-foreground">{notice}</p>
          </CardContent>
        </Card>
      )}

      {/* Preflight */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            Go-Live Preflight
          </CardTitle>
          <CardDescription>Fast checks for common setup blockers. Demo data seeding is local/dev only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reloadPreflight} disabled={preflightLoading}>
              {preflightLoading ? "Checking..." : "Refresh Checks"}
            </Button>
            <Button type="button" size="sm" onClick={seedDemoData} disabled={demoSeeding || preflightLoading}>
              {demoSeeding ? "Seeding..." : "Seed Demo Data"}
            </Button>
          </div>

          {preflight ? (
            <DataTable columns={preflightColumns} data={preflight.checks} searchPlaceholder="Search checks..." />
          ) : (
            <div className="text-sm text-muted-foreground">No preflight data yet.</div>
          )}
        </CardContent>
      </Card>

      {/* Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Go-Live Checklist
          </CardTitle>
          <CardDescription>Get data in, then verify reports and day-close flows.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {cards.map((c) => (
            <div key={c.href} className="rounded-lg border bg-muted/40 p-4">
              <div className="text-sm font-semibold">{c.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{c.desc}</div>
              <div className="mt-3">
                <Button asChild variant="outline" size="sm">
                  <Link href={c.href}>{c.cta}</Link>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Opening Balances */}
      <Card>
        <CardHeader>
          <CardTitle>Opening Balances</CardTitle>
          <CardDescription>Import outstanding AR/AP so Aging reports and payments are correct.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Rate Type</label>
            <Input value={rateType} onChange={(e) => setRateType(e.target.value)} placeholder="market" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Exchange Rate (USD to LL)</label>
            <Input value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="89500" />
          </div>
          <div className="flex items-end gap-2">
            <Dialog open={arOpen} onOpenChange={setArOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Import Opening AR
                </Button>
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
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Textarea
                      className="h-64 font-mono text-xs"
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
                      <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                        {arErrors}
                      </pre>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Preview (first {arPreview.length})</div>
                    <DataTable columns={arPreviewColumns} data={arPreview} searchPlaceholder="Search..." />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setArText("");
                          setArPreview([]);
                          setArErrors("");
                        }}
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        disabled={arImporting || !!arErrors || arPreview.length === 0}
                        onClick={async () => {
                          setArImporting(true);
                          setError("");
                          setNotice("");
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
                                amount_lbp: r.amount_lbp ?? 0,
                              })),
                            };
                            const res = await apiPost<{ created: number; skipped: number }>("/accounting/opening/ar/import", payload);
                            setArOpen(false);
                            setNotice(`Opening AR import OK. created=${res.created} skipped=${res.skipped}`);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
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
                <Button variant="outline" size="sm">
                  Import Opening AP
                </Button>
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
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Textarea
                      className="h-64 font-mono text-xs"
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
                      <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                        {apErrors}
                      </pre>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Preview (first {apPreview.length})</div>
                    <DataTable columns={apPreviewColumns} data={apPreview} searchPlaceholder="Search..." />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setApText("");
                          setApPreview([]);
                          setApErrors("");
                        }}
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        disabled={apImporting || !!apErrors || apPreview.length === 0}
                        onClick={async () => {
                          setApImporting(true);
                          setError("");
                          setNotice("");
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
                                amount_lbp: r.amount_lbp ?? 0,
                              })),
                            };
                            const res = await apiPost<{ created: number; skipped: number }>("/accounting/opening/ap/import", payload);
                            setApOpen(false);
                            setNotice(`Opening AP import OK. created=${res.created} skipped=${res.skipped}`);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
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

      {/* After Import */}
      <Card>
        <CardHeader>
          <CardTitle>After Import</CardTitle>
          <CardDescription>Verify AR/AP Aging, Trial Balance, and VAT.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/accounting/reports/ar-aging">AR Aging</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/accounting/reports/ap-aging">AP Aging</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/accounting/reports/trial-balance">Trial Balance</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/accounting/reports/general-ledger">General Ledger</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
