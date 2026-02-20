import { headers } from "next/headers";
import { createElement } from "react";

import { BackendHttpError, backendGetJson, backendGetJsonWithHeaders } from "@/lib/server/backend";
import { pdfResponse } from "@/lib/server/pdf";
import { safeFilenamePart } from "@/lib/pdf/format";
import { SalesInvoicePdf, type SalesInvoiceDetail, type SalesInvoicePdfTemplate } from "@/lib/pdf/sales-invoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const INVOICE_PDF_TEMPLATES = new Set(["official_classic", "official_compact", "standard"]);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const qs = new URL(req.url).searchParams;
    const inline = qs.get("inline") === "1";
    const template = (qs.get("template") || "").trim() as SalesInvoicePdfTemplate | "";

    const h = await headers();
    const cookie = (h.get("cookie") || "").trim();
    const deviceId = (h.get("x-device-id") || "").trim();
    const deviceToken = (h.get("x-device-token") || "").trim();

    let detail: SalesInvoiceDetail;
    let company: any = null;
    let customer: any = null;
    let addresses: any[] = [];

    if (cookie) {
      detail = await backendGetJson<SalesInvoiceDetail>(`/sales/invoices/${encodeURIComponent(id)}`);
      const me = await backendGetJson<{ active_company_id?: string | null }>(`/auth/me`).catch(() => ({ active_company_id: null }));
      const activeCompanyId = String(me.active_company_id || "").trim();
      if (activeCompanyId) {
        const c = await backendGetJson<{ company: any }>(`/companies/${encodeURIComponent(activeCompanyId)}`).catch(() => null);
        company = c?.company || null;
      }
      const customerId = String(detail?.invoice?.customer_id || "").trim();
      if (customerId) {
        const c = await backendGetJson<{ customer: any }>(`/customers/${encodeURIComponent(customerId)}`).catch(() => null);
        customer = c?.customer || null;
        const a = await backendGetJson<{ addresses: any[] }>(
          `/party-addresses?party_kind=customer&party_id=${encodeURIComponent(customerId)}`
        ).catch(() => null);
        addresses = a?.addresses || [];
      }
    } else if (deviceId && deviceToken) {
      const devHeaders = { "X-Device-Id": deviceId, "X-Device-Token": deviceToken };
      detail = await backendGetJsonWithHeaders<SalesInvoiceDetail>(`/pos/sales-invoices/${encodeURIComponent(id)}`, devHeaders);
      const cfg = await backendGetJsonWithHeaders<any>(`/pos/config`, devHeaders).catch(() => null);
      company = cfg?.company || null;
      const customerId = String(detail?.invoice?.customer_id || "").trim();
      if (customerId) {
        const c = await backendGetJsonWithHeaders<{ customer: any }>(`/pos/customers/${encodeURIComponent(customerId)}`, devHeaders).catch(
          () => null
        );
        customer = c?.customer || null;
      }
    } else {
      return new Response("Unauthorized", { status: 401 });
    }

    const no = safeFilenamePart(detail.invoice.invoice_no || detail.invoice.id);
    const filename = `sales-invoice_${no}.pdf`;
    const templateFromQuery = String(template || "").trim().toLowerCase();
    const templateFromPolicy = String(detail?.print_policy?.sales_invoice_pdf_template || "").trim().toLowerCase();
    const effectiveTemplate = INVOICE_PDF_TEMPLATES.has(templateFromQuery)
      ? templateFromQuery
      : INVOICE_PDF_TEMPLATES.has(templateFromPolicy)
        ? templateFromPolicy
        : "";

    const renderInvoicePdf = async (selectedTemplate?: string) =>
      pdfResponse({
        element: createElement(SalesInvoicePdf, { detail, company, customer, addresses, template: selectedTemplate }),
        filename,
        inline
      });

    try {
      return await renderInvoicePdf(effectiveTemplate || undefined);
    } catch (renderErr) {
      // If a custom/official template fails for a specific invoice payload, fall back to standard.
      if ((effectiveTemplate || "").toLowerCase() !== "standard") {
        try {
          return await renderInvoicePdf("standard");
        } catch {}
      }
      throw renderErr;
    }
  } catch (err) {
    if (err instanceof BackendHttpError) {
      return new Response(err.bodyText || err.message, { status: err.status });
    }
    console.error("sales invoice pdf render failed", err);
    return new Response("Failed to render sales invoice PDF", { status: 500 });
  }
}
