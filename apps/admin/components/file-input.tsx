"use client";

import * as React from "react";
import { Paperclip, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Props = Omit<React.ComponentPropsWithoutRef<"input">, "type"> & {
  buttonLabel?: string;
  placeholder?: string;
  wrapperClassName?: string;
  /**
   * Changing this value clears the internal label + the underlying <input>.
   * Useful when the parent clears the file after a successful upload.
   */
  resetKey?: string | number;
  /**
   * If true, clears the underlying <input> immediately after selection.
   * Use for flows where the file is uploaded immediately in onChange.
   */
  clearAfterSelect?: boolean;
  showClear?: boolean;
};

function humanBytes(n: number) {
  const v = Math.max(0, Number(n || 0));
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileInput(props: Props) {
  const {
    buttonLabel = "Choose file",
    placeholder = "No file selected",
    wrapperClassName,
    className,
    disabled,
    resetKey,
    clearAfterSelect = false,
    showClear = true,
    multiple,
    onChange,
    ...rest
  } = props;

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [label, setLabel] = React.useState<string>("");
  const [meta, setMeta] = React.useState<string>("");
  const prevReset = React.useRef<string | number | undefined>(resetKey);

  React.useEffect(() => {
    if (prevReset.current === resetKey) return;
    prevReset.current = resetKey;
    if (inputRef.current) inputRef.current.value = "";
    setLabel("");
    setMeta("");
  }, [resetKey]);

  function pick() {
    if (disabled) return;
    inputRef.current?.click();
  }

  function clear() {
    if (disabled) return;
    if (inputRef.current) inputRef.current.value = "";
    setLabel("");
    setMeta("");
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", wrapperClassName)}>
      <input
        ref={inputRef}
        type="file"
        disabled={disabled}
        multiple={multiple}
        className={cn("sr-only", className)}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files || []);
          if (!files.length) {
            setLabel("");
            setMeta("");
          } else if (multiple) {
            setLabel(`${files.length} file${files.length === 1 ? "" : "s"} selected`);
            const total = files.reduce((acc, f) => acc + (f.size || 0), 0);
            setMeta(humanBytes(total));
          } else {
            const f = files[0];
            setLabel(f.name || "");
            setMeta(f.size ? humanBytes(f.size) : "");
          }

          onChange?.(e);

          if (clearAfterSelect) {
            // Keep the UI responsive for immediate-upload flows, but avoid blocking same-file reselect later.
            e.currentTarget.value = "";
            setTimeout(() => {
              setLabel("");
              setMeta("");
            }, 0);
          }
        }}
        {...rest}
      />

      <Button type="button" variant="outline" size="sm" onClick={pick} disabled={disabled}>
        <Paperclip className="h-3.5 w-3.5" />
        {buttonLabel}
      </Button>

      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm", label ? "text-foreground" : "text-fg-muted")}>{label || placeholder}</div>
        {meta ? <div className="truncate text-sm text-fg-subtle">{meta}</div> : null}
      </div>

      {showClear && !!label ? (
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-elevated text-fg-muted transition-colors",
            "hover:border-border-strong hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          )}
          aria-label="Clear selected file"
          title="Clear"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
