"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiBase, apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/error-banner";
import { DataTable, type DataTableColumn } from "@/components/data-table";

type VatRow = {
  tax_code_id: string;
  tax_name: string;
  period: string;
  base_lbp: string | number;
  tax_lbp: string | number;
};

function fmtLbp(v: string | number) {
  return Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function VatReportPage() {
  const [rows, setRows] = useState<VatRow[]>([]);
  const [status, setStatus] = useState("");

  const columns = useMemo((): Array<DataTableColumn<VatRow>> => {
    return [
      { id: "period", header: "Period", accessor: (r) => r.period, mono: true, sortable: true, globalSearch: false },
      { id: "tax_name", header: "Tax", accessor: (r) => r.tax_name, sortable: true },
      {
        id: "base_lbp",
        header: "Base (LL)",
        accessor: (r) => Number(r.base_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.base_lbp)}</span>,
      },
      {
        id: "tax_lbp",
        header: "VAT (LL)",
        accessor: (r) => Number(r.tax_lbp || 0),
        align: "right",
        mono: true,
        sortable: true,
        cell: (r) => <span className="data-mono ui-tone-lbp">{fmtLbp(r.tax_lbp)}</span>,
      },
    ];
  }, []);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ vat: VatRow[] }>("/reports/vat");
      setRows(res.vat || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function downloadCsv() {
    setStatus("Downloading CSV...");
    try {
      const res = await fetch(`${apiBase()}/reports/vat?format=csv`, {
        credentials: "include"
      });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vat_report.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Monthly VAT (LL)</CardTitle>
            <CardDescription>Aggregated from tax lines. {rows.length} rows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Button asChild variant="outline">
                <Link href="/accounting/reports/vat/print" target="_blank" rel="noopener noreferrer">
                  Print / PDF
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href="/exports/reports/vat/pdf" target="_blank" rel="noopener noreferrer">
                  Download PDF
                </a>
              </Button>
              <Button variant="secondary" onClick={downloadCsv}>
                Download CSV
              </Button>
            </div>

            <DataTable<VatRow>
              tableId="accounting.reports.vat"
              rows={rows}
              columns={columns}
              initialSort={{ columnId: "period", dir: "desc" }}
              globalFilterPlaceholder="Search period / tax..."
              emptyText="No VAT rows yet."
            />
          </CardContent>
        </Card>
      </div>);
}
