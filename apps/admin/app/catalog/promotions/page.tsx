"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ItemRow = { id: string; sku: string; name: string; barcode: string | null };

type PromotionRow = {
  id: string;
  code: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
};

type PromotionItemRow = {
  id: string;
  item_id: string;
  sku: string;
  name: string;
  min_qty: string | number;
  promo_price_usd: string | number;
  promo_price_lbp: string | number;
  discount_pct: string | number;
  created_at: string;
  updated_at: string;
};

export default function PromotionsPage() {
  const [status, setStatus] = useState("");

  const [items, setItems] = useState<ItemRow[]>([]);
  const [promos, setPromos] = useState<PromotionRow[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [priority, setPriority] = useState("0");
  const [active, setActive] = useState(true);
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editStartsOn, setEditStartsOn] = useState("");
  const [editEndsOn, setEditEndsOn] = useState("");
  const [editPriority, setEditPriority] = useState("0");
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [itemsOpen, setItemsOpen] = useState(false);
  const [itemsPromo, setItemsPromo] = useState<PromotionRow | null>(null);
  const [promoItems, setPromoItems] = useState<PromotionItemRow[]>([]);
  const [addSku, setAddSku] = useState("");
  const [addItemId, setAddItemId] = useState("");
  const [addMinQty, setAddMinQty] = useState("1");
  const [addUsd, setAddUsd] = useState("");
  const [addLbp, setAddLbp] = useState("");
  const [addDisc, setAddDisc] = useState("");
  const [adding, setAdding] = useState(false);

  const itemBySku = useMemo(() => {
    const m = new Map<string, ItemRow>();
    for (const it of items) m.set((it.sku || "").toUpperCase(), it);
    return m;
  }, [items]);

  async function load() {
    setStatus("Loading...");
    try {
      const [p, it] = await Promise.all([
        apiGet<{ promotions: PromotionRow[] }>("/promotions"),
        apiGet<{ items: ItemRow[] }>("/items")
      ]);
      setPromos(p.promotions || []);
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

  async function createPromotion(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setStatus("code is required");
    if (!name.trim()) return setStatus("name is required");
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost<{ id: string }>("/promotions", {
        code: code.trim(),
        name: name.trim(),
        starts_on: startsOn ? startsOn : null,
        ends_on: endsOn ? endsOn : null,
        is_active: !!active,
        priority: Number(priority || 0)
      });
      setCreateOpen(false);
      setCode("");
      setName("");
      setStartsOn("");
      setEndsOn("");
      setPriority("0");
      setActive(true);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(p: PromotionRow) {
    setEditId(p.id);
    setEditCode(p.code || "");
    setEditName(p.name || "");
    setEditStartsOn(p.starts_on || "");
    setEditEndsOn(p.ends_on || "");
    setEditPriority(String(p.priority ?? 0));
    setEditActive(!!p.is_active);
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    if (!editCode.trim()) return setStatus("code is required");
    if (!editName.trim()) return setStatus("name is required");
    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/promotions/${editId}`, {
        code: editCode.trim(),
        name: editName.trim(),
        starts_on: editStartsOn ? editStartsOn : null,
        ends_on: editEndsOn ? editEndsOn : null,
        is_active: !!editActive,
        priority: Number(editPriority || 0)
      });
      setEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  async function openPromotionItems(p: PromotionRow) {
    setItemsPromo(p);
    setPromoItems([]);
    setAddSku("");
    setAddItemId("");
    setAddMinQty("1");
    setAddUsd("");
    setAddLbp("");
    setAddDisc("");
    setItemsOpen(true);
    setStatus("Loading promotion items...");
    try {
      const res = await apiGet<{ items: PromotionItemRow[] }>(`/promotions/${p.id}/items`);
      setPromoItems(res.items || []);
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

  async function addPromotionItem(e: React.FormEvent) {
    e.preventDefault();
    if (!itemsPromo) return;
    if (!addItemId) return setStatus("Pick a valid SKU / item.");
    const min = Number(addMinQty || 0);
    if (!Number.isFinite(min) || min <= 0) return setStatus("min_qty must be > 0");
    const usd = Number(addUsd || 0);
    const lbp = Number(addLbp || 0);
    const disc = Number(addDisc || 0);
    if (usd <= 0 && lbp <= 0 && disc <= 0) return setStatus("Set promo_price_usd, promo_price_lbp, or discount_pct.");
    if (disc < 0 || disc > 1) return setStatus("discount_pct must be between 0 and 1 (e.g. 0.10)");

    setAdding(true);
    setStatus("Saving promo rule...");
    try {
      await apiPost(`/promotions/${itemsPromo.id}/items`, {
        item_id: addItemId,
        min_qty: min,
        promo_price_usd: usd,
        promo_price_lbp: lbp,
        discount_pct: disc
      });
      const res = await apiGet<{ items: PromotionItemRow[] }>(`/promotions/${itemsPromo.id}/items`);
      setPromoItems(res.items || []);
      setAddSku("");
      setAddItemId("");
      setAddMinQty("1");
      setAddUsd("");
      setAddLbp("");
      setAddDisc("");
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setAdding(false);
    }
  }

  async function deletePromotionItem(id: string) {
    if (!itemsPromo) return;
    setStatus("Deleting...");
    try {
      await fetch(`/api/promotions/items/${id}`, { method: "DELETE", credentials: "include" }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
      });
      const res = await apiGet<{ items: PromotionItemRow[] }>(`/promotions/${itemsPromo.id}/items`);
      setPromoItems(res.items || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Promotions</CardTitle>
            <CardDescription>{promos.length} active/inactive promos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button>New Promotion</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Promotion</DialogTitle>
                    <DialogDescription>Item tier pricing or discount rules for POS (offline).</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createPromotion} className="grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Code</label>
                        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BULK10" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Name</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bulk discount 10%" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Starts On</label>
                        <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Ends On</label>
                        <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Priority</label>
                        <Input value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="0" />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                      Active
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
                    <th className="px-3 py-2">Dates</th>
                    <th className="px-3 py-2 text-right">Priority</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {promos.map((p) => (
                    <tr key={p.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                      <td className="px-3 py-2">{p.name}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {(p.starts_on || "-") + " → " + (p.ends_on || "-")}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(p.priority || 0)}</td>
                      <td className="px-3 py-2 text-xs">{p.is_active ? "Yes" : "No"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => openPromotionItems(p)}>
                            Items
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => openEdit(p)}>
                            Edit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {promos.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                        No promotions yet.
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
              <DialogTitle>Edit Promotion</DialogTitle>
              <DialogDescription>Changes apply to POS after the next Sync.</DialogDescription>
            </DialogHeader>
            <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Code</label>
                  <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Name</label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Starts On</label>
                  <Input type="date" value={editStartsOn} onChange={(e) => setEditStartsOn(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Ends On</label>
                  <Input type="date" value={editEndsOn} onChange={(e) => setEditEndsOn(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">Priority</label>
                  <Input value={editPriority} onChange={(e) => setEditPriority(e.target.value)} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                Active
              </label>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                  {saving ? "..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={itemsOpen}
          onOpenChange={(o) => {
            setItemsOpen(o);
            if (!o) {
              setItemsPromo(null);
              setPromoItems([]);
            }
          }}
        >
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Promotion Items</DialogTitle>
              <DialogDescription>
                {itemsPromo ? (
                  <span className="font-mono text-xs">
                    {itemsPromo.code} · {itemsPromo.name}
                  </span>
                ) : (
                  "Tier rules by item and min qty."
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Min Qty</th>
                    <th className="px-3 py-2 text-right">Promo USD</th>
                    <th className="px-3 py-2 text-right">Promo LBP</th>
                    <th className="px-3 py-2 text-right">Discount %</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {promoItems.map((pi) => (
                    <tr key={pi.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{pi.sku}</td>
                      <td className="px-3 py-2">{pi.name}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(pi.min_qty || 0).toLocaleString("en-US")}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(pi.promo_price_usd || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(pi.promo_price_lbp || 0).toLocaleString("en-US")}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{(Number(pi.discount_pct || 0) * 100).toFixed(2)}%</td>
                      <td className="px-3 py-2 text-right">
                        <Button type="button" variant="outline" size="sm" onClick={() => deletePromotionItem(pi.id)}>
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {promoItems.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                        No promo rules yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <form onSubmit={addPromotionItem} className="grid grid-cols-1 gap-3 md:grid-cols-8">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">SKU</label>
                <Input value={addSku} onChange={(e) => onSkuChange(e.target.value)} placeholder="SKU-001" />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Min Qty</label>
                <Input value={addMinQty} onChange={(e) => setAddMinQty(e.target.value)} placeholder="12" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Promo Price USD</label>
                <Input value={addUsd} onChange={(e) => setAddUsd(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Promo Price LBP</label>
                <Input value={addLbp} onChange={(e) => setAddLbp(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Discount Pct</label>
                <Input value={addDisc} onChange={(e) => setAddDisc(e.target.value)} placeholder="0.10" />
              </div>
              <div className="md:col-span-8 flex justify-end">
                <Button type="submit" disabled={adding || !itemsPromo}>
                  {adding ? "..." : "Add / Update Rule"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>);
}

