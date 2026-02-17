"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Paperclip } from "lucide-react";

import { apiGet } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DataTableTabs } from "@/components/data-table-tabs";
import { ErrorBanner } from "@/components/error-banner";
import { Page } from "@/components/page";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type InvoiceRow = {
  id: string;
  invoice_no: string;
  supplier_ref?: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  import_status?: string | null;
  status: string;
  invoice_date: string;
  due_date: string;
  created_at: string;
  attachment_count?: number;
};

const importStatusChoices = ["", "pending", "processing", "pending_review", "skipped", "filled", "failed"] as const;

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

export default function ApImportQueuePage() {
  const router = useRouter();

  const [err, setErr] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [importStatus, setImportStatus] = useState<(typeof importStatusChoices)[number]>("pending_review");
  const [rows, setRows] = useState<InvoiceRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("status", "draft");
      params.set("limit", "300");
      params.set("sort", "created_at");
      params.set("dir", "desc");
      if (q.trim()) params.set("q", q.trim());
      if (importStatus) params.set("import_status", importStatus);
      const res = await apiGet<{ invoices: InvoiceRow[] }>(`/purchases/invoices?${params.toString()}`);
      setRows(res.invoices || []);
    } catch (nextErr) {
      setErr(nextErr);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [q, importStatus]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, 180);
    return () => window.clearTimeout(t);
  }, [load]);

  const nextReview = useMemo(
    () =>
      rows.find(
        (r) =>
          String(r.import_status || "").toLowerCase() === "pending_review" &&
          Number(r.attachment_count || 0) > 0
      ) ||
      rows.find((r) => Number(r.attachment_count || 0) > 0) ||
      null,
    [rows]
  );

  const columns = useMemo((): Array<DataTableColumn<InvoiceRow>> => {
    return [
      {
        id: "invoice",
        header: "Draft",
        accessor: (r) => `${r.invoice_no || ""} ${r.supplier_ref || ""}`,
        cell: (r) => (
          <div>
            <div className="data-mono text-sm text-foreground">
              <ShortcutLink href={`/purchasing/supplier-invoices/${encodeURIComponent(r.id)}/edit`} title="Open review form">
                {r.invoice_no || "(draft)"}
              </ShortcutLink>
            </div>
            {r.supplier_ref ? <div className="data-mono text-xs text-fg-subtle">Ref: {r.supplier_ref}</div> : null}
          </div>
        ),
      },
      {
        id: "supplier",
        header: "Supplier",
        accessor: (r) => r.supplier_name || r.supplier_id || "",
        cell: (r) => <span className="text-xs">{r.supplier_name || r.supplier_id || "-"}</span>,
      },
      {
        id: "import_status",
        header: "Import",
        accessor: (r) => String(r.import_status || "none"),
        cell: (r) => <StatusChip value={String(r.import_status || "none")} />,
      },
      {
        id: "attachments",
        header: "Files",
        align: "right",
        accessor: (r) => Number(r.attachment_count || 0),
        cell: (r) => (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            <Paperclip className="h-3 w-3" />
            {Number(r.attachment_count || 0).toLocaleString("en-US")}
          </span>
        ),
      },
      {
        id: "dates",
        header: "Dates",
        accessor: (r) => `${r.invoice_date || ""} ${r.created_at || ""}`,
        cell: (r) => (
          <div className="text-xs text-fg-muted">
            <div>
              Invoice: <span className="data-mono">{fmtIso(r.invoice_date)}</span>
            </div>
            <div>
              Created: <span className="data-mono">{fmtIso(r.created_at)}</span>
            </div>
          </div>
        ),
      },
      {
        id: "actions",
        header: "Review",
        align: "right",
        accessor: (r) => r.id,
        cell: (r) => (
          <Button type="button" size="sm" variant="outline" onClick={() => router.push(`/purchasing/supplier-invoices/${encodeURIComponent(r.id)}/edit`)}>
            Open Split View
          </Button>
        ),
      },
    ];
  }, [router]);

  return (
    <Page>
      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>AP Import Queue</CardTitle>
          <CardDescription>
            Review imported drafts with the split-screen editor (fields on left, source image/PDF on right).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/purchasing/supplier-invoices/new">Import Single File</Link>
            </Button>
            <Button
              type="button"
              disabled={!nextReview}
              onClick={() => {
                if (!nextReview) return;
                router.push(`/purchasing/supplier-invoices/${encodeURIComponent(nextReview.id)}/edit`);
              }}
            >
              Review Next
            </Button>
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          <DataTable
            tableId="automation.ap_import.queue"
            rows={rows}
            columns={columns}
            onRowClick={(r) => router.push(`/purchasing/supplier-invoices/${encodeURIComponent(r.id)}/edit`)}
            emptyText={loading ? "Loading..." : "No imported drafts found."}
            isLoading={loading}
            headerSlot={
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <DataTableTabs
                  value={importStatus || "all"}
                  onChange={(v) => setImportStatus(v === "all" ? "" : (v as (typeof importStatusChoices)[number]))}
                  tabs={[
                    { value: "all", label: "All" },
                    { value: "pending_review", label: "Pending Review" },
                    { value: "pending", label: "Pending" },
                    { value: "processing", label: "Processing" },
                    { value: "skipped", label: "Skipped" },
                    { value: "filled", label: "Filled" },
                    { value: "failed", label: "Failed" },
                  ]}
                />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search invoice no, supplier ref, supplier, ID"
                  className="w-full md:w-72"
                />
              </div>
            }
          />
        </CardContent>
      </Card>
    </Page>
  );
}
