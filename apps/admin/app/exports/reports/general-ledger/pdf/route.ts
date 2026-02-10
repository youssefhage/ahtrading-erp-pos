import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { GeneralLedgerPdf, type GlRow } from "@/lib/pdf/reports";
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

  const res = await backendGetJson<{ gl: GlRow[] }>(`/reports/gl?${qs.toString()}`);
  const filename = `general_ledger_${safeFilenamePart(startDate || "all")}_${safeFilenamePart(endDate || "all")}.pdf`;
  return pdfResponse({
    element: GeneralLedgerPdf({ rows: res.gl || [], startDate, endDate }),
    filename,
    inline
  });
}

