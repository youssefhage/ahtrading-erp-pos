"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsUpDown,
  Building2,
  Warehouse,
  Search,
  Star,
  StarOff,
  ChevronRight,
} from "lucide-react";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import {
  moduleForPath,
  isActivePath,
  NAV_MODULES,
  type NavModule,
  type NavModuleSection,
  type NavModuleItem,
} from "@/lib/nav-modules";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import {
  getFavoritesForCompany,
  toggleFavoriteForCompany,
  isFavorite,
} from "@/lib/nav-memory";
import {
  getCollapsedSections,
  toggleSectionCollapsed,
} from "@/lib/sidebar-prefs";
import {
  getDefaultBranchId,
  getDefaultWarehouseId,
  setDefaultBranchId as persistBranch,
  setDefaultWarehouseId as persistWarehouse,
} from "@/lib/op-context";
import { apiGet, getCompanyId } from "@/lib/api";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* ------------------------------------------------------------------ */
/*  Main sidebar                                                       */
/* ------------------------------------------------------------------ */

export function AppSidebar() {
  const pathname = usePathname() || "/";
  const activeModule = moduleForPath(pathname);
  const mod = activeModule && activeModule.id !== "dashboard" ? activeModule : null;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeaderSection module={mod} />
      <SidebarContent className="px-1.5 py-1">
        {mod ? (
          <ModuleNav module={mod} pathname={pathname} />
        ) : (
          <DashboardNav pathname={pathname} />
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-0 text-xs">
        <ContextSelector />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/* ------------------------------------------------------------------ */
/*  Header — module icon + name                                        */
/* ------------------------------------------------------------------ */

function SidebarHeaderSection({ module }: { module: NavModule | null }) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const Icon = module?.icon;

  return (
    <SidebarHeader className="border-b border-sidebar-border px-2.5 py-2">
      <div className="flex items-center gap-2">
        {Icon && (
          <div
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sidebar-primary/10 text-sidebar-primary",
              isCollapsed && "mx-auto"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
        {!isCollapsed && (
          <span className="text-xs font-semibold tracking-tight text-sidebar-foreground">
            {module?.label || "Dashboard"}
          </span>
        )}
      </div>
    </SidebarHeader>
  );
}

/* ------------------------------------------------------------------ */
/*  Module navigation — favorites + collapsible sections + search      */
/* ------------------------------------------------------------------ */

function ModuleNav({ module, pathname }: { module: NavModule; pathname: string }) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  // Search state
  const [search, setSearch] = useState("");

  // Favorites
  const [favs, setFavs] = useState<Array<{ href: string; label: string }>>([]);
  useEffect(() => {
    setFavs(getFavoritesForCompany().filter((f) => {
      return module.sections.some((s) =>
        s.items.some((item) => f.href === item.href || f.href.startsWith(item.href + "/"))
      );
    }));
  }, [module, pathname]);

  // Collect all items for search
  const allItems = useMemo(() => {
    return module.sections.flatMap((s) =>
      s.items.map((item) => ({ ...item, section: s.label || "" }))
    );
  }, [module]);

  // Filtered items when searching
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    return filterAndRankByFuzzy(
      allItems,
      search,
      (item) => `${item.label} ${item.section}`,
      { limit: 12 }
    );
  }, [search, allItems]);

  // If collapsed, show simple icon-only nav
  if (isCollapsed) {
    return (
      <nav className="flex flex-col items-center gap-1 py-2">
        {allItems.map((item) => (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>
              <Link
                href={item.href}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                  isActivePath(pathname, item.href)
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Inline search */}
      <div className="relative px-0.5 pt-0.5 pb-1">
        <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter..."
          className="h-6 w-full rounded-md bg-sidebar-accent/50 pl-6 pr-2 text-[11px] text-sidebar-foreground placeholder:text-muted-foreground/50 outline-none focus:bg-sidebar-accent focus:ring-1 focus:ring-sidebar-ring transition-colors"
        />
      </div>

      {/* Search results */}
      {searchResults ? (
        <nav className="flex flex-col gap-0.5 px-1">
          {searchResults.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No matches
            </p>
          )}
          {searchResults.map((item) => (
            <NavItem
              key={item.href}
              item={item}
              pathname={pathname}
              onNavigate={() => setSearch("")}
            />
          ))}
        </nav>
      ) : (
        <>
          {/* Favorites */}
          {favs.length > 0 && (
            <FavoritesSection
              items={favs}
              allItems={allItems}
              pathname={pathname}
              onUpdate={() => setFavs(getFavoritesForCompany())}
            />
          )}

          {/* Module sections */}
          {module.sections.map((section, i) => (
            <CollapsibleSection
              key={section.label || `s-${i}`}
              section={section}
              moduleId={module.id}
              pathname={pathname}
            />
          ))}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Favorites section                                                  */
/* ------------------------------------------------------------------ */

function FavoritesSection({
  items,
  allItems,
  pathname,
  onUpdate,
}: {
  items: Array<{ href: string; label: string }>;
  allItems: Array<NavModuleItem & { section: string }>;
  pathname: string;
  onUpdate: () => void;
}) {
  return (
    <div className="px-1">
      <div className="flex h-6 items-center gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
        <Star className="h-2.5 w-2.5" />
        Favorites
      </div>
      <nav className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {items.map((fav) => {
            const navItem = allItems.find((it) => it.href === fav.href);
            if (!navItem) return null;
            return (
              <motion.div
                key={fav.href}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
              >
                <NavItem
                  item={navItem}
                  pathname={pathname}
                  showUnpin
                  onUnpin={() => {
                    toggleFavoriteForCompany({ href: fav.href, label: fav.label });
                    onUpdate();
                  }}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsible section                                                */
/* ------------------------------------------------------------------ */

function CollapsibleSection({
  section,
  moduleId,
  pathname,
}: {
  section: NavModuleSection;
  moduleId: string;
  pathname: string;
}) {
  const label = section.label;
  const [collapsed, setCollapsed] = useState(() => {
    if (!label) return false;
    return getCollapsedSections(moduleId).has(label);
  });

  const toggle = useCallback(() => {
    if (!label) return;
    toggleSectionCollapsed(moduleId, label);
    setCollapsed((p) => !p);
  }, [moduleId, label]);

  return (
    <div className="px-1">
      {/* Section label / toggle */}
      {label && (
        <button
          onClick={toggle}
          className="group flex h-6 w-full items-center gap-1 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 hover:text-sidebar-foreground/60 transition-colors"
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform duration-150",
              !collapsed && "rotate-90"
            )}
          />
          {label}
        </button>
      )}

      {/* Items with animated collapse */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex flex-col gap-0.5 overflow-hidden"
          >
            {section.items.map((item) => (
              <NavItem
                key={item.href}
                item={item}
                pathname={pathname}
                showFavorite
              />
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Nav item                                                           */
/* ------------------------------------------------------------------ */

function NavItem({
  item,
  pathname,
  showFavorite,
  showUnpin,
  onUnpin,
  onNavigate,
}: {
  item: NavModuleItem;
  pathname: string;
  showFavorite?: boolean;
  showUnpin?: boolean;
  onUnpin?: () => void;
  onNavigate?: () => void;
}) {
  const active = isActivePath(pathname, item.href);
  const [isFav, setIsFav] = useState(() => isFavorite(item.href));

  return (
    <div className="group/item relative flex items-center">
      {/* Active indicator — left accent bar */}
      {active && (
        <motion.div
          layoutId="sidebar-active-indicator"
          className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-sidebar-primary"
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      )}

      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex h-7 w-full items-center gap-2 rounded-md px-2 text-[12px] transition-all duration-150",
          active
            ? "bg-sidebar-accent font-medium text-sidebar-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
        )}
      >
        <item.icon
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-colors duration-150",
            active ? "text-sidebar-primary" : "text-sidebar-foreground/40"
          )}
        />
        <span className="truncate">{item.label}</span>
      </Link>

      {/* Favorite toggle (show on hover) */}
      {showFavorite && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFavoriteForCompany({ href: item.href, label: item.label });
            setIsFav(!isFav);
          }}
          className={cn(
            "absolute right-1 flex h-6 w-6 items-center justify-center rounded-md transition-all",
            isFav
              ? "text-amber-500 opacity-100"
              : "text-sidebar-foreground/30 opacity-0 group-hover/item:opacity-100 hover:text-amber-500"
          )}
        >
          <Star className={cn("h-3 w-3", isFav && "fill-current")} />
        </button>
      )}

      {/* Unpin button for favorites section */}
      {showUnpin && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onUnpin?.();
          }}
          className="absolute right-1 flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/30 opacity-0 group-hover/item:opacity-100 hover:text-sidebar-foreground transition-all"
        >
          <StarOff className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard nav (when no module is active)                           */
/* ------------------------------------------------------------------ */

function DashboardNav({ pathname }: { pathname: string }) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  // Use the first item of each module as a quick-access link
  const quickLinks = useMemo(() => {
    return NAV_MODULES.filter((m) => m.id !== "dashboard").map((m) => ({
      label: m.label,
      href: m.sections[0]?.items[0]?.href || "/dashboard",
      icon: m.icon,
    }));
  }, []);

  if (isCollapsed) {
    return (
      <nav className="flex flex-col items-center gap-1 py-2">
        {quickLinks.map((link) => (
          <Tooltip key={link.href}>
            <TooltipTrigger asChild>
              <Link
                href={link.href}
                className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
              >
                <link.icon className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{link.label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-0.5">
      <div className="flex h-6 items-center px-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
        Quick Access
      </div>
      <nav className="flex flex-col gap-0.5">
        {quickLinks.map((link) => {
          const active = pathname.startsWith(link.href.split("/").slice(0, 2).join("/") + "/") || pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex h-7 items-center gap-2 rounded-md px-2 text-[12px] transition-all duration-150",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <link.icon
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  active ? "text-sidebar-primary" : "text-sidebar-foreground/40"
                )}
              />
              <span className="truncate">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Branch / Warehouse context selector                                */
/* ------------------------------------------------------------------ */

function ContextSelector() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: number; name: string }>>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const cid = getCompanyId() || "";
      const [b, w] = await Promise.all([
        apiGet<{ items: Array<{ id: number; name: string }> }>("/branches"),
        apiGet<{ items: Array<{ id: number; name: string }> }>("/warehouses"),
      ]);
      setBranches(b?.items || []);
      setWarehouses(w?.items || []);
      setBranchId(getDefaultBranchId(cid));
      setWarehouseId(getDefaultWarehouseId(cid));
    } catch {
      // Ignore — context selector is non-critical
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const currentBranch = branches.find((b) => String(b.id) === branchId);
  const currentWarehouse = warehouses.find((w) => String(w.id) === warehouseId);

  if (isCollapsed) {
    if (branches.length === 0 && warehouses.length === 0) return null;
    return (
      <div className="flex flex-col items-center gap-1 py-2">
        {branches.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent/50 transition-colors">
                <Building2 className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="w-48">
              <DropdownMenuLabel>Branch</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {branches.map((b) => (
                <DropdownMenuItem
                  key={b.id}
                  className={cn(branchId === String(b.id) && "bg-accent")}
                  onClick={() => {
                    const cid = getCompanyId() || "";
                    setBranchId(String(b.id));
                    persistBranch(cid, String(b.id));
                  }}
                >
                  {b.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {warehouses.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent/50 transition-colors">
                <Warehouse className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="w-48">
              <DropdownMenuLabel>Warehouse</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {warehouses.map((w) => (
                <DropdownMenuItem
                  key={w.id}
                  className={cn(warehouseId === String(w.id) && "bg-accent")}
                  onClick={() => {
                    const cid = getCompanyId() || "";
                    setWarehouseId(String(w.id));
                    persistWarehouse(cid, String(w.id));
                  }}
                >
                  {w.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-0 p-1.5">
      {branches.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="flex-1 truncate text-left">
                {currentBranch?.name || "All Branches"}
              </span>
              <ChevronsUpDown className="h-2.5 w-2.5 shrink-0 opacity-40" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Branch</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {branches.map((b) => (
              <DropdownMenuItem
                key={b.id}
                className={cn(branchId === String(b.id) && "bg-accent")}
                onClick={() => {
                  const cid = getCompanyId() || "";
                  setBranchId(String(b.id));
                  persistBranch(cid, String(b.id));
                }}
              >
                {b.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {warehouses.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors">
              <Warehouse className="h-3 w-3 shrink-0" />
              <span className="flex-1 truncate text-left">
                {currentWarehouse?.name || "All Warehouses"}
              </span>
              <ChevronsUpDown className="h-2.5 w-2.5 shrink-0 opacity-40" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Warehouse</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {warehouses.map((w) => (
              <DropdownMenuItem
                key={w.id}
                className={cn(warehouseId === String(w.id) && "bg-accent")}
                onClick={() => {
                  const cid = getCompanyId() || "";
                  setWarehouseId(String(w.id));
                  persistWarehouse(cid, String(w.id));
                }}
              >
                {w.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
