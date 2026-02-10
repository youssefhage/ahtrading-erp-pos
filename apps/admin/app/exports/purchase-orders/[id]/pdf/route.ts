import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { safeFilenamePart } from "@/lib/pdf/format";
import { PurchaseOrderPdf, type PurchaseOrderDetail, type PurchaseOrderItem } from "@/lib/pdf/purchase-order";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ItemGetRes = { item: { id: string; sku?: string | null; name?: string | null; unit_of_measure?: string | null } };

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  const detail = await backendGetJson<PurchaseOrderDetail>(`/purchases/orders/${encodeURIComponent(id)}`);
  const ids = Array.from(new Set((detail.lines || []).map((l) => l.item_id).filter(Boolean)));

  const items = await Promise.all(
    ids.map(async (itemId) => {
      try {
        const r = await backendGetJson<ItemGetRes>(`/items/${encodeURIComponent(itemId)}`);
        return r.item || null;
      } catch {
        return null;
      }
    })
  );
  const itemsById = new Map<string, PurchaseOrderItem>();
  for (const it of items) {
    if (!it) continue;
    itemsById.set(String((it as any).id), it as PurchaseOrderItem);
  }

  const no = safeFilenamePart(detail.order.order_no || detail.order.id);
  const filename = `purchase-order_${no}.pdf`;

  return pdfResponse({
    element: PurchaseOrderPdf({ detail, itemsById }),
    filename,
    inline
  });
}

