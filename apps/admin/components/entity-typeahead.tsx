"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { apiGet, getCompanyId } from "@/lib/api";
import { rankByFuzzy } from "@/lib/fuzzy";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type MenuPosition = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
};

export interface EntityTypeaheadConfig<T extends { id: string }> {
  endpoint: string;
  responseKey: string;
  recentStorageKey: string;
  legacyStorageKey?: string;
  maxRecent?: number;
  buildHaystack: (item: T) => string;
  findExactMatch?: (items: T[], query: string) => T | undefined;
  renderItem: (item: T) => React.ReactNode;
  renderSecondary?: (item: T) => React.ReactNode | null;
  renderBadge?: (item: T) => React.ReactNode | null;
  getLabel: (item: T) => string;
  placeholder?: string;
  emptyRecentText?: string;
}

export interface EntityTypeaheadHandle<T extends { id: string }> {
  /** Programmatically set the search query and open the dropdown. */
  search(query: string): void;
  /** Read current remote results (updated after every fetch). */
  getRemote(): T[];
  /** Focus the input element. */
  focus(): void;
}

interface EntityTypeaheadProps<T extends { id: string }> {
  config: EntityTypeaheadConfig<T>;
  value?: T | null;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onSelect: (item: T) => void;
  onClear?: () => void;
  /** Called whenever remote results change (after fetch completes). */
  onRemoteChange?: (items: T[], query: string) => void;
  /** Override the default select behavior that sets the input text to `getLabel(item)`. */
  clearOnSelect?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

function buildRecentKey(baseKey: string): string {
  const cid = String(getCompanyId() || "").trim();
  return `${baseKey}.${cid || "unknown"}`;
}

function maybeMigrateLegacy(legacyKey: string | undefined, nextKey: string) {
  if (!legacyKey) return;
  try {
    const legacy = localStorage.getItem(legacyKey);
    if (!legacy) return;
    if (localStorage.getItem(nextKey)) return;
    localStorage.setItem(nextKey, legacy);
    localStorage.removeItem(legacyKey);
  } catch {
    // ignore
  }
}

function loadRecent<T>(baseKey: string, legacyKey: string | undefined): T[] {
  try {
    const k = buildRecentKey(baseKey);
    maybeMigrateLegacy(legacyKey, k);
    const parsed = safeJsonParse<T[]>(localStorage.getItem(k));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushRecent<T extends { id: string }>(
  item: T,
  baseKey: string,
  legacyKey: string | undefined,
  maxRecent: number,
) {
  try {
    const k = buildRecentKey(baseKey);
    maybeMigrateLegacy(legacyKey, k);
    const prev = loadRecent<T>(baseKey, legacyKey);
    const next = [item, ...prev.filter((p) => p.id !== item.id)].slice(0, maxRecent);
    localStorage.setItem(k, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function EntityTypeaheadInner<T extends { id: string }>(
  props: EntityTypeaheadProps<T>,
  ref: React.Ref<EntityTypeaheadHandle<T>>,
) {
  const { config, onRemoteChange } = props;
  const maxRecent = config.maxRecent ?? 12;

  const uid = useId();
  const listboxId = `${uid}-listbox`;

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  const [loading, setLoading] = useState(false);
  const [remote, setRemote] = useState<T[]>([]);
  const [recent, setRecent] = useState<T[]>([]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const remoteRef = useRef<T[]>([]);

  /* -- Imperative handle for programmatic control --------------------- */

  useImperativeHandle(ref, () => ({
    search(query: string) {
      setQ(query);
      setOpen(true);
      setActive(0);
    },
    getRemote() {
      return remoteRef.current;
    },
    focus() {
      inputRef.current?.focus();
    },
  }));

  /* -- Load recent items when opening -------------------------------- */

  useEffect(() => {
    if (!open) return;
    setRecent(loadRecent<T>(config.recentStorageKey, config.legacyStorageKey));
  }, [open, config.recentStorageKey, config.legacyStorageKey]);

  /* -- Outside click / escape to close ------------------------------- */

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      const el = wrapRef.current;
      const menu = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && (el.contains(e.target) || (menu && menu.contains(e.target)))) return;
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

  /* -- Clear menu position when closed ------------------------------- */

  useEffect(() => {
    if (open) return;
    setMenuPos(null);
  }, [open]);

  /* -- Compute portal position --------------------------------------- */

  useEffect(() => {
    if (!open) return;
    const updateMenuRect = () => {
      const el = wrapRef.current;
      if (!el) return;
      const gap = 8;
      const rect = el.getBoundingClientRect();
      const width = Math.min(rect.width, Math.max(120, window.innerWidth - gap * 2));
      const left = Math.min(Math.max(gap, rect.left), Math.max(gap, window.innerWidth - gap - width));
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const preferUp = spaceBelow < 280 && spaceAbove > spaceBelow;
      if (preferUp) {
        setMenuPos({
          left,
          width,
          bottom: Math.max(gap, window.innerHeight - rect.top + gap),
        });
        return;
      }
      setMenuPos({
        left,
        width,
        top: Math.max(gap, rect.bottom + gap),
      });
    };
    updateMenuRect();
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open]);

  /* -- Debounced remote search --------------------------------------- */

  useEffect(() => {
    if (!open) return;
    const qq = q.trim();
    if (!qq) {
      setRemote([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiGet<Record<string, T[]>>(
          `${config.endpoint}?q=${encodeURIComponent(qq)}&limit=50`,
        );
        if (cancelled) return;
        const items = res[config.responseKey] || [];
        remoteRef.current = items;
        setRemote(items);
        onRemoteChange?.(items, qq);
      } catch {
        if (cancelled) return;
        remoteRef.current = [];
        setRemote([]);
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, open, config.endpoint, config.responseKey, onRemoteChange]);

  /* -- Sync input text with external value --------------------------- */

  useEffect(() => {
    if (open) return;
    const v = props.value;
    if (!v) {
      setQ("");
      return;
    }
    setQ(config.getLabel(v) || String(v.id || ""));
  }, [open, props.value, config]);

  /* -- Local fuzzy filtering of recent items ------------------------- */

  const indexedRecent = useMemo(
    () => (recent || []).map((item) => ({ item, hay: config.buildHaystack(item) })),
    [recent, config],
  );

  const localResults = useMemo(() => {
    const qq = norm(q);
    if (!qq) return recent.slice(0, maxRecent);
    const terms = qq.split(/\s+/g).filter(Boolean);
    if (!terms.length) return [];
    const out: T[] = [];
    for (const row of indexedRecent) {
      let ok = true;
      for (const t of terms) {
        if (!row.hay.includes(t)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(row.item);
      if (out.length >= maxRecent) break;
    }
    return out;
  }, [q, indexedRecent, recent, maxRecent]);

  const showRecent = open && !q.trim();
  const rankedRemote = useMemo(
    () => rankByFuzzy(remote || [], q, config.buildHaystack),
    [remote, q, config],
  );
  const results = q.trim() ? rankedRemote : localResults;

  /* -- Reset active index on query change ---------------------------- */

  useEffect(() => setActive(0), [q]);

  /* -- Selection handler --------------------------------------------- */

  function select(item: T) {
    pushRecent(item, config.recentStorageKey, config.legacyStorageKey, maxRecent);
    props.onSelect(item);
    setQ(props.clearOnSelect ? "" : (config.getLabel(item) || String(item.id || "")));
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  }

  /* -- Keyboard navigation ------------------------------------------- */

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
      if (token && config.findExactMatch) {
        const exact = config.findExactMatch(remote || [], token);
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

  /* -- Option ID helper ---------------------------------------------- */

  function optionId(idx: number): string {
    return `${uid}-option-${idx}`;
  }

  /* -- Render -------------------------------------------------------- */

  const placeholder = props.placeholder ?? config.placeholder;
  const emptyRecentText = config.emptyRecentText ?? "No recent items.";

  return (
    <div ref={wrapRef} className={cn("relative", props.className)}>
      <Input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          if (props.value) props.onClear?.();
          setQ(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={props.disabled}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={open && results.length > 0 ? optionId(active) : undefined}
      />

      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              data-dialog-keepopen="true"
              className="z-[70] overflow-hidden rounded-md border border-border bg-bg-elevated shadow-lg"
              style={{
                position: "fixed",
                left: menuPos.left,
                width: menuPos.width,
                ...(typeof menuPos.top === "number" ? { top: menuPos.top } : { bottom: menuPos.bottom }),
              }}
            >
              <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2 text-xs text-fg-subtle">
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
                <div className="border-b border-border-subtle px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">
                  Recent
                </div>
              ) : null}

              <div id={listboxId} role="listbox" className="max-h-72 overflow-auto">
                {loading ? (
                  <div className="px-3 py-3 text-sm text-fg-subtle">Searching...</div>
                ) : results.length ? (
                  results.map((item, idx) => {
                    const isActive = idx === active;
                    const secondary = config.renderSecondary ? config.renderSecondary(item) : null;
                    const badge = config.renderBadge ? config.renderBadge(item) : null;
                    return (
                      <button
                        key={item.id}
                        id={optionId(idx)}
                        role="option"
                        aria-selected={isActive}
                        type="button"
                        className={cn(
                          "w-full px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
                          "border-b border-border-subtle last:border-b-0",
                          isActive ? "bg-primary/15 ring-1 ring-primary/25" : "hover:bg-bg-sunken/50",
                        )}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          select(item);
                        }}
                        onMouseEnter={() => setActive(idx)}
                        onClick={(e) => e.preventDefault()}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate">{config.renderItem(item)}</div>
                            {secondary ? (
                              <div className="mt-0.5 truncate font-mono text-xs text-fg-subtle">
                                {secondary}
                              </div>
                            ) : null}
                          </div>
                          {badge}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-3 text-sm text-fg-subtle">
                    {showRecent ? emptyRecentText : "No matches."}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * Generic typeahead with portal dropdown, recent items, fuzzy search, and ARIA.
 *
 * Accepts an optional `ref` exposing `EntityTypeaheadHandle` for programmatic
 * control (e.g. barcode scanning wrappers that need to trigger a search externally).
 */
export const EntityTypeahead = forwardRef(EntityTypeaheadInner) as <
  T extends { id: string },
>(
  props: EntityTypeaheadProps<T> & { ref?: React.Ref<EntityTypeaheadHandle<T>> },
) => React.ReactElement | null;
