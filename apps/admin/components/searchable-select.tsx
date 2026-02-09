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
    return out;
  }, [options, q, maxOptions]);

  useEffect(() => setActive(0), [q, open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const el = wrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    }
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
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
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-md border border-border bg-bg-elevated shadow-lg">
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
                      "w-full px-3 py-2 text-left text-sm transition-colors",
                      "border-b border-border-subtle last:border-b-0",
                      isActive ? "bg-bg-sunken/70" : "hover:bg-bg-sunken/50"
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => commit(opt)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{opt.label}</span>
                      {isSelected ? <span className="shrink-0 font-mono text-[10px] text-fg-subtle">selected</span> : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-3 text-sm text-fg-subtle">No matches.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

