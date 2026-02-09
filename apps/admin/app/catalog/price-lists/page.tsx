"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
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

  async function load() {
    setStatus("Loading...");
    try {
      const [pl, it] = await Promise.all([
        apiGet<{ lists: PriceListRow[] }>("/pricing/lists"),
        apiGet<{ items: ItemRow[] }>("/items")
      ]);
      setLists(pl.lists || []);
      setItems(it.items || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  function openEdit(list: PriceListRow) {
    setEditId(list.id);
    setEditName(list.name);
    setEditCurrency(list.currency);
    setEditDefault(!!list.is_default);
    setEditOpen(true);
  }

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

  async function setDefaultList(listId: string) {
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
  }

  async function openListItems(listId: string) {
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
  }

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
                        <select
                          className="ui-select"
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value as "USD" | "LBP")}
                        >
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

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Currency</th>
                    <th className="px-3 py-2">Default</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lists.map((pl) => (
                    <tr key={pl.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{pl.code}</td>
                      <td className="px-3 py-2 font-medium">{pl.name}</td>
                      <td className="px-3 py-2 text-xs">{pl.currency}</td>
                      <td className="px-3 py-2 text-xs">{pl.is_default ? "yes" : "no"}</td>
                      <td className="px-3 py-2 text-right">
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
                      </td>
                    </tr>
                  ))}
                  {lists.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={5}>
                        No price lists yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
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
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">USD</th>
                      <th className="px-3 py-2">LL</th>
                      <th className="px-3 py-2">From</th>
                      <th className="px-3 py-2">To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listItems.map((li) => {
                      const it = itemById.get(li.item_id);
                      return (
                        <tr key={li.id} className="ui-tr-hover">
                          <td className="px-3 py-2 font-mono text-xs">{it?.sku || "-"}</td>
                          <td className="px-3 py-2">{it?.name || li.item_id}</td>
                          <td className="px-3 py-2 font-mono text-xs">{li.price_usd}</td>
                          <td className="px-3 py-2 font-mono text-xs">{li.price_lbp}</td>
                          <td className="px-3 py-2 text-xs">{li.effective_from}</td>
                          <td className="px-3 py-2 text-xs">{li.effective_to || "-"}</td>
                        </tr>
                      );
                    })}
                    {listItems.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
                          No items yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

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
      </div>);
}
