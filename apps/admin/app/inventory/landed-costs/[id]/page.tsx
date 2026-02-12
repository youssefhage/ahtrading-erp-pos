"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";

type LandedCostDoc = {
  id: string;
  landed_cost_no: string | null;
  goods_receipt_id: string;
  goods_receipt_no?: string | null;
  status: string;
  memo?: string | null;
  exchange_rate: string | number;
  total_usd: string | number;
  total_lbp: string | number;
  created_at: string;
  posted_at?: string | null;
  canceled_at?: string | null;
  cancel_reason?: string | null;
};

type LandedCostLine = {
  id: string;
  description: string | null;
  amount_usd: string | number;
  amount_lbp: string | number;
  created_at: string;
};

type Detail = { landed_cost: LandedCostDoc; lines: LandedCostLine[] };

function fmtIso(iso: string | null | undefined) {
  const s = String(iso || "");
  return s ? s.replace("T", " ").slice(0, 19) : "-";
}

function Inner({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const searchParams = useSearchParams();

  const [postOpen, setPostOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);

  const lc = detail?.landed_cost;
  const lines = detail?.lines || [];
  const lineColumns = useMemo((): Array<DataTableColumn<LandedCostLine>> => {
    return [
      {
        id: "description",
        header: "Description",
        sortable: true,
        accessor: (ln) => ln.description || "",
        cell: (ln) => ln.description || "-",
      },
      {
        id: "amount_usd",
        header: "USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (ln) => Number(ln.amount_usd || 0),
        cell: (ln) => <span className="data-mono">{fmtUsd(ln.amount_usd)}</span>,
      },
      {
        id: "amount_lbp",
        header: "LBP",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (ln) => Number(ln.amount_lbp || 0),
        cell: (ln) => <span className="data-mono">{fmtLbp(ln.amount_lbp)}</span>,
      },
    ];
  }, []);

  const totalUsd = useMemo(() => (lc ? fmtUsd(lc.total_usd) : fmtUsd(0)), [lc]);
  const totalLbp = useMemo(() => (lc ? fmtLbp(lc.total_lbp) : fmtLbp(0)), [lc]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const d = await apiGet<Detail>(`/inventory/landed-costs/${encodeURIComponent(id)}`);
      setDetail(d);
    } catch (e) {
      setDetail(null);
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function postDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!lc) return;
    setPosting(true);
    setErr(null);
    setLastWarnings([]);
    try {
      const res = await apiPost<{ ok: boolean; warnings?: string[] }>(`/inventory/landed-costs/${encodeURIComponent(lc.id)}/post`, {});
      setPostOpen(false);
      setLastWarnings(res.warnings || []);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setPosting(false);
    }
  }

  async function cancelDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!lc) return;
    setCanceling(true);
    setErr(null);
    try {
      await apiPost(`/inventory/landed-costs/${encodeURIComponent(lc.id)}/cancel`, { reason: cancelReason.trim() || undefined });
      setCancelOpen(false);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setCanceling(false);
    }
  }

  if (!loading && !detail && !err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <EmptyState
          title="Landed cost not found"
          description="This document may not exist or you may not have access."
          actionLabel="Back"
          onAction={() => router.push("/inventory/landed-costs/list")}
        />
      </div>
    );
  }

  const activeTab = (() => {
    const t = String(searchParams.get("tab") || "overview").toLowerCase();
    if (t === "lines") return "lines";
    return "overview";
  })();
  const landedCostTabs = [
    { label: "Overview", href: "?tab=overview", activeQuery: { key: "tab", value: "overview" } },
    { label: "Lines", href: "?tab=lines", activeQuery: { key: "tab", value: "lines" } },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{lc?.landed_cost_no || (loading ? "Loading..." : "Landed Cost")}</h1>
          <p className="text-sm text-fg-muted">
            <span className="font-mono text-xs">{id}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/inventory/landed-costs/list")}>
            Back
          </Button>
          {lc?.status === "draft" ? (
            <>
              <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => setPostOpen(true)}>
                Post
              </Button>
            </>
          ) : null}
          {lc ? <DocumentUtilitiesDrawer entityType="landed_cost" entityId={lc.id} showAttachments={false} className="ml-1" /> : null}
        </div>
      </div>

      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      {lastWarnings.length ? (
        <Card className="border-border-subtle">
          <CardHeader>
            <CardTitle>Warnings</CardTitle>
            <CardDescription>Allocation completed with warnings (best-effort adjustments).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="list-disc pl-5 text-fg-muted">
              {lastWarnings.slice(0, 10).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <TabBar tabs={landedCostTabs} />
      {lc ? (
        <>
          {activeTab === "overview" ? (
            <Card>
            <CardHeader>
              <CardTitle>Header</CardTitle>
              <CardDescription>Status, totals, and linked receipt.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-2">
              <div>
                <div className="text-xs text-fg-muted">Status</div>
                <div className="mt-1">
                  <StatusChip value={lc.status} />
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Goods receipt</div>
                <div className="mt-1">
                  <Link className="focus-ring text-primary hover:underline" href={`/purchasing/goods-receipts/${encodeURIComponent(lc.goods_receipt_id)}`}>
                    {lc.goods_receipt_no || lc.goods_receipt_id.slice(0, 8)}
                  </Link>
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Totals</div>
                <div className="mt-1 data-mono">
                  {totalUsd} · {totalLbp}
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Exchange rate</div>
                <div className="mt-1 data-mono">{String(lc.exchange_rate || "")}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-fg-muted">Memo</div>
                <div className="mt-1">{lc.memo || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Created</div>
                <div className="mt-1 font-mono text-xs text-fg-muted">{fmtIso(lc.created_at)}</div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Posted</div>
                <div className="mt-1 font-mono text-xs text-fg-muted">{fmtIso(lc.posted_at)}</div>
              </div>
            </CardContent>
          </Card>

          ) : null}

          {activeTab === "lines" ? (
            <Card>
              <CardHeader>
                <CardTitle>Lines</CardTitle>
                <CardDescription>Cost components included in this allocation.</CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable<LandedCostLine>
                  tableId="inventory.landed_cost.lines"
                  rows={lines}
                  columns={lineColumns}
                  getRowId={(ln) => ln.id}
                  emptyText="No lines."
                  enableGlobalFilter={false}
                  initialSort={{ columnId: "description", dir: "asc" }}
                />
              </CardContent>
            </Card>
          ) : null}

          {/* Audit trail is available via the right-rail utilities drawer. */}
        </>
      ) : null}

      <Dialog open={postOpen} onOpenChange={setPostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post Landed Cost</DialogTitle>
            <DialogDescription>This will allocate landed costs across the linked goods receipt.</DialogDescription>
          </DialogHeader>
          <form onSubmit={postDoc} className="space-y-3">
            <div className="text-sm text-fg-muted">
              This is v1 allocation: it updates batch cost layers and best-effort updates average cost if stock is still on hand.
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPostOpen(false)} disabled={posting}>
                Close
              </Button>
              <Button type="submit" disabled={posting}>
                {posting ? "Posting..." : "Post"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Draft</DialogTitle>
            <DialogDescription>Draft-only in v1. Posted landed costs require reversal support.</DialogDescription>
          </DialogHeader>
          <form onSubmit={cancelDoc} className="space-y-3">
            <label className="space-y-1">
              <div className="text-xs text-fg-muted">Reason (optional)</div>
              <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Why cancel this draft?" />
            </label>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={canceling}>
                Close
              </Button>
              <Button type="submit" variant="destructive" disabled={canceling}>
                {canceling ? "Canceling..." : "Cancel Draft"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LandedCostViewPage() {
  const paramsObj = useParams();
  const idParam = (paramsObj as Record<string, string | string[] | undefined>)?.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? (idParam[0] || "") : "";
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner id={id} />
    </Suspense>
  );
}
