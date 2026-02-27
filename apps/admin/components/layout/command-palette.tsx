"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useMemo } from "react";
import { Clock, Star, Zap, Moon, Sun, PanelLeft } from "lucide-react";
import { useTheme } from "next-themes";

import { NAV_MODULES, type NavModuleItem } from "@/lib/nav-modules";
import { getRecentsForCompany, getFavoritesForCompany } from "@/lib/nav-memory";
import { scoreFuzzyQuery, normalizeSearchText } from "@/lib/fuzzy";
import { useSidebar } from "@/components/ui/sidebar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FlatItem = {
  label: string;
  href: string;
  icon: NavModuleItem["icon"];
  module: string;
  section: string;
  value: string;
};

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { toggleSidebar } = useSidebar();
  const [search, setSearch] = useState("");

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const navigate = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [router, onOpenChange]
  );

  // Flatten all nav items
  const allItems = useMemo<FlatItem[]>(() => {
    return NAV_MODULES.flatMap((mod) =>
      mod.sections.flatMap((section) =>
        section.items.map((item) => ({
          label: item.label,
          href: item.href,
          icon: item.icon,
          module: mod.label,
          section: section.label || "",
          value: `${mod.label} ${section.label || ""} ${item.label}`,
        }))
      )
    );
  }, []);

  // Custom fuzzy filter + ranked results
  const filteredItems = useMemo(() => {
    if (!search.trim()) return null;
    const q = normalizeSearchText(search);
    const scored = allItems
      .map((item) => {
        const score = scoreFuzzyQuery(q, `${item.label} ${item.section} ${item.module}`);
        return { item, score: score ?? 0 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
    return scored.map((x) => x.item);
  }, [search, allItems]);

  // Get recents and favorites
  const recents = useMemo(() => {
    if (!open) return [];
    return getRecentsForCompany().slice(0, 5);
  }, [open]);

  const favorites = useMemo(() => {
    if (!open) return [];
    return getFavoritesForCompany().slice(0, 5);
  }, [open]);

  // Relative time helper
  const relativeTime = (iso: string): string => {
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ago`;
    } catch {
      return "";
    }
  };

  const isSearching = search.trim().length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search pages, actions..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {isSearching ? (
          /* ---- Filtered search results ---- */
          filteredItems && filteredItems.length > 0 && (
            <CommandGroup heading="Results">
              {filteredItems.map((item) => (
                <CommandItem
                  key={`search-${item.href}`}
                  value={item.value}
                  onSelect={() => navigate(item.href)}
                  className="flex items-center gap-2"
                >
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{item.label}</span>
                  <span className="text-[11px] text-muted-foreground/60">
                    {item.module}
                    {item.section ? ` / ${item.section}` : ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )
        ) : (
          <>
            {/* ---- Recents ---- */}
            {recents.length > 0 && (
              <CommandGroup heading="Recent">
                {recents.map((r) => {
                  const navItem = allItems.find((it) => it.href === r.href);
                  const Icon = navItem?.icon || Clock;
                  return (
                    <CommandItem
                      key={`recent-${r.href}`}
                      value={`recent ${r.label} ${r.href}`}
                      onSelect={() => navigate(r.href)}
                      className="flex items-center gap-2"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{r.label}</span>
                      <span className="text-[11px] text-muted-foreground/50">
                        {relativeTime(r.at)}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {/* ---- Favorites ---- */}
            {favorites.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Favorites">
                  {favorites.map((f) => {
                    const navItem = allItems.find((it) => it.href === f.href);
                    const Icon = navItem?.icon || Star;
                    return (
                      <CommandItem
                        key={`fav-${f.href}`}
                        value={`favorite ${f.label} ${f.href}`}
                        onSelect={() => navigate(f.href)}
                        className="flex items-center gap-2"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{f.label}</span>
                        <Star className="h-3 w-3 shrink-0 text-amber-500 fill-amber-500" />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}

            {/* ---- Quick Actions ---- */}
            <CommandSeparator />
            <CommandGroup heading="Quick Actions">
              <CommandItem
                value="toggle theme dark light"
                onSelect={() => {
                  setTheme(theme === "dark" ? "light" : "dark");
                  onOpenChange(false);
                }}
                className="flex items-center gap-2"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Moon className="h-4 w-4 text-muted-foreground" />
                )}
                <span>Toggle Theme</span>
              </CommandItem>
              <CommandItem
                value="toggle sidebar collapse expand"
                onSelect={() => {
                  toggleSidebar();
                  onOpenChange(false);
                }}
                className="flex items-center gap-2"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
                <span>Toggle Sidebar</span>
              </CommandItem>
            </CommandGroup>

            {/* ---- All pages (collapsed) ---- */}
            <CommandSeparator />
            {NAV_MODULES.map((mod) => (
              <CommandGroup key={mod.id} heading={mod.label}>
                {mod.sections.flatMap((section) =>
                  section.items.map((item) => (
                    <CommandItem
                      key={`${mod.id}-${item.href}`}
                      value={`${mod.label} ${section.label || ""} ${item.label}`}
                      onSelect={() => navigate(item.href)}
                      className="flex items-center gap-2"
                    >
                      <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {section.label && (
                        <span className="text-[11px] text-muted-foreground/50">
                          {section.label}
                        </span>
                      )}
                    </CommandItem>
                  ))
                )}
              </CommandGroup>
            ))}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

/** Hook to manage command palette open state with Cmd+K shortcut. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return { open, setOpen };
}
