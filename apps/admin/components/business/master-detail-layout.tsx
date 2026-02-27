"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from "@/components/ui/sheet";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface MasterDetailLayoutProps {
  /** Whether the detail panel is open */
  open: boolean;
  /** Callback when the panel should close */
  onOpenChange: (open: boolean) => void;
  /** Detail panel title */
  title?: string;
  /** Detail panel subtitle / description */
  description?: string;
  /** Sheet side (default: right) */
  side?: "left" | "right" | "top" | "bottom";
  /** Width class for the Sheet (default: sm:max-w-2xl) */
  sheetClassName?: string;
  /** The detail panel content */
  detail: React.ReactNode;
  /** The master table / list content */
  children: React.ReactNode;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function MasterDetailLayout({
  open,
  onOpenChange,
  title,
  description,
  side = "right",
  sheetClassName = "sm:max-w-2xl",
  detail,
  children,
  className,
}: MasterDetailLayoutProps) {
  return (
    <div className={cn(className)}>
      {/* Master content (table, list, etc.) */}
      {children}

      {/* Detail panel — slides in as a Sheet */}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side={side} className={cn(sheetClassName)}>
          {(title || description) && (
            <SheetHeader>
              {title && <SheetTitle>{title}</SheetTitle>}
              {description && <SheetDescription>{description}</SheetDescription>}
            </SheetHeader>
          )}
          <SheetBody>{detail}</SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
