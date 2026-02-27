"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  Search,
  Upload,
  XCircle,
  AlertTriangle,
  FileCheck,
} from "lucide-react";

import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";

import { PageHeader } from "@/components/business/page-header";
import { KpiCard } from "@/components/business/kpi-card";
import { StatusBadge } from "@/components/business/status-badge";
import { EmptyState } from "@/components/business/empty-state";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const importStatusChoices = [
  "",
  "pending",
  "processing",
  "pending_review",
  "skipped",
  "filled",
  "failed",
] as const;

function fmtIso(iso?: string | null) {
  return String(iso || "").slice(0, 10) || "-";
}

function importStatusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" {
  switch (status.toLowerCase()) {
    case "pending_review":
      return "warning";
    case "pending":
      return "secondary";
    case "processing":
      return "info";
    case "filled":
      return "success";
    case "failed":
      return "destructive";
    case "skipped":
      return "outline";
    default:
      return "secondary";
  }
}

function importStatusIcon(status: string) {
  switch (status.toLowerCase()) {
    case "pending_review":
      return Clock;
    case "pending":
      return Clock;
    case "processing":
      return Loader2;
    case "filled":
      return CheckCircle2;
    case "failed":
      return XCircle;
    case "skipped":
      return AlertTriangle;
    default:
      return FileText;
  }
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function ApImportQueuePage() {
  const router = useRouter();
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [importStatus, setImportStatus] = useState<
    (typeof importStatusChoices)[number]
  >("pending_review");
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams();
      params.set("status", "draft");
      params.set("limit", "300");
      params.set("sort", "created_at");
      params.set("dir", "desc");
      if (q.trim()) params.set("q", q.trim());
      if (importStatus) params.set("import_status", importStatus);
      const res = await apiGet<{ invoices: InvoiceRow[] }>(
        `/purchases/invoices?${params.toString()}`
      );
      setRows(res.invoices || []);
    } catch (nextErr) {
      setErr(nextErr instanceof Error ? nextErr.message : String(nextErr));
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
          String(r.import_status || "").toLowerCase() ===
            "pending_review" && Number(r.attachment_count || 0) > 0
      ) ||
      rows.find((r) => Number(r.attachment_count || 0) > 0) ||
      null,
    [rows]
  );

  /* ---------- Status counts ---------- */

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const status = String(r.import_status || "none").toLowerCase();
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }, [rows]);

  /* ---------- Drag & drop handlers ---------- */

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    // Navigate to single file import -- the actual upload is handled by
    // the supplier-invoices/new page
    router.push("/purchasing/supplier-invoices/new");
  }

  /* ---------- Render ---------- */

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        title="AP Import Queue"
        description="Review imported invoice drafts with the split-screen editor. Upload new files or review AI-processed invoices."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw
                className={cn(
                  "mr-2 h-3.5 w-3.5",
                  loading && "animate-spin"
                )}
              />
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button
              size="sm"
              disabled={!nextReview}
              onClick={() => {
                if (!nextReview) return;
                router.push(
                  `/purchasing/supplier-invoices/${encodeURIComponent(nextReview.id)}/edit`
                );
              }}
            >
              <ArrowRight className="mr-2 h-3.5 w-3.5" />
              Review Next
            </Button>
          </div>
        }
      />

      {/* Error banner */}
      {err && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">
              {err || "Failed to load invoices."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Drag-and-drop upload zone */}
      <Card
        className={cn(
          "relative overflow-hidden border-2 border-dashed transition-all",
          isDragging
            ? "border-primary bg-primary/5 shadow-lg"
            : "border-muted-foreground/20 hover:border-muted-foreground/40"
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div
            className={cn(
              "mb-4 rounded-full p-4 transition-colors",
              isDragging
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Upload className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-semibold">
            {isDragging
              ? "Drop files to import"
              : "Drag & drop invoice files"}
          </h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Drop PDF, image, or spreadsheet files here to begin import, or
            click below to upload manually.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() =>
              router.push("/purchasing/supplier-invoices/new")
            }
          >
            <Upload className="mr-2 h-4 w-4" />
            Import Single File
          </Button>
        </CardContent>
      </Card>

      {/* KPI summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Drafts"
          value={rows.length}
          icon={FileText}
        />
        <KpiCard
          title="Pending Review"
          value={statusCounts["pending_review"] || 0}
          icon={Clock}
          trend={
            (statusCounts["pending_review"] || 0) > 0 ? "up" : "neutral"
          }
          trendValue={
            (statusCounts["pending_review"] || 0) > 0
              ? "needs attention"
              : ""
          }
        />
        <KpiCard
          title="Filled"
          value={statusCounts["filled"] || 0}
          icon={FileCheck}
        />
        <KpiCard
          title="Failed"
          value={statusCounts["failed"] || 0}
          icon={XCircle}
          trend={
            (statusCounts["failed"] || 0) > 0 ? "down" : "neutral"
          }
          trendValue={
            (statusCounts["failed"] || 0) > 0
              ? "need investigation"
              : ""
          }
        />
      </div>

      {/* Status filter tabs */}
      <Tabs
        value={importStatus || "all"}
        onValueChange={(v) =>
          setImportStatus(
            v === "all"
              ? ""
              : (v as (typeof importStatusChoices)[number])
          )
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending_review">
              Pending Review
            </TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="processing">Processing</TabsTrigger>
            <TabsTrigger value="filled">Filled</TabsTrigger>
            <TabsTrigger value="failed">Failed</TabsTrigger>
            <TabsTrigger value="skipped">Skipped</TabsTrigger>
          </TabsList>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search invoice no, supplier, ref..."
              className="pl-9"
            />
          </div>
        </div>

        {/* Invoice cards (all tabs share same content, filter is done via API) */}
        <div className="mt-6">
          {loading && rows.length === 0 && (
            <Card>
              <CardContent className="py-12">
                <div className="flex flex-col items-center gap-2 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Loading drafts...
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {!loading && rows.length === 0 && (
            <Card>
              <CardContent className="py-12">
                <EmptyState
                  icon={FileText}
                  title="No imported drafts found"
                  description="No invoices match the current filter. Try a different status or import new files."
                  action={{
                    label: "Import Single File",
                    onClick: () =>
                      router.push("/purchasing/supplier-invoices/new"),
                  }}
                />
              </CardContent>
            </Card>
          )}

          {rows.length > 0 && (
            <div className="space-y-3">
              {rows.map((r) => {
                const status = String(
                  r.import_status || "none"
                ).toLowerCase();
                const StatusIcon = importStatusIcon(status);
                const isProcessing = status === "processing";

                return (
                  <Card
                    key={r.id}
                    className="cursor-pointer transition-shadow hover:shadow-md"
                    onClick={() =>
                      router.push(
                        `/purchasing/supplier-invoices/${encodeURIComponent(r.id)}/edit`
                      )
                    }
                  >
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <div
                            className={cn(
                              "shrink-0 rounded-lg p-2",
                              status === "pending_review" &&
                                "bg-warning/10 text-warning",
                              status === "filled" &&
                                "bg-success/10 text-success",
                              status === "failed" &&
                                "bg-destructive/10 text-destructive",
                              status === "processing" &&
                                "bg-info/10 text-info",
                              !["pending_review", "filled", "failed", "processing"].includes(status) &&
                                "bg-muted text-muted-foreground"
                            )}
                          >
                            <StatusIcon
                              className={cn(
                                "h-5 w-5",
                                isProcessing && "animate-spin"
                              )}
                            />
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-sm font-medium">
                                {r.invoice_no || "(draft)"}
                              </span>
                              <Badge
                                variant={importStatusVariant(status)}
                                className="text-xs capitalize"
                              >
                                {status.replace(/_/g, " ")}
                              </Badge>
                              {r.supplier_ref && (
                                <span className="text-xs text-muted-foreground">
                                  Ref: {r.supplier_ref}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              {r.supplier_name && (
                                <span>{r.supplier_name}</span>
                              )}
                              <span>
                                Invoice: {fmtIso(r.invoice_date)}
                              </span>
                              <span>
                                Created: {fmtIso(r.created_at)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {Number(r.attachment_count || 0) > 0 && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Paperclip className="h-3.5 w-3.5" />
                              {Number(r.attachment_count || 0)}
                            </div>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(
                                `/purchasing/supplier-invoices/${encodeURIComponent(r.id)}/edit`
                              );
                            }}
                          >
                            Open Split View
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
