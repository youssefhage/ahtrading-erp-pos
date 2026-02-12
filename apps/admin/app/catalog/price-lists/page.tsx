"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ShortcutLink } from "@/components/shortcut-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

type ItemRow = { id: string; sku: string; name: string; barcode: string | null };

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
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function PriceListsPage() {
  const [status, setStatus] = useState("");
  const [lists, setLists] = useState<PriceListRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [isDefault, setIsDefault] = useState(false);
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editCurrency, setEditCurrency] = useState<"USD" | "LBP">("USD");
  const [editDefault, setEditDefault] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const [itemsOpen, setItemsOpen] = useState(false);
  const [itemsListId, setItemsListId] = useState("");
  const [listItems, setListItems] = useState<PriceListItemRow[]>([]);
  const [addSku, setAddSku] = useState("");
  const [addItemId, setAddItemId] = useState<string>("");
  const [addEffectiveFrom, setAddEffectiveFrom] = useState(todayIso());
  const [addEffectiveTo, setAddEffectiveTo] = useState("");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");
  const [adding, setAdding] = useState(false);

  const [editItemOpen, setEditItemOpen] = useState(false);
  const [editRowId, setEditRowId] = useState("");
  const [editEffectiveFrom, setEditEffectiveFrom] = useState(todayIso());
  const [editEffectiveTo, setEditEffectiveTo] = useState("");
  const [editUsd, setEditUsd] = useState("");
  const [editLbp, setEditLbp] = useState("");
  const [editItemSaving, setEditItemSaving] = useState(false);

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

  const listItemColumns = useMemo((): Array<DataTableColumn<PriceListItemRow>> => {
    return [
      {
        id: "sku",
        header: "SKU",
        accessor: (li) => itemById.get(li.item_id)?.sku || "",
        mono: true,
        sortable: true,
        cell: (li) => {
          const it = itemById.get(li.item_id);
          return (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(li.item_id)}`} title="Open item" className="font-mono text-xs">
              {it?.sku || "-"}
            </ShortcutLink>
          );
        },
      },
      {
        id: "item",
        header: "Item",
        accessor: (li) => itemById.get(li.item_id)?.name || li.item_id,
        sortable: true,
        cell: (li) => {
          const it = itemById.get(li.item_id);
          return (
            <ShortcutLink href={`/catalog/items/${encodeURIComponent(li.item_id)}`} title="Open item">
              {it?.name || li.item_id}
            </ShortcutLink>
          );
        },
      },
      { id: "price_usd", header: "USD", accessor: (li) => Number(li.price_usd || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (li) => <span className="font-mono text-xs">{li.price_usd}</span> },
      { id: "price_lbp", header: "LL", accessor: (li) => Number(li.price_lbp || 0), align: "right", mono: true, sortable: true, globalSearch: false, cell: (li) => <span className="font-mono text-xs">{li.price_lbp}</span> },
      { id: "effective_from", header: "From", accessor: (li) => li.effective_from, mono: true, sortable: true, globalSearch: false, cell: (li) => <span className="text-xs">{li.effective_from}</span> },
      { id: "effective_to", header: "To", accessor: (li) => li.effective_to || "", mono: true, sortable: true, globalSearch: false, cell: (li) => <span className="text-xs">{li.effective_to || "-"}</span> },
      {
        id: "actions",
        header: "Actions",
        accessor: () => "",
        globalSearch: false,
        align: "right",
        cell: (li) => (
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
                setEditItemOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!itemsListId) return;
                const ok = window.confirm("Delete this price row? (History row will be removed)");
                if (!ok) return;
                setStatus("Deleting price row...");
                try {
                  await apiDelete(`/pricing/lists/${encodeURIComponent(itemsListId)}/items/${encodeURIComponent(li.id)}`);
                  const res = await apiGet<{ items: PriceListItemRow[] }>(`/pricing/lists/${itemsListId}/items`);
                  setListItems(res.items || []);
                  setStatus("");
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  setStatus(message);
                }
              }}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ];
  }, [itemById, itemsListId]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [pl, it] = await Promise.all([
        apiGet<{ lists: PriceListRow[] }>("/pricing/lists"),
        apiGet<{ items: ItemRow[] }>("/items/min")
      ]);
      setLists(pl.lists || []);
      setItems(it.items || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setStatus("Code is required.");
    if (!name.trim()) return setStatus("Name is required.");
    setCreating(true);
    setStatus("Creating...");
    try {
      const res = await apiPost<{ id: string }>("/pricing/lists", {
        code: code.trim(),
        name: name.trim(),
        currency,
        is_default: isDefault
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
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
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
    if (!editName.trim()) return setStatus("Name is required.");
    setEditSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/pricing/lists/${editId}`, { name: editName.trim(), currency: editCurrency, is_default: editDefault });
      if (editDefault) {
        await apiPost("/pricing/company-settings", { key: "default_price_list_id", value_json: { id: editId } });
      }
      setEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setEditSaving(false);
    }
  }

  const setDefaultList = useCallback(async (listId: string) => {
    setStatus("Setting default...");
    try {
      await apiPatch(`/pricing/lists/${listId}`, { is_default: true });
      await apiPost("/pricing/company-settings", { key: "default_price_list_id", value_json: { id: listId } });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, [load]);

  const openListItems = useCallback(async (listId: string) => {
    setItemsListId(listId);
    setListItems([]);
    setAddSku("");
    setAddItemId("");
    setAddEffectiveFrom(todayIso());
    setAddEffectiveTo("");
    setAddUsd("");
    setAddLbp("");
    setItemsOpen(true);
    setStatus("Loading list items...");
    try {
      const res = await apiGet<{ items: PriceListItemRow[] }>(`/pricing/lists/${listId}/items`);
      setListItems(res.items || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  const listColumns = useMemo((): Array<DataTableColumn<PriceListRow>> => {
    return [
      { id: "code", header: "Code", accessor: (pl) => pl.code, mono: true, sortable: true, cell: (pl) => <span className="font-mono text-xs">{pl.code}</span> },
      { id: "name", header: "Name", accessor: (pl) => pl.name, sortable: true, cell: (pl) => <span className="font-medium">{pl.name}</span> },
      { id: "currency", header: "Currency", accessor: (pl) => pl.currency, sortable: true, globalSearch: false, cell: (pl) => <span className="text-xs">{pl.currency}</span> },
      { id: "is_default", header: "Default", accessor: (pl) => (pl.is_default ? "yes" : "no"), sortable: true, globalSearch: false, cell: (pl) => <span className="text-xs">{pl.is_default ? "yes" : "no"}</span> },
      {
        id: "actions",
        header: "",
        accessor: () => "",
        align: "right",
        globalSearch: false,
        cell: (pl) => (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => openListItems(pl.id)}>
              Items
            </Button>
            <Button variant="outline" size="sm" onClick={() => openEdit(pl)}>
              Edit
            </Button>
            {!pl.is_default ? (
              <Button size="sm" onClick={() => setDefaultList(pl.id)}>
                Set Default
              </Button>
            ) : null}
          </div>
        ),
      },
    ];
  }, [openEdit, openListItems, setDefaultList]);

  function onSkuChange(nextSku: string) {
    const normalized = (nextSku || "").trim().toUpperCase();
    setAddSku(normalized);
    const it = itemBySku.get(normalized);
    setAddItemId(it?.id || "");
  }

  async function addPrice(e: React.FormEvent) {
    e.preventDefault();
    if (!itemsListId) return;
    if (!addItemId) return setStatus("Pick a valid SKU / item.");
    if (!addEffectiveFrom) return setStatus("effective_from is required.");
    setAdding(true);
    setStatus("Adding price...");
    try {
      await apiPost(`/pricing/lists/${itemsListId}/items`, {
        item_id: addItemId,
        price_usd: Number(addUsd || 0),
        price_lbp: Number(addLbp || 0),
        effective_from: addEffectiveFrom,
        effective_to: addEffectiveTo ? addEffectiveTo : null
      });
      const res = await apiGet<{ items: PriceListItemRow[] }>(`/pricing/lists/${itemsListId}/items`);
      setListItems(res.items || []);
      setAddSku("");
      setAddItemId("");
      setAddUsd("");
      setAddLbp("");
      setAddEffectiveFrom(todayIso());
      setAddEffectiveTo("");
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setAdding(false);
    }
  }

  async function saveEditRow(e: React.FormEvent) {
    e.preventDefault();
    if (!itemsListId) return;
    if (!editRowId) return;
    if (!editEffectiveFrom) return setStatus("effective_from is required.");
    setEditItemSaving(true);
    setStatus("Saving price row...");
    try {
      await apiPatch(`/pricing/lists/${encodeURIComponent(itemsListId)}/items/${encodeURIComponent(editRowId)}`, {
        price_usd: Number(editUsd || 0),
        price_lbp: Number(editLbp || 0),
        effective_from: editEffectiveFrom,
        effective_to: editEffectiveTo ? editEffectiveTo : null,
      });
      const res = await apiGet<{ items: PriceListItemRow[] }>(`/pricing/lists/${itemsListId}/items`);
      setListItems(res.items || []);
      setEditItemOpen(false);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setEditItemSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Price Lists</CardTitle>
          <CardDescription>{lists.length} lists</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>Create List</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Price List</DialogTitle>
                  <DialogDescription>Use this to override default item prices (POS catalog will use the default list).</DialogDescription>
                </DialogHeader>
                <form onSubmit={createList} className="grid grid-cols-1 gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Code</label>
                      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="WHOLESALE" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Currency</label>
                      <select className="ui-select" value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "LBP")}>
                        <option value="USD">USD</option>
                        <option value="LBP">LL</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wholesale USD" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-fg-muted">
                    <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                    Set as default (used by POS)
                  </label>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating}>
                      {creating ? "..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <DataTable<PriceListRow>
            tableId="catalog.priceLists"
            rows={lists}
            columns={listColumns}
            initialSort={{ columnId: "code", dir: "asc" }}
            globalFilterPlaceholder="Search code / name..."
            emptyText="No price lists yet."
          />
        </CardContent>
      </Card>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Price List</DialogTitle>
              <DialogDescription>Defaults are used by POS catalog pricing.</DialogDescription>
            </DialogHeader>
            <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Name</label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Currency</label>
                  <select
                    className="ui-select"
                    value={editCurrency}
                    onChange={(e) => setEditCurrency(e.target.value as "USD" | "LBP")}
                  >
                    <option value="USD">USD</option>
                    <option value="LBP">LL</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                <input type="checkbox" checked={editDefault} onChange={(e) => setEditDefault(e.target.checked)} />
                Set as default (POS)
              </label>
              <div className="flex justify-end">
                <Button type="submit" disabled={editSaving}>
                  {editSaving ? "..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={itemsOpen} onOpenChange={setItemsOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Price List Items</DialogTitle>
              <DialogDescription>Most recent effective price wins for each item.</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <DataTable<PriceListItemRow>
                tableId={`catalog.priceListItems.${itemsListId || "none"}`}
                rows={listItems}
                columns={listItemColumns}
                initialSort={{ columnId: "effective_from", dir: "desc" }}
                globalFilterPlaceholder="Search SKU / item..."
                emptyText="No items yet."
              />

              <Card>
                <CardHeader>
                  <CardTitle>Add / Update Price</CardTitle>
                  <CardDescription>Insert a new row (history is preserved).</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={addPrice} className="grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">SKU</label>
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
                          <p className="text-xs text-fg-subtle">Item: {itemById.get(addItemId)?.name || addItemId}</p>
                        ) : (
                          <p className="text-xs text-fg-subtle">Pick a valid SKU.</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Effective From</label>
                        <Input value={addEffectiveFrom} onChange={(e) => setAddEffectiveFrom(e.target.value)} type="date" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Price USD</label>
                        <Input value={addUsd} onChange={(e) => setAddUsd(e.target.value)} placeholder="0" inputMode="decimal" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Price LL</label>
                        <Input value={addLbp} onChange={(e) => setAddLbp(e.target.value)} placeholder="0" inputMode="decimal" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-fg-muted">Effective To (optional)</label>
                      <Input value={addEffectiveTo} onChange={(e) => setAddEffectiveTo(e.target.value)} type="date" />
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={adding}>
                        {adding ? "..." : "Add Price Row"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={editItemOpen} onOpenChange={setEditItemOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Price Row</DialogTitle>
              <DialogDescription>Edits this history row in place.</DialogDescription>
            </DialogHeader>
            <form onSubmit={saveEditRow} className="grid grid-cols-1 gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Effective From</label>
                  <Input value={editEffectiveFrom} onChange={(e) => setEditEffectiveFrom(e.target.value)} type="date" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Effective To (optional)</label>
                  <Input value={editEffectiveTo} onChange={(e) => setEditEffectiveTo(e.target.value)} type="date" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Price USD</label>
                  <Input value={editUsd} onChange={(e) => setEditUsd(e.target.value)} placeholder="0" inputMode="decimal" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">Price LL</label>
                  <Input value={editLbp} onChange={(e) => setEditLbp(e.target.value)} placeholder="0" inputMode="decimal" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={editItemSaving}>
                  {editItemSaving ? "..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
    </div>
  );
}
