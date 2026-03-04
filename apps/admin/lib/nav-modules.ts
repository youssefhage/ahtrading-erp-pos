/**
 * Module-based navigation for the new top-nav + sidebar layout.
 *
 * Each "module" appears as a tab in the top navigation bar.
 * When a module is active, its `sections` populate the sidebar.
 */

import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ShoppingCart,
  Truck,
  Boxes,
  Package,
  Calculator,
  BarChart3,
  Sparkles,
  Settings,
  FileText,
  ReceiptText,
  CreditCard,
  ArrowLeftRight,
  BadgeDollarSign,
  ClipboardList,
  PackageCheck,
  FileInput,
  Scale,
  ShieldCheck,
  TrendingUp,
  Warehouse,
  ArrowRightLeft,
  RefreshCcw,
  ClipboardCheck,
  Layers,
  Bell,
  Lightbulb,
  DollarSign,
  Tag,
  BookOpen,
  Repeat,
  CheckSquare,
  GitBranch,
  Landmark,
  Building2,
  Bot,
  FileUp,
  MessageSquare,
  Cpu,
  Rocket,
  Palette,
  Ruler,
  MapPin,
  Users,
  Lock,
  Merge,
  ScrollText,
  UserRoundCog,
  Inbox,
  AlertTriangle,
  Timer,
  Monitor,
  UsersRound,
  Workflow,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type NavModule = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Path prefixes that activate this module */
  prefixes: string[];
  sections: NavModuleSection[];
};

export type NavModuleSection = {
  label?: string;
  items: NavModuleItem[];
};

export type NavModuleItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

/* ------------------------------------------------------------------ */
/*  Module definitions                                                 */
/* ------------------------------------------------------------------ */

export const NAV_MODULES: NavModule[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    prefixes: ["/dashboard"],
    sections: [
      {
        items: [
          { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
        ],
      },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    icon: ShoppingCart,
    prefixes: ["/sales"],
    sections: [
      {
        label: "Transactions",
        items: [
          { label: "Invoices", href: "/sales/invoices", icon: FileText },
          { label: "Receipts", href: "/sales/receipts", icon: ReceiptText },
          { label: "Credit Notes", href: "/sales/credit-notes", icon: CreditCard },
          { label: "Returns", href: "/sales/returns", icon: ArrowLeftRight },
        ],
      },
      {
        label: "Processing",
        items: [
          { label: "Payments", href: "/sales/payments", icon: BadgeDollarSign },
          { label: "Adjustment Queue", href: "/sales/adjustment-queue", icon: ClipboardList },
        ],
      },
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    icon: Truck,
    prefixes: ["/purchasing"],
    sections: [
      {
        label: "Documents",
        items: [
          { label: "Purchase Orders", href: "/purchasing/purchase-orders", icon: ClipboardList },
          { label: "Goods Receipts", href: "/purchasing/goods-receipts", icon: PackageCheck },
          { label: "Supplier Invoices", href: "/purchasing/supplier-invoices", icon: FileInput },
          { label: "Supplier Credits", href: "/purchasing/supplier-credits", icon: CreditCard },
        ],
      },
      {
        label: "Processing",
        items: [
          { label: "3-Way Match", href: "/purchasing/3-way-match", icon: Scale },
          { label: "Payments", href: "/purchasing/payments", icon: BadgeDollarSign },
        ],
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: Boxes,
    prefixes: ["/inventory"],
    sections: [
      {
        label: "Overview",
        items: [
          { label: "Stock", href: "/inventory/stock", icon: Warehouse },
          { label: "Movements", href: "/inventory/movements", icon: ArrowRightLeft },
          { label: "Transfers", href: "/inventory/transfers", icon: ArrowLeftRight },
          { label: "Batches", href: "/inventory/batches", icon: Layers },
        ],
      },
      {
        label: "Planning",
        items: [
          { label: "Replenishment", href: "/inventory/replenishment", icon: RefreshCcw },
          { label: "Cycle Counts", href: "/inventory/cycle-counts", icon: ClipboardCheck },
          { label: "Reorder Suggestions", href: "/inventory/reorder-suggestions", icon: Lightbulb },
          { label: "Alerts", href: "/inventory/alerts", icon: Bell },
        ],
      },
      {
        label: "Cost Tracking",
        items: [
          { label: "Landed Costs", href: "/inventory/landed-costs", icon: DollarSign },
          { label: "Cost Changes", href: "/inventory/cost-changes", icon: TrendingUp },
          { label: "Price Changes", href: "/inventory/price-changes", icon: Tag },
        ],
      },
    ],
  },
  {
    id: "catalog",
    label: "Catalog",
    icon: Package,
    prefixes: ["/catalog", "/partners"],
    sections: [
      {
        label: "Products",
        items: [
          { label: "Items", href: "/catalog/items/list", icon: Package },
          { label: "Categories", href: "/catalog/item-categories", icon: Tag },
        ],
      },
      {
        label: "Pricing",
        items: [
          { label: "Price Lists", href: "/catalog/price-lists", icon: DollarSign },
          { label: "Price Rules", href: "/catalog/price-rules", icon: Scale },
          { label: "Promotions", href: "/catalog/promotions", icon: Tag },
        ],
      },
      {
        label: "Partners",
        items: [
          { label: "Customers", href: "/partners/customers/list", icon: UsersRound },
          { label: "Suppliers", href: "/partners/suppliers", icon: Truck },
        ],
      },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    icon: Calculator,
    prefixes: ["/accounting"],
    sections: [
      {
        label: "Journals",
        items: [
          { label: "Journal Entries", href: "/accounting/journals", icon: BookOpen },
          { label: "Templates", href: "/accounting/journal-templates", icon: FileText },
          { label: "Recurring", href: "/accounting/recurring-journals", icon: Repeat },
        ],
      },
      {
        label: "Setup",
        items: [
          { label: "Chart of Accounts", href: "/accounting/coa", icon: GitBranch },
          { label: "Intercompany", href: "/accounting/intercompany", icon: Building2 },
          { label: "Close Checklist", href: "/accounting/close-checklist", icon: CheckSquare },
        ],
      },
      {
        label: "Banking",
        items: [
          { label: "Bank Accounts", href: "/accounting/banking/accounts", icon: Landmark },
          { label: "Reconciliation", href: "/accounting/banking/reconciliation", icon: Scale },
        ],
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    prefixes: ["/accounting/reports"],
    sections: [
      {
        label: "Financial",
        items: [
          { label: "Trial Balance", href: "/accounting/reports/trial-balance", icon: Scale },
          { label: "Profit & Loss", href: "/accounting/reports/profit-loss", icon: TrendingUp },
          { label: "Balance Sheet", href: "/accounting/reports/balance-sheet", icon: FileText },
          { label: "General Ledger", href: "/accounting/reports/general-ledger", icon: BookOpen },
          { label: "VAT", href: "/accounting/reports/vat", icon: ReceiptText },
          { label: "Consolidated", href: "/accounting/reports/consolidated", icon: Layers },
        ],
      },
      {
        label: "Receivables & Payables",
        items: [
          { label: "AR Aging", href: "/accounting/reports/ar-aging", icon: TrendingUp },
          { label: "AP Aging", href: "/accounting/reports/ap-aging", icon: TrendingUp },
          { label: "Customer SOA", href: "/accounting/reports/customer-soa", icon: FileText },
          { label: "Supplier SOA", href: "/accounting/reports/supplier-soa", icon: FileText },
        ],
      },
      {
        label: "Analysis",
        items: [
          { label: "Margin by Item", href: "/accounting/reports/margin-by-item", icon: BarChart3 },
          { label: "Margin by Customer", href: "/accounting/reports/margin-by-customer", icon: BarChart3 },
          { label: "Margin by Category", href: "/accounting/reports/margin-by-category", icon: BarChart3 },
          { label: "Inventory Valuation", href: "/accounting/reports/inventory-valuation", icon: Warehouse },
          { label: "Expiry Exposure", href: "/accounting/reports/expiry-exposure", icon: AlertTriangle },
          { label: "Negative Stock Risk", href: "/accounting/reports/negative-stock-risk", icon: AlertTriangle },
          { label: "Landed Cost Impact", href: "/accounting/reports/landed-cost-impact", icon: DollarSign },
        ],
      },
    ],
  },
  {
    id: "automation",
    label: "AI",
    icon: Sparkles,
    prefixes: ["/automation"],
    sections: [
      {
        items: [
          { label: "AI Hub", href: "/automation/ai-hub", icon: Bot },
          { label: "AP Import", href: "/automation/ap-import", icon: FileUp },
          { label: "Copilot", href: "/automation/copilot", icon: MessageSquare },
          { label: "Ops Copilot", href: "/automation/ops-copilot", icon: Cpu },
        ],
      },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Settings,
    prefixes: ["/system"],
    sections: [
      {
        label: "Operations",
        items: [
          { label: "Outbox", href: "/system/outbox", icon: Inbox },
          { label: "Needs Attention", href: "/system/attention", icon: AlertTriangle },
          { label: "POS Shifts", href: "/system/pos-shifts", icon: Timer },
          { label: "POS Devices", href: "/system/pos-devices", icon: Monitor },
          { label: "POS Cashiers", href: "/system/pos-cashiers", icon: UsersRound },
          { label: "Inventory Ops", href: "/inventory/ops", icon: Workflow },
        ],
      },
      {
        label: "Configuration",
        items: [
          { label: "Go-Live", href: "/system/go-live", icon: Rocket },
          { label: "Config", href: "/system/config", icon: Settings },
          { label: "Appearance", href: "/system/appearance", icon: Palette },
          { label: "Dimensions", href: "/system/dimensions", icon: Ruler },
          { label: "Branches", href: "/system/branches", icon: MapPin },
          { label: "UOMs", href: "/system/uoms", icon: Ruler },
          { label: "Warehouses", href: "/system/warehouses", icon: Warehouse },
          { label: "Warehouse Locations", href: "/system/warehouse-locations", icon: MapPin },
        ],
      },
      {
        label: "Security",
        items: [
          { label: "Users", href: "/system/users", icon: Users },
          { label: "Roles", href: "/system/roles-permissions", icon: ShieldCheck },
          { label: "Security", href: "/system/security", icon: Lock },
          { label: "Audit Logs", href: "/system/audit-logs", icon: ScrollText },
          { label: "Dedup / Merge", href: "/system/dedup", icon: Merge },
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Find which module a given pathname belongs to. */
export function moduleForPath(pathname: string): NavModule | undefined {
  // Reports must match before Accounting since /accounting/reports is a sub-path
  // Sort by prefix length descending so more specific prefixes match first
  const sorted = NAV_MODULES.flatMap((m) =>
    m.prefixes.map((p) => ({ module: m, prefix: p }))
  ).sort((a, b) => b.prefix.length - a.prefix.length);

  for (const { module, prefix } of sorted) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return module;
    }
  }
  return undefined;
}

/** Find the nav item matching a given pathname (for recent-page tracking). */
export function itemForPath(pathname: string): NavModuleItem | undefined {
  for (const mod of NAV_MODULES) {
    for (const section of mod.sections) {
      for (const item of section.items) {
        if (isActivePath(pathname, item.href)) return item;
      }
    }
  }
  return undefined;
}

/** Check if a path matches the current route (exact or prefix). */
export function isActivePath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // For list pages like /catalog/items/list, match /catalog/items/[id] too
  if (href.endsWith("/list")) {
    const base = href.replace(/\/list$/, "");
    return pathname.startsWith(base + "/");
  }
  return pathname.startsWith(href + "/");
}
