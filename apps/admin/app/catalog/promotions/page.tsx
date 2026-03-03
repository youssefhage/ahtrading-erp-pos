"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Tag } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
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
import { Alert, AlertDescription } from "@/components/ui/alert";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function PromotionsPage() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [promos, setPromos] = useState<PromotionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  /* ---- Create promo ---- */
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [priority, setPriority] = useState("0");
  const [active, setActive] = useState(true);
  const [creating, setCreating] = useState(false);

  /* ---- Edit promo ---- */
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editStartsOn, setEditStartsOn] = useState("");
  const [editEndsOn, setEditEndsOn] = useState("");
  const [editPriority, setEditPriority] = useState("0");
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  /* ---- Promo items dialog ---- */
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

  /* ---- Lookups ---- */
  const itemBySku = useMemo(() => {
    const m = new Map<string, ItemRow>();
    for (const it of items) m.set((it.sku || "").toUpperCase(), it);
    return m;
  }, [items]);

  /* ---- Load ---- */
  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [p, it] = await Promise.all([
        apiGet<{ promotions: PromotionRow[] }>("/promotions"),
        apiGet<{ items: ItemRow[] }>("/items/min"),
      ]);
      setPromos(p.promotions || []);
      setItems(it.items || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ---- Edit ---- */
  const openEdit = useCallback((p: PromotionRow) => {
    setEditId(p.id);
    setEditCode(p.code || "");
    setEditName(p.name || "");
    setEditStartsOn(p.starts_on || "");
    setEditEndsOn(p.ends_on || "");
    setEditPriority(String(p.priority ?? 0));
    setEditActive(!!p.is_active);
    setEditOpen(true);
  }, []);

  /* ---- Promo items ---- */
  const openPromotionItems = useCallback(async (p: PromotionRow) => {
    setItemsPromo(p);
    setPromoItems([]);
    setAddSku("");
    setAddItemId("");
    setAddMinQty("1");
    setAddUsd("");
    setAddLbp("");
    setAddDisc("");
    setItemsOpen(true);
    try {
      const res = await apiGet<{ items: PromotionItemRow[] }>(`/promotions/${p.id}/items`);
      setPromoItems(res.items || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const deletePromotionItem = useCallback(async (id: string) => {
    if (!itemsPromo) return;
    setErr(null);
    try {
      await apiDelete(`/promotions/items/${encodeURIComponent(id)}`);
      const res = await apiGet<{ items: PromotionItemRow[] }>(`/promotions/${itemsPromo.id}/items`);
      setPromoItems(res.items || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [itemsPromo]);

  /* ---- Promo CRUD ---- */
  async function createPromotion(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setErr("Code is required.");
    if (!name.trim()) return setErr("Name is required.");
    setCreating(true);
    setErr(null);
    try {
      await apiPost<{ id: string }>("/promotions", {
        code: code.trim(),
        name: name.trim(),
        starts_on: startsOn || null,
        ends_on: endsOn || null,
        is_active: !!active,
        priority: Number(priority || 0),
      });
      setCreateOpen(false);
      setCode("");
      setName("");
      setStartsOn("");
      setEndsOn("");
      setPriority("0");
      setActive(true);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    if (!editCode.trim()) return setErr("Code is required.");
    if (!editName.trim()) return setErr("Name is required.");
    setSaving(true);
    setErr(null);
    try {
      await apiPatch(`/promotions/${editId}`, {
        code: editCode.trim(),
        name: editName.trim(),
        starts_on: editStartsOn || null,
        ends_on: editEndsOn || null,
        is_active: !!editActive,
        priority: Number(editPriority || 0),
      });
      setEditOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
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
    if (!addItemId) return setErr("Pick a valid SKU / item.");
    const min = Number(addMinQty || 0);
    if (!Number.isFinite(min) || min <= 0) return setErr("Min qty must be > 0.");
    const usd = Number(addUsd || 0);
    const lbp = Number(addLbp || 0);
    const disc = Number(addDisc || 0);
    if (usd <= 0 && lbp <= 0 && disc <= 0) return setErr("Set promo price (USD or LBP) or discount %.");
    if (disc < 0 || disc > 1) return setErr("Discount % must be between 0 and 1 (e.g. 0.10).");
    setAdding(true);
    setErr(null);
    try {
      await apiPost(`/promotions/${itemsPromo.id}/items`, {
        item_id: addItemId,
        min_qty: min,
        promo_price_usd: usd,
        promo_price_lbp: lbp,
        discount_pct: disc,
      });
      const res = await apiGet<{ items: PromotionItemRow[] }>(`/promotions/${itemsPromo.id}/items`);
      setPromoItems(res.items || []);
      setAddSku("");
      setAddItemId("");
      setAddMinQty("1");
      setAddUsd("");
      setAddLbp("");
      setAddDisc("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  /* ---- Columns: promotions ---- */
  const promoColumns = useMemo<ColumnDef<PromotionRow>[]>(() => [
    {
      accessorKey: "code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
      cell: ({ row }) => <span className="font-mono text-xs font-medium">{row.original.code}</span>,
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorFn: (p) => `${p.starts_on || ""} ${p.ends_on || ""}`,
      id: "dates",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Dates" />,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.starts_on || "---"} to {row.original.ends_on || "---"}
        </span>
      ),
    },
    {
      accessorFn: (p) => Number(p.priority || 0),
      id: "priority",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Priority" />,
      cell: ({ row }) => <Badge variant="secondary" className="font-mono text-xs">{Number(row.original.priority || 0)}</Badge>,
    },
    {
      accessorFn: (p) => (p.is_active ? "active" : "inactive"),
      id: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.is_active ? "active" : "inactive"} />,
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => openPromotionItems(p)}>
              Items
            </Button>
            <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
              Edit
            </Button>
          </div>
        );
      },
    },
  ], [openEdit, openPromotionItems]);

  /* ---- Columns: promotion items ---- */
  const promoItemColumns = useMemo<ColumnDef<PromotionItemRow>[]>(() => [
    {
      accessorKey: "sku",
      header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
      cell: ({ row }) => (
        <Link href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`} className="font-mono text-xs text-primary hover:underline">
          {row.original.sku}
        </Link>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <Link href={`/catalog/items/${encodeURIComponent(row.original.item_id)}`} className="font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorFn: (pi) => Number(pi.min_qty || 0),
      id: "min_qty",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Min Qty" />,
      cell: ({ row }) => <span className="font-mono text-xs">{Number(row.original.min_qty || 0).toLocaleString("en-US")}</span>,
    },
    {
      accessorFn: (pi) => Number(pi.promo_price_usd || 0),
      id: "promo_usd",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Promo USD" />,
      cell: ({ row }) => <span className="font-mono text-xs">{Number(row.original.promo_price_usd || 0).toFixed(2)}</span>,
    },
    {
      accessorFn: (pi) => Number(pi.promo_price_lbp || 0),
      id: "promo_lbp",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Promo LBP" />,
      cell: ({ row }) => <span className="font-mono text-xs">{Number(row.original.promo_price_lbp || 0).toLocaleString("en-US")}</span>,
    },
    {
      accessorFn: (pi) => Number(pi.discount_pct || 0),
      id: "discount_pct",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Discount %" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs">{(Number(row.original.discount_pct || 0) * 100).toFixed(2)}%</span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <ConfirmDialog
            title="Delete Promotion Rule?"
            description="This removes the item rule from this promotion."
            confirmLabel="Delete"
            variant="destructive"
            onConfirm={() => deletePromotionItem(row.original.id)}
            trigger={
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                Delete
              </Button>
            }
          />
        </div>
      ),
    },
  ], [deletePromotionItem]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title="Promotions"
        description={`${promos.length} promotion${promos.length === 1 ? "" : "s"}`}
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) { setCode(""); setName(""); setStartsOn(""); setEndsOn(""); setPriority("0"); setActive(true); } }}>
              <DialogTrigger asChild>
                <Button><Plus className="mr-2 h-4 w-4" /> New Promotion</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Promotion</DialogTitle>
                  <DialogDescription>Item tier pricing or discount rules for POS (offline-ready).</DialogDescription>
                </DialogHeader>
                <form onSubmit={createPromotion} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Code <span className="text-destructive">*</span></Label>
                      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BULK10" />
                    </div>
                    <div className="space-y-2">
                      <Label>Name <span className="text-destructive">*</span></Label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bulk discount 10%" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Starts On</Label>
                      <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Ends On</Label>
                      <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Input value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="0" inputMode="numeric" />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={active} onCheckedChange={setActive} />
                    <Label>Active</Label>
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

      {!loading && promos.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={Tag}
              title="No promotions yet"
              description="Create a promotion to set up tier pricing or discount rules for POS."
              action={{ label: "New Promotion", onClick: () => setCreateOpen(true) }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Promotions</CardTitle>
            <CardDescription>Manage tier pricing and discount rules. Changes apply after next POS sync.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={promoColumns}
              data={promos}
              isLoading={loading}
              searchPlaceholder="Search code / name..."
              pageSize={25}
            />
          </CardContent>
        </Card>
      )}

      {/* ---- Edit Promotion Dialog ---- */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Promotion</DialogTitle>
            <DialogDescription>Changes apply to POS after the next sync.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Starts On</Label>
                <Input type="date" value={editStartsOn} onChange={(e) => setEditStartsOn(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Ends On</Label>
                <Input type="date" value={editEndsOn} onChange={(e) => setEditEndsOn(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Input value={editPriority} onChange={(e) => setEditPriority(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={editActive} onCheckedChange={setEditActive} />
              <Label>Active</Label>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---- Promotion Items Dialog ---- */}
      <Dialog
        open={itemsOpen}
        onOpenChange={(o) => {
          setItemsOpen(o);
          if (!o) { setItemsPromo(null); setPromoItems([]); }
        }}
      >
        <DialogContent className="w-[96vw] max-w-[1200px] max-h-[92vh] overflow-hidden p-0">
          <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6 pr-12">
              <DialogTitle>
                Promotion Items
                {itemsPromo ? (
                  <Badge variant="outline" className="ml-3 font-mono text-xs">
                    {itemsPromo.code} -- {itemsPromo.name}
                  </Badge>
                ) : null}
              </DialogTitle>
              <DialogDescription>Tier rules by item and minimum quantity.</DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              <DataTable
                columns={promoItemColumns}
                data={promoItems}
                searchPlaceholder="Search SKU / item..."
                pageSize={25}
              />

              {/* Add form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Add / Update Rule</CardTitle>
                  <CardDescription>Set a promo price (USD or LBP) or a discount percentage.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={addPromotionItem} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label>SKU</Label>
                        <Input
                          value={addSku}
                          onChange={(e) => onSkuChange(e.target.value)}
                          placeholder="SKU-001"
                          list="promoSkuList"
                        />
                        <datalist id="promoSkuList">
                          {items.slice(0, 2000).map((it) => (
                            <option key={it.id} value={(it.sku || "").toUpperCase()}>
                              {it.name}
                            </option>
                          ))}
                        </datalist>
                        {addItemId ? (
                          <p className="text-xs text-muted-foreground">
                            {items.find((i) => i.id === addItemId)?.name || addItemId}
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <Label>Min Qty</Label>
                        <Input value={addMinQty} onChange={(e) => setAddMinQty(e.target.value)} placeholder="12" inputMode="numeric" />
                      </div>
                      <div className="space-y-2">
                        <Label>Discount % (fraction)</Label>
                        <Input value={addDisc} onChange={(e) => setAddDisc(e.target.value)} placeholder="0.10" inputMode="decimal" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Promo Price USD</Label>
                        <Input value={addUsd} onChange={(e) => setAddUsd(e.target.value)} placeholder="0.00" inputMode="decimal" />
                      </div>
                      <div className="space-y-2">
                        <Label>Promo Price LBP</Label>
                        <Input value={addLbp} onChange={(e) => setAddLbp(e.target.value)} placeholder="0" inputMode="decimal" />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={adding || !itemsPromo}>
                        {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Add / Update Rule
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
