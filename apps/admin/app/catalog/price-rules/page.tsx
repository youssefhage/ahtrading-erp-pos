"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Play, Zap, Pencil } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatDateLike } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

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
  last_run_summary?: unknown;
};

function pctNum(v: string | number | null | undefined) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function PriceRulesPage() {
  const [lists, setLists] = useState<PriceListRow[]>([]);
  const [rows, setRows] = useState<DerivationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* ---- Create ---- */
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

  /* ---- Edit ---- */
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editMode, setEditMode] = useState<"markup_pct" | "discount_pct">("markup_pct");
  const [editPct, setEditPct] = useState("");
  const [editUsdStep, setEditUsdStep] = useState("");
  const [editLbpStep, setEditLbpStep] = useState("");
  const [editMinMargin, setEditMinMargin] = useState("");
  const [editSkipIfCostMissing, setEditSkipIfCostMissing] = useState(true);
  const [editActive, setEditActive] = useState(true);

  /* ---- Load ---- */
  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [pl, dr] = await Promise.all([
        apiGet<{ lists: PriceListRow[] }>("/pricing/lists"),
        apiGet<{ derivations: DerivationRow[] }>("/pricing/derivations"),
      ]);
      setLists(pl.lists || []);
      setRows(dr.derivations || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ---- Actions ---- */
  const runRule = useCallback(async (ruleId: string) => {
    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/pricing/derivations/${encodeURIComponent(ruleId)}/run`, {});
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [load]);

  const toggleActive = useCallback(async (rule: DerivationRow) => {
    setBusy(true);
    setErr(null);
    try {
      await apiPatch(`/pricing/derivations/${encodeURIComponent(rule.id)}`, { is_active: !rule.is_active });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [load]);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId) return setErr("Target list is required.");
    if (!baseId) return setErr("Base list is required.");
    if (targetId === baseId) return setErr("Target list must differ from base list.");
    setBusy(true);
    setErr(null);
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
      setTargetId("");
      setBaseId("");
      setMode("markup_pct");
      setPct("0.05");
      setUsdStep("0.25");
      setLbpStep("5000");
      setMinMargin("0.12");
      setSkipIfCostMissing(true);
      setActive(true);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ---- Edit ---- */
  function openEdit(rule: DerivationRow) {
    setEditId(rule.id);
    setEditMode(rule.mode);
    setEditPct(String(pctNum(rule.pct)));
    setEditUsdStep(String(rule.usd_round_step ?? "0.01"));
    setEditLbpStep(String(rule.lbp_round_step ?? "0"));
    setEditMinMargin(rule.min_margin_pct == null ? "" : String(pctNum(rule.min_margin_pct)));
    setEditSkipIfCostMissing(rule.skip_if_cost_missing);
    setEditActive(rule.is_active);
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiPatch(`/pricing/derivations/${encodeURIComponent(editId)}`, {
        mode: editMode,
        pct: Number(editPct || 0),
        usd_round_step: Number(editUsdStep || 0.01),
        lbp_round_step: Number(editLbpStep || 0),
        min_margin_pct: editMinMargin.trim() ? Number(editMinMargin) : null,
        skip_if_cost_missing: Boolean(editSkipIfCostMissing),
        is_active: Boolean(editActive),
      });
      setEditOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ---- Columns ---- */
  const columns = useMemo<ColumnDef<DerivationRow>[]>(() => [
    {
      accessorFn: (r) => `${r.target_code} ${r.target_name}`,
      id: "target",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Target List" />,
      cell: ({ row }) => (
        <div>
          <span className="font-mono text-xs font-medium">{row.original.target_code}</span>
          <span className="ml-2 text-xs text-muted-foreground">{row.original.target_name}</span>
        </div>
      ),
    },
    {
      accessorFn: (r) => `${r.base_code} ${r.base_name}`,
      id: "base",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Base List" />,
      cell: ({ row }) => (
        <div>
          <span className="font-mono text-xs font-medium">{row.original.base_code}</span>
          <span className="ml-2 text-xs text-muted-foreground">{row.original.base_name}</span>
        </div>
      ),
    },
    {
      accessorFn: (r) => `${r.mode} ${pctNum(r.pct)}`,
      id: "rule",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Rule" />,
      cell: ({ row }) => {
        const r = row.original;
        const sign = r.mode === "markup_pct" ? "+" : "-";
        return (
          <Badge variant="secondary" className="font-mono text-xs">
            {sign}{(pctNum(r.pct) * 100).toFixed(2)}%
          </Badge>
        );
      },
    },
    {
      accessorFn: (r) => pctNum(r.min_margin_pct),
      id: "margin",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Min Margin" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.min_margin_pct == null ? "-" : `${(pctNum(row.original.min_margin_pct) * 100).toFixed(1)}%`}
        </span>
      ),
    },
    {
      accessorFn: (r) => `${r.usd_round_step}|${r.lbp_round_step}`,
      id: "rounding",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Rounding" />,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          USD {String(row.original.usd_round_step)} / LBP {String(row.original.lbp_round_step)}
        </span>
      ),
    },
    {
      accessorFn: (r) => (r.is_active ? "active" : "inactive"),
      id: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.is_active ? "active" : "inactive"} />,
    },
    {
      accessorFn: (r) => r.last_run_at || "",
      id: "last_run",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Last Run" />,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDateLike(row.original.last_run_at, "-")}</span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openEdit(r)}
              disabled={busy}
            >
              <Pencil className="mr-1 h-3 w-3" /> Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runRule(r.id)}
              disabled={busy}
            >
              <Play className="mr-1 h-3 w-3" /> Run
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleActive(r)}
              disabled={busy}
            >
              {r.is_active ? "Disable" : "Enable"}
            </Button>
          </div>
        );
      },
    },
  ], [busy, runRule, toggleActive, openEdit]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title="Price Rules"
        description="Derived list rules with optional margin floor guard."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading || busy}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); }}>
              <DialogTrigger asChild>
                <Button disabled={busy}><Plus className="mr-2 h-4 w-4" /> New Rule</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create Price Rule</DialogTitle>
                  <DialogDescription>Materialize a target list from a base list with markup/discount and guardrails.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createRule} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Target List <span className="text-destructive">*</span></Label>
                      <Select value={targetId} onValueChange={setTargetId}>
                        <SelectTrigger><SelectValue placeholder="Pick target..." /></SelectTrigger>
                        <SelectContent>
                          {lists.map((l) => (
                            <SelectItem key={l.id} value={l.id}>{l.code} -- {l.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Base List <span className="text-destructive">*</span></Label>
                      <Select value={baseId} onValueChange={setBaseId}>
                        <SelectTrigger><SelectValue placeholder="Pick base..." /></SelectTrigger>
                        <SelectContent>
                          {lists.map((l) => (
                            <SelectItem key={l.id} value={l.id}>{l.code} -- {l.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Mode</Label>
                      <Select value={mode} onValueChange={(v) => setMode(v as "markup_pct" | "discount_pct")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="markup_pct">Markup (%)</SelectItem>
                          <SelectItem value="discount_pct">Discount (%)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Percent (fraction, e.g. 0.05 = 5%)</Label>
                      <Input value={pct} onChange={(e) => setPct(e.target.value)} placeholder="0.05" inputMode="decimal" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>USD Round Step</Label>
                      <Input value={usdStep} onChange={(e) => setUsdStep(e.target.value)} placeholder="0.25" inputMode="decimal" />
                    </div>
                    <div className="space-y-2">
                      <Label>LBP Round Step</Label>
                      <Input value={lbpStep} onChange={(e) => setLbpStep(e.target.value)} placeholder="5000" inputMode="decimal" />
                    </div>
                    <div className="space-y-2">
                      <Label>Min Margin (fraction)</Label>
                      <Input value={minMargin} onChange={(e) => setMinMargin(e.target.value)} placeholder="0.12" inputMode="decimal" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <Switch checked={skipIfCostMissing} onCheckedChange={setSkipIfCostMissing} />
                      <Label>Skip / hold discount when cost is missing</Label>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch checked={active} onCheckedChange={setActive} />
                      <Label>Active</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={busy}>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Create
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {err ? <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert> : null}

      {!loading && rows.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={Zap}
              title="No price rules yet"
              description="Create a derivation rule, e.g. RETAIL = WHOLESALE + 5%."
              action={{ label: "New Rule", onClick: () => setCreateOpen(true) }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Derivation Rules</CardTitle>
            <CardDescription>Example: RETAIL = WHOLESALE +5% with optional margin floor guard.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={rows}
              isLoading={loading}
              searchPlaceholder="Search target / base list..."
              pageSize={25}
            />
          </CardContent>
        </Card>
      )}

      {/* ---- Edit Dialog ---- */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Price Rule</DialogTitle>
            <DialogDescription>Update the derivation parameters. Re-run the rule after saving to apply changes.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select value={editMode} onValueChange={(v) => setEditMode(v as "markup_pct" | "discount_pct")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="markup_pct">Markup (%)</SelectItem>
                    <SelectItem value="discount_pct">Discount (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Percent (fraction, e.g. 0.05 = 5%)</Label>
                <Input value={editPct} onChange={(e) => setEditPct(e.target.value)} placeholder="0.05" inputMode="decimal" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>USD Round Step</Label>
                <Input value={editUsdStep} onChange={(e) => setEditUsdStep(e.target.value)} placeholder="0.25" inputMode="decimal" />
              </div>
              <div className="space-y-2">
                <Label>LBP Round Step</Label>
                <Input value={editLbpStep} onChange={(e) => setEditLbpStep(e.target.value)} placeholder="5000" inputMode="decimal" />
              </div>
              <div className="space-y-2">
                <Label>Min Margin (fraction)</Label>
                <Input value={editMinMargin} onChange={(e) => setEditMinMargin(e.target.value)} placeholder="0.12" inputMode="decimal" />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Switch checked={editSkipIfCostMissing} onCheckedChange={setEditSkipIfCostMissing} />
                <Label>Skip / hold discount when cost is missing</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={editActive} onCheckedChange={setEditActive} />
                <Label>Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
