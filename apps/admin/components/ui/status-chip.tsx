"use client";

import * as React from "react";
import { Chip, type ChipVariant } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

function normalize(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function titleize(s: string): string {
  if (!s) return "-";
  return s
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function StatusChip(props: { value?: string | null; className?: string }) {
  const raw = normalize(props.value);
  const semanticToneClass =
    raw === "draft"
      ? "ui-chip-status-draft"
      : raw === "posted"
        ? "ui-chip-status-posted"
        : "";

  let variant: ChipVariant = "default";
  if (["posted", "paid", "active", "completed", "success", "executed", "approved", "reconciled", "done"].includes(raw)) variant = "success";
  else if (["on_hold", "on-hold", "blocked", "overdue", "expired", "partial", "partially_paid", "partially-paid"].includes(raw)) variant = "warning";
  else if (["unpaid", "not_paid", "not-paid", "not_posted"].includes(raw)) variant = "primary";
  else if (["canceled", "cancelled", "void", "voided", "inactive", "failed", "error", "rejected"].includes(raw)) variant = "danger";
  else if (["open", "new", "sent"].includes(raw)) variant = "primary";

  return (
    <Chip variant={variant} className={cn(semanticToneClass, props.className)}>
      {titleize(raw)}
    </Chip>
  );
}
