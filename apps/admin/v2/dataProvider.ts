import type { DataProvider } from "react-admin";

import { httpJson } from "@/v2/http";

const resourceToPath: Record<string, string> = {
  "sales-invoices": "/sales/invoices",
  items: "/items",
  customers: "/customers",
  warehouses: "/warehouses",
};

function pathFor(resource: string): string {
  const p = resourceToPath[resource];
  if (!p) throw new Error(`Unknown resource: ${resource}`);
  return p;
}

function parseListResponse(resource: string, res: any): { rows: any[]; total: number } {
  if (res && Array.isArray(res.data) && (typeof res.total === "number" || typeof res.total === "string")) {
    return { rows: res.data, total: Number(res.total) };
  }
  if (res && Array.isArray(res[resource])) {
    const rows = res[resource];
    return { rows, total: rows.length };
  }
  // Transitional/legacy aliases (kept for big-bang porting).
  const legacyKey =
    resource === "sales-invoices"
      ? "invoices"
      : resource === "warehouses"
        ? "warehouses"
        : resource; // items/customers already match
  if (res && Array.isArray(res[legacyKey])) {
    const rows = res[legacyKey];
    return { rows, total: rows.length };
  }
  return { rows: [], total: 0 };
}

export const dataProvider: DataProvider = {
  async getList(resource, params) {
    const { page, perPage } = params.pagination ?? { page: 1, perPage: 25 };
    const { field, order } = params.sort ?? { field: "id", order: "ASC" };
    const offset = (page - 1) * perPage;

    const qs = new URLSearchParams();
    qs.set("limit", String(perPage));
    qs.set("offset", String(offset));
    if (field) qs.set("sort", field);
    if (order) qs.set("dir", order.toLowerCase());

    // Map react-admin filters to query params (keep it simple and explicit).
    const f = params.filter || {};
    for (const [k, v] of Object.entries(f)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }

    const res = await httpJson<any>(`${pathFor(resource)}?${qs.toString()}`);
    const { rows, total } = parseListResponse(resource, res);
    return { data: rows, total };
  },

  async getOne(resource, params) {
    if (resource === "sales-invoices") {
      const res = await httpJson<{
        invoice: Record<string, unknown>;
        lines: unknown[];
        payments: unknown[];
        tax_lines: unknown[];
      }>(`${pathFor(resource)}/${params.id}`);

      const invoice = (res.invoice || {}) as any;
      return {
        data: {
          ...invoice,
          lines: res.lines || [],
          payments: res.payments || [],
          tax_lines: res.tax_lines || [],
        },
      };
    }

    const res = await httpJson<{ [k: string]: any }>(`${pathFor(resource)}/${params.id}`);
    // Expect `{ resource: {...} }` or `{ data: {...} }` or direct record.
    const data = res.data || res[resource.slice(0, -1)] || res;
    return { data };
  },

  // Not needed until we add edit/create/reference inputs.
  async getMany() {
    throw new Error("Not implemented");
  },
  async getManyReference() {
    throw new Error("Not implemented");
  },
  async update(resource, params) {
    if (resource === "sales-invoices") {
      const id = params.id;
      const payload: any = {
        customer_id: params.data.customer_id || null,
        warehouse_id: params.data.warehouse_id || null,
        invoice_no: params.data.invoice_no || null,
        invoice_date: params.data.invoice_date || null,
        due_date: params.data.due_date || null,
        exchange_rate: params.data.exchange_rate ?? null,
        pricing_currency: params.data.pricing_currency || null,
        settlement_currency: params.data.settlement_currency || null,
      };
      if (Array.isArray(params.data.lines)) {
        payload.lines = params.data.lines.map((l: any) => ({
          item_id: l.item_id,
          qty: Number(l.qty || 0),
          unit_price_usd: Number(l.unit_price_usd || 0),
          unit_price_lbp: Number(l.unit_price_lbp || 0),
        }));
      }

      await httpJson(`${pathFor(resource)}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const refreshed = await dataProvider.getOne(resource, { id, meta: params.meta });
      return { data: refreshed.data } as any;
    }
    throw new Error("Not implemented");
  },
  async updateMany() {
    throw new Error("Not implemented");
  },
  async create(resource, params) {
    if (resource === "sales-invoices") {
      const payload: any = {
        customer_id: params.data.customer_id || null,
        warehouse_id: params.data.warehouse_id,
        invoice_no: params.data.invoice_no || null,
        invoice_date: params.data.invoice_date || null,
        due_date: params.data.due_date || null,
        exchange_rate: params.data.exchange_rate ?? 0,
        pricing_currency: params.data.pricing_currency || "USD",
        settlement_currency: params.data.settlement_currency || "USD",
        lines: Array.isArray(params.data.lines)
          ? params.data.lines.map((l: any) => ({
              item_id: l.item_id,
              qty: Number(l.qty || 0),
              unit_price_usd: Number(l.unit_price_usd || 0),
              unit_price_lbp: Number(l.unit_price_lbp || 0),
            }))
          : [],
      };
      const res = await httpJson<{ id: string; invoice_no?: string }>(`${pathFor(resource)}/drafts`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return {
        data: {
          ...params.data,
          id: res.id,
          invoice_no: res.invoice_no ?? params.data.invoice_no,
          status: "draft",
        },
      } as any;
    }
    throw new Error("Not implemented");
  },
  async delete() {
    throw new Error("Not implemented");
  },
  async deleteMany() {
    throw new Error("Not implemented");
  },
};
