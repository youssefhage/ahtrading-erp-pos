"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Building2,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Cpu,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShoppingCart,
  Sparkles,
  Tag,
  Truck,
  Users
} from "lucide-react";

import { apiGet, apiPost, clearSession, getCompanyId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type NavItem = {
  label: string;
  href: string;
};

type NavSection = { label: string; items: NavItem[] };

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

  const companyId = getCompanyId();
  const [authChecked, setAuthChecked] = useState(false);
  const [authOk, setAuthOk] = useState(false);

  const flatNav = useMemo(() => navSections.flatMap((s) => s.items), []);
  const activeInfo = useMemo(() => {
    const item = flatNav.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
    return { href: item?.href || "/dashboard", label: item?.label || "Dashboard" };
  }, [pathname, flatNav]);
  const active = activeInfo.href;
  const title = props.title ?? activeInfo.label;

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
      <div className="mx-auto flex min-h-screen max-w-[88rem] gap-4 px-3 py-4 sm:px-4 lg:px-6">
        <aside
          className={cn(
            "sticky top-4 hidden h-[calc(100vh-2rem)] shrink-0 flex-col rounded-2xl border border-slate-200/70 bg-white/55 shadow-sm backdrop-blur-[6px] md:flex",
            collapsed ? "w-20" : "w-72"
          )}
        >
          <div className={cn("flex items-start justify-between gap-3 p-4", collapsed && "justify-center")}>
            <div className={cn("space-y-1", collapsed && "hidden")}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">AH Trading</p>
              <p className="text-lg font-semibold text-slate-900">Admin ERP</p>
              <p className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <Building2 className="h-4 w-4 text-slate-500" />
                <span className="font-medium">Company</span>
                <code className="rounded bg-slate-900/5 px-1.5 py-0.5 text-[11px]">{companyId || "unset"}</code>
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
                    "px-3 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400",
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
                          "group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
                          collapsed && "justify-center px-0",
                          isActive
                            ? "bg-slate-900 text-white shadow-sm"
                            : "text-slate-700 hover:bg-slate-900/5 hover:text-slate-900"
                        )}
                      >
                        <Icon className={cn("h-4 w-4", isActive ? "text-white" : "text-slate-500 group-hover:text-slate-700")} />
                        <span className={cn("truncate", collapsed && "hidden")}>{item.label}</span>
                        <span className={cn("ml-auto h-1.5 w-1.5 rounded-full bg-white/80", !isActive && "hidden", collapsed && "hidden")} />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className={cn("border-t border-slate-200/70 p-3", collapsed && "p-2")}>
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
            <div className="rounded-2xl border border-slate-200/70 bg-white/55 px-4 py-4 shadow-sm backdrop-blur-[6px]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    {activeInfo.label}
                  </p>
                  <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
                </div>

                <div className="flex items-center gap-2">
                  <div className="hidden items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-xs text-slate-700 shadow-sm backdrop-blur-[2px] md:flex">
                    <Building2 className="h-4 w-4 text-slate-500" />
                    <span className="font-medium">Company</span>
                    <code className="rounded bg-slate-900/5 px-1.5 py-0.5 text-[11px]">{companyId || "unset"}</code>
                  </div>

                  <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="icon" className="md:hidden" aria-label="Open menu">
                        <Menu className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent
                      className="left-0 top-0 h-[100svh] w-[min(22rem,calc(100vw-1rem))] max-w-none translate-x-0 translate-y-0 rounded-none border-0 border-r border-slate-200/70 bg-white/85 p-4"
                    >
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <LayoutDashboard className="h-5 w-5 text-slate-700" />
                          Admin ERP
                        </DialogTitle>
                      </DialogHeader>

                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-700">
                        <Building2 className="h-4 w-4 text-slate-500" />
                        <span className="font-medium">Company</span>
                        <code className="rounded bg-slate-900/5 px-1.5 py-0.5 text-[11px]">{companyId || "unset"}</code>
                      </div>

                      <div className="mt-4 space-y-5 overflow-y-auto pb-6">
                        {navSections.map((section) => (
                          <div key={section.label} className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{section.label}</p>
                            <div className="grid grid-cols-2 gap-2">
                              {section.items.map((item) => {
                                const isActive = active === item.href;
                                const Icon = iconForHref(item.href);
                                return (
                                  <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                      "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm",
                                      isActive
                                        ? "border-slate-900 bg-slate-900 text-white"
                                        : "border-slate-200/70 bg-white/70 text-slate-800 hover:bg-white"
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
        </main>
      </div>
    </div>
  );
}
