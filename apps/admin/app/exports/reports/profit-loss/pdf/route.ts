import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { ProfitLossPdf, type PlRes } from "@/lib/pdf/reports";
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

  const res = await backendGetJson<PlRes>(`/reports/profit-loss?${qs.toString()}`);
  const filename = `profit_loss_${safeFilenamePart(res.start_date)}_${safeFilenamePart(res.end_date)}.pdf`;
  return pdfResponse({ element: ProfitLossPdf({ data: res }), filename, inline });
}

