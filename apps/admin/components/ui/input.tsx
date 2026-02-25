import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * If true, selects the entire input value on focus/click (so typing replaces the current number).
   * Defaults to true for numeric-like inputs (type="number" or inputMode="numeric|decimal").
   */
  autoSelectOnFocus?: boolean;
  /** When true, renders the input with danger-colored border and sets aria-invalid. */
  error?: boolean;
  /** Optional helper or error text rendered below the input. */
  helperText?: string;
}

function isNumericLikeInput(type: string | undefined, inputMode: string | undefined) {
  const t = (type || "").toLowerCase();
  const m = (inputMode || "").toLowerCase();
  return t === "number" || m === "numeric" || m === "decimal";
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, autoSelectOnFocus, onFocus, onPointerDown, inputMode, error, helperText, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const autoSelect = autoSelectOnFocus ?? isNumericLikeInput(type, inputMode);
    const descId = React.useId();

    function setRef(node: HTMLInputElement | null) {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    }

    const inputEl = (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-foreground",
          "placeholder:text-fg-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          error && "border-danger focus-visible:ring-danger/40 focus-visible:border-danger/60",
          className
        )}
        inputMode={inputMode}
        aria-invalid={error || undefined}
        aria-describedby={helperText ? descId : undefined}
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

    if (helperText) {
      return (
        <>
          {inputEl}
          <p id={descId} className={cn("mt-1 text-xs text-fg-muted", error && "text-danger")}>
            {helperText}
          </p>
        </>
      );
    }

    return inputEl;
  }
);
Input.displayName = "Input";

export { Input };
