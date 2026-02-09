"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { apiGet } from "@/lib/api";
import { filterAndRankByFuzzy } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export function ComboboxInput(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;

  // Optional remote suggestions: GET `${endpoint}?q=...&limit=...` -> JSON with `responseKey` array of strings.
  endpoint?: string;
  responseKey?: string;
  limit?: number;
  debounceMs?: number;
  fallbackSuggestions?: string[];
}) {
  const {
    value,
    onChange,
    disabled,
    placeholder,
    className,
    endpoint,
    responseKey = "values",
    limit = 24,
    debounceMs = 160,
    fallbackSuggestions = [],
  } = props;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [remote, setRemote] = useState<string[]>([]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load remote suggestions (debounced) when open.
  useEffect(() => {
    if (!open) return;
    if (!endpoint) return;
    const q = String(value || "").trim();
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(limit));
        params.set("q", q);
        const res = await apiGet<Record<string, unknown>>(`${endpoint}?${params.toString()}`);
        if (cancelled) return;
        const raw = (res as any)?.[responseKey];
        const arr = Array.isArray(raw) ? raw.map((x) => String(x || "").trim()).filter(Boolean) : [];
        setRemote(arr);
      } catch {
        if (cancelled) return;
        setRemote([]);
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, endpoint, responseKey, value, limit, debounceMs]);

  const suggestions = useMemo(() => {
    const base = remote.length ? remote : fallbackSuggestions;
    // While searching, rank suggestions by closeness.
    const ranked = filterAndRankByFuzzy(base, value, (s) => s, { limit: 20 });
    // When input is empty, just show the first few (already frequency-sorted from server).
    if (!String(value || "").trim()) return (base || []).slice(0, 20);
    return ranked;
  }, [remote, fallbackSuggestions, value]);

  useEffect(() => setActive(0), [open, value]);

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

  function select(s: string) {
    onChange(s);
    setOpen(false);
    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((n) => Math.min(Math.max(0, suggestions.length - 1), n + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((n) => Math.max(0, n - 1));
      return;
    }
    if (e.key === "Enter" && open && suggestions[active]) {
      e.preventDefault();
      select(suggestions[active]);
      return;
    }
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />

      {open ? (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-md border border-border bg-bg-elevated shadow-lg">
          <div className="max-h-72 overflow-auto">
            {loading ? (
              <div className="px-3 py-3 text-sm text-fg-subtle">Searching...</div>
            ) : suggestions.length ? (
              suggestions.map((s, idx) => {
                const isActive = idx === active;
                return (
                  <button
                    key={`${s}-${idx}`}
                    type="button"
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm transition-colors",
                      "border-b border-border-subtle last:border-b-0",
                      isActive ? "bg-bg-sunken/70" : "hover:bg-bg-sunken/50"
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => select(s)}
                  >
                    <span className="font-mono text-xs text-foreground">{s}</span>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-3 text-sm text-fg-subtle">No suggestions.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

