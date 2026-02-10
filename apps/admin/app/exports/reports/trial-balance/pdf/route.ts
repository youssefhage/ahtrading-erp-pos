import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { TrialBalancePdf, type TrialRow } from "@/lib/pdf/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const res = await backendGetJson<{ trial_balance: TrialRow[] }>("/reports/trial-balance");
  const filename = "trial_balance.pdf";
  return pdfResponse({ element: TrialBalancePdf({ rows: res.trial_balance || [] }), filename, inline });
}

