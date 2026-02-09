"use client";

import * as React from "react";
import { Calendar } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type Props = Omit<React.ComponentProps<typeof Input>, "type"> & {
  wrapperClassName?: string;
};

export function DateInput(props: Props) {
  const { className, wrapperClassName, disabled, ...rest } = props;
  const ref = React.useRef<HTMLInputElement>(null);

  function openPicker() {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    // Prefer native calendar UI when available (Chrome/Safari).
    try {
      el.focus();
      (el as any).showPicker?.();
    } catch {
      // ignore
    }
  }

  return (
    <div className={cn("relative", wrapperClassName)}>
      <Input
        ref={ref}
        type="date"
        disabled={disabled}
        className={cn("ui-date pr-10", className)}
        {...rest}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        className={cn(
          "absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 transition-colors",
          "text-fg-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30",
          disabled ? "opacity-50" : "opacity-80"
        )}
        aria-label="Open calendar"
      >
        <Calendar className="h-4 w-4" />
      </button>
    </div>
  );
}

