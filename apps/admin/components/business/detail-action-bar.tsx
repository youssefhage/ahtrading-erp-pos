"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface ActionItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
  tooltip?: string;
  /** Only shown when condition is true (default true) */
  visible?: boolean;
}

export interface DetailActionBarProps {
  /** Single primary CTA — filled button */
  primary?: ActionItem;
  /** Secondary actions — visible as outline buttons on >=md, collapse to dropdown on mobile */
  secondary?: ActionItem[];
  /** Destructive action — always visible, red variant */
  destructive?: ActionItem;
  /** Utilities slot — for DocumentUtilitiesDrawer, ViewRaw, etc. */
  utilities?: React.ReactNode;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function ActionButton({
  item,
  variant = "outline",
  size = "sm",
}: {
  item: ActionItem;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const btn = (
    <Button
      variant={variant}
      size={size}
      disabled={item.disabled || item.loading}
      onClick={item.onClick}
      className="gap-2"
    >
      {item.icon}
      <span>{item.label}</span>
    </Button>
  );

  if (item.tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent>{item.tooltip}</TooltipContent>
      </Tooltip>
    );
  }
  return btn;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function DetailActionBar({
  primary,
  secondary = [],
  destructive,
  utilities,
  className,
}: DetailActionBarProps) {
  const visibleSecondary = secondary.filter((a) => a.visible !== false);

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("flex items-center gap-2", className)}>
        {/* Primary CTA */}
        {primary && primary.visible !== false && (
          <ActionButton item={primary} variant="default" size="sm" />
        )}

        {/* Secondary — expanded on md+ */}
        {visibleSecondary.length > 0 && (
          <>
            {/* Desktop: show all outline buttons */}
            <div className="hidden items-center gap-2 md:flex">
              {visibleSecondary.map((a) => (
                <ActionButton key={a.label} item={a} variant="outline" size="sm" />
              ))}
            </div>

            {/* Mobile: collapse into dropdown */}
            <div className="md:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1">
                    Actions <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {visibleSecondary.map((a) => (
                    <DropdownMenuItem
                      key={a.label}
                      onClick={a.onClick}
                      disabled={a.disabled}
                      className="gap-2"
                    >
                      {a.icon}
                      {a.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}

        {/* Destructive — always visible */}
        {destructive && destructive.visible !== false && (
          <ActionButton item={destructive} variant="destructive" size="sm" />
        )}

        {/* Utilities slot */}
        {utilities}
      </div>
    </TooltipProvider>
  );
}
