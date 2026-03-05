/**
 * Shared navigation data (path / label only — no icons).
 *
 * Icons are a visual concern and stay in `components/app-shell.tsx` where
 * they are mapped via `iconForHref`.
 */

export type NavItemData = {
  label: string;
  href: string;
};

export type NavSectionData = {
  label: string;
  items: NavItemData[];
};

/* ------------------------------------------------------------------ */
/*  Full nav (all sections visible in the default "full" UI variant)  */
/* ------------------------------------------------------------------ */

export const FULL_NAV_SECTIONS: NavSectionData[] = [
  {
    label: "Home",
    items: [
      { label: "Dashboard", href: "/dashboard" },
    ]
  },
  {
    label: "Operations",
    items: [
      { label: "Outbox", href: "/system/outbox" },
      { label: "Needs Attention", href: "/system/attention" },
      { label: "POS Shifts", href: "/system/pos-shifts" },
      { label: "POS Devices", href: "/system/pos-devices" },
      { label: "POS Cashiers", href: "/system/pos-cashiers" },
      { label: "Inventory Ops", href: "/inventory/ops" }
    ]
  },
  {
    label: "Sales",
    items: [
      { label: "Sales Invoices", href: "/sales/invoices" },
      { label: "Sales Receipts", href: "/sales/receipts" },
      { label: "Credit Notes", href: "/sales/credit-notes" },
      { label: "Adjustment Queue", href: "/sales/adjustment-queue" },
      { label: "Sales Payments", href: "/sales/payments" },
      { label: "Sales Returns", href: "/sales/returns" }
    ]
  },
  {
    label: "Purchasing",
    items: [
      { label: "Purchase Orders", href: "/purchasing/purchase-orders" },
      { label: "Goods Receipts", href: "/purchasing/goods-receipts" },
      { label: "Supplier Invoices", href: "/purchasing/supplier-invoices" },
      { label: "Supplier Credits", href: "/purchasing/supplier-credits" },
      { label: "3-Way Match", href: "/purchasing/3-way-match" },
      { label: "Supplier Payments", href: "/purchasing/payments" }
    ]
  },
  {
    label: "Master Data",
    items: [
      { label: "Customers", href: "/partners/customers/list" },
      { label: "Suppliers", href: "/partners/suppliers" },
      { label: "Items", href: "/catalog/items/list" },
      { label: "Products Catalog", href: "/catalog/products" },
      { label: "Categories", href: "/catalog/item-categories" },
      { label: "Price Lists", href: "/catalog/price-lists" },
      { label: "Promotions", href: "/catalog/promotions" }
    ]
  },
  {
    label: "Inventory",
    items: [
      { label: "Stock", href: "/inventory/stock" },
      { label: "Movements", href: "/inventory/movements" },
      { label: "Transfers", href: "/inventory/transfers" },
      { label: "Replenishment", href: "/inventory/replenishment" },
      { label: "Cycle Counts", href: "/inventory/cycle-counts" },
      { label: "Batches", href: "/inventory/batches" },
      { label: "Alerts", href: "/inventory/alerts" },
      { label: "Reorder Suggestions", href: "/inventory/reorder-suggestions" },
      { label: "Landed Costs", href: "/inventory/landed-costs" },
      { label: "Cost Changes", href: "/inventory/cost-changes" },
      { label: "Price Changes", href: "/inventory/price-changes" }
    ]
  },
  {
    label: "Accounting",
    items: [
      { label: "Journals", href: "/accounting/journals" },
      { label: "Journal Templates", href: "/accounting/journal-templates" },
      { label: "Recurring Journals", href: "/accounting/recurring-journals" },
      { label: "Close Checklist", href: "/accounting/close-checklist" },
      { label: "Chart of Accounts", href: "/accounting/coa" },
      { label: "Intercompany", href: "/accounting/intercompany" },
      { label: "Bank Accounts", href: "/accounting/banking/accounts" },
      { label: "Reconciliation", href: "/accounting/banking/reconciliation" }
    ]
  },
  {
    label: "Reports",
    items: [
      { label: "VAT", href: "/accounting/reports/vat" },
      { label: "Trial Balance", href: "/accounting/reports/trial-balance" },
      { label: "Profit & Loss", href: "/accounting/reports/profit-loss" },
      { label: "Balance Sheet", href: "/accounting/reports/balance-sheet" },
      { label: "General Ledger", href: "/accounting/reports/general-ledger" },
      { label: "AR Aging", href: "/accounting/reports/ar-aging" },
      { label: "AP Aging", href: "/accounting/reports/ap-aging" },
      { label: "Customer SOA", href: "/accounting/reports/customer-soa" },
      { label: "Supplier SOA", href: "/accounting/reports/supplier-soa" },
      { label: "Inventory Valuation", href: "/accounting/reports/inventory-valuation" },
      { label: "Margin by Item", href: "/accounting/reports/margin-by-item" },
      { label: "Margin by Customer", href: "/accounting/reports/margin-by-customer" },
      { label: "Margin by Category", href: "/accounting/reports/margin-by-category" },
      { label: "Expiry Exposure", href: "/accounting/reports/expiry-exposure" },
      { label: "Negative Stock Risk", href: "/accounting/reports/negative-stock-risk" },
      { label: "Landed Cost Impact", href: "/accounting/reports/landed-cost-impact" },
      { label: "Consolidated", href: "/accounting/reports/consolidated" }
    ]
  },
  {
    label: "Automation",
    items: [
      { label: "AI Hub", href: "/automation/ai-hub" },
      { label: "AP Import Queue", href: "/automation/ap-import" },
      { label: "Copilot", href: "/automation/copilot" },
      { label: "Ops Copilot", href: "/automation/ops-copilot" },
      { label: "Kai Analytics", href: "/automation/kai-analytics" },
      { label: "Kai Settings", href: "/automation/kai-settings" }
    ]
  },
  {
    label: "Administration",
    items: [
      { label: "Go-Live", href: "/system/go-live" },
      { label: "Config", href: "/system/config" },
      { label: "Appearance", href: "/system/appearance" },
      { label: "Dimensions", href: "/system/dimensions" },
      { label: "Branches", href: "/system/branches" },
      { label: "UOMs", href: "/system/uoms" },
      { label: "Warehouses", href: "/system/warehouses" },
      { label: "Warehouse Locations", href: "/system/warehouse-locations" },
      { label: "Users", href: "/system/users" },
      { label: "Security", href: "/system/security" },
      { label: "Dedup / Merge", href: "/system/dedup" },
      { label: "Audit Logs", href: "/system/audit-logs" },
      { label: "Roles", href: "/system/roles-permissions" }
    ]
  }
];

/* ------------------------------------------------------------------ */
/*  Lite nav (reduced set for simplified UI)                          */
/* ------------------------------------------------------------------ */

export const LITE_NAV_SECTIONS: NavSectionData[] = [
  {
    label: "Core",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Sales Invoices", href: "/sales/invoices" },
      { label: "Customers", href: "/partners/customers/list" },
      { label: "Items", href: "/catalog/items/list" },
      { label: "Stock", href: "/inventory/stock" }
    ]
  },
  {
    label: "Operations",
    items: [
      { label: "POS Shifts", href: "/system/pos-shifts" },
      { label: "POS Devices", href: "/system/pos-devices" },
      { label: "Outbox", href: "/system/outbox" }
    ]
  },
  {
    label: "Administration",
    items: [
      { label: "Users", href: "/system/users" },
      { label: "Audit Logs", href: "/system/audit-logs" },
      { label: "Config", href: "/system/config" },
      { label: "Appearance", href: "/system/appearance" },
      { label: "UOMs", href: "/system/uoms" },
    ]
  }
];

/* ------------------------------------------------------------------ */
/*  Title lookup                                                      */
/* ------------------------------------------------------------------ */

/**
 * Extra title overrides for paths that are not present in the nav
 * sections but still need a page title (e.g. alias paths, hidden pages).
 */
const EXTRA_TITLES: Record<string, string> = {
  "/partners/customers": "Customers",
  "/catalog/items": "Items",
  "/accounting/period-locks": "Period Locks",
};

/** Build a flat path -> label map from all nav sections. */
function buildTitleMap(): Record<string, string> {
  const map: Record<string, string> = { ...EXTRA_TITLES };
  for (const section of FULL_NAV_SECTIONS) {
    for (const item of section.items) {
      map[item.href] = item.label;
    }
  }
  // Lite sections may have paths not in full (unlikely but safe).
  for (const section of LITE_NAV_SECTIONS) {
    for (const item of section.items) {
      if (!map[item.href]) {
        map[item.href] = item.label;
      }
    }
  }
  return map;
}

const TITLE_MAP = buildTitleMap();

/**
 * Derive a human-readable page title from the current pathname.
 * Performs an exact match first, then falls back to longest-prefix match.
 */
export function titleForPath(pathname: string): string | undefined {
  if (TITLE_MAP[pathname]) return TITLE_MAP[pathname];
  // Longest-prefix match: sort by descending length so more specific paths win.
  const keys = Object.keys(TITLE_MAP).sort((a, b) => b.length - a.length);
  const match = keys.find((k) => pathname === k || pathname.startsWith(k + "/"));
  return match ? TITLE_MAP[match] : undefined;
}
