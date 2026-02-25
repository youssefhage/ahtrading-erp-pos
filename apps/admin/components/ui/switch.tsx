"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  id?: string;
}

export function Switch({ checked, onCheckedChange, disabled, label, className, id }: SwitchProps) {
  const autoId = React.useId();
  const switchId = id || autoId;

  return (
    <label htmlFor={switchId} className={cn("inline-flex items-center gap-2 cursor-pointer", disabled && "opacity-50 cursor-not-allowed", className)}>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          checked ? "bg-primary" : "bg-border-strong"
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-bg-elevated shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
      {label && <span className="text-sm text-fg">{label}</span>}
    </label>
  );
}
