"use client";

import { usePathname } from "next/navigation";

import { AppShell } from "@/components/app-shell";

const PUBLIC_PREFIXES = ["/login", "/company/select"];
// Public utility routes that just flip client-side UI settings (no auth gating here).
const PUBLIC_PREFIXES_EXTRA = ["/lite", "/full", "/light", "/dark"];

function isPrintPath(pathname: string) {
  // Match any route that contains a `print` path segment.
  // Examples:
  // - /sales/invoices/[id]/print
  // - /purchasing/supplier-invoices/[id]/print
  const clean = String(pathname || "").split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  return parts.includes("print");
}

const TITLE_BY_PATH: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/sales/invoices": "Sales Invoices",
  "/sales/adjustment-queue": "Adjustment Queue",
  "/sales/payments": "Sales Payments",
  "/sales/returns": "Sales Returns",
  "/purchasing/purchase-orders": "Purchase Orders",
  "/purchasing/goods-receipts": "Goods Receipts",
  "/purchasing/supplier-invoices": "Supplier Invoices",
  "/purchasing/supplier-credits": "Supplier Credits",
  "/purchasing/payments": "Supplier Payments",
  "/partners/customers": "Customers",
  "/partners/customers/list": "Customers",
  "/partners/suppliers": "Suppliers",
  "/catalog/items": "Items",
  "/catalog/items/list": "Items",
  "/catalog/item-categories": "Item Categories",
  "/catalog/price-lists": "Price Lists",
  "/catalog/promotions": "Promotions",
  "/inventory/stock": "Stock",
  "/inventory/alerts": "Inventory Alerts",
  "/inventory/movements": "Inventory Movements",
  "/inventory/batches": "Batches",
  "/inventory/ops": "Inventory Ops",
  "/accounting/journals": "Journals",
  "/accounting/journal-templates": "Journal Templates",
  "/accounting/close-checklist": "Close Checklist",
  "/accounting/coa": "Chart of Accounts",
  "/accounting/intercompany": "Intercompany",
  "/accounting/banking/accounts": "Bank Accounts",
  "/accounting/banking/reconciliation": "Bank Reconciliation",
  "/accounting/period-locks": "Period Locks",
  "/accounting/reports/vat": "VAT Report",
  "/accounting/reports/trial-balance": "Trial Balance",
  "/accounting/reports/general-ledger": "General Ledger",
  "/accounting/reports/profit-loss": "Profit & Loss",
  "/accounting/reports/balance-sheet": "Balance Sheet",
  "/accounting/reports/ar-aging": "AR Aging",
  "/accounting/reports/ap-aging": "AP Aging",
  "/accounting/reports/inventory-valuation": "Inventory Valuation",
  "/accounting/reports/margin-by-item": "Margin by Item",
  "/accounting/reports/margin-by-customer": "Margin by Customer",
  "/accounting/reports/margin-by-category": "Margin by Category",
  "/accounting/reports/expiry-exposure": "Expiry Exposure",
  "/accounting/reports/negative-stock-risk": "Negative Stock Risk",
  "/accounting/reports/landed-cost-impact": "Landed Cost Impact",
  "/accounting/reports/consolidated": "Consolidated Reports",
  "/system/config": "Config",
  "/system/dimensions": "Dimensions",
  "/system/branches": "Branches",
  "/system/warehouses": "Warehouses",
  "/system/users": "Users",
  "/system/roles-permissions": "Roles & Permissions",
  "/system/pos-devices": "POS Devices",
  "/system/pos-cashiers": "POS Cashiers",
  "/system/pos-shifts": "POS Shifts",
  "/system/outbox": "Outbox",
  "/system/audit-logs": "Audit Logs",
  "/automation/copilot": "Copilot",
  "/automation/ops-copilot": "Ops Copilot",
  "/automation/ai-hub": "AI Hub"
};

function isPublicPath(pathname: string) {
  if (pathname === "/") return true;
  // Print-friendly views should not be wrapped with the AppShell/nav chrome.
  if (isPrintPath(pathname)) return true;
  return [...PUBLIC_PREFIXES, ...PUBLIC_PREFIXES_EXTRA].some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function titleForPath(pathname: string) {
  if (TITLE_BY_PATH[pathname]) return TITLE_BY_PATH[pathname];
  const keys = Object.keys(TITLE_BY_PATH).sort((a, b) => b.length - a.length);
  const match = keys.find((k) => pathname === k || pathname.startsWith(k + "/"));
  return match ? TITLE_BY_PATH[match] : undefined;
}

export function ClientShellLayout(props: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";

  if (isPublicPath(pathname)) return props.children;
  return <AppShell title={titleForPath(pathname)}>{props.children}</AppShell>;
}
