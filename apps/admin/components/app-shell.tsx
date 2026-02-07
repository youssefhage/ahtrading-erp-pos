"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost, clearSession, getCompanyId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type NavItem = {
  label: string;
  href: string;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "POS Devices", href: "/system/pos-devices" },
  { label: "POS Shifts", href: "/system/pos-shifts" },
  { label: "Outbox", href: "/system/outbox" },
  { label: "Sales Invoices", href: "/sales/invoices" },
  { label: "Sales Returns", href: "/sales/returns" },
  { label: "Suppliers", href: "/partners/suppliers" },
  { label: "Customers", href: "/partners/customers" },
  { label: "Items", href: "/catalog/items" },
  { label: "Stock", href: "/inventory/stock" },
  { label: "Movements", href: "/inventory/movements" },
  { label: "Inventory Ops", href: "/inventory/ops" },
  { label: "Purchase Orders", href: "/purchasing/purchase-orders" },
  { label: "Goods Receipts", href: "/purchasing/goods-receipts" },
  { label: "Supplier Invoices", href: "/purchasing/supplier-invoices" },
  { label: "VAT Report", href: "/accounting/reports/vat" },
  { label: "Trial Balance", href: "/accounting/reports/trial-balance" },
  { label: "General Ledger", href: "/accounting/reports/general-ledger" },
  { label: "Config", href: "/system/config" },
  { label: "Branches", href: "/system/branches" },
  { label: "Warehouses", href: "/system/warehouses" },
  { label: "Users", href: "/system/users" },
  { label: "Roles & Perms", href: "/system/roles-permissions" },
  { label: "AI Hub", href: "/automation/ai-hub" }
];

export function AppShell(props: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const companyId = getCompanyId();
  const [authChecked, setAuthChecked] = useState(false);
  const [authOk, setAuthOk] = useState(false);

  const active = useMemo(() => {
    const item = navItems.find((i) => pathname === i.href);
    return item?.href || "/dashboard";
  }, [pathname]);

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
      <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,#dbeafe,transparent_50%),radial-gradient(1200px_circle_at_90%_10%,#fff7ed,transparent_45%),linear-gradient(to_bottom,#f8fafc,#ffffff)] px-6 py-10">
        <p className="text-sm text-slate-700">Checking session...</p>
      </div>
    );
  }
  if (!authOk) return null;

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,#dbeafe,transparent_50%),radial-gradient(1200px_circle_at_90%_10%,#fff7ed,transparent_45%),linear-gradient(to_bottom,#f8fafc,#ffffff)]">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200/60 bg-white/60 p-4 backdrop-blur md:block">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              AH Trading
            </p>
            <p className="text-lg font-semibold text-slate-900">Admin ERP</p>
            <p className="text-xs text-slate-600">
              Company:{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">
                {companyId || "unset"}
              </code>
            </p>
          </div>

          <nav className="mt-6 space-y-1">
            {navItems.map((item) => {
              const isActive = active === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "block rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-6 space-y-2">
            <Button variant="outline" className="w-full" onClick={() => router.push("/company/select")}>
              Change Company
            </Button>
            <Button variant="secondary" className="w-full" onClick={logout}>
              Logout
            </Button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8">
          <header className="mb-5 flex items-start justify-between gap-3 md:mb-7">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-slate-900">{props.title}</h1>
              <p className="text-sm text-slate-600 md:hidden">
                <span className="font-medium">Company</span>:{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">
                  {companyId || "unset"}
                </code>
              </p>
            </div>
            <div className="flex items-center gap-2 md:hidden">
              <Button
                variant="outline"
                onClick={() => setMobileOpen((v) => !v)}
                aria-expanded={mobileOpen}
              >
                Menu
              </Button>
              <Button variant="secondary" onClick={logout}>
                Logout
              </Button>
            </div>
          </header>

          {mobileOpen ? (
            <div className="mb-6 rounded-lg border border-slate-200/70 bg-white/70 p-3 backdrop-blur md:hidden">
              <div className="grid grid-cols-2 gap-2">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm",
                      active === item.href
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-800"
                    )}
                    onClick={() => setMobileOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
                <Button variant="outline" onClick={() => router.push("/company/select")}>
                  Change Company
                </Button>
              </div>
            </div>
          ) : null}

          {props.children}
        </main>
      </div>
    </div>
  );
}
