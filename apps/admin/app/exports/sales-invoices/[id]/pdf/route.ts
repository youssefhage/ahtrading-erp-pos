import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { safeFilenamePart } from "@/lib/pdf/format";
import { SalesInvoicePdf, type SalesInvoiceDetail } from "@/lib/pdf/sales-invoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  const detail = await backendGetJson<SalesInvoiceDetail>(`/sales/invoices/${encodeURIComponent(id)}`);
  const no = safeFilenamePart(detail.invoice.invoice_no || detail.invoice.id);
  const filename = `sales-invoice_${no}.pdf`;

  return pdfResponse({
    element: SalesInvoicePdf({ detail }),
    filename,
    inline
  });
}

