import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { safeFilenamePart } from "@/lib/pdf/format";
import { SupplierInvoicePdf, type SupplierInvoiceDetail } from "@/lib/pdf/supplier-invoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  const detail = await backendGetJson<SupplierInvoiceDetail>(`/purchases/invoices/${encodeURIComponent(id)}`);
  const no = safeFilenamePart(detail.invoice.invoice_no || detail.invoice.id);
  const filename = `supplier-invoice_${no}.pdf`;

  return pdfResponse({
    element: SupplierInvoicePdf({ detail }),
    filename,
    inline
  });
}

