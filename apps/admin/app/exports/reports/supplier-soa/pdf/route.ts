import { backendGetJson } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { SoaPdf, type SoaParty, type SoaRow } from "@/lib/pdf/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Res = {
  supplier: SoaParty;
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

  const supplierId = (u.searchParams.get("supplier_id") || "").trim();
  if (supplierId) qs.set("supplier_id", supplierId);
  const startDate = (u.searchParams.get("start_date") || "").trim();
  if (startDate) qs.set("start_date", startDate);
  const endDate = (u.searchParams.get("end_date") || "").trim();
  if (endDate) qs.set("end_date", endDate);

  const res = await backendGetJson<Res>(`/reports/supplier-soa?${qs.toString()}`);
  const filename = `supplier_soa_${res.supplier?.code || res.supplier?.id || "supplier"}.pdf`;
  return pdfResponse({
    element: SoaPdf({
      title: "Supplier Statement of Account",
      partyLabel: "Supplier",
      party: res.supplier,
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

