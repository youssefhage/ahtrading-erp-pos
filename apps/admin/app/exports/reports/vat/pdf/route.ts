import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { VatReportPdf, type VatRow, type VatSummary } from "@/lib/pdf/reports";
import { safeFilenamePart } from "@/lib/pdf/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const inline = url.searchParams.get("inline") === "1";
  const startDate = url.searchParams.get("start_date") || "";
  const endDate = url.searchParams.get("end_date") || "";

  const qs = new URLSearchParams();
  if (startDate) qs.set("start_date", startDate);
  if (endDate) qs.set("end_date", endDate);
  const query = qs.toString();

  const res = await backendGetJson<{ vat: VatRow[]; summary?: VatSummary; start_date?: string | null; end_date?: string | null }>(
    `/reports/vat${query ? `?${query}` : ""}`
  );
  const filename = `vat_report_${safeFilenamePart(startDate || "all")}_${safeFilenamePart(endDate || "all")}.pdf`;
  return pdfResponse({
    element: VatReportPdf({ rows: res.vat || [], summary: res.summary, startDate: res.start_date || startDate, endDate: res.end_date || endDate }),
    filename,
    inline
  });
}
