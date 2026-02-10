import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * If true, selects the entire input value on focus/click (so typing replaces the current number).
   * Defaults to true for numeric-like inputs (type="number" or inputMode="numeric|decimal").
   */
  autoSelectOnFocus?: boolean;
}

function isNumericLikeInput(type: string | undefined, inputMode: string | undefined) {
  const t = (type || "").toLowerCase();
  const m = (inputMode || "").toLowerCase();
  return t === "number" || m === "numeric" || m === "decimal";
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, autoSelectOnFocus, onFocus, onPointerDown, inputMode, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const autoSelect = autoSelectOnFocus ?? isNumericLikeInput(type, inputMode);

    function setRef(node: HTMLInputElement | null) {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-foreground",
          "placeholder:text-fg-subtle",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:border-primary/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className
        )}
        inputMode={inputMode}
        onPointerDown={(e) => {
          onPointerDown?.(e);
          if (!autoSelect || e.defaultPrevented) return;
          const el = e.currentTarget;
          // First click should behave like "reset": focus + select all so typing replaces the value.
          if (document.activeElement !== el) {
            e.preventDefault();
            el.focus();
          }
        }}
        onFocus={(e) => {
          onFocus?.(e);
          if (!autoSelect || e.defaultPrevented) return;
          try {
            // Defer to next tick so focus is fully applied.
            queueMicrotask(() => e.currentTarget.select());
          } catch {
            // ignore
          }
        }}
        ref={setRef}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
