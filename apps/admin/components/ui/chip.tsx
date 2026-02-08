"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ChipVariant = "default" | "primary" | "success" | "warning" | "danger";

export function Chip({
  variant = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: ChipVariant }) {
  return (
    <span
      className={cn("ui-chip", `ui-chip-${variant}`, className)}
      {...props}
    />
  );
}

