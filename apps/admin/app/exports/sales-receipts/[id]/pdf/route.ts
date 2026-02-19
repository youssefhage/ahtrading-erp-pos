import { headers } from "next/headers";

import { BackendHttpError, backendGetJson, backendGetJsonWithHeaders } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { safeFilenamePart } from "@/lib/pdf/format";
import { SalesReceiptPdf, type SalesReceiptDetail } from "@/lib/pdf/sales-receipt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  const h = await headers();
  const cookie = (h.get("cookie") || "").trim();
  const deviceId = (h.get("x-device-id") || "").trim();
  const deviceToken = (h.get("x-device-token") || "").trim();

  try {
    let detail: SalesReceiptDetail;

    if (cookie) {
      detail = await backendGetJson<SalesReceiptDetail>(`/sales/invoices/${encodeURIComponent(id)}`);
    } else if (deviceId && deviceToken) {
      const devHeaders = { "X-Device-Id": deviceId, "X-Device-Token": deviceToken };
      detail = await backendGetJsonWithHeaders<SalesReceiptDetail>(`/pos/sales-invoices/${encodeURIComponent(id)}`, devHeaders);
    } else {
      return new Response("Unauthorized", { status: 401 });
    }

    if (String(detail.invoice.status || "").toLowerCase() !== "posted") {
      return new Response("Receipt is available only for posted invoices", { status: 409 });
    }

    const no = safeFilenamePart(detail.invoice.receipt_no || detail.invoice.invoice_no || detail.invoice.id);
    const filename = `sales-receipt_${no}.pdf`;

    return pdfResponse({
      element: SalesReceiptPdf({ detail }),
      filename,
      inline
    });
  } catch (err) {
    if (err instanceof BackendHttpError) {
      return new Response(err.bodyText || err.message, { status: err.status });
    }
    throw err;
  }
}
