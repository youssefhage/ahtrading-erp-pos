import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  helperText?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, helperText, ...props }, ref) => {
    const descId = React.useId();
    const textarea = (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border bg-bg-elevated px-3 py-2 text-sm shadow-sm transition-colors",
          "placeholder:text-fg-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-danger focus-visible:ring-danger/40 focus-visible:border-danger/60",
          !error && "border-border",
          className
        )}
        ref={ref}
        aria-invalid={error || undefined}
        aria-describedby={helperText ? descId : undefined}
        {...props}
      />
    );
    if (!helperText) return textarea;
    return (
      <>
        {textarea}
        <p id={descId} className={cn("mt-1 text-xs", error ? "text-danger" : "text-fg-muted")}>
          {helperText}
        </p>
      </>
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
