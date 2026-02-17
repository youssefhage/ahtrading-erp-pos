"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Check, Copy } from "lucide-react";

import { apiGet, apiUrl } from "@/lib/api";
import { formatDate, formatDateLike } from "@/lib/datetime";
import { fmtLbpMaybe, fmtUsdLbp, fmtUsdMaybe } from "@/lib/money";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { DocumentUtilitiesDrawer } from "@/components/document-utilities-drawer";
import { ViewRaw } from "@/components/view-raw";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";

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
  id: string; // link id
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

type ItemPriceRow = { id: string; price_usd: string | number; price_lbp: string | number; effective_from: string; effective_to: string | null };

function shortId(v: string, head = 8, tail = 4) {
  const s = (v || "").trim();
  if (!s) return "-";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function itemTypeLabel(t?: Item["item_type"]) {
  if (t === "service") return "Service";
  if (t === "bundle") return "Bundle";
  return "Stocked";
}

function fmtRate(v: string | number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  // Most rates are stored as "11" for 11%, so keep it simple and readable.
  const s = String(n);
  return `${s.replace(/\.0+$/, "")}%`;
}

function fmtPctFrac(v: string | number | null | undefined) {
  if (v == null) return "-";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtIso(iso?: string | null) {
  return formatDateLike(iso);
}

function fmtQty(v: string | number | null | undefined) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return String(v ?? "");
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function CopyIconButton(props: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const text = (props.text || "").trim();
  const disabled = !text || text === "-";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8 text-fg-muted hover:text-foreground", props.className)}
      disabled={disabled}
      onClick={async () => {
        if (disabled) return;
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          // ignore
        }
      }}
      title={disabled ? undefined : `Copy${props.label ? ` ${props.label}` : ""}`}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

function KeyField(props: { label: string; value: string; mono?: boolean; copyText?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/45 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">{props.label}</p>
        {props.copyText ? <CopyIconButton text={props.copyText} label={props.label} className="h-7 w-7" /> : null}
      </div>
      <p
        className={cn(
          "mt-1 text-sm font-semibold leading-snug text-foreground",
          props.mono && "font-mono font-medium text-[13px]"
        )}
        title={props.value}
      >
        {props.value}
      </p>
      {props.hint ? <p className="mt-1 text-xs text-fg-subtle">{props.hint}</p> : null}
    </div>
  );
}

function SummaryField(props: { label: string; value: string; mono?: boolean; copyText?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">{props.label}</p>
        {props.copyText ? <CopyIconButton text={props.copyText} label={props.label} className="h-7 w-7" /> : null}
      </div>
      <p
        className={cn(
          "mt-1 text-[15px] font-semibold leading-snug text-foreground",
          props.mono && "font-mono text-[14px] font-medium"
        )}
        title={props.value}
      >
        {props.value}
      </p>
      {props.hint ? <p className="mt-1 text-xs text-fg-subtle">{props.hint}</p> : null}
    </div>
  );
}

export default function ItemViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
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
  const searchParams = useSearchParams();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
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

      // Optional: show effective WHOLESALE/RETAIL overrides for this item.
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

      const tracked = Boolean(it.item?.track_batches || it.item?.track_expiry);
      if (tracked) {
        const sb = await apiGet<{ stock: StockBatchRow[] }>(`/inventory/stock?item_id=${encodeURIComponent(id)}&by_batch=1`).catch(() => ({ stock: [] as any[] }));
        setStockBatches((sb as any)?.stock || []);
      } else {
        setStockBatches([]);
      }

      // Fallback if the API doesn't support filtering by item_id: query by SKU then filter locally.
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
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const title = useMemo(() => {
    if (loading) return "Loading...";
    if (item) return `${item.sku} · ${item.name}`;
    return "Item";
  }, [loading, item]);

  const taxById = useMemo(() => new Map(taxCodes.map((t) => [t.id, t])), [taxCodes]);
  const taxMeta = useMemo(() => (item?.tax_code_id ? taxById.get(item.tax_code_id) : undefined), [item?.tax_code_id, taxById]);
  const defaultListLabel = useMemo(() => {
    const pl = priceLists.find((l) => l.id === defaultPriceListId) || priceLists.find((l) => l.is_default) || null;
    return pl ? `${pl.code} · ${pl.name}` : "-";
  }, [priceLists, defaultPriceListId]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [String(c.id), c])), [categories]);
  const categoryMeta = useMemo(() => (item?.category_id ? categoryById.get(String(item.category_id)) : undefined), [item?.category_id, categoryById]);

  const warehouseById = useMemo(() => new Map(warehouses.map((w) => [String(w.id), w])), [warehouses]);

  const preferredSupplierName = useMemo(() => {
    const pid = String(item?.preferred_supplier_id || "").trim();
    if (!pid) return "";
    const s = suppliers.find((x) => String(x.supplier_id) === pid);
    return s?.name || pid;
  }, [item?.preferred_supplier_id, suppliers]);

  const negativeStockPolicy = useMemo(() => {
    const v = item?.allow_negative_stock;
    if (v === null || v === undefined) return { label: "inherit", variant: "default" as const };
    return v ? { label: "allowed", variant: "danger" as const } : { label: "blocked", variant: "success" as const };
  }, [item?.allow_negative_stock]);

  const pricingSecondaryMissing = useMemo(() => {
    const usd = Number((priceSuggest as any)?.current?.price_usd || 0) || 0;
    const lbp = Number((priceSuggest as any)?.current?.price_lbp || 0) || 0;
    return usd > 0 && lbp === 0;
  }, [priceSuggest]);

  const stockTotals = useMemo(() => {
    let on_hand = 0;
    let reserved = 0;
    let available = 0;
    let incoming = 0;
    for (const r of stock || []) {
      on_hand += Number((r as any)?.qty_on_hand || 0) || 0;
      reserved += Number((r as any)?.reserved_qty || 0) || 0;
      available += Number((r as any)?.qty_available || 0) || 0;
      incoming += Number((r as any)?.incoming_qty || 0) || 0;
    }
    return { on_hand, reserved, available, incoming };
  }, [stock]);

  const tabId = useMemo<"overview" | "pricing" | "inventory" | "logistics">(() => {
    const next = String(searchParams.get("tab") || "").toLowerCase();
    if (next === "pricing" || next === "inventory" || next === "logistics") return next;
    return "overview";
  }, [searchParams]);

  const tabBaseHref = `/catalog/items/${encodeURIComponent(id)}`;
  const itemTabs = useMemo(
    () => [
      { label: "Overview", href: `${tabBaseHref}?tab=overview`, activeQuery: { key: "tab", value: "overview" } },
      { label: "Pricing", href: `${tabBaseHref}?tab=pricing`, activeQuery: { key: "tab", value: "pricing" } },
      { label: "Inventory", href: `${tabBaseHref}?tab=inventory`, activeQuery: { key: "tab", value: "inventory" } },
      { label: "Logistics", href: `${tabBaseHref}?tab=logistics`, activeQuery: { key: "tab", value: "logistics" } },
    ],
    [tabBaseHref]
  );

  useEffect(() => {
    if (!item) return;
    const currentTab = String(searchParams.get("tab") || "").toLowerCase();
    if (currentTab !== "overview" && currentTab !== "pricing" && currentTab !== "inventory" && currentTab !== "logistics") {
      router.replace(`${tabBaseHref}?tab=overview`);
    }
  }, [router, item, searchParams, tabBaseHref]);

  const stockColumns = useMemo((): Array<DataTableColumn<StockRow>> => {
    return [
      {
        id: "warehouse",
        header: "Warehouse",
        sortable: true,
        accessor: (r) => warehouseById.get(String(r.warehouse_id))?.name || r.warehouse_id,
        cell: (r) => <span className="text-sm">{warehouseById.get(String(r.warehouse_id))?.name || shortId(String(r.warehouse_id))}</span>,
      },
      {
        id: "qty_on_hand",
        header: "On Hand",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number((r as any)?.qty_on_hand || 0),
        cell: (r) => <span className="font-mono text-sm">{fmtQty((r as any)?.qty_on_hand)}</span>,
      },
      {
        id: "reserved_qty",
        header: "Reserved",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number((r as any)?.reserved_qty || 0),
        cell: (r) => <span className="font-mono text-sm">{fmtQty((r as any)?.reserved_qty)}</span>,
      },
      {
        id: "qty_available",
        header: "Available",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number((r as any)?.qty_available || 0),
        cell: (r) => <span className="font-mono text-sm">{fmtQty((r as any)?.qty_available)}</span>,
      },
      {
        id: "incoming_qty",
        header: "Incoming",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number((r as any)?.incoming_qty || 0),
        cell: (r) => <span className="font-mono text-sm">{fmtQty((r as any)?.incoming_qty)}</span>,
      },
    ];
  }, [warehouseById]);

  const priceChangeColumns = useMemo((): Array<DataTableColumn<PriceChangeRow>> => {
    const fmtWhen = (iso: string) => formatDateLike(iso);
    const fmtPct = (v: string | number | null | undefined) => {
      if (v == null) return "-";
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return "-";
      const pct = n * 100;
      const s = pct.toFixed(Math.abs(pct) < 10 ? 1 : 0);
      return `${s}%`;
    };
    return [
      {
        id: "when",
        header: "When",
        sortable: true,
        mono: true,
        accessor: (r) => r.changed_at,
        cell: (r) => <span className="text-xs">{fmtWhen(r.changed_at)}</span>,
      },
      {
        id: "effective",
        header: "Effective",
        sortable: true,
        mono: true,
        accessor: (r) => String(r.effective_from || ""),
        cell: (r) => <span className="text-xs text-fg-subtle">{formatDate(r.effective_from)}</span>,
      },
      {
        id: "usd",
        header: "USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.new_price_usd || 0),
        cell: (r) => (
          <span className="data-mono text-xs">
            {fmtUsdMaybe(r.old_price_usd)} <span className="text-fg-subtle">→</span> {fmtUsdMaybe(r.new_price_usd)}
          </span>
        ),
      },
      {
        id: "usd_pct",
        header: "USD %",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.pct_change_usd || 0),
        cell: (r) => <span className="text-xs">{fmtPct(r.pct_change_usd)}</span>,
      },
      {
        id: "lbp",
        header: "LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.new_price_lbp || 0),
        cell: (r) => (
          <span className="data-mono text-xs">
            {fmtLbpMaybe(r.old_price_lbp, { dashIfZero: Number(r.old_price_usd || 0) !== 0 })} <span className="text-fg-subtle">→</span>{" "}
            {fmtLbpMaybe(r.new_price_lbp, { dashIfZero: Number(r.new_price_usd || 0) !== 0 })}
          </span>
        ),
      },
      {
        id: "lbp_pct",
        header: "LL %",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.pct_change_lbp || 0),
        cell: (r) => <span className="text-xs">{fmtPct(r.pct_change_lbp)}</span>,
      },
      {
        id: "source",
        header: "Source",
        sortable: true,
        accessor: (r) => String(r.source_type || ""),
        cell: (r) => <span className="text-xs text-fg-muted">{String(r.source_type || "-")}</span>,
      },
    ];
  }, []);

  const stockBatchColumns = useMemo((): Array<DataTableColumn<StockBatchRow>> => {
    return [
      {
        id: "warehouse",
        header: "Warehouse",
        sortable: true,
        accessor: (r) => warehouseById.get(String(r.warehouse_id))?.name || r.warehouse_id,
        cell: (r) => <span className="text-sm">{warehouseById.get(String(r.warehouse_id))?.name || shortId(String(r.warehouse_id))}</span>,
      },
      {
        id: "batch",
        header: "Batch",
        sortable: true,
        mono: true,
        accessor: (r) => String(r.batch_no || ""),
        cell: (r) => <span className="font-mono text-xs">{String(r.batch_no || "-")}</span>,
      },
      {
        id: "expiry",
        header: "Expiry",
        sortable: true,
        mono: true,
        accessor: (r) => String(r.expiry_date || ""),
        cell: (r) => <span className="font-mono text-xs">{String(r.expiry_date || "-").slice(0, 10) || "-"}</span>,
      },
      {
        id: "qty_on_hand",
        header: "On Hand",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number((r as any)?.qty_on_hand || 0),
        cell: (r) => <span className="font-mono text-sm">{fmtQty((r as any)?.qty_on_hand)}</span>,
      },
    ];
  }, [warehouseById]);

  const conversionColumns = useMemo((): Array<DataTableColumn<UomConversionRow>> => {
    return [
      {
        id: "uom",
        header: "UOM",
        sortable: true,
        mono: true,
        accessor: (r) => r.uom_code,
        cell: (r) => <span className="font-mono text-sm">{r.uom_code}</span>,
      },
      {
        id: "name",
        header: "Name",
        sortable: true,
        accessor: (r) => r.uom_name || "",
        cell: (r) => <span className="text-sm text-fg-muted">{r.uom_name || ""}</span>,
      },
      {
        id: "to_base_factor",
        header: `To ${uomBase || "BASE"}`,
        sortable: true,
        align: "right",
        mono: true,
        accessor: (r) => Number(r.to_base_factor || 0),
        cell: (r) => <span className="font-mono text-sm">{String(r.to_base_factor || "")}</span>,
      },
      {
        id: "active",
        header: "Active",
        sortable: true,
        accessor: (r) => (r.is_active ? "yes" : "no"),
        cell: (r) => (r.is_active ? <Chip variant="success">yes</Chip> : <Chip variant="default">no</Chip>),
      },
    ];
  }, [uomBase]);

  const policyColumns = useMemo((): Array<DataTableColumn<ItemWarehousePolicyRow>> => {
    return [
      { id: "warehouse", header: "Warehouse", sortable: true, accessor: (p) => p.warehouse_name, cell: (p) => <span className="text-sm">{p.warehouse_name}</span> },
      { id: "min", header: "Min", sortable: true, align: "right", mono: true, accessor: (p) => Number(p.min_stock || 0), cell: (p) => <span className="font-mono text-sm">{fmtQty(p.min_stock)}</span> },
      { id: "max", header: "Max", sortable: true, align: "right", mono: true, accessor: (p) => Number(p.max_stock || 0), cell: (p) => <span className="font-mono text-sm">{fmtQty(p.max_stock)}</span> },
      { id: "lead", header: "Lead (days)", sortable: true, align: "right", mono: true, accessor: (p) => Number(p.replenishment_lead_time_days || 0), cell: (p) => <span className="font-mono text-sm">{String(p.replenishment_lead_time_days ?? "-")}</span> },
      { id: "supplier", header: "Preferred Supplier", sortable: true, accessor: (p) => p.preferred_supplier_name || "", cell: (p) => <span className="text-sm text-fg-muted">{p.preferred_supplier_name || "-"}</span> },
      { id: "notes", header: "Notes", sortable: false, accessor: (p) => p.notes || "", cell: (p) => <span className="text-sm text-fg-muted">{p.notes || ""}</span> },
    ];
  }, []);
  const barcodeColumns = useMemo((): Array<DataTableColumn<ItemBarcode>> => {
    return [
      {
        id: "barcode",
        header: "Barcode",
        sortable: true,
        mono: true,
        accessor: (b) => b.barcode,
        cell: (b) => (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm">{b.barcode}</span>
            <CopyIconButton text={b.barcode} label="barcode" className="h-7 w-7" />
          </div>
        ),
      },
      {
        id: "qty_factor",
        header: "Factor",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (b) => Number(b.qty_factor || 1),
        cell: (b) => <span className="font-mono text-sm">{String(b.qty_factor || 1)}</span>,
      },
      {
        id: "uom_code",
        header: "UOM",
        sortable: true,
        mono: true,
        accessor: (b) => String(b.uom_code || item?.unit_of_measure || ""),
        cell: (b) => <span className="font-mono text-sm">{String(b.uom_code || item?.unit_of_measure || "-")}</span>,
      },
      {
        id: "label",
        header: "Label",
        sortable: true,
        accessor: (b) => b.label || "",
        cell: (b) => <span className="text-sm text-fg-muted">{b.label || ""}</span>,
      },
      {
        id: "is_primary",
        header: "Primary",
        sortable: true,
        accessor: (b) => (b.is_primary ? "yes" : "no"),
        cell: (b) => (b.is_primary ? <Chip variant="primary">yes</Chip> : <Chip variant="default">no</Chip>),
      },
    ];
  }, [item?.unit_of_measure]);
  const supplierColumns = useMemo((): Array<DataTableColumn<ItemSupplierLinkRow>> => {
    return [
      {
        id: "name",
        header: "Supplier",
        sortable: true,
        accessor: (s) => s.name,
        cell: (s) => <span className="text-sm">{s.name}</span>,
      },
      {
        id: "is_primary",
        header: "Primary",
        sortable: true,
        accessor: (s) => (s.is_primary ? "yes" : "no"),
        cell: (s) => (s.is_primary ? <Chip variant="primary">yes</Chip> : <Chip variant="default">no</Chip>),
      },
      {
        id: "lead_time_days",
        header: "Lead (days)",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.lead_time_days || 0),
        cell: (s) => <span className="font-mono text-sm">{String(s.lead_time_days || 0)}</span>,
      },
      {
        id: "min_order_qty",
        header: "Min Qty",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.min_order_qty || 0),
        cell: (s) => <span className="font-mono text-sm">{String(s.min_order_qty || 0)}</span>,
      },
      {
        id: "last_cost_usd",
        header: "Last Cost USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.last_cost_usd || 0),
        cell: (s) => <span className="font-mono text-sm">{String(s.last_cost_usd || 0)}</span>,
      },
      {
        id: "last_cost_lbp",
        header: "Last Cost LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.last_cost_lbp || 0),
        cell: (s) => <span className="font-mono text-sm">{String(s.last_cost_lbp || 0)}</span>,
      },
    ];
  }, []);

  if (err) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Item</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <span className="font-mono text-xs">{shortId(id)}</span>
              <CopyIconButton text={id} label="ID" className="h-7 w-7" />
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")}>
            Back
          </Button>
        </div>
        <ErrorBanner error={err} onRetry={load} />
      </div>
    );
  }

  if (!loading && !item) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <EmptyState
          title="Item not found"
          description="This item may have been deleted or you may not have access."
          actionLabel="Back"
          onAction={() => router.push("/catalog/items/list")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span className="font-mono text-xs">{shortId(id)}</span>
            <CopyIconButton text={id} label="ID" className="h-7 w-7" />
            {item ? (
              <>
                <span className="text-fg-subtle">·</span>
                <Chip variant={item.is_active === false ? "default" : "success"}>{item.is_active === false ? "inactive" : "active"}</Chip>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")} disabled={loading}>
            Back
          </Button>
          {item ? (
            <Button asChild variant="outline" disabled={loading}>
              <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>Edit</Link>
            </Button>
          ) : null}
          <Button asChild disabled={loading}>
            <Link href="/catalog/items/new">New Item</Link>
          </Button>
          {item ? <DocumentUtilitiesDrawer entityType="item" entityId={item.id} allowUploadAttachments={true} className="ml-1" /> : null}
        </div>
      </div>

      <TabBar tabs={itemTabs} />

      {item ? (
        <>
      {tabId === "overview" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Item Profile</CardTitle>
                  <CardDescription>Core identity and configuration.</CardDescription>
                </div>
                <Button asChild variant="outline" size="sm" disabled={loading}>
                  <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>Edit</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-3">
                <section className="rounded-xl border border-border-subtle bg-bg-elevated/45 p-4">
                  <p className="ui-panel-title">Core identity</p>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    <KeyField label="SKU" value={item.sku || "-"} copyText={item.sku || ""} />
                    <KeyField label="Name" value={item.name || "-"} />
                    <KeyField label="Type" value={itemTypeLabel(item.item_type)} />
                    <KeyField label="UOM" value={item.unit_of_measure || "-"} />
                    <KeyField label="Primary Barcode" value={item.barcode || "-"} copyText={item.barcode || ""} />
                    <KeyField
                      label="Category"
                      value={item.category_id ? (categoryMeta?.name || shortId(item.category_id)) : "-"}
                      hint={item.category_id ? `ID: ${shortId(item.category_id)}` : undefined}
                      copyText={item.category_id || ""}
                    />
                    <KeyField
                      label="Tax"
                      value={
                        item.tax_code_id
                          ? `${taxMeta ? `${taxMeta.name}${taxMeta.rate !== undefined && taxMeta.rate !== null ? ` (${fmtRate(taxMeta.rate)})` : ""}` : item.tax_code_id}`
                          : "-"
                      }
                      copyText={item.tax_code_id || ""}
                      hint={item.tax_code_id && taxMeta ? `ID: ${shortId(item.tax_code_id)}` : undefined}
                    />
                    <KeyField label="Status" value={item.is_active === false ? "Inactive" : "Active"} />
                    <KeyField label="Track Batches" value={item.track_batches ? "On" : "Off"} />
                    <KeyField label="Track Expiry" value={item.track_expiry ? "On" : "Off"} />
                  </div>
                </section>

                <details className="rounded-xl border border-border-subtle bg-bg-sunken/20 p-4">
                  <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">Item notes and metadata</summary>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {item.tags?.length ? (
                        item.tags.map((tag) => <Chip key={tag} variant="default">{tag}</Chip>)
                      ) : (
                        <span className="text-xs text-fg-subtle">No tags assigned.</span>
                      )}
                    </div>
                    <SummaryField
                      label="Short Name"
                      value={item.short_name || "-"}
                      hint={item.short_name ? "Friendly label used on reports/receipts." : undefined}
                    />
                    <div className="rounded-md border border-border-subtle bg-bg-elevated/45 p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">Description</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.description || "—"}</p>
                    </div>
                    {item.external_ids ? (
                      <div className="rounded-md border border-border-subtle bg-bg-elevated/45 p-3">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">External IDs</p>
                        <div className="mt-2">
                          <ViewRaw value={item.external_ids} label="View external IDs" defaultOpen={false} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>
              </div>

              <div className="space-y-3">
                <section className="rounded-xl border border-border-subtle bg-bg-elevated/45 p-4">
                  <p className="ui-panel-title">Operations</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Chip variant={item.track_batches ? "primary" : "default"}>{item.track_batches ? "batches: on" : "batches: off"}</Chip>
                    <Chip variant={item.track_expiry ? "primary" : "default"}>{item.track_expiry ? "expiry: on" : "expiry: off"}</Chip>
                    <Chip variant={negativeStockPolicy.variant}>{`negative stock: ${negativeStockPolicy.label}`}</Chip>
                    <Chip variant={item.is_excise ? "primary" : "default"}>{item.is_excise ? "excise: yes" : "excise: no"}</Chip>
                    <Chip variant={item.is_active === false ? "default" : "success"}>{item.is_active === false ? "inactive" : "active"}</Chip>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <SummaryField label="Reorder Point" value={String(item.reorder_point ?? "-")} mono />
                    <SummaryField label="Reorder Qty" value={String(item.reorder_qty ?? "-")} mono />
                    <SummaryField label="Shelf Life" value={`${item.default_shelf_life_days ?? "-"}d`} />
                    <SummaryField label="Min for Sale" value={`${item.min_shelf_life_days_for_sale ?? "-"}d`} />
                    <SummaryField label="Expiry Warning" value={`${item.expiry_warning_days ?? "-"}d`} />
                    <SummaryField label="Excise Flag" value={item.is_excise ? "enabled" : "disabled"} />
                  </div>
                </section>

                <section className="rounded-xl border border-border-subtle bg-bg-sunken/20 p-4">
                  <p className="ui-panel-title">Primary image</p>
                  <div className="mt-3">
                    {item.image_attachment_id ? (
                      <div className="space-y-3">
                        <div className="rounded-md border border-border-subtle bg-bg-sunken/30 p-2">
                          <Image
                            src={apiUrl(`/attachments/${encodeURIComponent(item.image_attachment_id)}/view`)}
                            alt={item.image_alt || item.name}
                            width={220}
                            height={220}
                            className="mx-auto h-[220px] w-[220px] object-contain"
                            unoptimized
                          />
                        </div>
                        <div className="text-xs text-fg-muted">
                          <span className="text-fg-subtle">Alt:</span> {item.image_alt || "-"}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button asChild size="sm" variant="outline">
                            <a href={apiUrl(`/attachments/${encodeURIComponent(item.image_attachment_id)}/view`)} target="_blank" rel="noreferrer">
                              View
                            </a>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <a href={apiUrl(`/attachments/${encodeURIComponent(item.image_attachment_id)}/download`)} target="_blank" rel="noreferrer">
                              Download
                            </a>
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm text-fg-subtle">No image currently on file.</p>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>Attach image</Link>
                        </Button>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </CardContent>
          </Card>
          </div>
          )}

          {tabId === "pricing" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle>Pricing</CardTitle>
                      <CardDescription>Read-only pricing details. Edit prices from the Edit screen.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild variant="outline" size="sm" disabled={loading}>
                        <Link href={`/catalog/items/${encodeURIComponent(item.id)}/edit`}>Edit Prices</Link>
                      </Button>
                      <Button asChild variant="outline" size="sm" disabled={loading}>
                        <Link href="/catalog/price-lists">Price Lists</Link>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <SummaryField
                    label="Effective Sell Price"
                    value={`${fmtUsdMaybe(priceSuggest?.current?.price_usd)} · ${fmtLbpMaybe(priceSuggest?.current?.price_lbp, { dashIfZero: true })}`}
                    hint={`Default list: ${defaultListLabel}${pricingSecondaryMissing ? " (LL derived from exchange rate)" : ""}`}
                  />
                  <SummaryField
                    label="Average Cost"
                    value={`${fmtUsdMaybe(priceSuggest?.current?.avg_cost_usd)} · ${fmtLbpMaybe(priceSuggest?.current?.avg_cost_lbp, { dashIfZero: true })}`}
                  />
                  <SummaryField
                    label="Margin"
                    value={`${fmtPctFrac(priceSuggest?.current?.margin_usd)} (USD) · ${fmtPctFrac(priceSuggest?.current?.margin_lbp)} (LL)`}
                    hint={priceSuggest ? `Target: ${fmtPctFrac(priceSuggest.target_margin_pct)}` : undefined}
                  />
                  <SummaryField
                    label="WHOLESALE (Effective)"
                    value={
                      wholesaleEffective
                        ? `${fmtUsdMaybe(wholesaleEffective?.price_usd, { dashIfZero: true })} · ${fmtLbpMaybe(wholesaleEffective?.price_lbp, { dashIfZero: true })}`
                        : "-"
                    }
                    hint={wholesaleEffective?.effective_from ? `From: ${String(wholesaleEffective.effective_from).slice(0, 10)}` : "No override row"}
                  />
                  <SummaryField
                    label="RETAIL (Effective)"
                    value={
                      retailEffective
                        ? `${fmtUsdMaybe(retailEffective?.price_usd, { dashIfZero: true })} · ${fmtLbpMaybe(retailEffective?.price_lbp, { dashIfZero: true })}`
                        : "-"
                    }
                    hint={retailEffective?.effective_from ? `From: ${String(retailEffective.effective_from).slice(0, 10)}` : "No override row"}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle>Price Change History</CardTitle>
                      <CardDescription>Sell price changes derived from item price inserts.</CardDescription>
                    </div>
                    <Button asChild variant="outline" size="sm" disabled={loading}>
                      <Link href={`/inventory/price-changes/list?q=${encodeURIComponent(item.sku || "")}`}>Open Full Log</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <DataTable<PriceChangeRow>
                    tableId="catalog.item.priceChanges"
                    rows={priceChanges}
                    columns={priceChangeColumns}
                    getRowId={(r) => r.id}
                    emptyText="No price changes yet."
                    enablePagination
                    enableGlobalFilter={false}
                    initialSort={{ columnId: "when", dir: "desc" }}
                  />
                </CardContent>
              </Card>

              {legacyPrices.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Legacy Item Prices</CardTitle>
                    <CardDescription>`item_prices` history (if used). Modern pricing uses price lists.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-fg-muted">
                    <details className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
                      <summary className="cursor-pointer text-sm font-medium text-foreground">Show history ({legacyPrices.length})</summary>
                      <div className="mt-3 space-y-2">
                        {legacyPrices.slice(0, 25).map((p) => (
                          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-elevated/40 p-2">
                            <span className="font-mono text-xs text-fg-subtle">
                              {String(p.effective_from).slice(0, 10)}
                              {p.effective_to ? ` → ${String(p.effective_to).slice(0, 10)}` : ""}
                            </span>
                            <span className="data-mono text-xs text-foreground">
                              {fmtUsdLbp(p.price_usd, p.price_lbp, { sep: " · " })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          )}

          {tabId === "inventory" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Inventory</CardTitle>
                  <CardDescription>On-hand, reserved, available, and incoming.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <SummaryField label="Total On Hand" value={fmtQty(stockTotals.on_hand)} mono />
                    <SummaryField label="Total Reserved" value={fmtQty(stockTotals.reserved)} mono />
                    <SummaryField label="Total Available" value={fmtQty(stockTotals.available)} mono />
                    <SummaryField label="Total Incoming" value={fmtQty(stockTotals.incoming)} mono />
                  </div>
                  <DataTable<StockRow>
                    tableId="catalog.item.stock"
                    rows={stock}
                    columns={stockColumns}
                    getRowId={(r) => `${r.warehouse_id}`}
                    emptyText="No stock moves yet."
                    enableGlobalFilter={false}
                    initialSort={{ columnId: "warehouse", dir: "asc" }}
                  />
                  {(item.track_batches || item.track_expiry) ? (
                    <details className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
                      <summary className="cursor-pointer text-sm font-medium text-foreground">Batches</summary>
                      <div className="mt-3">
                        <DataTable<StockBatchRow>
                          tableId="catalog.item.stockBatches"
                          rows={stockBatches}
                          columns={stockBatchColumns}
                          getRowId={(r) => `${r.warehouse_id}:${r.batch_id || r.batch_no || ""}:${r.expiry_date || ""}`}
                          emptyText="No batch stock yet."
                          enableGlobalFilter={false}
                          initialSort={{ columnId: "expiry", dir: "asc" }}
                        />
                      </div>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )}

          {tabId === "logistics" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>UOM Conversions</CardTitle>
                  <CardDescription>How non-base units convert into base UOM.</CardDescription>
                </CardHeader>
                <CardContent>
                  <DataTable<UomConversionRow>
                    tableId="catalog.item.uomConversions"
                    rows={uomConversions}
                    columns={conversionColumns}
                    getRowId={(r) => r.uom_code}
                    emptyText="No conversions."
                    enableGlobalFilter={false}
                    initialSort={{ columnId: "uom", dir: "asc" }}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Warehouse Policies</CardTitle>
                  <CardDescription>Per-warehouse min/max and replenishment hints.</CardDescription>
                </CardHeader>
                <CardContent>
                  <DataTable<ItemWarehousePolicyRow>
                    tableId="catalog.item.warehousePolicies"
                    rows={warehousePolicies}
                    columns={policyColumns}
                    getRowId={(p) => p.id}
                    emptyText="No warehouse policies."
                    enableGlobalFilter={false}
                    initialSort={{ columnId: "warehouse", dir: "asc" }}
                  />
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Barcodes</CardTitle>
                    <CardDescription>Primary + alternate barcodes.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DataTable<ItemBarcode>
                      tableId="catalog.item.barcodes"
                      rows={barcodes}
                      columns={barcodeColumns}
                      getRowId={(b) => b.id}
                      emptyText="No barcodes."
                      enableGlobalFilter={false}
                      initialSort={{ columnId: "is_primary", dir: "desc" }}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Suppliers</CardTitle>
                    <CardDescription>Preferred supplier and last cost.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DataTable<ItemSupplierLinkRow>
                      tableId="catalog.item.suppliers"
                      rows={suppliers}
                      columns={supplierColumns}
                      getRowId={(s) => s.id}
                      emptyText="No suppliers linked."
                      enableGlobalFilter={false}
                      initialSort={{ columnId: "is_primary", dir: "desc" }}
                    />
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
