import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { SoaPdf, type SoaParty, type SoaRow } from "@/lib/pdf/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Res = {
  customer: SoaParty;
  start_date: string;
  end_date: string;
  opening_usd: string | number;
  opening_lbp: string | number;
  closing_usd: string | number;
  closing_lbp: string | number;
  rows: SoaRow[];
};

export async function GET(req: Request) {
  const u = new URL(req.url);
  const inline = u.searchParams.get("inline") === "1";
  const qs = new URLSearchParams();

  const customerId = (u.searchParams.get("customer_id") || "").trim();
  if (customerId) qs.set("customer_id", customerId);
  const startDate = (u.searchParams.get("start_date") || "").trim();
  if (startDate) qs.set("start_date", startDate);
  const endDate = (u.searchParams.get("end_date") || "").trim();
  if (endDate) qs.set("end_date", endDate);

  const res = await backendGetJson<Res>(`/reports/customer-soa?${qs.toString()}`);
  const filename = `customer_soa_${res.customer?.code || res.customer?.id || "customer"}.pdf`;
  return pdfResponse({
    element: SoaPdf({
      title: "Customer Statement of Account",
      partyLabel: "Customer",
      party: res.customer,
      startDate: res.start_date,
      endDate: res.end_date,
      openingUsd: res.opening_usd,
      openingLbp: res.opening_lbp,
      closingUsd: res.closing_usd,
      closingLbp: res.closing_lbp,
      rows: res.rows || [],
    }),
    filename,
    inline,
  });
}

