import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { BalanceSheetPdf, type BsRes } from "@/lib/pdf/reports";
import { safeFilenamePart } from "@/lib/pdf/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const inline = url.searchParams.get("inline") === "1";
  const asOf = url.searchParams.get("as_of") || "";

  const qs = new URLSearchParams();
  if (asOf) qs.set("as_of", asOf);

  const res = await backendGetJson<BsRes>(`/reports/balance-sheet?${qs.toString()}`);
  const filename = `balance_sheet_${safeFilenamePart(res.as_of)}.pdf`;
  return pdfResponse({ element: BalanceSheetPdf({ data: res }), filename, inline });
}

