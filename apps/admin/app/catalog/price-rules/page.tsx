"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PriceListRow = {
  id: string;
  code: string;
  name: string;
  currency: "USD" | "LBP";
  is_default: boolean;
};

type DerivationRow = {
  id: string;
  target_price_list_id: string;
  target_code: string;
  target_name: string;
  base_price_list_id: string;
  base_code: string;
  base_name: string;
  mode: "markup_pct" | "discount_pct";
  pct: string | number;
  usd_round_step: string | number;
  lbp_round_step: string | number;
  min_margin_pct: string | number | null;
  skip_if_cost_missing: boolean;
  is_active: boolean;
  last_run_at?: string | null;
  last_run_summary?: any;
};

function pctNum(v: string | number | null | undefined) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function PriceRulesPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [lists, setLists] = useState<PriceListRow[]>([]);
  const [rows, setRows] = useState<DerivationRow[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [baseId, setBaseId] = useState("");
  const [mode, setMode] = useState<"markup_pct" | "discount_pct">("markup_pct");
  const [pct, setPct] = useState("0.05");
  const [usdStep, setUsdStep] = useState("0.25");
  const [lbpStep, setLbpStep] = useState("5000");
  const [minMargin, setMinMargin] = useState("0.12");
  const [skipIfCostMissing, setSkipIfCostMissing] = useState(true);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [pl, dr] = await Promise.all([
        apiGet<{ lists: PriceListRow[] }>("/pricing/lists"),
        apiGet<{ derivations: DerivationRow[] }>("/pricing/derivations"),
      ]);
      setLists(pl.lists || []);
      setRows(dr.derivations || []);
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo((): Array<DataTableColumn<DerivationRow>> => {
    return [
      { id: "target", header: "Target List", accessor: (r) => `${r.target_code} ${r.target_name}`, sortable: true, cell: (r) => <span className="font-medium">{r.target_code}</span> },
      { id: "base", header: "Base List", accessor: (r) => `${r.base_code} ${r.base_name}`, sortable: true, cell: (r) => <span className="font-medium">{r.base_code}</span> },
      { id: "mode", header: "Rule", accessor: (r) => `${r.mode} ${pctNum(r.pct)}`, sortable: true, cell: (r) => <span className="text-xs">{r.mode === "markup_pct" ? "+" : "-"}{(pctNum(r.pct) * 100).toFixed(2)}%</span> },
      { id: "margin", header: "Min Margin", accessor: (r) => pctNum(r.min_margin_pct), sortable: true, cell: (r) => <span className="text-xs">{r.min_margin_pct == null ? "-" : `${(pctNum(r.min_margin_pct) * 100).toFixed(1)}%`}</span> },
      { id: "rounding", header: "Rounding", accessor: (r) => `${r.usd_round_step}|${r.lbp_round_step}`, sortable: false, cell: (r) => <span className="text-xs">USD {String(r.usd_round_step)} · LL {String(r.lbp_round_step)}</span> },
      { id: "active", header: "Active", accessor: (r) => (r.is_active ? "yes" : "no"), sortable: true, cell: (r) => <span className="text-xs">{r.is_active ? "yes" : "no"}</span> },
      { id: "last", header: "Last Run", accessor: (r) => r.last_run_at || "", sortable: true, cell: (r) => <span className="text-xs">{r.last_run_at ? String(r.last_run_at).slice(0, 19).replace("T", " ") : "-"}</span> },
      {
        id: "actions",
        header: "",
        accessor: () => "",
        align: "right",
        globalSearch: false,
        cell: (r) => (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setBusy(true);
                setStatus("Running rule...");
                try {
                  await apiPost(`/pricing/derivations/${encodeURIComponent(r.id)}/run`, {});
                  await load();
                  setStatus("");
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              Run Now
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setBusy(true);
                setStatus("Toggling active...");
                try {
                  await apiPatch(`/pricing/derivations/${encodeURIComponent(r.id)}`, { is_active: !r.is_active });
                  await load();
                  setStatus("");
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              {r.is_active ? "Disable" : "Enable"}
            </Button>
          </div>
        ),
      },
    ];
  }, [busy, load]);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId) return setStatus("Target list is required.");
    if (!baseId) return setStatus("Base list is required.");
    if (targetId === baseId) return setStatus("Target list must differ from base list.");

    setBusy(true);
    setStatus("Creating rule...");
    try {
      await apiPost("/pricing/derivations", {
        target_price_list_id: targetId,
        base_price_list_id: baseId,
        mode,
        pct: Number(pct || 0),
        usd_round_step: Number(usdStep || 0.01),
        lbp_round_step: Number(lbpStep || 0),
        min_margin_pct: minMargin.trim() ? Number(minMargin) : null,
        skip_if_cost_missing: Boolean(skipIfCostMissing),
        is_active: Boolean(active),
      });
      setCreateOpen(false);
      await load();
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Price Rules</CardTitle>
          <CardDescription>Derived list rules (example: RETAIL = WHOLESALE +5%) with optional margin floor guard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={load} disabled={loading || busy}>
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button disabled={busy}>New Rule</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create Price Rule</DialogTitle>
                  <DialogDescription>
                    Materialize a target list from a base list with markup/discount and guardrails.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={createRule} className="grid grid-cols-1 gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Target List</label>
                      <select className="ui-select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                        <option value="">(pick)</option>
                        {lists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code} · {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Base List</label>
                      <select className="ui-select" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                        <option value="">(pick)</option>
                        {lists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code} · {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Mode</label>
                      <select className="ui-select" value={mode} onChange={(e) => setMode(e.target.value as any)}>
                        <option value="markup_pct">Markup (%)</option>
                        <option value="discount_pct">Discount (%)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Percent (fraction)</label>
                      <Input value={pct} onChange={(e) => setPct(e.target.value)} placeholder="0.05 = 5%" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">USD Round Step</label>
                      <Input value={usdStep} onChange={(e) => setUsdStep(e.target.value)} placeholder="0.25" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">LL Round Step</label>
                      <Input value={lbpStep} onChange={(e) => setLbpStep(e.target.value)} placeholder="5000" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Min Margin (fraction)</label>
                      <Input value={minMargin} onChange={(e) => setMinMargin(e.target.value)} placeholder="0.12" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-fg-muted">
                    <input type="checkbox" checked={skipIfCostMissing} onChange={(e) => setSkipIfCostMissing(e.target.checked)} />
                    Skip/hold discount when cost is missing
                  </label>
                  <label className="flex items-center gap-2 text-sm text-fg-muted">
                    <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                    Active
                  </label>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={busy}>
                      {busy ? "..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <DataTable<DerivationRow>
            tableId="catalog.priceRules"
            rows={rows}
            columns={columns}
            initialSort={{ columnId: "target", dir: "asc" }}
            globalFilterPlaceholder="Search target/base list..."
            emptyText="No price rules yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}

