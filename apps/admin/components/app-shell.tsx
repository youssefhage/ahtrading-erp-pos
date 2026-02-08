"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  BadgeDollarSign,
  BellRing,
  BookOpen,
  Bot,
  Boxes,
  Building2,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Command,
  Cpu,
  FileText,
  GitBranch,
  Inbox,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Package,
  PackageCheck,
  Percent,
  ReceiptText,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Sun,
  Timer,
  TrendingUp,
  Truck,
  UserRoundCog,
  Users,
  UsersRound,
  Warehouse,
  Wifi,
  WifiOff,
  Workflow,
  X,
  Zap
} from "lucide-react";

import { apiGet, apiPost, clearSession, getCompanyId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type NavItem = {
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
};

type NavSection = { label: string; items: NavItem[] };
type FlatNavItem = NavItem & { section: string };

function iconForHref(href: string) {
  const byHref: Record<string, React.ComponentType<{ className?: string }>> = {
    "/dashboard": LayoutDashboard,

    "/system/outbox": Inbox,
    "/system/pos-devices": Monitor,
    "/system/pos-cashiers": UserRoundCog,
    "/system/pos-shifts": Timer,

    "/sales/invoices": ReceiptText,
    "/sales/payments": BadgeDollarSign,
    "/sales/returns": ArrowLeftRight,

    "/purchasing/purchase-orders": ClipboardList,
    "/purchasing/goods-receipts": PackageCheck,
    "/purchasing/supplier-invoices": FileText,
    "/purchasing/payments": BadgeDollarSign,

    "/partners/customers": UsersRound,
    "/partners/suppliers": Users,

    "/catalog/items": Package,
    "/catalog/item-categories": Percent,
    "/catalog/price-lists": BadgeDollarSign,
    "/catalog/promotions": Sparkles,

    "/inventory/stock": Boxes,
    "/inventory/movements": ArrowLeftRight,
    "/inventory/alerts": BellRing,
    "/inventory/ops": Workflow,

    "/accounting/journals": BookOpen,
    "/accounting/coa": BookOpen,
    "/accounting/intercompany": Workflow,
    "/accounting/banking/accounts": Landmark,
    "/accounting/banking/reconciliation": BadgeDollarSign,

    "/accounting/reports/vat": Percent,
    "/accounting/reports/trial-balance": Calculator,
    "/accounting/reports/profit-loss": TrendingUp,
    "/accounting/reports/balance-sheet": Calculator,
    "/accounting/reports/general-ledger": BookOpen,
    "/accounting/reports/ar-aging": Timer,
    "/accounting/reports/ap-aging": Timer,
    "/accounting/reports/inventory-valuation": BadgeDollarSign,
    "/accounting/reports/consolidated": Workflow,

    "/automation/ai-hub": Sparkles,
    "/automation/copilot": Bot,
    "/automation/ops-copilot": Workflow,

    "/system/go-live": Rocket,
    "/system/config": Settings2,
    "/system/branches": GitBranch,
    "/system/warehouses": Warehouse,
    "/system/users": UserRoundCog,
    "/system/roles-permissions": ShieldCheck,
  };

  if (byHref[href]) return byHref[href];

  if (href === "/dashboard") return LayoutDashboard;
  if (href.startsWith("/sales/")) return ShoppingCart;
  if (href.startsWith("/purchasing/")) return Truck;
  if (href.startsWith("/partners/")) return Users;
  if (href.startsWith("/inventory/")) return Boxes;
  if (href.startsWith("/accounting/")) return Calculator;
  if (href.startsWith("/automation/")) return Sparkles;
  return Cpu;
}

function withIcons(sections: NavSection[]): NavSection[] {
  return sections.map((s) => ({
    ...s,
    items: s.items.map((i) => ({ ...i, icon: i.icon ?? iconForHref(i.href) }))
  }));
}

const FULL_NAV_SECTIONS: NavSection[] = [
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
      { label: "Supplier Payments", href: "/purchasing/payments" }
    ]
  },
  {
    label: "Master Data",
    items: [
      { label: "Customers", href: "/partners/customers" },
      { label: "Suppliers", href: "/partners/suppliers" },
      { label: "Items", href: "/catalog/items" },
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
      { label: "Alerts", href: "/inventory/alerts" }
    ]
  },
  {
    label: "Accounting",
    items: [
      { label: "Journals", href: "/accounting/journals" },
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
      { label: "Inventory Valuation", href: "/accounting/reports/inventory-valuation" },
      { label: "Consolidated", href: "/accounting/reports/consolidated" }
    ]
  },
  {
    label: "Automation",
    items: [
      { label: "AI Hub", href: "/automation/ai-hub" },
      { label: "Copilot", href: "/automation/copilot" },
      { label: "Ops Copilot", href: "/automation/ops-copilot" }
    ]
  },
  {
    label: "Administration",
    items: [
      { label: "Go-Live", href: "/system/go-live" },
      { label: "Config", href: "/system/config" },
      { label: "Branches", href: "/system/branches" },
      { label: "Warehouses", href: "/system/warehouses" },
      { label: "Users", href: "/system/users" },
      { label: "Roles", href: "/system/roles-permissions" }
    ]
  }
];

const LITE_NAV_SECTIONS: NavSection[] = [
  {
    label: "Core",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Sales Invoices", href: "/sales/invoices" },
      { label: "Customers", href: "/partners/customers" },
      { label: "Items", href: "/catalog/items" },
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
      { label: "Config", href: "/system/config" }
    ]
  }
];

type UiVariant = "full" | "lite";
type ColorTheme = "light" | "dark";

function NavItemComponent({
  item,
  isActive,
  collapsed,
  onClick
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon ?? Cpu;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      data-active={isActive}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 focus-ring",
        collapsed && "justify-center px-2",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-fg-muted hover:bg-bg-elevated/60 hover:text-foreground"
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          isActive ? "text-primary" : "text-fg-subtle group-hover:text-fg-muted"
        )}
      />
      <span className={cn("truncate", collapsed && "hidden")}>{item.label}</span>
      {isActive && !collapsed && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </Link>
  );
}

export function AppShell(props: { title?: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [uiVariant, setUiVariant] = useState<UiVariant>(() => {
    try {
      const raw = localStorage.getItem("admin.uiVariant");
      return raw === "lite" ? "lite" : "full";
    } catch {
      return "full";
    }
  });
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
    try {
      const raw = localStorage.getItem("admin.colorTheme");
      return raw === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQ, setCommandQ] = useState("");
  const commandInputRef = useRef<HTMLInputElement | null>(null);

  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [healthDetail, setHealthDetail] = useState("");

  const companyId = getCompanyId();
  const [authChecked, setAuthChecked] = useState(false);
  const [authOk, setAuthOk] = useState(false);

  const navSections = useMemo<NavSection[]>(
    () => withIcons(uiVariant === "lite" ? LITE_NAV_SECTIONS : FULL_NAV_SECTIONS),
    [uiVariant]
  );

  const flatNav = useMemo<FlatNavItem[]>(
    () => navSections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label }))),
    [navSections]
  );

  const activeInfo = useMemo(() => {
    const item = flatNav.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
    return { href: item?.href || "/dashboard", label: item?.label || "Dashboard" };
  }, [pathname, flatNav]);

  const active = activeInfo.href;
  const title = props.title ?? activeInfo.label;

  const activeSectionLabel = useMemo(() => {
    const item = flatNav.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
    return item?.section || "";
  }, [pathname, flatNav]);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Persist module expansion per UI variant (full vs lite).
    const key = `admin.navOpenSections.${uiVariant}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setOpenSections(parsed);
          return;
        }
      }
    } catch {
      // ignore
    }

    // Default: keep the first module and the active module open.
    const defaults: Record<string, boolean> = {};
    for (const s of navSections) defaults[s.label] = false;
    if (navSections[0]?.label) defaults[navSections[0].label] = true;
    if (activeSectionLabel) defaults[activeSectionLabel] = true;
    setOpenSections(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiVariant, navSections.length]);

  useEffect(() => {
    if (!activeSectionLabel) return;
    setOpenSections((prev) => {
      if (prev[activeSectionLabel]) return prev;
      const next = { ...prev, [activeSectionLabel]: true };
      try {
        localStorage.setItem(`admin.navOpenSections.${uiVariant}`, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [activeSectionLabel, uiVariant]);

  function toggleSection(label: string) {
    setOpenSections((prev) => {
      const next = { ...prev, [label]: !(prev[label] ?? true) };
      try {
        localStorage.setItem(`admin.navOpenSections.${uiVariant}`, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  const commandResults = useMemo(() => {
    const needle = commandQ.trim().toLowerCase();
    const items = needle
      ? flatNav.filter((i) => i.label.toLowerCase().includes(needle) || i.href.toLowerCase().includes(needle))
      : flatNav;
    return items.slice(0, 10);
  }, [commandQ, flatNav]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await apiGet("/auth/me");
        if (cancelled) return;
        setAuthOk(true);
      } catch {
        if (cancelled) return;
        clearSession();
        router.push("/login");
      } finally {
        if (cancelled) return;
        setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!authChecked || !authOk) return;
    if (!companyId) router.push("/company/select");
  }, [authChecked, authOk, companyId, router]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("admin.sidebarCollapsed");
      if (raw === "1") setCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("admin.colorTheme", colorTheme);
    } catch {
      // ignore
    }
    if (colorTheme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [colorTheme]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
      if (e.key === "Escape" && commandOpen) {
        setCommandOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandOpen]);

  useEffect(() => {
    if (!commandOpen) return;
    setCommandQ("");
    const t = window.setTimeout(() => commandInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [commandOpen]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function check() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (cancelled) return;
        setHealth("online");
        setHealthDetail("");
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setHealth("offline");
        setHealthDetail(message);
      }
    }

    check();
    // Lite mode is meant to be "quiet": reduce background polling.
    if (uiVariant !== "lite") {
      timer = window.setInterval(check, 30000);
    }
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [uiVariant]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("admin.sidebarCollapsed", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  function toggleUiVariant() {
    setUiVariant((v) => {
      const next: UiVariant = v === "lite" ? "full" : "lite";
      try {
        localStorage.setItem("admin.uiVariant", next);
      } catch {
        // ignore
      }
      return next;
    });
  }

  function toggleColorTheme() {
    setColorTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  async function logout() {
    try {
      await apiPost("/auth/logout", {});
    } catch {
      // ignore
    } finally {
      clearSession();
      router.push("/login");
    }
  }

  if (!authChecked) {
        return (
          <div className="flex h-screen items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-4">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
              <p className="text-sm text-fg-subtle">Initializing session...</p>
            </div>
          </div>
        );
      }
  if (!authOk) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-border-subtle bg-bg-elevated/70 transition-all duration-300",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Header */}
        <div className="flex h-14 items-center border-b border-border-subtle px-4">
            <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-dim">
              <span className="text-sm font-bold text-primary-foreground">AH</span>
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">AH Trading</span>
                <span className="text-[10px] uppercase tracking-wider text-fg-subtle">Admin</span>
              </div>
            )}
          </div>
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7 text-fg-subtle hover:text-foreground"
              onClick={toggleCollapsed}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Collapse button when collapsed */}
        {collapsed && (
          <div className="flex h-10 items-center justify-center border-b border-border-subtle">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-fg-subtle hover:text-foreground"
              onClick={toggleCollapsed}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2">
          {navSections.map((section) => (
            <div key={section.label} className="px-2 py-2">
              {!collapsed && (
                <button
                  type="button"
                  className={cn(
                    "mb-1 flex w-full items-center gap-2 rounded-md px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-fg-subtle transition-colors hover:bg-bg-sunken/60 hover:text-fg-muted",
                    openSections[section.label] ? "text-fg-muted" : "text-fg-subtle"
                  )}
                  onClick={() => toggleSection(section.label)}
                  aria-expanded={!!openSections[section.label]}
                >
                  <span className="flex-1 text-left">{section.label}</span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform",
                      openSections[section.label] ? "rotate-0" : "-rotate-90"
                    )}
                  />
                </button>
              )}
              {collapsed && <div className="mb-2 h-px bg-border-subtle" />}
              {(collapsed || openSections[section.label]) && (
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <NavItemComponent
                      key={item.href}
                      item={item}
                      isActive={active === item.href}
                      collapsed={collapsed}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border-subtle p-2">
          <div className={cn("space-y-1", collapsed && "flex flex-col items-center")}>
            <Button
              variant="ghost"
              className={cn(
                "h-8 text-fg-muted hover:text-foreground",
                collapsed ? "w-8 justify-center px-0" : "w-full justify-start gap-2"
              )}
              onClick={toggleColorTheme}
              title={collapsed ? (colorTheme === "dark" ? "Dark theme" : "Light theme") : undefined}
            >
              {colorTheme === "dark" ? (
                <Moon className="h-4 w-4 shrink-0" />
              ) : (
                <Sun className="h-4 w-4 shrink-0" />
              )}
              {!collapsed && (
                <>
                  <span className="text-xs">Theme</span>
                  <code
                    className={cn(
                      "ml-auto rounded px-1.5 py-0.5 text-[10px]",
                      colorTheme === "dark"
                        ? "bg-primary/10 text-primary"
                        : "bg-bg-sunken text-fg-muted"
                    )}
                  >
                    {colorTheme === "dark" ? "DARK" : "LIGHT"}
                  </code>
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              className={cn(
                "h-8 text-fg-muted hover:text-foreground",
                collapsed ? "w-8 justify-center px-0" : "w-full justify-start gap-2"
              )}
              onClick={toggleUiVariant}
              title={collapsed ? (uiVariant === "lite" ? "Lite mode (on)" : "Lite mode (off)") : undefined}
            >
              <Zap className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="text-xs">Lite mode</span>
                  <code
                    className={cn(
                      "ml-auto rounded px-1.5 py-0.5 text-[10px]",
                      uiVariant === "lite"
                        ? "bg-primary/10 text-primary"
                        : "bg-bg-sunken text-fg-muted"
                    )}
                  >
                    {uiVariant === "lite" ? "ON" : "OFF"}
                  </code>
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              className={cn(
                "h-8 text-fg-muted hover:text-foreground",
                collapsed ? "w-8 justify-center px-0" : "w-full justify-start gap-2"
              )}
              onClick={() => router.push("/company/select")}
            >
              <Building2 className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="text-xs">Company</span>
                  <code className="ml-auto rounded bg-bg-sunken px-1.5 py-0.5 text-[10px] text-fg-muted">
                    {companyId || "-"}
                  </code>
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              className={cn(
                "h-8 text-fg-muted hover:text-red-500",
                collapsed ? "w-8 justify-center px-0" : "w-full justify-start gap-2"
              )}
              onClick={logout}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="text-xs">Logout</span>}
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border-subtle bg-background/70 px-4 backdrop-blur-sm">
          <div className="flex items-center gap-3 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-fg-muted hover:text-foreground"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex flex-1 items-center gap-4">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">{title}</span>
              <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                {activeSectionLabel || activeInfo.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Search trigger */}
            <Button
              variant="outline"
              onClick={() => setCommandOpen(true)}
              className="hidden h-9 items-center gap-2 border-border bg-bg-elevated/60 text-fg-muted hover:bg-bg-sunken hover:text-foreground md:flex"
            >
              <Search className="h-4 w-4" />
              <span className="text-sm">Search...</span>
              <span className="ml-2 flex items-center gap-0.5">
                <kbd className="ui-kbd">⌘</kbd>
                <kbd className="ui-kbd">K</kbd>
              </span>
            </Button>

            {/* Health indicator */}
            <div
              className={cn(
                "flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium",
                health === "online"
                  ? "border-green-500/20 bg-green-500/10 text-green-400"
                  : health === "offline"
                    ? "border-red-500/20 bg-red-500/10 text-red-400"
                    : "border-border bg-bg-elevated text-fg-subtle"
              )}
              title={healthDetail || "System status"}
            >
              {health === "online" ? (
                <>
                  <span className="status-dot status-online" />
                  <span className="hidden sm:inline">Online</span>
                </>
              ) : health === "offline" ? (
                <>
                  <WifiOff className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Offline</span>
                </>
              ) : (
                <>
                  <Wifi className="h-3.5 w-3.5 animate-pulse" />
                  <span className="hidden sm:inline">...</span>
                </>
              )}
            </div>

            {/* User menu */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-fg-muted hover:text-foreground"
              onClick={logout}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="mx-auto max-w-7xl">{props.children}</div>
        </div>
      </main>

      {/* Mobile Navigation Drawer */}
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent className="left-0 top-0 h-full w-72 max-w-none translate-x-0 translate-y-0 rounded-none border-0 border-r border-border-subtle bg-bg-elevated p-0">
          <DialogHeader className="border-b border-border-subtle p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-dim">
                <span className="text-sm font-bold text-primary-foreground">AH</span>
              </div>
              <div className="flex flex-col">
                <DialogTitle className="text-sm font-semibold text-foreground">AH Trading</DialogTitle>
                <span className="text-[10px] uppercase tracking-wider text-fg-subtle">Admin</span>
              </div>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-1 p-2">
            <div className="mb-2 flex items-center gap-2 px-3 py-2">
              <Building2 className="h-4 w-4 text-fg-subtle" />
              <span className="text-xs text-fg-muted">Company</span>
              <code className="ml-auto rounded bg-bg-sunken px-1.5 py-0.5 text-[10px] text-fg-muted">
                {companyId || "-"}
              </code>
            </div>

            {navSections.map((section) => (
              <div key={section.label} className="py-1">
                <p className="mb-1 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <NavItemComponent
                      key={item.href}
                      item={item}
                      isActive={active === item.href}
                      collapsed={false}
                      onClick={() => setMobileOpen(false)}
                    />
                  ))}
                </div>
              </div>
            ))}

            <div className="mt-auto border-t border-border-subtle pt-2">
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 text-fg-muted hover:text-red-500"
                onClick={() => {
                  setMobileOpen(false);
                  logout();
                }}
              >
                <LogOut className="h-4 w-4" />
                <span className="text-xs">Logout</span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Command Palette */}
      <Dialog open={commandOpen} onOpenChange={setCommandOpen}>
        <DialogContent className="max-w-xl border-border-subtle bg-bg-elevated p-0 shadow-2xl">
          <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
            <Search className="h-5 w-5 text-fg-subtle" />
            <input
              ref={commandInputRef}
              value={commandQ}
              onChange={(e) => setCommandQ(e.target.value)}
              placeholder="Search pages, actions, or data..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-fg-subtle focus:outline-none"
            />
            <kbd className="ui-kbd">ESC</kbd>
          </div>

          <div className="max-h-[60vh] overflow-y-auto py-2">
            {commandResults.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-fg-subtle">
                <p>No results found</p>
                <p className="mt-1 text-xs">Try a different search term</p>
              </div>
            ) : (
              <div className="space-y-0.5 px-2">
                {commandResults.map((item) => {
                  const Icon = item.icon ?? Cpu;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-bg-sunken"
                      onClick={() => {
                        setCommandOpen(false);
                        router.push(item.href);
                      }}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-sunken">
                        <Icon className="h-4 w-4 text-fg-muted" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                        <p className="truncate text-xs text-fg-subtle">
                          {item.section} · {item.href}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-fg-subtle" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border-subtle px-4 py-2 text-xs text-fg-subtle">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="ui-kbd">↑</kbd>
                <kbd className="ui-kbd">↓</kbd>
                <span className="ml-1">Navigate</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="ui-kbd">Enter</kbd>
                <span className="ml-1">Select</span>
              </span>
            </div>
            <span>{commandResults.length} items</span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
