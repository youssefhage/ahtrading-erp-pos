import { headers } from "next/headers";

import { BackendHttpError, backendGetJson, backendGetJsonWithHeaders } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { safeFilenamePart } from "@/lib/pdf/format";
import { SalesCreditNotePdf, type SalesCreditNoteDetail } from "@/lib/pdf/sales-credit-note";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LinkedInvoice = {
  id: string;
  invoice_no: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
};

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  const h = await headers();
  const cookie = (h.get("cookie") || "").trim();
  const deviceId = (h.get("x-device-id") || "").trim();
  const deviceToken = (h.get("x-device-token") || "").trim();

  try {
    let detail: SalesCreditNoteDetail;
    let invoice: LinkedInvoice | null = null;

    if (cookie) {
      detail = await backendGetJson<SalesCreditNoteDetail>(`/sales/returns/${encodeURIComponent(id)}`);
      if (detail.return.invoice_id) {
        const inv = await backendGetJson<{ invoice: LinkedInvoice }>(`/sales/invoices/${encodeURIComponent(detail.return.invoice_id)}`).catch(() => null);
        invoice = inv?.invoice || null;
      }
    } else if (deviceId && deviceToken) {
      const devHeaders = { "X-Device-Id": deviceId, "X-Device-Token": deviceToken };
      detail = await backendGetJsonWithHeaders<SalesCreditNoteDetail>(`/pos/sales-returns/${encodeURIComponent(id)}`, devHeaders);
      if (detail.return.invoice_id) {
        const inv = await backendGetJsonWithHeaders<{ invoice: LinkedInvoice }>(`/pos/sales-invoices/${encodeURIComponent(detail.return.invoice_id)}`, devHeaders).catch(() => null);
        invoice = inv?.invoice || null;
      }
    } else {
      return new Response("Unauthorized", { status: 401 });
    }

    const method = String(detail.return.refund_method || "").toLowerCase();
    const hasCreditRefund = (detail.refunds || []).some((rf) => String(rf.method || "").toLowerCase() === "credit");
    if (!(method === "credit" || hasCreditRefund)) {
      return new Response("Not a credit note", { status: 409 });
    }

    const no = safeFilenamePart(detail.return.return_no || detail.return.id);
    const filename = `sales-credit-note_${no}.pdf`;

    return pdfResponse({
      element: SalesCreditNotePdf({ detail, invoice }),
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
