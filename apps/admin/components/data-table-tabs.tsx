"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type DataTableTab = {
  value: string;
  label: string;
  count?: number | null;
  icon?: ReactNode;
};

export function DataTableTabs(props: {
  value: string;
  tabs: DataTableTab[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const { value, tabs, onChange, className } = props;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
              active
                ? "border-border bg-foreground text-background"
                : "border-border-subtle bg-bg-muted/30 text-fg-muted hover:border-border hover:text-foreground"
            )}
          >
            {t.icon}
            <span>{t.label}</span>
            {typeof t.count === "number" ? (
              <span
                className={cn(
                  "data-mono rounded-full px-2 py-0.5 text-sm",
                  active ? "bg-background/20 text-background" : "bg-bg-sunken/60 text-fg-muted"
                )}
              >
                {t.count.toLocaleString("en-US")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
