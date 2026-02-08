"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  Boxes,
  Building2,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Cpu,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  Tag,
  Truck,
  Users,
  Wifi,
  WifiOff
} from "lucide-react";

import { apiGet, apiPost, clearSession, getCompanyId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type NavItem = {
  label: string;
  href: string;
};

type NavSection = { label: string; items: NavItem[] };
type FlatNavItem = NavItem & { section: string };

const navSections: NavSection[] = [
  {
    label: "Operations",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "POS Devices", href: "/system/pos-devices" },
      { label: "POS Cashiers", href: "/system/pos-cashiers" },
      { label: "POS Shifts", href: "/system/pos-shifts" },
      { label: "Outbox", href: "/system/outbox" }
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
      { label: "Suppliers", href: "/partners/suppliers" },
      { label: "Purchase Orders", href: "/purchasing/purchase-orders" },
      { label: "Goods Receipts", href: "/purchasing/goods-receipts" },
      { label: "Supplier Invoices", href: "/purchasing/supplier-invoices" },
      { label: "Supplier Payments", href: "/purchasing/payments" }
    ]
  },
  {
    label: "Partners",
    items: [{ label: "Customers", href: "/partners/customers" }]
  },
  {
    label: "Catalog & Inventory",
    items: [
      { label: "Items", href: "/catalog/items" },
      { label: "Item Categories", href: "/catalog/item-categories" },
      { label: "Price Lists", href: "/catalog/price-lists" },
      { label: "Promotions", href: "/catalog/promotions" },
      { label: "Stock", href: "/inventory/stock" },
      { label: "Alerts", href: "/inventory/alerts" },
      { label: "Movements", href: "/inventory/movements" },
      { label: "Inventory Ops", href: "/inventory/ops" }
    ]
  },
  {
    label: "Accounting",
    items: [
      { label: "Journals", href: "/accounting/journals" },
      { label: "COA", href: "/accounting/coa" },
      { label: "Bank Accounts", href: "/accounting/banking/accounts" },
      { label: "Reconciliation", href: "/accounting/banking/reconciliation" },
      { label: "Period Locks", href: "/accounting/period-locks" },
      { label: "VAT Report", href: "/accounting/reports/vat" },
      { label: "Trial Balance", href: "/accounting/reports/trial-balance" },
      { label: "General Ledger", href: "/accounting/reports/general-ledger" },
      { label: "Profit & Loss", href: "/accounting/reports/profit-loss" },
      { label: "Balance Sheet", href: "/accounting/reports/balance-sheet" },
      { label: "AR Aging", href: "/accounting/reports/ar-aging" },
      { label: "AP Aging", href: "/accounting/reports/ap-aging" },
      { label: "Inventory Valuation", href: "/accounting/reports/inventory-valuation" }
    ]
  },
  {
    label: "System",
    items: [
      { label: "Go-Live", href: "/system/go-live" },
      { label: "Config", href: "/system/config" },
      { label: "Branches", href: "/system/branches" },
      { label: "Warehouses", href: "/system/warehouses" },
      { label: "Users", href: "/system/users" },
      { label: "Roles & Perms", href: "/system/roles-permissions" }
    ]
  },
  {
    label: "Automation",
    items: [
      { label: "Copilot", href: "/automation/copilot" },
      { label: "Ops Copilot", href: "/automation/ops-copilot" },
      { label: "AI Hub", href: "/automation/ai-hub" }
    ]
  }
];

function iconForHref(href: string) {
  if (href === "/dashboard") return LayoutDashboard;
  if (href.startsWith("/sales/")) return ShoppingCart;
  if (href.startsWith("/purchasing/")) return Truck;
  if (href.startsWith("/partners/")) return Users;
  if (href.startsWith("/catalog/")) return Tag;
  if (href.startsWith("/inventory/")) return Boxes;
  if (href.startsWith("/accounting/")) return Calculator;
  if (href.startsWith("/system/")) return Settings;
  if (href.startsWith("/automation/")) return Sparkles;
  return Cpu;
}

export function AppShell(props: { title?: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQ, setCommandQ] = useState("");
  const commandInputRef = useRef<HTMLInputElement | null>(null);

  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [healthDetail, setHealthDetail] = useState("");
  const [healthAt, setHealthAt] = useState<Date | null>(null);

  const companyId = getCompanyId();
  const [authChecked, setAuthChecked] = useState(false);
  const [authOk, setAuthOk] = useState(false);

  const flatNav = useMemo<FlatNavItem[]>(
    () => navSections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label }))),
    []
  );
  const activeInfo = useMemo(() => {
    const item = flatNav.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
    return { href: item?.href || "/dashboard", label: item?.label || "Dashboard" };
  }, [pathname, flatNav]);
  const active = activeInfo.href;
  const title = props.title ?? activeInfo.label;

  const commandResults = useMemo(() => {
    const needle = commandQ.trim().toLowerCase();
    const items = needle
      ? flatNav.filter((i) => i.label.toLowerCase().includes(needle) || i.href.toLowerCase().includes(needle))
      : flatNav;
    return items.slice(0, 12);
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
    function onKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl+K opens the global command menu.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!commandOpen) return;
    setCommandQ("");
    // Defer focus so the dialog content is mounted.
    const t = window.setTimeout(() => commandInputRef.current?.focus(), 0);
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
        setHealthAt(new Date());
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setHealth("offline");
        setHealthDetail(message);
        setHealthAt(new Date());
      }
    }

    check();
    timer = window.setInterval(check, 30000);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

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
      <div className="min-h-screen px-6 py-10">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-slate-700">Checking session...</p>
          <div className="mt-4 h-2 w-56 rounded-full bg-slate-900/10">
            <div className="h-2 w-24 animate-pulse rounded-full bg-slate-900/20" />
          </div>
        </div>
      </div>
    );
  }
  if (!authOk) return null;

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[96rem] gap-5 px-3 py-4 sm:px-5 lg:px-8">
        <aside
          className={cn(
            "sticky top-4 hidden h-[calc(100vh-2rem)] shrink-0 flex-col rounded-3xl border border-[rgb(var(--border)/0.92)] bg-white/55 shadow-[0_1px_0_rgba(15,23,42,0.04),0_18px_70px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:flex",
            collapsed ? "w-20" : "w-72"
          )}
        >
          <div className={cn("flex items-start justify-between gap-3 p-4", collapsed && "justify-center")}>
            <div className={cn("space-y-1", collapsed && "hidden")}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">AH Trading</p>
              <p className="text-lg font-semibold text-slate-950">Admin ERP</p>
              <p className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                <Building2 className="h-4 w-4 text-slate-500" />
                <span className="font-medium">Company</span>
                <code className="rounded-lg border border-[rgb(var(--border)/0.9)] bg-white/60 px-1.5 py-0.5 text-[11px]">
                  {companyId || "unset"}
                </code>
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>

          <nav className={cn("min-h-0 flex-1 overflow-y-auto px-2 pb-2", collapsed && "px-1")}>
            {navSections.map((section) => (
              <div key={section.label} className="mt-2">
                <p
                  className={cn(
                    "px-3 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500",
                    collapsed && "hidden"
                  )}
                >
                  {section.label}
                </p>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = active === item.href;
                    const Icon = iconForHref(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "group flex items-center gap-2 rounded-2xl border border-transparent px-3 py-2 text-sm transition-colors",
                          collapsed && "justify-center px-0",
                          isActive
                            ? "border-teal-500/30 bg-teal-600 text-white shadow-sm"
                            : "text-slate-800 hover:border-[rgb(var(--border)/0.92)] hover:bg-white/60 hover:text-slate-950"
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4",
                            isActive ? "text-white" : "text-slate-500 group-hover:text-slate-700"
                          )}
                        />
                        <span className={cn("truncate", collapsed && "hidden")}>{item.label}</span>
                        <span className={cn("ml-auto h-1.5 w-1.5 rounded-full bg-white/80", !isActive && "hidden", collapsed && "hidden")} />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className={cn("border-t border-[rgb(var(--border)/0.92)] p-3", collapsed && "p-2")}>
            <div className={cn("grid gap-2", collapsed && "justify-items-center")}>
              <Button
                variant="outline"
                className={cn("w-full justify-start", collapsed && "h-10 w-10 justify-center px-0")}
                onClick={() => router.push("/company/select")}
                title={collapsed ? "Change company" : undefined}
              >
                <Building2 className="h-4 w-4" />
                <span className={cn(collapsed && "hidden")}>Change Company</span>
              </Button>
              <Button
                variant="secondary"
                className={cn("w-full justify-start", collapsed && "h-10 w-10 justify-center px-0")}
                onClick={logout}
                title={collapsed ? "Logout" : undefined}
              >
                <LogOut className="h-4 w-4" />
                <span className={cn(collapsed && "hidden")}>Logout</span>
              </Button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 -mx-3 px-3 pb-4 pt-3 sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6">
            <div className="rounded-3xl border border-[rgb(var(--border)/0.92)] bg-white/55 px-4 py-4 shadow-[0_1px_0_rgba(15,23,42,0.03),0_18px_70px_rgba(15,23,42,0.10)] backdrop-blur-[10px]">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">{activeInfo.label}</p>
                  <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setCommandOpen(true)}
                    className="w-full justify-between md:w-[26rem]"
                    aria-label="Open command menu"
                    title="Search pages and actions (Cmd/Ctrl+K)"
                  >
                    <span className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-slate-500" />
                      <span className="text-slate-800">Search pages and actions</span>
                    </span>
                    <span className="hidden items-center gap-1 sm:flex">
                      <span className="ui-kbd">Cmd</span>
                      <span className="ui-kbd">K</span>
                    </span>
                  </Button>

                  <div
                    className={cn(
                      "ui-chip",
                      health === "offline" && "border-rose-200/70 bg-rose-50/70 text-rose-900"
                    )}
                    title={
                      health === "offline"
                        ? `API offline (${healthDetail || "unreachable"})`
                        : healthAt
                          ? `Last checked ${healthAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
                          : "Checking API..."
                    }
                  >
                    {health === "online" ? (
                      <Wifi className="h-4 w-4 text-teal-700" />
                    ) : health === "offline" ? (
                      <WifiOff className="h-4 w-4 text-rose-700" />
                    ) : (
                      <Wifi className="h-4 w-4 animate-pulse text-slate-500" />
                    )}
                    <span className="font-medium">
                      {health === "online" ? "Online" : health === "offline" ? "Offline" : "Checking"}
                    </span>
                  </div>

                  <Button
                    variant="outline"
                    className="hidden md:inline-flex"
                    onClick={() => router.push("/company/select")}
                    title="Change company"
                  >
                    <Building2 className="h-4 w-4 text-slate-600" />
                    <span className="text-slate-800">Company</span>
                    <code className="rounded-lg border border-[rgb(var(--border)/0.9)] bg-white/60 px-1.5 py-0.5 text-[11px]">
                      {companyId || "unset"}
                    </code>
                  </Button>

                  <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="icon" className="md:hidden" aria-label="Open menu">
                        <Menu className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="left-0 top-0 h-[100svh] w-[min(22rem,calc(100vw-1rem))] max-w-none translate-x-0 translate-y-0 rounded-none border-0 border-r border-[rgb(var(--border)/0.92)] bg-white/85 p-4">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <LayoutDashboard className="h-5 w-5 text-slate-700" />
                          Admin ERP
                        </DialogTitle>
                        <DialogDescription>Navigate across modules and run quick actions.</DialogDescription>
                      </DialogHeader>

                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-700">
                        <Building2 className="h-4 w-4 text-slate-500" />
                        <span className="font-medium">Company</span>
                        <code className="rounded-lg border border-[rgb(var(--border)/0.9)] bg-white/60 px-1.5 py-0.5 text-[11px]">
                          {companyId || "unset"}
                        </code>
                      </div>

                      <div className="mt-4 space-y-5 overflow-y-auto pb-6">
                        {navSections.map((section) => (
                          <div key={section.label} className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">{section.label}</p>
                            <div className="grid grid-cols-2 gap-2">
                              {section.items.map((item) => {
                                const isActive = active === item.href;
                                const Icon = iconForHref(item.href);
                                return (
                                  <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                      "flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm shadow-sm",
                                      isActive
                                        ? "border-teal-500/30 bg-teal-600 text-white"
                                        : "border-[rgb(var(--border)/0.92)] bg-white/70 text-slate-900 hover:bg-white"
                                    )}
                                    onClick={() => setMobileOpen(false)}
                                  >
                                    <Icon className={cn("h-4 w-4", isActive ? "text-white" : "text-slate-500")} />
                                    <span className="truncate">{item.label}</span>
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        ))}

                        <div className="grid gap-2">
                          <Button variant="outline" onClick={() => router.push("/company/select")}>
                            <Building2 className="h-4 w-4" />
                            Change Company
                          </Button>
                          <Button variant="secondary" onClick={logout}>
                            <LogOut className="h-4 w-4" />
                            Logout
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Button variant="secondary" className="hidden md:inline-flex" onClick={logout}>
                    <LogOut className="h-4 w-4" />
                    Logout
                  </Button>
                </div>
              </div>
            </div>
          </header>

          <div className="px-0 pb-6 pt-2 sm:pb-10">{props.children}</div>

          <Dialog open={commandOpen} onOpenChange={setCommandOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Command className="h-5 w-5 text-slate-700" />
                  Command Menu
                </DialogTitle>
                <DialogDescription>Jump to a page, or run a quick action.</DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[rgb(var(--border)/0.92)] bg-white/60">
                    <Search className="h-4 w-4 text-slate-600" />
                  </div>
                  <input
                    ref={commandInputRef}
                    value={commandQ}
                    onChange={(e) => setCommandQ(e.target.value)}
                    placeholder="Search: invoices, items, roles, ..."
                    className="ui-control"
                  />
                </div>

                <div className="grid gap-2">
                  {commandResults.length === 0 ? (
                    <div className="rounded-2xl border border-[rgb(var(--border)/0.92)] bg-white/60 p-4 text-sm text-slate-700">
                      No results.
                    </div>
                  ) : (
                    commandResults.map((item) => {
                      const Icon = iconForHref(item.href);
                      return (
                        <button
                          key={item.href}
                          type="button"
                          className="flex w-full items-center gap-3 rounded-2xl border border-[rgb(var(--border)/0.92)] bg-white/60 px-3 py-2 text-left text-sm text-slate-900 shadow-sm transition hover:bg-white"
                          onClick={() => {
                            setCommandOpen(false);
                            router.push(item.href);
                          }}
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900/5">
                            <Icon className="h-4 w-4 text-slate-600" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{item.label}</span>
                            <span className="block truncate text-xs text-slate-600">
                              {item.section} · {item.href}
                            </span>
                          </span>
                          <span className="ui-kbd">Enter</span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCommandOpen(false);
                      router.push("/company/select");
                    }}
                  >
                    <Building2 className="h-4 w-4" />
                    Change Company
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCommandOpen(false);
                      logout();
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </div>
  );
}
