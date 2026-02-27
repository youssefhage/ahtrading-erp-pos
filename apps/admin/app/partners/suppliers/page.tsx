"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Upload, Truck } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";
import { ViewRaw } from "@/components/view-raw";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

type BulkSupplierIn = {
  code?: string | null;
  name: string;
  party_type?: PartyType;
  phone?: string | null;
  email?: string | null;
  payment_terms_days?: number;
};

/* ------------------------------------------------------------------ */
/*  CSV parser                                                         */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SuppliersListPage() {
  const router = useRouter();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  /* ---- import state ---- */
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<BulkSupplierIn[]>([]);
  const [importErrors, setImportErrors] = useState<string>("");
  const [importing, setImporting] = useState(false);

  /* ---- data fetching ---- */

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGet<{ suppliers: Supplier[] }>("/suppliers");
      setSuppliers(res.suppliers || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ---- columns ---- */

  const columns = useMemo<ColumnDef<Supplier>[]>(
    () => [
      {
        accessorKey: "code",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Code" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.code || "--"}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Supplier" />
        ),
        cell: ({ row }) => (
          <div>
            <span className="font-medium">{row.original.name}</span>
            {row.original.legal_name && (
              <p className="text-xs text-muted-foreground">
                {row.original.legal_name}
              </p>
            )}
          </div>
        ),
      },
      {
        accessorKey: "phone",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Phone" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.phone || "--"}
          </span>
        ),
      },
      {
        accessorKey: "email",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Email" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.email || "--"}
          </span>
        ),
      },
      {
        id: "terms",
        accessorFn: (row) => Number(row.payment_terms_days || 0),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Terms" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {Number(row.original.payment_terms_days || 0)}d
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) =>
          row.is_active === false ? "inactive" : "active",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <StatusBadge
            status={
              row.original.is_active === false ? "inactive" : "active"
            }
          />
        ),
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
      },
      {
        id: "vat_no",
        accessorFn: (row) => row.vat_no || "",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="VAT No" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm text-muted-foreground">
            {row.original.vat_no || "--"}
          </span>
        ),
        enableHiding: true,
      },
      {
        id: "tax_id",
        accessorFn: (row) => row.tax_id || "",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tax ID" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm text-muted-foreground">
            {row.original.tax_id || "--"}
          </span>
        ),
        enableHiding: true,
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              router.push(
                `/partners/suppliers/${encodeURIComponent(row.original.id)}/edit`,
              );
            }}
          >
            Edit
          </Button>
        ),
      },
    ],
    [router],
  );

  /* ---- CSV import helpers ---- */

  function buildImportPreview() {
    setImportErrors("");
    const rows = parseCsv(importText || "");
    if (!rows.length) {
      setImportPreview([]);
      return;
    }
    const header = (rows[0] || []).map((h) =>
      String(h || "")
        .trim()
        .toLowerCase(),
    );
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
        code: iCode >= 0 ? String(r[iCode] || "").trim() || null : null,
        name,
        phone: iPhone >= 0 ? String(r[iPhone] || "").trim() || null : null,
        email: iEmail >= 0 ? String(r[iEmail] || "").trim() || null : null,
        payment_terms_days:
          iTerms >= 0 ? Number(String(r[iTerms] || "0")) || 0 : 0,
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
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setImporting(false);
    }
  }

  /* ---- empty state ---- */

  if (!loading && suppliers.length === 0 && !err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Suppliers"
          description="Partners"
          actions={
            <Button
              size="sm"
              onClick={() => router.push("/partners/suppliers/new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Supplier
            </Button>
          }
        />
        <EmptyState
          icon={Truck}
          title="No suppliers yet"
          description="Create suppliers to manage purchasing, AP tracking, and vendor contacts."
          action={{
            label: "New Supplier",
            onClick: () => router.push("/partners/suppliers/new"),
          }}
        />
      </div>
    );
  }

  /* ---- main render ---- */

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Suppliers"
        description={
          loading
            ? "Loading..."
            : `${suppliers.length} supplier${suppliers.length !== 1 ? "s" : ""}`
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => load()}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>

            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Upload className="mr-2 h-4 w-4" />
                  Import CSV
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Import Suppliers (CSV)</DialogTitle>
                  <DialogDescription>
                    Columns supported: code, name, phone, email,
                    payment_terms_days
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={importSuppliers} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Paste CSV</Label>
                    <Textarea
                      rows={10}
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder="code,name,phone,email,payment_terms_days&#10;SUP-001,Acme Inc,+1234567890,acme@example.com,30"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={buildImportPreview}
                    >
                      Preview
                    </Button>
                    <Button
                      type="submit"
                      disabled={importing || !importPreview.length}
                    >
                      {importing
                        ? "Importing..."
                        : `Import (${importPreview.length})`}
                    </Button>
                  </div>
                  {importErrors && (
                    <p className="text-sm text-destructive">{importErrors}</p>
                  )}
                  {importPreview.length > 0 && (
                    <div className="space-y-2">
                      <Badge variant="secondary">
                        {importPreview.length} rows ready
                      </Badge>
                      <ViewRaw
                        value={importPreview}
                        label="View preview (raw)"
                      />
                    </div>
                  )}
                </form>
              </DialogContent>
            </Dialog>

            <Button
              size="sm"
              onClick={() => router.push("/partners/suppliers/new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Supplier
            </Button>
          </>
        }
      />

      {err && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <DataTable
        columns={columns}
        data={suppliers}
        isLoading={loading}
        searchPlaceholder="Search by name, code, phone, VAT..."
        onRowClick={(row) =>
          router.push(
            `/partners/suppliers/${encodeURIComponent(row.id)}`,
          )
        }
        filterableColumns={[
          {
            id: "status",
            title: "Status",
            options: [
              { label: "Active", value: "active" },
              { label: "Inactive", value: "inactive" },
            ],
          },
        ]}
      />
    </div>
  );
}
