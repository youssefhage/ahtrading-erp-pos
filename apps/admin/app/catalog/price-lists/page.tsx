"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, RefreshCw, ListOrdered, Star, Pencil, X, Check, Percent, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { EmptyState } from "@/components/business/empty-state";
import { ConfirmDialog } from "@/components/business/confirm-dialog";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type ItemRow = { id: string; sku: string; name: string; barcode: string | null; all_barcodes?: string };

type PriceListRow = {
  id: string;
  code: string;
  name: string;
  currency: "USD" | "LBP";
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

type PriceListItemRow = {
  id: string;
  item_id: string;
  price_usd: string | number;
  price_lbp: string | number;
  cost_usd: string | number;
  cost_lbp: string | number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function PriceListsPage() {
  const sp = useSearchParams();
  const [lists, setLists] = useState<PriceListRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const openedFromQueryRef = useRef(false);

  /* ---- Create list ---- */
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [isDefault, setIsDefault] = useState(false);
  const [creating, setCreating] = useState(false);

  /* ---- Edit list ---- */
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editCurrency, setEditCurrency] = useState<"USD" | "LBP">("USD");
  const [editDefault, setEditDefault] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  /* ---- List items dialog ---- */
  const [itemsOpen, setItemsOpen] = useState(false);
  const [itemsListId, setItemsListId] = useState("");
  const [listItems, setListItems] = useState<PriceListItemRow[]>([]);
  const [addSku, setAddSku] = useState("");
  const [addItemId, setAddItemId] = useState<string>("");
  const [addEffectiveFrom, setAddEffectiveFrom] = useState(todayIso());
  const [addEffectiveTo, setAddEffectiveTo] = useState("");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");
  const [addCostUsd, setAddCostUsd] = useState("");
  const [addCostLbp, setAddCostLbp] = useState("");
  const [adding, setAdding] = useState(false);

  /* ---- Edit price row ---- */
  const [editItemOpen, setEditItemOpen] = useState(false);
  const [editRowId, setEditRowId] = useState("");
  const [editEffectiveFrom, setEditEffectiveFrom] = useState(todayIso());
  const [editEffectiveTo, setEditEffectiveTo] = useState("");
  const [editUsd, setEditUsd] = useState("");
  const [editLbp, setEditLbp] = useState("");
  const [editCostUsd, setEditCostUsd] = useState("");
  const [editCostLbp, setEditCostLbp] = useState("");
  const [editItemSaving, setEditItemSaving] = useState(false);

  /* ---- Bulk edit mode ---- */
  const [editMode, setEditMode] = useState(false);
  const [dirtyPrices, setDirtyPrices] = useState<Map<string, { price_usd?: string; price_lbp?: string; cost_usd?: string; cost_lbp?: string }>>(new Map());
  const [batchSaving, setBatchSaving] = useState(false);

  /* ---- Multi-select & quick actions ---- */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"markup" | "discount" | "fixed" | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkField, setBulkField] = useState<"both" | "usd" | "lbp">("both");

  /* ---- Lookups ---- */
  const itemBySku = useMemo(() => {
    const m = new Map<string, ItemRow>();
    for (const it of items) m.set((it.sku || "").toUpperCase(), it);
    return m;
  }, [items]);

  const itemById = useMemo(() => {
    const m = new Map<string, ItemRow>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  /* ---- Load ---- */
  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [pl, it] = await Promise.all([
        apiGet<{ lists: PriceListRow[] }>("/pricing/lists"),
        apiGet<{ items: ItemRow[] }>("/items/min"),
      ]);
      setLists(pl.lists || []);
      setItems(it.items || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ---- Deep-link: /catalog/price-lists?open=<list_id> ---- */
  useEffect(() => {
    if (openedFromQueryRef.current) return;
    const openId = (sp?.get("open") || "").trim();
    if (!openId) return;
    if (!lists.length || !items.length) return;
    const exists = lists.some((l) => l.id === openId);
    if (!exists) return;
    openedFromQueryRef.current = true;
    openListItems(openId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, lists, items]);

  /* ---- List CRUD ---- */
  async function createList(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setErr("Code is required.");
    if (!name.trim()) return setErr("Name is required.");
    setCreating(true);
    setErr(null);
    try {
      const res = await apiPost<{ id: string }>("/pricing/lists", {
        code: code.trim(),
        name: name.trim(),
        currency,
        is_default: isDefault,
      });
      if (isDefault) {
        await apiPost("/pricing/company-settings", { key: "default_price_list_id", value_json: { id: res.id } });
      }
      setCreateOpen(false);
      setCode("");
      setName("");
      setCurrency("USD");
      setIsDefault(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const openEdit = useCallback((list: PriceListRow) => {
    setEditId(list.id);
    setEditName(list.name);
    setEditCurrency(list.currency);
    setEditDefault(!!list.is_default);
    setEditOpen(true);
  }, []);

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    if (!editName.trim()) return setErr("Name is required.");
    setEditSaving(true);
    setErr(null);
    try {
      await apiPatch(`/pricing/lists/${encodeURIComponent(editId)}`, { name: editName.trim(), currency: editCurrency, is_default: editDefault });
      if (editDefault) {
        await apiPost("/pricing/company-settings", { key: "default_price_list_id", value_json: { id: editId } });
      }
      setEditOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEditSaving(false);
    }
  }

  const setDefaultList = useCallback(async (listId: string) => {
    setErr(null);
    try {
      await apiPatch(`/pricing/lists/${encodeURIComponent(listId)}`, { is_default: true });
      await apiPost("/pricing/company-settings", { key: "default_price_list_id", value_json: { id: listId } });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  /* ---- List items ---- */
  const openListItems = useCallback(async (listId: string) => {
    setItemsListId(listId);
    setListItems([]);
    setAddSku("");
    setAddItemId("");
    setAddEffectiveFrom(todayIso());
    setAddEffectiveTo("");
    setAddUsd("");
    setAddLbp("");
    setAddCostUsd("");
    setAddCostLbp("");
    setItemsOpen(true);
    try {
      const res = await apiGet<{ items: PriceListItemRow[] }>(`/pricing/lists/${encodeURIComponent(listId)}/items?page_size=5000`);
      setListItems(res.items || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  function onSkuChange(nextSku: string) {
    const normalized = (nextSku || "").trim().toUpperCase();
    setAddSku(normalized);
    const it = itemBySku.get(normalized);
    setAddItemId(it?.id || "");
  }

  async function addPrice(e: React.FormEvent) {
    e.preventDefault();
    if (!itemsListId) return;
    if (!addItemId) return setErr("Pick a valid SKU / item.");
    if (!addEffectiveFrom) return setErr("Effective from date is required.");
    setAdding(true);
    setErr(null);
    try {
      await apiPost(`/pricing/lists/${encodeURIComponent(itemsListId)}/items`, {
        item_id: addItemId,
        price_usd: Number(addUsd || 0),
        price_lbp: Number(addLbp || 0),
        cost_usd: Number(addCostUsd || 0),
        cost_lbp: Number(addCostLbp || 0),
        effective_from: addEffectiveFrom,
        effective_to: addEffectiveTo ? addEffectiveTo : null,
      });
      const res = await apiGet<{ items: PriceListItemRow[] }>(`/pricing/lists/${encodeURIComponent(itemsListId)}/items?page_size=5000`);
      setListItems(res.items || []);
      setAddSku("");
      setAddItemId("");
      setAddUsd("");
      setAddLbp("");
      setAddCostUsd("");
      setAddCostLbp("");
      setAddEffectiveFrom(todayIso());
      setAddEffectiveTo("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  async function saveEditRow(e: React.FormEvent) {
    e.preventDefault();
    if (!itemsListId || !editRowId) return;
    if (!editEffectiveFrom) return setErr("Effective from date is required.");
    setEditItemSaving(true);
    setErr(null);
    try {
      await apiPatch(`/pricing/lists/${encodeURIComponent(itemsListId)}/items/${encodeURIComponent(editRowId)}`, {
        price_usd: Number(editUsd || 0),
        price_lbp: Number(editLbp || 0),
        cost_usd: Number(editCostUsd || 0),
        cost_lbp: Number(editCostLbp || 0),
        effective_from: editEffectiveFrom,
        effective_to: editEffectiveTo ? editEffectiveTo : null,
      });
      const res = await apiGet<{ items: PriceListItemRow[] }>(`/pricing/lists/${encodeURIComponent(itemsListId)}/items?page_size=5000`);
      setListItems(res.items || []);
      setEditItemOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEditItemSaving(false);
    }
  }

  function toggleEditMode() {
    if (editMode) {
      setEditMode(false);
      setDirtyPrices(new Map());
      setSelectedIds(new Set());
      setBulkAction(null);
    } else {
      setEditMode(true);
    }
  }

  function setDirtyField(rowId: string, field: "price_usd" | "price_lbp" | "cost_usd" | "cost_lbp", value: string) {
    setDirtyPrices((prev) => {
      const next = new Map(prev);
      const existing = next.get(rowId) || {};
      next.set(rowId, { ...existing, [field]: value });
      return next;
    });
  }

  async function saveBatch() {
    if (!itemsListId || dirtyPrices.size === 0) return;
    setBatchSaving(true);
    setErr(null);
    try {
      const updates = Array.from(dirtyPrices.entries()).map(([id, vals]) => ({
        id,
        ...(vals.price_usd !== undefined ? { price_usd: Number(vals.price_usd || 0) } : {}),
        ...(vals.price_lbp !== undefined ? { price_lbp: Number(vals.price_lbp || 0) } : {}),
        ...(vals.cost_usd !== undefined ? { cost_usd: Number(vals.cost_usd || 0) } : {}),
        ...(vals.cost_lbp !== undefined ? { cost_lbp: Number(vals.cost_lbp || 0) } : {}),
      }));
      await apiPost(`/pricing/lists/${encodeURIComponent(itemsListId)}/items/batch-update`, { updates });
      const res = await apiGet<{ items: PriceListItemRow[] }>(`/pricing/lists/${itemsListId}/items?page_size=5000`);
      setListItems(res.items || []);
      setEditMode(false);
      setDirtyPrices(new Map());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchSaving(false);
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, col: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(`input[data-row="${rowIndex + 1}"][data-col="${col}"]`);
      next?.focus();
    }
  }

  /* ---- Multi-select helpers ---- */
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(listItems.map((li) => li.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  /** Apply a bulk price operation to all selected items */
  function applyBulkAction() {
    const pct = parseFloat(bulkValue);
    if (isNaN(pct) || pct === 0) return;

    setDirtyPrices((prev) => {
      const next = new Map(prev);
      for (const li of listItems) {
        if (!selectedIds.has(li.id)) continue;
        const existing = next.get(li.id) || {};
        const curUsd = existing.price_usd !== undefined ? Number(existing.price_usd) : Number(li.price_usd || 0);
        const curLbp = existing.price_lbp !== undefined ? Number(existing.price_lbp) : Number(li.price_lbp || 0);

        let newUsd = curUsd;
        let newLbp = curLbp;

        if (bulkAction === "markup") {
          if (bulkField !== "lbp") newUsd = curUsd * (1 + pct / 100);
          if (bulkField !== "usd") newLbp = curLbp * (1 + pct / 100);
        } else if (bulkAction === "discount") {
          if (bulkField !== "lbp") newUsd = curUsd * (1 - pct / 100);
          if (bulkField !== "usd") newLbp = curLbp * (1 - pct / 100);
        } else if (bulkAction === "fixed") {
          if (bulkField !== "lbp") newUsd = curUsd + pct;
          if (bulkField !== "usd") newLbp = curLbp + pct;
        }

        // Round: USD to 2 decimals, LBP to 0
        newUsd = Math.round(newUsd * 100) / 100;
        newLbp = Math.round(newLbp);

        // Don't go below 0
        if (newUsd < 0) newUsd = 0;
        if (newLbp < 0) newLbp = 0;

        const updates: { price_usd?: string; price_lbp?: string } = {};
        if (bulkField !== "lbp") updates.price_usd = String(newUsd);
        if (bulkField !== "usd") updates.price_lbp = String(newLbp);

        next.set(li.id, { ...existing, ...updates });
      }
      return next;
    });

    setBulkAction(null);
    setBulkValue("");
  }

  /* ---- Columns: price lists ---- */
  const listColumns = useMemo<ColumnDef<PriceListRow>[]>(() => [
    {
      accessorKey: "code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "currency",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Currency" />,
      cell: ({ row }) => <Badge variant="outline">{row.original.currency}</Badge>,
    },
    {
      accessorFn: (r) => (r.is_default ? "default" : ""),
      id: "is_default",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Default" />,
      cell: ({ row }) =>
        row.original.is_default ? (
          <Badge variant="default" className="gap-1">
            <Star className="h-3 w-3" /> Default
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const pl = row.original;
        return (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => openListItems(pl.id)}>
              Items
            </Button>
            <Button variant="outline" size="sm" onClick={() => openEdit(pl)}>
              Edit
            </Button>
            {!pl.is_default ? (
              <Button variant="ghost" size="sm" onClick={() => setDefaultList(pl.id)}>
                Set Default
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ], [openEdit, openListItems, setDefaultList]);

  /* ---- Columns: list items ---- */
  const listItemColumns = useMemo<ColumnDef<PriceListItemRow>[]>(() => [
    ...(editMode ? [{
      id: "select",
      header: () => (
        <Checkbox
          checked={listItems.length > 0 && selectedIds.size === listItems.length}
          onCheckedChange={(checked) => checked ? selectAll() : deselectAll()}
          aria-label="Select all"
        />
      ),
      cell: ({ row }: { row: any }) => (
        <Checkbox
          checked={selectedIds.has(row.original.id)}
          onCheckedChange={() => toggleSelect(row.original.id)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    } as ColumnDef<PriceListItemRow>] : []),
    {
      accessorFn: (li) => itemById.get(li.item_id)?.sku || "",
      id: "sku",
      header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
      cell: ({ row }) => {
        const it = itemById.get(row.original.item_id);
        return (
          <Link href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`} className="font-mono text-xs text-primary hover:underline">
            {it?.sku || "-"}
          </Link>
        );
      },
    },
    {
      accessorFn: (li) => {
        const it = itemById.get(li.item_id);
        // Include barcode data in accessor so global filter can search by barcode
        return [it?.name || li.item_id, it?.barcode || "", it?.all_barcodes || ""].join(" ");
      },
      id: "item",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => {
        const it = itemById.get(row.original.item_id);
        return (
          <Link href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`} className="font-medium text-primary hover:underline">
            {it?.name || row.original.item_id}
          </Link>
        );
      },
      sortingFn: (rowA, rowB) => {
        const a = itemById.get(rowA.original.item_id)?.name || "";
        const b = itemById.get(rowB.original.item_id)?.name || "";
        return a.localeCompare(b);
      },
    },
    {
      accessorFn: (li) => Number(li.price_usd || 0),
      id: "price_usd",
      header: ({ column }) => <DataTableColumnHeader column={column} title="USD" />,
      cell: ({ row }) => {
        if (!editMode) return <span className="font-mono text-xs">{row.original.price_usd}</span>;
        const dirty = dirtyPrices.get(row.original.id);
        const val = dirty?.price_usd ?? String(row.original.price_usd ?? "");
        const orig = String(row.original.price_usd ?? "");
        const changed = dirty?.price_usd !== undefined && dirty.price_usd !== orig;
        return (
          <div className="flex flex-col gap-0.5">
            <Input
              className={`h-7 w-28 font-mono text-xs ${changed ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20" : ""}`}
              value={val}
              onChange={(e) => setDirtyField(row.original.id, "price_usd", e.target.value)}
              onKeyDown={(e) => handleEditKeyDown(e, row.index, "usd")}
              data-row={row.index}
              data-col="usd"
              inputMode="decimal"
            />
            {changed && (
              <span className="font-mono text-[10px] text-muted-foreground line-through">{orig}</span>
            )}
          </div>
        );
      },
    },
    {
      accessorFn: (li) => Number(li.price_lbp || 0),
      id: "price_lbp",
      header: ({ column }) => <DataTableColumnHeader column={column} title="LBP" />,
      cell: ({ row }) => {
        if (!editMode) return <span className="font-mono text-xs">{row.original.price_lbp}</span>;
        const dirty = dirtyPrices.get(row.original.id);
        const val = dirty?.price_lbp ?? String(row.original.price_lbp ?? "");
        const orig = String(row.original.price_lbp ?? "");
        const changed = dirty?.price_lbp !== undefined && dirty.price_lbp !== orig;
        return (
          <div className="flex flex-col gap-0.5">
            <Input
              className={`h-7 w-28 font-mono text-xs ${changed ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20" : ""}`}
              value={val}
              onChange={(e) => setDirtyField(row.original.id, "price_lbp", e.target.value)}
              onKeyDown={(e) => handleEditKeyDown(e, row.index, "lbp")}
              data-row={row.index}
              data-col="lbp"
              inputMode="decimal"
            />
            {changed && (
              <span className="font-mono text-[10px] text-muted-foreground line-through">{orig}</span>
            )}
          </div>
        );
      },
    },
    {
      accessorFn: (li) => Number(li.cost_usd || 0),
      id: "cost_usd",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cost $" />,
      cell: ({ row }) => {
        const v = Number(row.original.cost_usd || 0);
        if (!editMode) return <span className="font-mono text-xs text-muted-foreground">{v > 0 ? v : "-"}</span>;
        const dirty = dirtyPrices.get(row.original.id);
        const val = dirty?.cost_usd ?? String(row.original.cost_usd ?? "");
        return (
          <Input
            className="h-7 w-24 font-mono text-xs"
            value={val}
            onChange={(e) => setDirtyField(row.original.id, "cost_usd", e.target.value)}
            onKeyDown={(e) => handleEditKeyDown(e, row.index, "cost_usd")}
            data-row={row.index}
            data-col="cost_usd"
            inputMode="decimal"
          />
        );
      },
    },
    {
      accessorFn: (li) => Number(li.cost_lbp || 0),
      id: "cost_lbp",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cost L" />,
      cell: ({ row }) => {
        const v = Number(row.original.cost_lbp || 0);
        if (!editMode) return <span className="font-mono text-xs text-muted-foreground">{v > 0 ? v : "-"}</span>;
        const dirty = dirtyPrices.get(row.original.id);
        const val = dirty?.cost_lbp ?? String(row.original.cost_lbp ?? "");
        return (
          <Input
            className="h-7 w-24 font-mono text-xs"
            value={val}
            onChange={(e) => setDirtyField(row.original.id, "cost_lbp", e.target.value)}
            onKeyDown={(e) => handleEditKeyDown(e, row.index, "cost_lbp")}
            data-row={row.index}
            data-col="cost_lbp"
            inputMode="decimal"
          />
        );
      },
    },
    {
      id: "margin",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Margin" />,
      cell: ({ row }) => {
        const price = Number(row.original.price_usd || 0);
        const cost = Number(row.original.cost_usd || 0);
        if (price <= 0 || cost <= 0) return <span className="text-xs text-muted-foreground">-</span>;
        const m = ((price - cost) / price) * 100;
        const color = m >= 30 ? "text-emerald-600" : m >= 15 ? "text-amber-600" : "text-red-600";
        return <span className={`font-mono text-xs font-medium ${color}`}>{m.toFixed(1)}%</span>;
      },
    },
    {
      accessorKey: "effective_from",
      header: ({ column }) => <DataTableColumnHeader column={column} title="From" />,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.effective_from}</span>,
    },
    {
      accessorFn: (li) => li.effective_to || "",
      id: "effective_to",
      header: ({ column }) => <DataTableColumnHeader column={column} title="To" />,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.effective_to || "-"}</span>,
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        if (editMode) return null;
        const li = row.original;
        return (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditRowId(li.id);
                setEditEffectiveFrom(li.effective_from || todayIso());
                setEditEffectiveTo(li.effective_to || "");
                setEditUsd(String(li.price_usd ?? ""));
                setEditLbp(String(li.price_lbp ?? ""));
                setEditCostUsd(String(li.cost_usd ?? ""));
                setEditCostLbp(String(li.cost_lbp ?? ""));
                setEditItemOpen(true);
              }}
            >
              Edit
            </Button>
            <ConfirmDialog
              title="Delete Price Row?"
              description="This removes the history row. This action cannot be undone."
              confirmLabel="Delete"
              variant="destructive"
              onConfirm={async () => {
                if (!itemsListId) return;
                await apiDelete(`/pricing/lists/${encodeURIComponent(itemsListId)}/items/${encodeURIComponent(li.id)}`);
                const res = await apiGet<{ items: PriceListItemRow[] }>(`/pricing/lists/${encodeURIComponent(itemsListId)}/items?page_size=5000`);
                setListItems(res.items || []);
              }}
              trigger={
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                  Delete
                </Button>
              }
            />
          </div>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [itemById, itemsListId, editMode, dirtyPrices, selectedIds, listItems]);

  const currentList = lists.find((l) => l.id === itemsListId);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title="Price Lists"
        description={`${lists.length} price list${lists.length === 1 ? "" : "s"}`}
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) { setCode(""); setName(""); setCurrency("USD"); setIsDefault(false); } }}>
              <DialogTrigger asChild>
                <Button><Plus className="mr-2 h-4 w-4" /> New List</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create Price List</DialogTitle>
                  <DialogDescription>Override default item prices. The POS catalog uses the default list.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createList} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Code <span className="text-destructive">*</span></Label>
                      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="WHOLESALE" />
                    </div>
                    <div className="space-y-2">
                      <Label>Currency</Label>
                      <Select value={currency} onValueChange={(v) => setCurrency(v as "USD" | "LBP")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="LBP">LBP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Name <span className="text-destructive">*</span></Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wholesale USD" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={isDefault} onCheckedChange={setIsDefault} />
                    <Label>Set as default (used by POS)</Label>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={creating}>
                      {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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

      {!loading && lists.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={ListOrdered}
              title="No price lists yet"
              description="Create a price list to override default item prices."
              action={{ label: "New List", onClick: () => setCreateOpen(true) }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Lists</CardTitle>
            <CardDescription>Click Items to manage prices for a list.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={listColumns}
              data={lists}
              isLoading={loading}
              searchPlaceholder="Search code / name..."
              pageSize={25}
            />
          </CardContent>
        </Card>
      )}

      {/* ---- Edit List Dialog ---- */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Price List</DialogTitle>
            <DialogDescription>Default lists are used by POS catalog pricing.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={editCurrency} onValueChange={(v) => setEditCurrency(v as "USD" | "LBP")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="LBP">LBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={editDefault} onCheckedChange={setEditDefault} />
              <Label>Set as default (POS)</Label>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={editSaving}>
                {editSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---- List Items Dialog (full-width) ---- */}
      <Dialog open={itemsOpen} onOpenChange={(o) => { setItemsOpen(o); if (!o) { setEditMode(false); setDirtyPrices(new Map()); setSelectedIds(new Set()); setBulkAction(null); } }}>
        <DialogContent className="w-[96vw] max-w-[1400px] h-[92vh] overflow-hidden p-0">
          <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6 pr-12">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <DialogTitle>
                    Price List Items
                    {currentList ? (
                      <Badge variant="outline" className="ml-3 font-mono text-xs">
                        {currentList.code} -- {currentList.name}
                      </Badge>
                    ) : null}
                  </DialogTitle>
                  <DialogDescription>Most recent effective price wins for each item.</DialogDescription>
                </div>
                <Button
                  variant={editMode ? "default" : "outline"}
                  size="sm"
                  onClick={toggleEditMode}
                  className="shrink-0"
                >
                  {editMode ? <><X className="mr-1.5 h-3.5 w-3.5" /> Exit Edit</> : <><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit Prices</>}
                </Button>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              {/* Quick Actions bar (edit mode) */}
              {editMode && (
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2.5">
                  <span className="mr-1 text-sm font-medium text-muted-foreground">
                    {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select items to apply bulk changes"}
                  </span>

                  {selectedIds.size > 0 && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={deselectAll}>
                      Clear
                    </Button>
                  )}

                  <div className="mx-1 h-5 w-px bg-border" />

                  {/* Markup % */}
                  <Popover open={bulkAction === "markup"} onOpenChange={(o) => { setBulkAction(o ? "markup" : null); setBulkValue(""); }}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={selectedIds.size === 0}>
                        <TrendingUp className="h-3.5 w-3.5" /> Markup %
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72" align="start">
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Markup by percentage</p>
                        <p className="text-xs text-muted-foreground">Increase prices of {selectedIds.size} selected item{selectedIds.size === 1 ? "" : "s"}</p>
                        <div className="flex items-center gap-2">
                          <Input
                            value={bulkValue}
                            onChange={(e) => setBulkValue(e.target.value)}
                            placeholder="e.g. 10"
                            inputMode="decimal"
                            className="h-8"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBulkAction(); } }}
                          />
                          <span className="text-sm font-medium">%</span>
                        </div>
                        <div className="flex gap-1.5">
                          <Button variant={bulkField === "both" ? "default" : "outline"} size="sm" className="h-7 text-xs flex-1" onClick={() => setBulkField("both")}>Both</Button>
                          <Button variant={bulkField === "usd" ? "default" : "outline"} size="sm" className="h-7 text-xs flex-1" onClick={() => setBulkField("usd")}>USD only</Button>
                          <Button variant={bulkField === "lbp" ? "default" : "outline"} size="sm" className="h-7 text-xs flex-1" onClick={() => setBulkField("lbp")}>LBP only</Button>
                        </div>
                        <Button size="sm" className="w-full" onClick={applyBulkAction} disabled={!bulkValue || isNaN(parseFloat(bulkValue))}>
                          <Check className="mr-1.5 h-3.5 w-3.5" /> Apply Markup
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Discount % */}
                  <Popover open={bulkAction === "discount"} onOpenChange={(o) => { setBulkAction(o ? "discount" : null); setBulkValue(""); }}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={selectedIds.size === 0}>
                        <TrendingDown className="h-3.5 w-3.5" /> Discount %
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72" align="start">
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Discount by percentage</p>
                        <p className="text-xs text-muted-foreground">Decrease prices of {selectedIds.size} selected item{selectedIds.size === 1 ? "" : "s"}</p>
                        <div className="flex items-center gap-2">
                          <Input
                            value={bulkValue}
                            onChange={(e) => setBulkValue(e.target.value)}
                            placeholder="e.g. 5"
                            inputMode="decimal"
                            className="h-8"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBulkAction(); } }}
                          />
                          <span className="text-sm font-medium">%</span>
                        </div>
                        <div className="flex gap-1.5">
                          <Button variant={bulkField === "both" ? "default" : "outline"} size="sm" className="h-7 text-xs flex-1" onClick={() => setBulkField("both")}>Both</Button>
                          <Button variant={bulkField === "usd" ? "default" : "outline"} size="sm" className="h-7 text-xs flex-1" onClick={() => setBulkField("usd")}>USD only</Button>
                          <Button variant={bulkField === "lbp" ? "default" : "outline"} size="sm" className="h-7 text-xs flex-1" onClick={() => setBulkField("lbp")}>LBP only</Button>
                        </div>
                        <Button size="sm" className="w-full" onClick={applyBulkAction} disabled={!bulkValue || isNaN(parseFloat(bulkValue))}>
                          <Check className="mr-1.5 h-3.5 w-3.5" /> Apply Discount
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Fixed +/- */}
                  <Popover open={bulkAction === "fixed"} onOpenChange={(o) => { setBulkAction(o ? "fixed" : null); setBulkValue(""); }}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={selectedIds.size === 0}>
                        <DollarSign className="h-3.5 w-3.5" /> Fixed +/-
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72" align="start">
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Add / subtract fixed amount</p>
                        <p className="text-xs text-muted-foreground">Use negative for decrease (e.g. -2.50)</p>
                        <div className="flex items-center gap-2">
                          <Input
                            value={bulkValue}
                            onChange={(e) => setBulkValue(e.target.value)}
                            placeholder="e.g. 2.50 or -1.00"
                            inputMode="decimal"
                            className="h-8"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBulkAction(); } }}
                          />
                        </div>
                        <div className="flex gap-1.5">
                          <Button variant={bulkField === "both" ? "default" : "outline"} size="sm" className="h-7 text-xs flex-1" onClick={() => setBulkField("both")}>Both</Button>
                          <Button variant={bulkField === "usd" ? "default" : "outline"} size="sm" className="h-7 text-xs flex-1" onClick={() => setBulkField("usd")}>USD only</Button>
                          <Button variant={bulkField === "lbp" ? "default" : "outline"} size="sm" className="h-7 text-xs flex-1" onClick={() => setBulkField("lbp")}>LBP only</Button>
                        </div>
                        <Button size="sm" className="w-full" onClick={applyBulkAction} disabled={!bulkValue || isNaN(parseFloat(bulkValue))}>
                          <Check className="mr-1.5 h-3.5 w-3.5" /> Apply Change
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              <div className={editMode ? "" : "grid gap-6 xl:grid-cols-[minmax(0,2.2fr)_minmax(360px,1fr)]"}>
                {/* Table */}
                <div className="min-w-0">
                  <DataTable
                    columns={listItemColumns}
                    data={listItems}
                    searchPlaceholder="Search SKU / item / barcode..."
                    pageSize={25}
                  />
                </div>

                {/* Add price form (hidden in edit mode) */}
                {!editMode && (
                  <Card className="h-fit xl:sticky xl:top-0">
                    <CardHeader>
                      <CardTitle className="text-base">Add / Update Price</CardTitle>
                      <CardDescription>Insert a new row (history is preserved).</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form onSubmit={addPrice} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>SKU</Label>
                            <Input
                              value={addSku}
                              onChange={(e) => onSkuChange(e.target.value)}
                              placeholder="SKU"
                              list="skuList"
                            />
                            <datalist id="skuList">
                              {items.slice(0, 2000).map((it) => (
                                <option key={it.id} value={(it.sku || "").toUpperCase()}>
                                  {it.name}
                                </option>
                              ))}
                            </datalist>
                            {addItemId ? (
                              <p className="text-xs text-muted-foreground">
                                Item: {itemById.get(addItemId)?.name || addItemId}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">Pick a valid SKU.</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label>Effective From</Label>
                            <Input value={addEffectiveFrom} onChange={(e) => setAddEffectiveFrom(e.target.value)} type="date" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Price USD</Label>
                            <Input value={addUsd} onChange={(e) => setAddUsd(e.target.value)} placeholder="0.00" inputMode="decimal" />
                          </div>
                          <div className="space-y-2">
                            <Label>Price LBP</Label>
                            <Input value={addLbp} onChange={(e) => setAddLbp(e.target.value)} placeholder="0" inputMode="decimal" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Replacement Cost USD</Label>
                            <Input value={addCostUsd} onChange={(e) => setAddCostUsd(e.target.value)} placeholder="0.00" inputMode="decimal" />
                          </div>
                          <div className="space-y-2">
                            <Label>Replacement Cost LBP</Label>
                            <Input value={addCostLbp} onChange={(e) => setAddCostLbp(e.target.value)} placeholder="0" inputMode="decimal" />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Effective To (optional)</Label>
                          <Input value={addEffectiveTo} onChange={(e) => setAddEffectiveTo(e.target.value)} type="date" />
                        </div>
                        <div className="flex justify-end">
                          <Button type="submit" disabled={adding}>
                            {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Add Price Row
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* Sticky save bar for bulk edit */}
            {editMode && dirtyPrices.size > 0 && (
              <div className="shrink-0 border-t bg-muted/50 px-6 py-3 flex items-center justify-between">
                <span className="text-sm font-medium">
                  {dirtyPrices.size} item{dirtyPrices.size === 1 ? "" : "s"} changed
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setDirtyPrices(new Map()); setEditMode(false); setSelectedIds(new Set()); }}>
                    Discard
                  </Button>
                  <Button size="sm" onClick={saveBatch} disabled={batchSaving}>
                    {batchSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save All
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ---- Edit Price Row Dialog ---- */}
      <Dialog open={editItemOpen} onOpenChange={setEditItemOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Price Row</DialogTitle>
            <DialogDescription>Edits this history row in place.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEditRow} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Effective From</Label>
                <Input value={editEffectiveFrom} onChange={(e) => setEditEffectiveFrom(e.target.value)} type="date" />
              </div>
              <div className="space-y-2">
                <Label>Effective To (optional)</Label>
                <Input value={editEffectiveTo} onChange={(e) => setEditEffectiveTo(e.target.value)} type="date" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Price USD</Label>
                <Input value={editUsd} onChange={(e) => setEditUsd(e.target.value)} placeholder="0.00" inputMode="decimal" />
              </div>
              <div className="space-y-2">
                <Label>Price LBP</Label>
                <Input value={editLbp} onChange={(e) => setEditLbp(e.target.value)} placeholder="0" inputMode="decimal" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Replacement Cost USD</Label>
                <Input value={editCostUsd} onChange={(e) => setEditCostUsd(e.target.value)} placeholder="0.00" inputMode="decimal" />
              </div>
              <div className="space-y-2">
                <Label>Replacement Cost LBP</Label>
                <Input value={editCostLbp} onChange={(e) => setEditCostLbp(e.target.value)} placeholder="0" inputMode="decimal" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={editItemSaving}>
                {editItemSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
