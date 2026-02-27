"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ChipVariant = "default" | "primary" | "success" | "warning" | "danger";

const variantStyles: Record<ChipVariant, string> = {
  default: "border-border bg-muted/50 text-foreground",
  primary: "border-info/30 bg-info/10 text-info",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function Chip({
  variant = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: ChipVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}

