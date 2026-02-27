"use client";

import { EntityTypeahead, type EntityTypeaheadConfig } from "@/components/entity-typeahead";

export type CustomerTypeaheadCustomer = {
  id: string;
  code?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  membership_no?: string | null;
  payment_terms_days?: string | number | null;
  price_list_id?: string | null;
  is_active?: boolean;
};

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

const config: EntityTypeaheadConfig<CustomerTypeaheadCustomer> = {
  endpoint: "/customers/typeahead",
  responseKey: "customers",
  recentStorageKey: "admin.recent.customers.v1",
  legacyStorageKey: "admin.recent.customers.v1",
  buildHaystack(c) {
    const parts: string[] = [];
    if (c.code) parts.push(String(c.code));
    if (c.name) parts.push(String(c.name));
    if (c.phone) parts.push(String(c.phone));
    if (c.email) parts.push(String(c.email));
    if (c.membership_no) parts.push(String(c.membership_no));
    return norm(parts.join(" "));
  },
  findExactMatch(items, query) {
    const t = norm(query);
    if (!t) return undefined;
    return items.find(
      (c) =>
        (c.code && norm(String(c.code)) === t) ||
        norm(String(c.name || "")) === t ||
        (c.membership_no && norm(String(c.membership_no)) === t),
    );
  },
  getLabel(c) {
    return [c.code ? String(c.code).trim() : "", c.name ? String(c.name).trim() : ""]
      .filter(Boolean)
      .join(" · ");
  },
  renderItem(c) {
    return (
      <>
        {c.code ? <span className="font-mono text-xs text-muted-foreground">{c.code}</span> : null}
        {c.code ? <span className="text-muted-foreground"> · </span> : null}
        <span className="text-foreground">{c.name}</span>
      </>
    );
  },
  renderSecondary(c) {
    const parts = [c.phone, c.email, c.membership_no].filter(Boolean);
    if (!parts.length) return null;
    return <>{parts.join(" · ")}</>;
  },
  renderBadge(c) {
    if (c.is_active === false) {
      return <div className="shrink-0 font-mono text-xs text-muted-foreground">inactive</div>;
    }
    return null;
  },
  placeholder: "Search customer code / name / phone...",
  emptyRecentText: "No recent customers.",
};

export function CustomerTypeahead(props: {
  value?: CustomerTypeaheadCustomer | null;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onSelect: (c: CustomerTypeaheadCustomer) => void;
  onClear?: () => void;
}) {
  return <EntityTypeahead config={config} {...props} />;
}
