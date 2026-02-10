import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { safeFilenamePart } from "@/lib/pdf/format";
import { GoodsReceiptPdf, type GoodsReceiptDetail, type SimpleItem } from "@/lib/pdf/goods-receipt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SupplierGetRes = { supplier: { id: string; name: string } };
type WarehousesRes = { warehouses: Array<{ id: string; name: string }> };
type ItemGetRes = { item: { id: string; sku?: string | null; name?: string | null } };

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  const detail = await backendGetJson<GoodsReceiptDetail>(`/purchases/receipts/${encodeURIComponent(id)}`);

  const supplierName = await (async () => {
    const sid = detail.receipt.supplier_id;
    if (!sid) return undefined;
    try {
      const r = await backendGetJson<SupplierGetRes>(`/suppliers/${encodeURIComponent(sid)}`);
      return r.supplier?.name || sid;
    } catch {
      return sid;
    }
  })();

  const warehouseName = await (async () => {
    const wid = detail.receipt.warehouse_id;
    if (!wid) return undefined;
    try {
      const r = await backendGetJson<WarehousesRes>("/warehouses");
      const hit = (r.warehouses || []).find((w) => String(w.id) === String(wid));
      return hit?.name || wid;
    } catch {
      return wid;
    }
  })();

  const itemIds = Array.from(new Set((detail.lines || []).map((l) => l.item_id).filter(Boolean)));
  const items = await Promise.all(
    itemIds.map(async (itemId) => {
      try {
        const r = await backendGetJson<ItemGetRes>(`/items/${encodeURIComponent(itemId)}`);
        return r.item || null;
      } catch {
        return null;
      }
    })
  );
  const itemsById = new Map<string, SimpleItem>();
  for (const it of items) {
    if (!it) continue;
    itemsById.set(String((it as any).id), it as SimpleItem);
  }

  const no = safeFilenamePart(detail.receipt.receipt_no || detail.receipt.id);
  const filename = `goods-receipt_${no}.pdf`;

  return pdfResponse({
    element: GoodsReceiptPdf({ detail, supplierName, warehouseName, itemsById }),
    filename,
    inline
  });
}

