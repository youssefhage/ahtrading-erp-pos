import type { DataProvider } from "react-admin";

import { httpJson } from "@/v2/http";

const resourceToPath: Record<string, string> = {
  "sales-invoices": "/sales/invoices",
  items: "/items",
  customers: "/customers",
};

function pathFor(resource: string): string {
  const p = resourceToPath[resource];
  if (!p) throw new Error(`Unknown resource: ${resource}`);
  return p;
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

    const res = await httpJson<{ data: any[]; total: number }>(`${pathFor(resource)}?${qs.toString()}`);
    return { data: res.data || [], total: Number(res.total || 0) };
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
  async update() {
    throw new Error("Not implemented");
  },
  async updateMany() {
    throw new Error("Not implemented");
  },
  async create() {
    throw new Error("Not implemented");
  },
  async delete() {
    throw new Error("Not implemented");
  },
  async deleteMany() {
    throw new Error("Not implemented");
  },
};
