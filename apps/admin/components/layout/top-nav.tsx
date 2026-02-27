"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { NAV_MODULES, moduleForPath } from "@/lib/nav-modules";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserMenu } from "./user-menu";

interface TopNavProps {
  onCommandOpen: () => void;
}

export function TopNav({ onCommandOpen }: TopNavProps) {
  const pathname = usePathname() || "/";
  const activeModule = moduleForPath(pathname);
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-50 flex h-12 items-center border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
      {/* Logo */}
      <div className="flex h-full w-[13rem] shrink-0 items-center border-r px-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">
            C
          </div>
          <span className="text-sm">Codex</span>
        </Link>
      </div>

      {/* Module tabs */}
      <nav className="flex h-full flex-1 items-center gap-0.5 overflow-x-auto px-2">
        {NAV_MODULES.map((mod) => {
          const Icon = mod.icon;
          const isActive = activeModule?.id === mod.id;
          return (
            <Link
              key={mod.id}
              href={mod.sections[0]?.items[0]?.href || "/dashboard"}
              className={cn(
                "relative flex h-full items-center gap-1.5 px-2.5 text-[13px] font-medium transition-colors whitespace-nowrap",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{mod.label}</span>
              {/* Active bottom indicator — animated between tabs */}
              {isActive && (
                <motion.div
                  layoutId="topnav-active-tab"
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-primary"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Right actions */}
      <div className="flex h-full items-center gap-1 border-l px-3">
        {/* Search */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onCommandOpen}
            >
              <Search className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>Search</span>
            <kbd className="ml-2 inline-flex h-5 items-center rounded border bg-muted px-1.5 text-[10px] font-medium">
              ⌘K
            </kbd>
          </TooltipContent>
        </Tooltip>

        {/* Theme toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle theme</TooltipContent>
        </Tooltip>

        {/* User menu */}
        <UserMenu />
      </div>
    </header>
  );
}
