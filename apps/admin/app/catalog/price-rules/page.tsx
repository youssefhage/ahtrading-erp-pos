"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Play, Zap, Pencil, X, ChevronDown, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { apiGet, apiPatch, apiPost, apiDelete } from "@/lib/api";
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
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";

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

type CategoryRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type ItemOverrideRow = {
  item_id: string;
  item_sku: string;
  item_name: string;
  mode: "exempt" | "markup_pct" | "discount_pct";
  pct: number;
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
  category_overrides: { category_id: string; mode: "exempt" | "markup_pct" | "discount_pct"; pct: number }[];
  item_overrides: ItemOverrideRow[];
  is_active: boolean;
  last_run_at?: string | null;
  last_run_summary?: unknown;
};

function pctNum(v: string | number | null | undefined) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

/* -------------------------------------------------------------------------- */
/*  Category Overrides                                                        */
/* -------------------------------------------------------------------------- */

type Override = { category_id: string; mode: "exempt" | "markup_pct" | "discount_pct"; pct: number };

function CategoryOverrides({
  categories,
  value,
  onChange,
}: {
  categories: CategoryRow[];
  value: Override[];
  onChange: (v: Override[]) => void;
}) {
  const usedIds = new Set(value.map((o) => o.category_id));
  const available = categories.filter((c) => c.is_active && !usedIds.has(c.id));
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  function addRow() {
    if (available.length === 0) return;
    onChange([...value, { category_id: available[0].id, mode: "exempt", pct: 0 }]);
  }

  function updateRow(idx: number, patch: Partial<Override>) {
    const next = value.map((o, i) => (i === idx ? { ...o, ...patch } : o));
    onChange(next);
  }

  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      {value.map((ov, idx) => (
        <div key={idx} className="flex items-center gap-2">
          {/* Category picker */}
          <Select value={ov.category_id} onValueChange={(v) => updateRow(idx, { category_id: v })}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              {categories.filter((c) => c.is_active && (c.id === ov.category_id || !usedIds.has(c.id))).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Mode */}
          <Select value={ov.mode} onValueChange={(v) => updateRow(idx, { mode: v as Override["mode"], pct: v === "exempt" ? 0 : ov.pct })}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="exempt">Exempt</SelectItem>
              <SelectItem value="markup_pct">Markup (%)</SelectItem>
              <SelectItem value="discount_pct">Discount (%)</SelectItem>
            </SelectContent>
          </Select>
          {/* Pct input (only when not exempt) */}
          {ov.mode !== "exempt" ? (
            <Input
              className="w-[90px]"
              value={ov.pct}
              onChange={(e) => updateRow(idx, { pct: Number(e.target.value) || 0 })}
              placeholder="0.05"
              inputMode="decimal"
            />
          ) : (
            <div className="w-[90px]" />
          )}
          {/* Remove */}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeRow(idx)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={available.length === 0}>
        <Plus className="mr-1 h-3 w-3" /> Add Override
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Item Overrides                                                            */
/* -------------------------------------------------------------------------- */

function ItemOverrides({
  value,
  onChange,
}: {
  value: ItemOverrideRow[];
  onChange: (v: ItemOverrideRow[]) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; sku: string; name: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const usedIds = new Set(value.map((o) => o.item_id));

  // Debounced server-side search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<{ items: { id: string; sku: string; name: string }[] }>(
          `/items/typeahead?q=${encodeURIComponent(searchQuery.trim())}&limit=20`
        );
        setSearchResults(res.items || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const searchOptions: SearchableSelectOption[] = useMemo(
    () =>
      searchResults
        .filter((r) => !usedIds.has(r.id))
        .map((r) => ({ value: r.id, label: `${r.sku} — ${r.name}`, keywords: r.sku })),
    [searchResults, usedIds]
  );

  function addItem(itemId: string) {
    const found = searchResults.find((r) => r.id === itemId);
    if (!found) return;
    onChange([...value, { item_id: found.id, item_sku: found.sku, item_name: found.name, mode: "exempt", pct: 0 }]);
  }

  function updateRow(idx: number, patch: Partial<ItemOverrideRow>) {
    const next = value.map((o, i) => (i === idx ? { ...o, ...patch } : o));
    onChange(next);
  }

  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      {value.map((ov, idx) => (
        <div key={ov.item_id} className="flex items-center gap-2">
          {/* Item label */}
          <div className="w-[200px] truncate text-sm" title={`${ov.item_sku} — ${ov.item_name}`}>
            <span className="font-mono text-xs font-medium">{ov.item_sku}</span>
            <span className="ml-1 text-xs text-muted-foreground">{ov.item_name}</span>
          </div>
          {/* Mode */}
          <Select value={ov.mode} onValueChange={(v) => updateRow(idx, { mode: v as ItemOverrideRow["mode"], pct: v === "exempt" ? 0 : ov.pct })}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="exempt">Exempt</SelectItem>
              <SelectItem value="markup_pct">Markup (%)</SelectItem>
              <SelectItem value="discount_pct">Discount (%)</SelectItem>
            </SelectContent>
          </Select>
          {/* Pct input (only when not exempt) */}
          {ov.mode !== "exempt" ? (
            <Input
              className="w-[90px]"
              value={ov.pct}
              onChange={(e) => updateRow(idx, { pct: Number(e.target.value) || 0 })}
              placeholder="0.05"
              inputMode="decimal"
            />
          ) : (
            <div className="w-[90px]" />
          )}
          {/* Remove */}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeRow(idx)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {/* Add item via search */}
      <div className="max-w-[360px]">
        <SearchableSelect
          value=""
          onChange={addItem}
          options={searchOptions}
          placeholder="Search items to add..."
          searchPlaceholder="Type SKU or name..."
          loading={searchLoading}
          onSearchQueryChange={setSearchQuery}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function PriceRulesPage() {
  const [lists, setLists] = useState<PriceListRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
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
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [itemOverrides, setItemOverrides] = useState<ItemOverrideRow[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  /* ---- Run summary ---- */
  const [runSummary, setRunSummary] = useState<{
    applied: number;
    base_price_rows: number;
    prepared: number;
    missing_base: number;
    missing_cost: number;
    adjusted_or_blocked_by_margin: number;
    skipped_exempt: number;
    orphans_removed: number;
    effective_from: string;
  } | null>(null);

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
  const [editOverrides, setEditOverrides] = useState<Override[]>([]);
  const [editItemOverrides, setEditItemOverrides] = useState<ItemOverrideRow[]>([]);
  const [editAdvancedOpen, setEditAdvancedOpen] = useState(false);

  /* ---- Load ---- */
  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [pl, dr, cats] = await Promise.all([
        apiGet<{ lists: PriceListRow[] }>("/pricing/lists"),
        apiGet<{ derivations: DerivationRow[] }>("/pricing/derivations"),
        apiGet<{ categories: CategoryRow[] }>("/item-categories"),
      ]);
      setLists(pl.lists || []);
      setRows(dr.derivations || []);
      setCategories(cats.categories || []);
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
    setRunSummary(null);
    try {
      const res = await apiPost<{ ok: boolean; summary: typeof runSummary }>(`/pricing/derivations/${encodeURIComponent(ruleId)}/run`, {});
      setRunSummary(res.summary ?? null);
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

  const deleteRule = useCallback(async (ruleId: string) => {
    if (!confirm("Are you sure you want to delete this price rule? This cannot be undone.")) return;
    setBusy(true);
    setErr(null);
    try {
      await apiDelete(`/pricing/derivations/${encodeURIComponent(ruleId)}`);
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
        category_overrides: overrides,
        item_overrides: itemOverrides,
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
      setOverrides([]);
      setItemOverrides([]);
      setAdvancedOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ---- Edit ---- */
  const openEdit = useCallback((rule: DerivationRow) => {
    setEditId(rule.id);
    setEditMode(rule.mode);
    setEditPct(String(pctNum(rule.pct)));
    setEditUsdStep(String(rule.usd_round_step ?? "0.01"));
    setEditLbpStep(String(rule.lbp_round_step ?? "0"));
    setEditMinMargin(rule.min_margin_pct == null ? "" : String(pctNum(rule.min_margin_pct)));
    setEditSkipIfCostMissing(rule.skip_if_cost_missing);
    setEditActive(rule.is_active);
    setEditOverrides((rule.category_overrides || []).map((o) => ({
      category_id: o.category_id,
      mode: o.mode,
      pct: Number(o.pct || 0),
    })));
    setEditItemOverrides((rule.item_overrides || []).map((o) => ({
      item_id: o.item_id,
      item_sku: o.item_sku,
      item_name: o.item_name,
      mode: o.mode,
      pct: Number(o.pct || 0),
    })));
    setEditAdvancedOpen((rule.category_overrides || []).length > 0 || (rule.item_overrides || []).length > 0);
    setEditOpen(true);
  }, []);

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
        category_overrides: editOverrides,
        item_overrides: editItemOverrides,
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
      accessorFn: (r) => (r.category_overrides || []).length + (r.item_overrides || []).length,
      id: "overrides",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Overrides" />,
      cell: ({ row }) => {
        const catOvs = row.original.category_overrides || [];
        const itemOvs = row.original.item_overrides || [];
        const total = catOvs.length + itemOvs.length;
        if (total === 0) return <span className="text-xs text-muted-foreground">-</span>;
        const labels: string[] = [];
        for (const o of catOvs) {
          const name = categories.find((c) => c.id === o.category_id)?.name || o.category_id.slice(0, 6);
          if (o.mode === "exempt") labels.push(`${name} exempt`);
          else {
            const sign = o.mode === "markup_pct" ? "+" : "-";
            labels.push(`${name} ${sign}${(Number(o.pct || 0) * 100).toFixed(1)}%`);
          }
        }
        for (const o of itemOvs) {
          const name = o.item_sku || o.item_id.slice(0, 6);
          if (o.mode === "exempt") labels.push(`${name} exempt`);
          else {
            const sign = o.mode === "markup_pct" ? "+" : "-";
            labels.push(`${name} ${sign}${(Number(o.pct || 0) * 100).toFixed(1)}%`);
          }
        }
        return (
          <span className="text-xs text-muted-foreground" title={labels.join(", ")}>
            {labels.length <= 2 ? labels.join(", ") : `${total} overrides`}
          </span>
        );
      },
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
      cell: ({ row }) => {
        const r = row.original;
        const s = r.last_run_summary as { applied?: number; base_price_rows?: number } | null | undefined;
        return (
          <div>
            <span className="text-xs text-muted-foreground">{formatDateLike(r.last_run_at, "-")}</span>
            {s && typeof s.applied === "number" && (
              <p className="text-xs text-muted-foreground">
                {s.applied}/{s.base_price_rows ?? "?"} applied
              </p>
            )}
          </div>
        );
      },
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => deleteRule(r.id)}
              disabled={busy}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1 h-3 w-3" /> Delete
            </Button>
          </div>
        );
      },
    },
  ], [busy, runRule, toggleActive, deleteRule, openEdit, categories]);

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
                  <div className="flex items-center gap-3">
                    <Switch checked={active} onCheckedChange={setActive} />
                    <Label>Active</Label>
                  </div>
                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" type="button" className="w-full justify-between px-0">
                        <span className="text-sm font-medium">Advanced Options</span>
                        <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <Label>Category Overrides</Label>
                        <p className="text-xs text-muted-foreground">Customize pricing for specific categories (exempt, custom markup, or custom discount).</p>
                        <CategoryOverrides categories={categories} value={overrides} onChange={setOverrides} />
                      </div>
                      <div className="space-y-2">
                        <Label>Item Overrides</Label>
                        <p className="text-xs text-muted-foreground">Override pricing for specific items (takes priority over category overrides).</p>
                        <ItemOverrides value={itemOverrides} onChange={setItemOverrides} />
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch checked={skipIfCostMissing} onCheckedChange={setSkipIfCostMissing} />
                        <Label>Skip / hold discount when cost is missing</Label>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
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

      {runSummary && (
        <Alert variant={runSummary.applied > 0 ? "default" : "destructive"}>
          <AlertDescription>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <p className="font-medium">
                  {runSummary.applied > 0
                    ? `✓ Applied ${runSummary.applied} price${runSummary.applied !== 1 ? "s" : ""} (effective ${runSummary.effective_from})`
                    : "No prices were applied."}
                </p>
                <p className="text-xs text-muted-foreground">
                  {runSummary.base_price_rows} base price{runSummary.base_price_rows !== 1 ? "s" : ""} found
                  {runSummary.missing_base > 0 && ` · ${runSummary.missing_base} skipped (zero price)`}
                  {runSummary.skipped_exempt > 0 && ` · ${runSummary.skipped_exempt} exempt`}
                  {runSummary.orphans_removed > 0 && ` · ${runSummary.orphans_removed} orphaned removed`}
                  {runSummary.missing_cost > 0 && ` · ${runSummary.missing_cost} missing cost`}
                  {runSummary.adjusted_or_blocked_by_margin > 0 && ` · ${runSummary.adjusted_or_blocked_by_margin} blocked/adjusted by margin`}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setRunSummary(null)}>Dismiss</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

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
            <div className="flex items-center gap-3">
              <Switch checked={editActive} onCheckedChange={setEditActive} />
              <Label>Active</Label>
            </div>
            <Collapsible open={editAdvancedOpen} onOpenChange={setEditAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" type="button" className="w-full justify-between px-0">
                  <span className="text-sm font-medium">Advanced Options</span>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", editAdvancedOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Category Overrides</Label>
                  <p className="text-xs text-muted-foreground">Customize pricing for specific categories (exempt, custom markup, or custom discount).</p>
                  <CategoryOverrides categories={categories} value={editOverrides} onChange={setEditOverrides} />
                </div>
                <div className="space-y-2">
                  <Label>Item Overrides</Label>
                  <p className="text-xs text-muted-foreground">Override pricing for specific items (takes priority over category overrides).</p>
                  <ItemOverrides value={editItemOverrides} onChange={setEditItemOverrides} />
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={editSkipIfCostMissing} onCheckedChange={setEditSkipIfCostMissing} />
                  <Label>Skip / hold discount when cost is missing</Label>
                </div>
              </CollapsibleContent>
            </Collapsible>
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
