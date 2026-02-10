import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { safeFilenamePart } from "@/lib/pdf/format";
import { SupplierCreditPdf, type SupplierCreditDetail } from "@/lib/pdf/supplier-credit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  const detail = await backendGetJson<SupplierCreditDetail>(`/purchases/credits/${encodeURIComponent(id)}`);
  const no = safeFilenamePart(detail.credit.credit_no || detail.credit.id);
  const filename = `supplier-credit_${no}.pdf`;

  return pdfResponse({
    element: SupplierCreditPdf({ detail }),
    filename,
    inline
  });
}

