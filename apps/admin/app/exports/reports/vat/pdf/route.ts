import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { VatReportPdf, type VatRow } from "@/lib/pdf/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const res = await backendGetJson<{ vat: VatRow[] }>("/reports/vat");
  const filename = "vat_report.pdf";
  return pdfResponse({ element: VatReportPdf({ rows: res.vat || [] }), filename, inline });
}

