"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { apiGet } from "@/lib/api";
import { rankByFuzzy } from "@/lib/fuzzy";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type BarcodeRow = { barcode?: string | null };

export type ItemTypeaheadItem = {
  id: string;
  sku: string;
  name: string;
  barcode?: string | null;
  unit_of_measure?: string | null;
  barcodes?: BarcodeRow[] | null;
  price_usd?: string | number | null;
  price_lbp?: string | number | null;
};

const RECENT_KEY = "admin.recent.items.v1";

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadRecent(): ItemTypeaheadItem[] {
  try {
    const parsed = safeJsonParse<ItemTypeaheadItem[]>(localStorage.getItem(RECENT_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushRecent(it: ItemTypeaheadItem) {
  try {
    const prev = loadRecent();
    const next = [it, ...prev.filter((p) => p.id !== it.id)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function buildHaystack(it: ItemTypeaheadItem) {
  const parts: string[] = [];
  if (it.sku) parts.push(it.sku);
  if (it.name) parts.push(it.name);
  if (it.barcode) parts.push(String(it.barcode));
  for (const b of it.barcodes || []) {
    const code = (b as any)?.barcode;
    if (code) parts.push(String(code));
  }
  return norm(parts.join(" "));
}

function exactMatches(it: ItemTypeaheadItem, token: string) {
  const t = norm(token);
  if (!t) return false;
  if (norm(it.sku) === t) return true;
  if (it.barcode && norm(String(it.barcode)) === t) return true;
  for (const b of it.barcodes || []) {
    const code = (b as any)?.barcode;
    if (code && norm(String(code)) === t) return true;
  }
  return false;
}

export function ItemTypeahead(props: {
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  endpoint?: string;
  onSelect: (item: ItemTypeaheadItem) => void;
  onClear?: () => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const [loading, setLoading] = useState(false);
  const [remoteItems, setRemoteItems] = useState<ItemTypeaheadItem[]>([]);
  const [recentItems, setRecentItems] = useState<ItemTypeaheadItem[]>([]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setRecentItems(loadRecent());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      const el = wrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
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

  // Debounced remote search.
  useEffect(() => {
    if (!open) return;
    const qq = q.trim();
    if (!qq) {
      setRemoteItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const ep = props.endpoint || "/items/typeahead";
        const res = await apiGet<{ items: ItemTypeaheadItem[] }>(`${ep}?q=${encodeURIComponent(qq)}&limit=50`);
        if (cancelled) return;
        setRemoteItems(res.items || []);
      } catch {
        if (cancelled) return;
        setRemoteItems([]);
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, open, props.endpoint]);

  const indexedRecent = useMemo(() => (recentItems || []).map((it) => ({ it, hay: buildHaystack(it) })), [recentItems]);

  const localResults = useMemo(() => {
    const qq = norm(q);
    if (!qq) return recentItems.slice(0, 12);
    const terms = qq.split(/\s+/g).filter(Boolean);
    if (!terms.length) return [];
    const out: ItemTypeaheadItem[] = [];
    for (const row of indexedRecent) {
      let ok = true;
      for (const t of terms) {
        if (!row.hay.includes(t)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(row.it);
      if (out.length >= 12) break;
    }
    return out;
  }, [q, indexedRecent, recentItems]);

  const showRecent = open && !q.trim();
  const rankedRemote = useMemo(() => rankByFuzzy(remoteItems || [], q, buildHaystack), [remoteItems, q]);
  const results = q.trim() ? rankedRemote : localResults;

  useEffect(() => setActive(0), [q]);

  function select(it: ItemTypeaheadItem) {
    pushRecent(it);
    props.onSelect(it);
    setQ("");
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((n) => Math.min((results.length || 1) - 1, n + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((n) => Math.max(0, n - 1));
      return;
    }
    if (e.key === "Enter") {
      const token = (q || "").trim();
      if (token) {
        const exact = (remoteItems || []).find((it) => exactMatches(it, token));
        if (exact) {
          e.preventDefault();
          select(exact);
          return;
        }
      }
      if (open && results[active]) {
        e.preventDefault();
        select(results[active]);
      }
    }
  }

  return (
    <div ref={wrapRef} className={cn("relative", props.className)}>
      <Input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={props.placeholder || "Search SKU / name / barcode..."}
        disabled={props.disabled}
      />

      {open ? (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-md border border-border bg-bg-elevated shadow-lg">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2 text-[11px] text-fg-subtle">
            <div className="flex items-center gap-2">
              <span className="ui-kbd">Enter</span>
              <span>select</span>
              <span className="ui-kbd">Esc</span>
              <span>close</span>
            </div>
            {props.onClear ? (
              <button
                type="button"
                className="text-fg-muted hover:text-foreground"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQ("");
                  setOpen(false);
                  props.onClear?.();
                }}
              >
                Clear
              </button>
            ) : null}
          </div>

          {showRecent ? (
            <div className="border-b border-border-subtle px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">
              Recent
            </div>
          ) : null}

          <div className="max-h-72 overflow-auto">
            {loading ? (
              <div className="px-3 py-3 text-sm text-fg-subtle">Searching...</div>
            ) : results.length ? (
              results.map((it, idx) => {
                const isActive = idx === active;
                return (
                  <button
                    key={it.id}
                    type="button"
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm transition-colors",
                      "border-b border-border-subtle last:border-b-0",
                      isActive ? "bg-bg-sunken/70" : "hover:bg-bg-sunken/50"
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => select(it)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate">
                          <span className="font-mono text-xs text-fg-muted">{it.sku}</span>{" "}
                          <span className="text-foreground">· {it.name}</span>
                        </div>
                        {it.barcode ? <div className="mt-0.5 truncate font-mono text-[10px] text-fg-subtle">{String(it.barcode)}</div> : null}
                      </div>
                      {it.unit_of_measure ? <div className="shrink-0 font-mono text-[11px] text-fg-muted">{String(it.unit_of_measure)}</div> : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-3 text-sm text-fg-subtle">{showRecent ? "No recent items." : "No matches."}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
