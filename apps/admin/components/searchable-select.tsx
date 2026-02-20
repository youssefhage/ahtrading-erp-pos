"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type SearchableSelectOption = {
  value: string;
  label: string;
  keywords?: string; // extra text to help matching (not shown)
};

export function SearchableSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  disabled?: boolean;
  placeholder?: string; // shown when value not found and empty
  searchPlaceholder?: string;
  className?: string;
  controlClassName?: string; // applied to the trigger (defaults to ui-select)
  maxOptions?: number;
  loading?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSearchQueryChange?: (query: string) => void;
}) {
  const {
    value,
    onChange,
    options,
    disabled,
    placeholder = "Select...",
    searchPlaceholder = "Search...",
    className,
    controlClassName,
    maxOptions = 80,
    loading = false,
    onOpenChange,
    onSearchQueryChange,
  } = props;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const triggerLabel = selected ? selected.label : (value ? String(value) : placeholder);

  const filtered = useMemo(() => {
    const out = filterAndRankByFuzzy(
      options || [],
      q,
      (o) => `${o.label} ${o.keywords || ""} ${o.value}`.trim(),
      { limit: maxOptions }
    );
    // `filterAndRankByFuzzy()` returns the input unchanged when query is empty,
    // so we still enforce a hard cap here to avoid rendering huge menus.
    return (out || []).slice(0, Math.max(0, maxOptions));
  }, [options, q, maxOptions]);

  useEffect(() => setActive(0), [q, open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || !onSearchQueryChange) return;
    const t = window.setTimeout(() => onSearchQueryChange(q), 180);
    return () => window.clearTimeout(t);
  }, [q, open, onSearchQueryChange]);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      const el = wrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      if (path.includes(el)) return;
      setOpen(false);
    }
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [open]);

  function commit(opt: SearchableSelectOption) {
    onChange(opt.value);
    setOpen(false);
    setQ("");
    setActive(0);
  }

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((v) => !v);
      return;
    }
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((n) => Math.min(Math.max(0, filtered.length - 1), n + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((n) => Math.max(0, n - 1));
      return;
    }
    if (e.key === "Enter") {
      const row = filtered[active];
      if (row) {
        e.preventDefault();
        commit(row);
      }
    }
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        className={cn(controlClassName || "ui-select", "text-left", value ? "text-foreground" : "text-fg-subtle")}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        {triggerLabel}
      </button>

      {open ? (
            <div
              data-dialog-keepopen="true"
              data-searchable-select-menu="true"
              className="absolute left-0 right-0 z-[80] mt-1 overflow-hidden rounded-md border border-border bg-bg-elevated shadow-lg"
            >
              <div className="border-b border-border-subtle p-2">
                <Input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder={searchPlaceholder}
                />
              </div>
              <div className="max-h-72 overflow-auto py-1" role="listbox">
                {filtered.length ? (
                  filtered.map((opt, idx) => {
                    const isActive = idx === active;
                    const isSelected = opt.value === value;
                    return (
                      <button
                        key={`${opt.value}-${idx}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={cn(
                          "w-full px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
                          "border-b border-border-subtle last:border-b-0",
                          isActive ? "bg-primary/15 ring-1 ring-primary/25" : "hover:bg-bg-sunken/50"
                        )}
                        onPointerDown={(e) => {
                          // Commit on pointerdown so selection applies before any
                          // outside-close handlers that listen on pointerdown.
                          e.preventDefault();
                          e.stopPropagation();
                          commit(opt);
                        }}
                        onMouseEnter={() => setActive(idx)}
                        onClick={(e) => e.preventDefault()}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">{opt.label}</span>
                          {isSelected ? <span className="shrink-0 font-mono text-xs text-fg-subtle">selected</span> : null}
                        </div>
                      </button>
                    );
                  })
                ) : loading ? (
                  <div className="px-3 py-3 text-sm text-fg-subtle">Loading...</div>
                ) : (
                  <div className="px-3 py-3 text-sm text-fg-subtle">No matches.</div>
                )}
              </div>
            </div>
        ) : null}
    </div>
  );
}
