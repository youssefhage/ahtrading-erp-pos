export type RecommendationView = {
  kind?: string;
  kind_label?: string;
  title?: string;
  summary?: string;
  next_step?: string;
  severity?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  link_href?: string | null;
  link_label?: string | null;
  details?: string[];
};

export type RecommendationLike = {
  agent_code?: string;
  recommendation_json?: any;
  recommendation_view?: RecommendationView;
};

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function humanizeToken(v: string): string {
  const cleaned = String(v || "").replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Recommendation";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((x) => x[0].toUpperCase() + x.slice(1))
    .join(" ");
}

function fallbackLink(json: any): string | undefined {
  const itemId = firstText(json?.item_id, json?.entity_id);
  const invoiceId = firstText(json?.invoice_id);
  const customerId = firstText(json?.customer_id);
  if (invoiceId) return `/purchasing/supplier-invoices/${encodeURIComponent(invoiceId)}`;
  if (customerId) return `/partners/customers/${encodeURIComponent(customerId)}`;
  if (itemId && String(json?.entity_type || "").toLowerCase() !== "customer") {
    return `/catalog/items/${encodeURIComponent(itemId)}`;
  }
  return undefined;
}

export function recommendationKind(row: RecommendationLike): string {
  const view = row.recommendation_view || {};
  const json = row.recommendation_json || {};
  return String(view.kind || json.kind || json.type || row.agent_code || "").trim().toLowerCase();
}

export function recommendationView(row: RecommendationLike): {
  kind: string;
  kindLabel: string;
  title: string;
  summary: string;
  nextStep: string;
  severity: string;
  details: string[];
  linkHref?: string;
  linkLabel?: string;
} {
  const view = row.recommendation_view || {};
  const json = row.recommendation_json || {};
  const kind = recommendationKind(row) || "recommendation";

  const issueMessages = Array.isArray(json?.issues)
    ? json.issues
        .map((x: any) => firstText(x?.message, x?.code))
        .filter(Boolean)
        .slice(0, 4)
    : [];

  const details = Array.isArray(view.details)
    ? view.details.filter((x) => String(x || "").trim()).map((x) => String(x)).slice(0, 4)
    : issueMessages;

  const kindLabel = firstText(view.kind_label, view.kind, humanizeToken(kind));
  const title = firstText(view.title, json?.title, kindLabel, "Recommendation");
  const summary = firstText(
    view.summary,
    json?.explain?.why,
    json?.hold_reason,
    json?.message,
    json?.key,
    "Triggered by an internal rule."
  );
  const nextStep = firstText(view.next_step, "Review recommendation details and decide.");
  const severity = firstText(view.severity, json?.severity, "medium").toLowerCase();
  const linkHref = firstText(view.link_href, fallbackLink(json)) || undefined;
  const linkLabel = firstText(view.link_label, "Open related document") || undefined;

  return {
    kind,
    kindLabel,
    title,
    summary,
    nextStep,
    severity,
    details,
    linkHref,
    linkLabel,
  };
}
