import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, options, placeholder, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          "flex h-9 w-full rounded-md border bg-bg-elevated px-3 py-1 text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-danger focus-visible:ring-danger/40 focus-visible:border-danger/60",
          !error && "border-border",
          className
        )}
        ref={ref}
        aria-invalid={error || undefined}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
    );
  }
);
Select.displayName = "Select";

export { Select };
