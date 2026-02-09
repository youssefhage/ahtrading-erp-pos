"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { ViewRaw } from "@/components/view-raw";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PartyType = "individual" | "business";
type Supplier = {
  id: string;
  code?: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  payment_terms_days: string | number;
  party_type?: PartyType;
  legal_name?: string | null;
  tax_id?: string | null;
  vat_no?: string | null;
  notes?: string | null;
  is_active?: boolean;
};

type BulkSupplierIn = { code?: string | null; name: string; party_type?: PartyType; phone?: string | null; email?: string | null; payment_terms_days?: number };

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

export default function SuppliersListPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);

  const [q, setQ] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<BulkSupplierIn[]>([]);
  const [importErrors, setImportErrors] = useState<string>("");
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return suppliers;
    return (suppliers || []).filter((s) => {
      return (
        s.name.toLowerCase().includes(needle) ||
        (s.code || "").toLowerCase().includes(needle) ||
        (s.legal_name || "").toLowerCase().includes(needle) ||
        (s.phone || "").toLowerCase().includes(needle) ||
        (s.email || "").toLowerCase().includes(needle) ||
        (s.vat_no || "").toLowerCase().includes(needle) ||
        (s.tax_id || "").toLowerCase().includes(needle)
      );
    });
  }, [suppliers, q]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ suppliers: Supplier[] }>("/suppliers");
      setSuppliers(res.suppliers || []);
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function buildImportPreview() {
    setImportErrors("");
    const rows = parseCsv(importText || "");
    if (!rows.length) {
      setImportPreview([]);
      return;
    }
    const header = (rows[0] || []).map((h) => String(h || "").trim().toLowerCase());
    const idx = (k: string) => header.findIndex((h) => h === k);
    const iCode = idx("code");
    const iName = idx("name");
    const iPhone = idx("phone");
    const iEmail = idx("email");
    const iTerms = idx("payment_terms_days");
    if (iName < 0) {
      setImportErrors("CSV must include a 'name' column.");
      setImportPreview([]);
      return;
    }
    const out: BulkSupplierIn[] = [];
    for (const r of rows.slice(1)) {
      const name = String(r[iName] || "").trim();
      if (!name) continue;
      out.push({
        code: iCode >= 0 ? (String(r[iCode] || "").trim() || null) : null,
        name,
        phone: iPhone >= 0 ? (String(r[iPhone] || "").trim() || null) : null,
        email: iEmail >= 0 ? (String(r[iEmail] || "").trim() || null) : null,
        payment_terms_days: iTerms >= 0 ? Number(String(r[iTerms] || "0")) || 0 : 0
      });
    }
    setImportPreview(out.slice(0, 200));
  }

  async function importSuppliers(e: React.FormEvent) {
    e.preventDefault();
    if (!importPreview.length) return;
    setImporting(true);
    setErr(null);
    try {
      await apiPost("/suppliers/bulk", { suppliers: importPreview });
      setImportOpen(false);
      setImportText("");
      setImportPreview([]);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Suppliers</h1>
          <p className="text-sm text-fg-muted">{loading ? "Loading..." : `${filtered.length} supplier(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline">
                Import CSV
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>Import Suppliers (CSV)</DialogTitle>
                <DialogDescription>Columns supported: code,name,phone,email,payment_terms_days</DialogDescription>
              </DialogHeader>
              <form onSubmit={importSuppliers} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Paste CSV</label>
                  <textarea className="ui-textarea" rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" variant="outline" onClick={buildImportPreview}>
                    Preview
                  </Button>
                  <Button type="submit" disabled={importing || !importPreview.length}>
                    {importing ? "..." : `Import (${importPreview.length})`}
                  </Button>
                </div>
                {importErrors ? <div className="text-sm text-danger">{importErrors}</div> : null}
                {importPreview.length ? <ViewRaw value={importPreview} label="View preview (raw)" /> : null}
              </form>
            </DialogContent>
          </Dialog>
          <Button type="button" onClick={() => router.push("/partners/suppliers/new")}>
            New Supplier
          </Button>
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Directory</CardTitle>
          <CardDescription>Search and open suppliers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="w-full md:w-96">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / code / phone / VAT..." />
          </div>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2 text-right">Terms</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="ui-tr-hover">
                    <td className="px-3 py-2">
                      <Link
                        className="focus-ring inline-flex items-center gap-1 text-primary hover:underline"
                        href={`/partners/suppliers/${encodeURIComponent(s.id)}`}
                      >
                        {s.code ? <span className="font-mono text-xs text-fg-muted">{s.code}</span> : null}
                        {s.code ? <span className="text-fg-muted"> · </span> : null}
                        <span className="font-medium text-foreground">{s.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-sm text-fg-muted">{s.phone || "-"}</td>
                    <td className="px-3 py-2 text-sm text-fg-muted">{s.email || "-"}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-fg-muted">{Number(s.payment_terms_days || 0)}</td>
                    <td className="px-3 py-2 text-sm">{s.is_active === false ? "inactive" : "active"}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                      No suppliers.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
