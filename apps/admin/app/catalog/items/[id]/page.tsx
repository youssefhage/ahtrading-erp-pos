"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Copy,
  Package,
  DollarSign,
  Warehouse,
  Truck,
  Pencil,
  Plus,
  ExternalLink,
  Barcode,
  Tags,
  Info,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { apiGet, apiUrl } from "@/lib/api";
import { formatDate, formatDateLike } from "@/lib/datetime";
import { fmtLbpMaybe, fmtUsdLbp, fmtUsdMaybe } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { KpiCard } from "@/components/business/kpi-card";
import { EmptyState } from "@/components/business/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { ViewRaw } from "@/components/view-raw";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type TaxCode = { id: string; name: string; rate: string | number };

type Item = {
  id: string;
  sku: string;
  name: string;
  item_type?: "stocked" | "service" | "bundle";
  tags?: string[] | null;
  unit_of_measure: string;
  purchase_uom_code?: string | null;
  sales_uom_code?: string | null;
  barcode: string | null;
  tax_code_id: string | null;
  tax_category?: string | null;
  is_excise?: boolean;
  reorder_point: string | number | null;
  reorder_qty: string | number | null;
  is_active?: boolean;
  category_id?: string | null;
  brand?: string | null;
  short_name?: string | null;
  description?: string | null;
  track_batches?: boolean;
  track_expiry?: boolean;
  default_shelf_life_days?: number | null;
  min_shelf_life_days_for_sale?: number | null;
  expiry_warning_days?: number | null;
  allow_negative_stock?: boolean | null;
  case_pack_qty?: string | number | null;
  inner_pack_qty?: string | number | null;
  standard_cost_usd?: string | number | null;
  standard_cost_lbp?: string | number | null;
  min_margin_pct?: string | number | null;
  costing_method?: string | null;
  preferred_supplier_id?: string | null;
  weight?: string | number | null;
  volume?: string | number | null;
  external_ids?: any;
  image_attachment_id?: string | null;
  image_alt?: string | null;
  created_at?: string;
  updated_at?: string;
};

type ItemBarcode = {
  id: string;
  barcode: string;
  qty_factor: string | number;
  uom_code?: string | null;
  label: string | null;
  is_primary: boolean;
};

type ItemSupplierLinkRow = {
  id: string;
  supplier_id: string;
  name: string;
  is_primary: boolean;
  lead_time_days: number;
  min_order_qty: string | number;
  last_cost_usd: string | number;
  last_cost_lbp: string | number;
};

type PriceSuggest = {
  item_id: string;
  target_margin_pct: string;
  rounding: { usd_step: string; lbp_step: string };
  current: {
    price_usd: string;
    price_lbp: string;
    avg_cost_usd: string;
    avg_cost_lbp: string;
    margin_usd: string | null;
    margin_lbp: string | null;
  };
  suggested: { price_usd: string | null; price_lbp: string | null };
};

type PriceListRow = {
  id: string;
  code: string;
  name: string;
  currency: "USD" | "LBP";
  is_default: boolean;
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

type CategoryRow = { id: string; name: string; parent_id: string | null; is_active: boolean; updated_at: string };
type WarehouseRow = { id: string; name: string };

type PriceChangeRow = {
  id: string;
  changed_at: string;
  item_id: string;
  sku: string;
  name: string;
  effective_from?: string | null;
  old_price_usd?: string | number | null;
  new_price_usd?: string | number | null;
  pct_change_usd?: string | number | null;
  old_price_lbp?: string | number | null;
  new_price_lbp?: string | number | null;
  pct_change_lbp?: string | number | null;
  source_type?: string | null;
};

type StockRow = {
  item_id: string;
  warehouse_id: string;
  qty_in: string | number;
  qty_out: string | number;
  qty_on_hand: string | number;
  reserved_qty?: string | number;
  qty_available?: string | number;
  incoming_qty?: string | number;
};

type StockBatchRow = {
  item_id: string;
  warehouse_id: string;
  batch_id: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  qty_in: string | number;
  qty_out: string | number;
  qty_on_hand: string | number;
};

type UomConversionRow = {
  uom_code: string;
  uom_name: string | null;
  uom_precision: number | null;
  to_base_factor: string | number;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type ItemWarehousePolicyRow = {
  id: string;
  item_id: string;
  warehouse_id: string;
  warehouse_name: string;
  min_stock: string | number;
  max_stock: string | number;
  preferred_supplier_id: string | null;
  preferred_supplier_name: string | null;
  replenishment_lead_time_days: number | null;
  notes: string | null;
  updated_at: string;
};

type ItemPriceRow = {
  id: string;
  price_usd: string | number;
  price_lbp: string | number;
  effective_from: string;
  effective_to: string | null;
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function shortId(v: string, head = 8, tail = 4) {
  const s = (v || "").trim();
  if (!s) return "-";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

function itemTypeLabel(t?: Item["item_type"]) {
  if (t === "service") return "Service";
  if (t === "bundle") return "Bundle";
  return "Stocked";
}

function fmtRate(v: string | number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  const s = String(n);
  return `${s.replace(/\.0+$/, "")}%`;
}

function fmtPctFrac(v: string | number | null | undefined) {
  if (v == null) return "-";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtQty(v: string | number | null | undefined) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return String(v ?? "");
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/* -------------------------------------------------------------------------- */
/*  Small UI components                                                       */
/* -------------------------------------------------------------------------- */

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const disabled = !text || text === "-";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            disabled={disabled}
            onClick={async () => {
              if (disabled) return;
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch { /* ignore */ }
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : `Copy ${label || ""}`}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DetailField({
  label,
  value,
  mono,
  copyText,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyText?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {copyText ? <CopyButton text={copyText} label={label} /> : null}
      </div>
      <p className={cn("text-sm font-medium", mono && "font-mono text-sm")} title={value}>
        {value || "-"}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                            */
/* -------------------------------------------------------------------------- */

export default function ItemViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  const searchParams = useSearchParams();

  /* ---- State ---- */
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [item, setItem] = useState<Item | null>(null);
  const [barcodes, setBarcodes] = useState<ItemBarcode[]>([]);
  const [suppliers, setSuppliers] = useState<ItemSupplierLinkRow[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [priceSuggest, setPriceSuggest] = useState<PriceSuggest | null>(null);
  const [priceLists, setPriceLists] = useState<PriceListRow[]>([]);
  const [defaultPriceListId, setDefaultPriceListId] = useState<string>("");
  const [wholesaleEffective, setWholesaleEffective] = useState<PriceListItemRow | null>(null);
  const [retailEffective, setRetailEffective] = useState<PriceListItemRow | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [stockBatches, setStockBatches] = useState<StockBatchRow[]>([]);
  const [uomBase, setUomBase] = useState("");
  const [uomConversions, setUomConversions] = useState<UomConversionRow[]>([]);
  const [warehousePolicies, setWarehousePolicies] = useState<ItemWarehousePolicyRow[]>([]);
  const [legacyPrices, setLegacyPrices] = useState<ItemPriceRow[]>([]);
  const [priceChanges, setPriceChanges] = useState<PriceChangeRow[]>([]);

  /* ---- Tab routing ---- */
  const tabId = useMemo(() => {
    const next = String(searchParams.get("tab") || "").toLowerCase();
    if (next === "pricing" || next === "stock" || next === "batches" || next === "history") return next;
    return "overview";
  }, [searchParams]);

  /* ---- Data loading ---- */
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr("");
    try {
      const [it, bc, sup, tc, ps, pls, settings, cats, whs, st, uom, pol, pr, pc] = await Promise.all([
        apiGet<{ item: Item }>(`/items/${encodeURIComponent(id)}`),
        apiGet<{ barcodes: ItemBarcode[] }>(`/items/${encodeURIComponent(id)}/barcodes`).catch(() => ({ barcodes: [] as ItemBarcode[] })),
        apiGet<{ suppliers: ItemSupplierLinkRow[] }>(`/suppliers/items/${encodeURIComponent(id)}`).catch(() => ({ suppliers: [] as ItemSupplierLinkRow[] })),
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes").catch(() => ({ tax_codes: [] as TaxCode[] })),
        apiGet<PriceSuggest>(`/pricing/items/${encodeURIComponent(id)}/suggested-price`).catch(() => null),
        apiGet<{ lists: PriceListRow[] }>("/pricing/lists").catch(() => ({ lists: [] as PriceListRow[] })),
        apiGet<{ settings: Array<{ key: string; value_json: any }> }>("/pricing/company-settings").catch(() => ({ settings: [] as any[] })),
        apiGet<{ categories: CategoryRow[] }>("/item-categories").catch(() => ({ categories: [] as any[] })),
        apiGet<{ warehouses: WarehouseRow[] }>("/warehouses").catch(() => ({ warehouses: [] as any[] })),
        apiGet<{ stock: StockRow[] }>(`/inventory/stock?item_id=${encodeURIComponent(id)}`).catch(() => ({ stock: [] as any[] })),
        apiGet<{ base_uom: string; conversions: UomConversionRow[] }>(`/items/${encodeURIComponent(id)}/uom-conversions`).catch(() => ({ base_uom: "", conversions: [] as any[] })),
        apiGet<{ policies: ItemWarehousePolicyRow[] }>(`/items/${encodeURIComponent(id)}/warehouse-policies`).catch(() => ({ policies: [] as any[] })),
        apiGet<{ prices: ItemPriceRow[] }>(`/items/${encodeURIComponent(id)}/prices`).catch(() => ({ prices: [] as any[] })),
        apiGet<{ changes: PriceChangeRow[] }>(`/pricing/price-changes?item_id=${encodeURIComponent(id)}&q=&limit=200`).catch(() => ({ changes: [] as PriceChangeRow[] })),
      ]);

      setItem(it.item || null);
      setBarcodes(bc.barcodes || []);
      setSuppliers(sup.suppliers || []);
      setTaxCodes(tc.tax_codes || []);
      setPriceSuggest((ps as any) || null);
      setCategories((cats as any)?.categories || []);
      setWarehouses((whs as any)?.warehouses || []);
      setStock((st as any)?.stock || []);
      setUomBase((uom as any)?.base_uom || "");
      setUomConversions((uom as any)?.conversions || []);
      setWarehousePolicies((pol as any)?.policies || []);
      setLegacyPrices((pr as any)?.prices || []);

      const initialPc = ((pc as any)?.changes || []) as PriceChangeRow[];
      const initialFiltered = initialPc.filter((r) => String((r as any)?.item_id || "") === id);
      setPriceChanges(initialFiltered);

      const lists = pls?.lists || [];
      setPriceLists(lists);
      const settingDefault = (settings?.settings || []).find((s) => String(s?.key || "") === "default_price_list_id");
      const defIdFromSetting = String(settingDefault?.value_json?.id || "");
      const defIdFromFlag = String((lists.find((l) => l.is_default)?.id as any) || "");
      const defId = defIdFromSetting || defIdFromFlag || "";
      setDefaultPriceListId(defId);

      // Fetch WHOLESALE / RETAIL effective overrides
      const w = lists.find((l) => String(l.code || "").toUpperCase() === "WHOLESALE");
      const r = lists.find((l) => String(l.code || "").toUpperCase() === "RETAIL");
      const [wEff, rEff] = await Promise.all([
        w
          ? apiGet<{ effective: PriceListItemRow | null }>(
              `/pricing/lists/${encodeURIComponent(w.id)}/items/by-item/${encodeURIComponent(id)}`
            ).catch(() => ({ effective: null as any }))
          : Promise.resolve({ effective: null as any }),
        r
          ? apiGet<{ effective: PriceListItemRow | null }>(
              `/pricing/lists/${encodeURIComponent(r.id)}/items/by-item/${encodeURIComponent(id)}`
            ).catch(() => ({ effective: null as any }))
          : Promise.resolve({ effective: null as any }),
      ]);
      setWholesaleEffective((wEff as any)?.effective || null);
      setRetailEffective((rEff as any)?.effective || null);

      // Batch stock
      const tracked = Boolean(it.item?.track_batches || it.item?.track_expiry);
      if (tracked) {
        const sb = await apiGet<{ stock: StockBatchRow[] }>(`/inventory/stock?item_id=${encodeURIComponent(id)}&by_batch=1`).catch(() => ({ stock: [] as any[] }));
        setStockBatches((sb as any)?.stock || []);
      } else {
        setStockBatches([]);
      }

      // Fallback price changes fetch
      if (initialFiltered.length === 0 && it.item?.sku) {
        const res = await apiGet<{ changes: PriceChangeRow[] }>(`/pricing/price-changes?q=${encodeURIComponent(it.item.sku)}&limit=500`).catch(() => ({ changes: [] as PriceChangeRow[] }));
        const maybe = (res?.changes || []).filter((r) => String((r as any)?.item_id || "") === id);
        if (maybe.length) setPriceChanges(maybe);
      }
    } catch (e) {
      setItem(null);
      setBarcodes([]);
      setSuppliers([]);
      setTaxCodes([]);
      setPriceSuggest(null);
      setPriceLists([]);
      setDefaultPriceListId("");
      setWholesaleEffective(null);
      setRetailEffective(null);
      setCategories([]);
      setWarehouses([]);
      setStock([]);
      setStockBatches([]);
      setUomBase("");
      setUomConversions([]);
      setWarehousePolicies([]);
      setLegacyPrices([]);
      setPriceChanges([]);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /* ---- Derived ---- */
  const taxById = useMemo(() => new Map(taxCodes.map((t) => [t.id, t])), [taxCodes]);
  const taxMeta = useMemo(() => (item?.tax_code_id ? taxById.get(item.tax_code_id) : undefined), [item?.tax_code_id, taxById]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [String(c.id), c])), [categories]);
  const categoryMeta = useMemo(() => (item?.category_id ? categoryById.get(String(item.category_id)) : undefined), [item?.category_id, categoryById]);
  const warehouseById = useMemo(() => new Map(warehouses.map((w) => [String(w.id), w])), [warehouses]);
  const defaultListLabel = useMemo(() => {
    const pl = priceLists.find((l) => l.id === defaultPriceListId) || priceLists.find((l) => l.is_default) || null;
    return pl ? `${pl.code} - ${pl.name}` : "-";
  }, [priceLists, defaultPriceListId]);

  const preferredSupplierName = useMemo(() => {
    const pid = String(item?.preferred_supplier_id || "").trim();
    if (!pid) return "";
    const s = suppliers.find((x) => String(x.supplier_id) === pid);
    return s?.name || pid;
  }, [item?.preferred_supplier_id, suppliers]);

  const stockTotals = useMemo(() => {
    let on_hand = 0, reserved = 0, available = 0, incoming = 0;
    for (const r of stock || []) {
      on_hand += Number((r as any)?.qty_on_hand || 0) || 0;
      reserved += Number((r as any)?.reserved_qty || 0) || 0;
      available += Number((r as any)?.qty_available || 0) || 0;
      incoming += Number((r as any)?.incoming_qty || 0) || 0;
    }
    return { on_hand, reserved, available, incoming };
  }, [stock]);

  const pricingSecondaryMissing = useMemo(() => {
    const usd = Number((priceSuggest as any)?.current?.price_usd || 0) || 0;
    const lbp = Number((priceSuggest as any)?.current?.price_lbp || 0) || 0;
    return usd > 0 && lbp === 0;
  }, [priceSuggest]);

  /* ---- Tab URL push ---- */
  const tabBaseHref = `/catalog/items/${encodeURIComponent(id)}`;
  function onTabChange(tab: string) {
    router.replace(`${tabBaseHref}?tab=${tab}`);
  }

  useEffect(() => {
    if (!item) return;
    const currentTab = String(searchParams.get("tab") || "").toLowerCase();
    if (!["overview", "pricing", "stock", "batches", "history"].includes(currentTab)) {
      router.replace(`${tabBaseHref}?tab=overview`);
    }
  }, [router, item, searchParams, tabBaseHref]);

  /* ---- Column defs ---- */

  const stockColumns = useMemo<ColumnDef<StockRow>[]>(() => [
    {
      accessorFn: (r) => warehouseById.get(String(r.warehouse_id))?.name || r.warehouse_id,
      id: "warehouse",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" />,
      cell: ({ row }) => warehouseById.get(String(row.original.warehouse_id))?.name || shortId(String(row.original.warehouse_id)),
    },
    {
      accessorFn: (r) => Number(r.qty_on_hand || 0),
      id: "qty_on_hand",
      header: ({ column }) => <DataTableColumnHeader column={column} title="On Hand" />,
      cell: ({ row }) => <span className="font-mono text-sm">{fmtQty(row.original.qty_on_hand)}</span>,
    },
    {
      accessorFn: (r) => Number(r.reserved_qty || 0),
      id: "reserved_qty",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Reserved" />,
      cell: ({ row }) => <span className="font-mono text-sm">{fmtQty(row.original.reserved_qty)}</span>,
    },
    {
      accessorFn: (r) => Number(r.qty_available || 0),
      id: "qty_available",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Available" />,
      cell: ({ row }) => <span className="font-mono text-sm">{fmtQty(row.original.qty_available)}</span>,
    },
    {
      accessorFn: (r) => Number(r.incoming_qty || 0),
      id: "incoming_qty",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Incoming" />,
      cell: ({ row }) => <span className="font-mono text-sm">{fmtQty(row.original.incoming_qty)}</span>,
    },
  ], [warehouseById]);

  const stockBatchColumns = useMemo<ColumnDef<StockBatchRow>[]>(() => [
    {
      accessorFn: (r) => warehouseById.get(String(r.warehouse_id))?.name || r.warehouse_id,
      id: "warehouse",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" />,
      cell: ({ row }) => warehouseById.get(String(row.original.warehouse_id))?.name || shortId(String(row.original.warehouse_id)),
    },
    {
      accessorFn: (r) => r.batch_no || "",
      id: "batch",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Batch" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.batch_no || "-"}</span>,
    },
    {
      accessorFn: (r) => r.expiry_date || "",
      id: "expiry",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Expiry" />,
      cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.expiry_date || "-").slice(0, 10)}</span>,
    },
    {
      accessorFn: (r) => Number(r.qty_on_hand || 0),
      id: "qty_on_hand",
      header: ({ column }) => <DataTableColumnHeader column={column} title="On Hand" />,
      cell: ({ row }) => <span className="font-mono text-sm">{fmtQty(row.original.qty_on_hand)}</span>,
    },
  ], [warehouseById]);

  const priceChangeColumns = useMemo<ColumnDef<PriceChangeRow>[]>(() => {
    const fmtPct = (v: string | number | null | undefined) => {
      if (v == null) return "-";
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return "-";
      const pct = n * 100;
      return `${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
    };
    return [
      {
        accessorKey: "changed_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="When" />,
        cell: ({ row }) => <span className="font-mono text-xs">{formatDateLike(row.original.changed_at)}</span>,
      },
      {
        accessorFn: (r) => r.effective_from || "",
        id: "effective",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Effective" />,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{formatDate(row.original.effective_from)}</span>,
      },
      {
        accessorFn: (r) => Number(r.new_price_usd || 0),
        id: "usd",
        header: ({ column }) => <DataTableColumnHeader column={column} title="USD" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {fmtUsdMaybe(row.original.old_price_usd)}{" "}
            <span className="text-muted-foreground">-&gt;</span>{" "}
            {fmtUsdMaybe(row.original.new_price_usd)}
          </span>
        ),
      },
      {
        accessorFn: (r) => Number(r.pct_change_usd || 0),
        id: "usd_pct",
        header: ({ column }) => <DataTableColumnHeader column={column} title="USD %" />,
        cell: ({ row }) => <span className="font-mono text-xs">{fmtPct(row.original.pct_change_usd)}</span>,
      },
      {
        accessorFn: (r) => Number(r.new_price_lbp || 0),
        id: "lbp",
        header: ({ column }) => <DataTableColumnHeader column={column} title="LBP" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {fmtLbpMaybe(row.original.old_price_lbp, { dashIfZero: Number(row.original.old_price_usd || 0) !== 0 })}{" "}
            <span className="text-muted-foreground">-&gt;</span>{" "}
            {fmtLbpMaybe(row.original.new_price_lbp, { dashIfZero: Number(row.original.new_price_usd || 0) !== 0 })}
          </span>
        ),
      },
      {
        accessorFn: (r) => Number(r.pct_change_lbp || 0),
        id: "lbp_pct",
        header: ({ column }) => <DataTableColumnHeader column={column} title="LBP %" />,
        cell: ({ row }) => <span className="font-mono text-xs">{fmtPct(row.original.pct_change_lbp)}</span>,
      },
      {
        accessorFn: (r) => r.source_type || "",
        id: "source",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.source_type || "-"}</span>,
      },
    ];
  }, []);

  const barcodeColumns = useMemo<ColumnDef<ItemBarcode>[]>(() => [
    {
      accessorKey: "barcode",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Barcode" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{row.original.barcode}</span>
          <CopyButton text={row.original.barcode} label="barcode" />
        </div>
      ),
    },
    {
      accessorFn: (b) => Number(b.qty_factor || 1),
      id: "qty_factor",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Factor" />,
      cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.qty_factor || 1)}</span>,
    },
    {
      accessorFn: (b) => b.uom_code || item?.unit_of_measure || "",
      id: "uom_code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="UOM" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.uom_code || item?.unit_of_measure || "-"}</span>,
    },
    {
      accessorFn: (b) => b.label || "",
      id: "label",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Label" />,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.label || ""}</span>,
    },
    {
      accessorFn: (b) => (b.is_primary ? 1 : 0),
      id: "is_primary",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Primary" />,
      cell: ({ row }) => row.original.is_primary ? <Badge variant="default">Primary</Badge> : <Badge variant="secondary">No</Badge>,
    },
  ], [item?.unit_of_measure]);

  const supplierColumns = useMemo<ColumnDef<ItemSupplierLinkRow>[]>(() => [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorFn: (s) => (s.is_primary ? 1 : 0),
      id: "is_primary",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Primary" />,
      cell: ({ row }) => row.original.is_primary ? <Badge variant="default">Primary</Badge> : <Badge variant="secondary">No</Badge>,
    },
    {
      accessorFn: (s) => Number(s.lead_time_days || 0),
      id: "lead_time",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Lead (days)" />,
      cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.lead_time_days || 0)}</span>,
    },
    {
      accessorFn: (s) => Number(s.min_order_qty || 0),
      id: "min_order",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Min Qty" />,
      cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.min_order_qty || 0)}</span>,
    },
    {
      accessorFn: (s) => Number(s.last_cost_usd || 0),
      id: "last_cost_usd",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Last Cost USD" />,
      cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.last_cost_usd || 0)}</span>,
    },
    {
      accessorFn: (s) => Number(s.last_cost_lbp || 0),
      id: "last_cost_lbp",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Last Cost LBP" />,
      cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.last_cost_lbp || 0)}</span>,
    },
  ], []);

  const conversionColumns = useMemo<ColumnDef<UomConversionRow>[]>(() => [
    {
      accessorKey: "uom_code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="UOM" />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.uom_code}</span>,
    },
    {
      accessorFn: (r) => r.uom_name || "",
      id: "uom_name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.uom_name || ""}</span>,
    },
    {
      accessorFn: (r) => Number(r.to_base_factor || 0),
      id: "to_base_factor",
      header: ({ column }) => <DataTableColumnHeader column={column} title={`To ${uomBase || "BASE"}`} />,
      cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.to_base_factor || "")}</span>,
    },
    {
      accessorFn: (r) => (r.is_active ? 1 : 0),
      id: "active",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Active" />,
      cell: ({ row }) => <StatusBadge status={row.original.is_active ? "active" : "inactive"} />,
    },
  ], [uomBase]);

  const policyColumns = useMemo<ColumnDef<ItemWarehousePolicyRow>[]>(() => [
    {
      accessorKey: "warehouse_name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Warehouse" />,
      cell: ({ row }) => row.original.warehouse_name,
    },
    {
      accessorFn: (p) => Number(p.min_stock || 0),
      id: "min_stock",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Min" />,
      cell: ({ row }) => <span className="font-mono text-sm">{fmtQty(row.original.min_stock)}</span>,
    },
    {
      accessorFn: (p) => Number(p.max_stock || 0),
      id: "max_stock",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Max" />,
      cell: ({ row }) => <span className="font-mono text-sm">{fmtQty(row.original.max_stock)}</span>,
    },
    {
      accessorFn: (p) => Number(p.replenishment_lead_time_days || 0),
      id: "lead",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Lead (days)" />,
      cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.replenishment_lead_time_days ?? "-")}</span>,
    },
    {
      accessorFn: (p) => p.preferred_supplier_name || "",
      id: "supplier",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Preferred Supplier" />,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.preferred_supplier_name || "-"}</span>,
    },
    {
      accessorFn: (p) => p.notes || "",
      id: "notes",
      header: "Notes",
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.notes || ""}</span>,
    },
  ], []);

  /* ---- Error state ---- */
  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <PageHeader
          title="Item"
          description={shortId(id)}
          backHref="/catalog/items/list"
        />
        <Card>
          <CardContent className="py-8">
            <EmptyState
              title="Failed to load item"
              description={err}
              action={{ label: "Retry", onClick: load }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---- Not found ---- */
  if (!loading && !item) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <PageHeader title="Item not found" backHref="/catalog/items/list" />
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={Package}
              title="Item not found"
              description="This item may have been deleted or you may not have access."
              action={{ label: "Back to list", onClick: () => router.push("/catalog/items/list") }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---- Loading skeleton ---- */
  if (loading && !item) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  if (!item) return null;

  /* ---- Render ---- */
  const negativeStockLabel = item.allow_negative_stock === null || item.allow_negative_stock === undefined
    ? "inherit" : item.allow_negative_stock ? "allowed" : "blocked";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <PageHeader
        title={item.name}
        backHref="/catalog/items/list"
        badge={<StatusBadge status={item.is_active === false ? "inactive" : "active"} />}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button asChild>
              <Link href="/catalog/items/new">
                <Plus className="mr-2 h-4 w-4" />
                New Item
              </Link>
            </Button>
            <DocumentUtilitiesDrawer entityType="item" entityId={item.id} allowUploadAttachments={true} />
          </>
        }
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono text-xs">{item.sku}</span>
          <CopyButton text={item.sku} label="SKU" />
          <span className="text-muted-foreground/50">|</span>
          <span className="font-mono text-xs">{shortId(id)}</span>
          <CopyButton text={id} label="ID" />
        </div>
      </PageHeader>

      {/* Tabs */}
      <Tabs value={tabId} onValueChange={onTabChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <Package className="h-4 w-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="pricing" className="gap-2">
            <DollarSign className="h-4 w-4" /> Pricing
          </TabsTrigger>
          <TabsTrigger value="stock" className="gap-2">
            <Warehouse className="h-4 w-4" /> Stock
          </TabsTrigger>
          <TabsTrigger value="batches" className="gap-2">
            <Barcode className="h-4 w-4" /> Batches &amp; Logistics
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <Tags className="h-4 w-4" /> History
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* OVERVIEW TAB                                                      */}
        {/* ================================================================ */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* Left: core profile */}
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle>Item Profile</CardTitle>
                    <CardDescription>Core identity and classification</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>Edit</Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Primary identifiers */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DetailField label="Name" value={item.name || "-"} />
                    <DetailField label="SKU" value={item.sku || "-"} copyText={item.sku} mono />
                    <DetailField label="Primary Barcode" value={item.barcode || "-"} copyText={item.barcode || ""} mono />
                    <DetailField label="Item Type" value={itemTypeLabel(item.item_type)} />
                  </div>

                  <Separator />

                  {/* Classification */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DetailField label="UOM" value={item.unit_of_measure || "-"} mono />
                    <DetailField
                      label="Category"
                      value={item.category_id ? (categoryMeta?.name || shortId(item.category_id)) : "-"}
                      hint={item.category_id ? `ID: ${shortId(item.category_id)}` : undefined}
                    />
                    <DetailField
                      label="Tax Code"
                      value={
                        item.tax_code_id
                          ? (taxMeta ? `${taxMeta.name}${taxMeta.rate != null ? ` (${fmtRate(taxMeta.rate)})` : ""}` : item.tax_code_id)
                          : "-"
                      }
                    />
                    <DetailField label="Brand" value={item.brand || "-"} />
                  </div>

                  <Separator />

                  {/* Lifecycle */}
                  <div className="grid gap-4 sm:grid-cols-3">
                    <DetailField label="Track Batches" value={item.track_batches ? "On" : "Off"} />
                    <DetailField label="Track Expiry" value={item.track_expiry ? "On" : "Off"} />
                    <DetailField label="Negative Stock" value={negativeStockLabel} />
                  </div>

                  {/* Tags */}
                  {item.tags?.length ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {item.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                        </div>
                      </div>
                    </>
                  ) : null}

                  {/* Description */}
                  {item.description ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Description</p>
                        <p className="whitespace-pre-wrap text-sm">{item.description}</p>
                      </div>
                    </>
                  ) : null}

                  {/* External IDs */}
                  {item.external_ids ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">External IDs</p>
                        <ViewRaw value={item.external_ids} label="View external IDs" defaultOpen={false} />
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>

              {/* Reorder & operations */}
              <Card>
                <CardHeader>
                  <CardTitle>Operations</CardTitle>
                  <CardDescription>Reorder and shelf-life parameters</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <DetailField label="Reorder Point" value={String(item.reorder_point ?? "-")} mono />
                    <DetailField label="Reorder Qty" value={String(item.reorder_qty ?? "-")} mono />
                    <DetailField label="Shelf Life" value={`${item.default_shelf_life_days ?? "-"} days`} />
                    <DetailField label="Min for Sale" value={`${item.min_shelf_life_days_for_sale ?? "-"} days`} />
                    <DetailField label="Expiry Warning" value={`${item.expiry_warning_days ?? "-"} days`} />
                    <DetailField label="Excise" value={item.is_excise ? "Yes" : "No"} />
                    {item.short_name ? <DetailField label="Short Name" value={item.short_name} /> : null}
                    {preferredSupplierName ? <DetailField label="Preferred Supplier" value={preferredSupplierName} /> : null}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right sidebar: image + quick stats */}
            <div className="space-y-6">
              {/* Image */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Image</CardTitle>
                </CardHeader>
                <CardContent>
                  {item.image_attachment_id ? (
                    <div className="space-y-3">
                      <div className="overflow-hidden rounded-lg bg-muted/30 p-2">
                        <Image
                          src={apiUrl(`/attachments/${encodeURIComponent(item.image_attachment_id)}/view`)}
                          alt={item.image_alt || item.name}
                          width={280}
                          height={280}
                          className="mx-auto h-[200px] w-[200px] object-contain"
                          unoptimized
                        />
                      </div>
                      {item.image_alt ? (
                        <p className="text-xs text-muted-foreground">Alt: {item.image_alt}</p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <a href={apiUrl(`/attachments/${encodeURIComponent(item.image_attachment_id)}/view`)} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-1.5 h-3 w-3" /> View
                          </a>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-center">
                      <div className="flex h-32 items-center justify-center rounded-lg bg-muted/20">
                        <Package className="h-10 w-10 text-muted-foreground/40" />
                      </div>
                      <p className="text-sm text-muted-foreground">No image</p>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>Upload</Link>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quick stock summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Stock Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">On Hand</p>
                      <p className="font-mono text-lg font-semibold">{fmtQty(stockTotals.on_hand)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Available</p>
                      <p className="font-mono text-lg font-semibold">{fmtQty(stockTotals.available)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Reserved</p>
                      <p className="font-mono text-sm">{fmtQty(stockTotals.reserved)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Incoming</p>
                      <p className="font-mono text-sm">{fmtQty(stockTotals.incoming)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Timestamps */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Timestamps</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Created</span>
                    <span className="font-mono text-xs">{formatDateLike(item.created_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Updated</span>
                    <span className="font-mono text-xs">{formatDateLike(item.updated_at)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* PRICING TAB                                                       */}
        {/* ================================================================ */}
        <TabsContent value="pricing" className="space-y-6">
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <KpiCard
              title="Effective Sell Price"
              icon={DollarSign}
              value={priceSuggest?.current
                ? fmtUsdLbp(priceSuggest.current.price_usd, priceSuggest.current.price_lbp, { sep: " / " })
                : "-"}
              description={`Default list: ${defaultListLabel}${pricingSecondaryMissing ? " (LBP derived from FX)" : ""}`}
            />
            <KpiCard
              title="Average Cost"
              value={priceSuggest?.current
                ? fmtUsdLbp(priceSuggest.current.avg_cost_usd, priceSuggest.current.avg_cost_lbp, { sep: " / " })
                : "-"}
              description={priceSuggest?.current?.margin_usd != null
                ? `Margin: ${(Number(priceSuggest.current.margin_usd) * 100).toFixed(1)}% (USD)`
                : undefined}
            />
            <KpiCard
              title="Margin"
              value={`${fmtPctFrac(priceSuggest?.current?.margin_usd)} (USD)`}
              description={priceSuggest ? `Target: ${fmtPctFrac(priceSuggest.target_margin_pct)}` : undefined}
            />
          </div>

          {/* WHOLESALE / RETAIL overrides */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle>Price List Overrides</CardTitle>
                <CardDescription>Effective WHOLESALE and RETAIL prices for this item</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>Edit Prices</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/catalog/price-lists">Price Lists</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2 rounded-lg border p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">WHOLESALE</p>
                  <p className="font-mono text-lg font-semibold">
                    {wholesaleEffective
                      ? `${fmtUsdMaybe(wholesaleEffective.price_usd, { dashIfZero: true })} / ${fmtLbpMaybe(wholesaleEffective.price_lbp, { dashIfZero: true })}`
                      : "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {wholesaleEffective?.effective_from ? `From: ${String(wholesaleEffective.effective_from).slice(0, 10)}` : "No override row"}
                  </p>
                </div>
                <div className="space-y-2 rounded-lg border p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">RETAIL</p>
                  <p className="font-mono text-lg font-semibold">
                    {retailEffective
                      ? `${fmtUsdMaybe(retailEffective.price_usd, { dashIfZero: true })} / ${fmtLbpMaybe(retailEffective.price_lbp, { dashIfZero: true })}`
                      : "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {retailEffective?.effective_from ? `From: ${String(retailEffective.effective_from).slice(0, 10)}` : "No override row"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Suggested Price */}
          {priceSuggest?.suggested ? (
            <Card>
              <CardHeader>
                <CardTitle>Suggested Price</CardTitle>
                <CardDescription>
                  Based on average cost and target margin ({fmtPctFrac(priceSuggest.target_margin_pct)}). Rounding: USD step {priceSuggest.rounding?.usd_step || "-"} / LBP step {priceSuggest.rounding?.lbp_step || "-"}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Suggested</p>
                    <p className="font-mono text-lg font-semibold">
                      {fmtUsdLbp(priceSuggest.suggested.price_usd, priceSuggest.suggested.price_lbp, { sep: " / " })}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>Apply via Edit</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Legacy Prices */}
          {legacyPrices.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Legacy Item Prices</CardTitle>
                <CardDescription>Historical item_prices rows. Modern pricing uses price lists.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {legacyPrices.slice(0, 25).map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {String(p.effective_from).slice(0, 10)}
                        {p.effective_to ? ` -> ${String(p.effective_to).slice(0, 10)}` : ""}
                      </span>
                      <span className="font-mono text-sm">
                        {fmtUsdLbp(p.price_usd, p.price_lbp, { sep: " / " })}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {/* ================================================================ */}
        {/* STOCK TAB                                                         */}
        {/* ================================================================ */}
        <TabsContent value="stock" className="space-y-6">
          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-4">
            <KpiCard title="On Hand" icon={Warehouse} value={fmtQty(stockTotals.on_hand)} />
            <KpiCard title="Reserved" value={fmtQty(stockTotals.reserved)} />
            <KpiCard title="Available" value={fmtQty(stockTotals.available)} />
            <KpiCard title="Incoming" icon={Truck} value={fmtQty(stockTotals.incoming)} />
          </div>

          {/* Per-warehouse */}
          <Card>
            <CardHeader>
              <CardTitle>Warehouse Breakdown</CardTitle>
              <CardDescription>Stock levels per warehouse</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={stockColumns}
                data={stock}
                isLoading={loading}
                searchPlaceholder="Search warehouses..."
                pageSize={20}
              />
            </CardContent>
          </Card>

          {/* Batch stock */}
          {(item.track_batches || item.track_expiry) && stockBatches.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Batch Stock</CardTitle>
                <CardDescription>Stock by batch and expiry date</CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={stockBatchColumns}
                  data={stockBatches}
                  isLoading={loading}
                  searchPlaceholder="Search batches..."
                  pageSize={20}
                />
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {/* ================================================================ */}
        {/* BATCHES & LOGISTICS TAB                                           */}
        {/* ================================================================ */}
        <TabsContent value="batches" className="space-y-6">
          {/* UOM Conversions */}
          <Card>
            <CardHeader>
              <CardTitle>UOM Conversions</CardTitle>
              <CardDescription>How non-base units convert to base UOM ({uomBase || item.unit_of_measure || "-"})</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={conversionColumns}
                data={uomConversions}
                isLoading={loading}
                searchPlaceholder="Search UOMs..."
                pageSize={10}
              />
            </CardContent>
          </Card>

          {/* Warehouse Policies */}
          <Card>
            <CardHeader>
              <CardTitle>Warehouse Policies</CardTitle>
              <CardDescription>Per-warehouse min/max and replenishment hints</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={policyColumns}
                data={warehousePolicies}
                isLoading={loading}
                searchPlaceholder="Search warehouses..."
                pageSize={10}
              />
            </CardContent>
          </Card>

          {/* Barcodes & Suppliers side by side */}
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Barcodes</CardTitle>
                <CardDescription>Primary and alternate barcodes ({barcodes.length})</CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={barcodeColumns}
                  data={barcodes}
                  isLoading={loading}
                  pageSize={10}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Suppliers</CardTitle>
                <CardDescription>Linked suppliers and last cost ({suppliers.length})</CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={supplierColumns}
                  data={suppliers}
                  isLoading={loading}
                  pageSize={10}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* HISTORY TAB                                                       */}
        {/* ================================================================ */}
        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle>Price Change History</CardTitle>
                <CardDescription>Sell price changes derived from item price inserts ({priceChanges.length} records)</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/inventory/price-changes/list?q=${encodeURIComponent(item.sku || "")}`}>
                  <ExternalLink className="mr-1.5 h-3 w-3" /> Full Log
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={priceChangeColumns}
                data={priceChanges}
                isLoading={loading}
                searchPlaceholder="Search changes..."
                pageSize={25}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
