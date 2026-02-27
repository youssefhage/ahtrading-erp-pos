"use client";

import { EntityTypeahead, type EntityTypeaheadConfig } from "@/components/entity-typeahead";

export type SupplierTypeaheadSupplier = {
  id: string;
  code?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  vat_no?: string | null;
  tax_id?: string | null;
  is_active?: boolean;
};

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

const config: EntityTypeaheadConfig<SupplierTypeaheadSupplier> = {
  endpoint: "/suppliers/typeahead",
  responseKey: "suppliers",
  recentStorageKey: "admin.recent.suppliers.v1",
  legacyStorageKey: "admin.recent.suppliers.v1",
  buildHaystack(s) {
    const parts: string[] = [];
    if (s.code) parts.push(String(s.code));
    if (s.name) parts.push(String(s.name));
    if (s.phone) parts.push(String(s.phone));
    if (s.email) parts.push(String(s.email));
    if (s.vat_no) parts.push(String(s.vat_no));
    if (s.tax_id) parts.push(String(s.tax_id));
    return norm(parts.join(" "));
  },
  findExactMatch(items, query) {
    const t = norm(query);
    if (!t) return undefined;
    return items.find(
      (s) => (s.code && norm(String(s.code)) === t) || norm(String(s.name || "")) === t,
    );
  },
  getLabel(s) {
    return [s.code ? String(s.code).trim() : "", s.name ? String(s.name).trim() : ""]
      .filter(Boolean)
      .join(" · ");
  },
  renderItem(s) {
    return (
      <>
        {s.code ? <span className="font-mono text-xs text-muted-foreground">{s.code}</span> : null}
        {s.code ? <span className="text-muted-foreground"> · </span> : null}
        <span className="text-foreground">{s.name}</span>
      </>
    );
  },
  renderSecondary(s) {
    const parts = [s.phone, s.email].filter(Boolean);
    if (!parts.length) return null;
    return <>{parts.join(" · ")}</>;
  },
  renderBadge(s) {
    if (s.is_active === false) {
      return <div className="shrink-0 font-mono text-xs text-muted-foreground">inactive</div>;
    }
    return null;
  },
  placeholder: "Search supplier code / name / phone...",
  emptyRecentText: "No recent suppliers.",
};

export function SupplierTypeahead(props: {
  value?: SupplierTypeaheadSupplier | null;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onSelect: (s: SupplierTypeaheadSupplier) => void;
  onClear?: () => void;
}) {
  return <EntityTypeahead config={config} {...props} />;
}
