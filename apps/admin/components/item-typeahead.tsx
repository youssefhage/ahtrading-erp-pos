"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { apiGet, getCompanyId } from "@/lib/api";
import { rankByFuzzy } from "@/lib/fuzzy";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type MenuPosition = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
};

type BarcodeRow = { barcode?: string | null };

export type ItemTypeaheadItem = {
  id: string;
  sku: string;
  name: string;
  barcode?: string | null;
  unit_of_measure?: string | null;
  tax_code_id?: string | null;
  standard_cost_usd?: string | number | null;
  standard_cost_lbp?: string | number | null;
  barcodes?: BarcodeRow[] | null;
  price_usd?: string | number | null;
  price_lbp?: string | number | null;
};

const LEGACY_RECENT_KEY = "admin.recent.items.v1";

function recentKey(): string {
  const cid = String(getCompanyId() || "").trim();
  return `${LEGACY_RECENT_KEY}.${cid || "unknown"}`;
}

function maybeMigrateLegacy(nextKey: string) {
  try {
    const legacy = localStorage.getItem(LEGACY_RECENT_KEY);
    if (!legacy) return;
    if (localStorage.getItem(nextKey)) return;
    localStorage.setItem(nextKey, legacy);
    localStorage.removeItem(LEGACY_RECENT_KEY);
  } catch {
    // ignore
  }
}

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
    const k = recentKey();
    maybeMigrateLegacy(k);
    const parsed = safeJsonParse<ItemTypeaheadItem[]>(localStorage.getItem(k));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushRecent(it: ItemTypeaheadItem) {
  try {
    const k = recentKey();
    maybeMigrateLegacy(k);
    const prev = loadRecent();
    const next = [it, ...prev.filter((p) => p.id !== it.id)].slice(0, 12);
    localStorage.setItem(k, JSON.stringify(next));
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
  // When enabled, barcode scans (fast keyboard input + Enter) will be captured at the document level
  // so the cashier doesn't need to focus this field first. We intentionally do NOT capture while
  // the user is typing in any other input/select/textarea/contenteditable element.
  globalScan?: boolean;
  onSelect: (item: ItemTypeaheadItem) => void;
  onClear?: () => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  const [loading, setLoading] = useState(false);
  const [remoteItems, setRemoteItems] = useState<ItemTypeaheadItem[]>([]);
  const [recentItems, setRecentItems] = useState<ItemTypeaheadItem[]>([]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scanBufRef = useRef<{ buf: string; timer: number | null }>({ buf: "", timer: null });
  const pendingScanRef = useRef<string>("");

  useEffect(() => {
    if (!open) return;
    setRecentItems(loadRecent());
  }, [open]);

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

  // Optional global barcode scan capture (invoice screens, etc.).
  useEffect(() => {
    if (!props.globalScan) return;
    if (props.disabled) return;
    const scanState = scanBufRef.current;

    function isTypingTarget(t: EventTarget | null) {
      if (!(t instanceof HTMLElement)) return false;
      const tag = String(t.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    }

    function reset() {
      scanState.buf = "";
      if (scanState.timer) window.clearTimeout(scanState.timer);
      scanState.timer = null;
    }

    function onDocKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const key = String(e.key || "");
      if (key === "Enter") {
        const token = scanState.buf.trim();
        if (!token) return;
        e.preventDefault();
        pendingScanRef.current = token;
        setQ(token);
        setOpen(true);
        setActive(0);
        reset();
        return;
      }

      if (key.length !== 1) return;
      if (/\s/.test(key)) return;

      scanState.buf += key;
      if (scanState.timer) window.clearTimeout(scanState.timer);
      scanState.timer = window.setTimeout(reset, 280);
    }

    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocKeyDown);
      // Clear any buffered characters on unmount.
      scanState.buf = "";
      if (scanState.timer) window.clearTimeout(scanState.timer);
      scanState.timer = null;
    };
  }, [props.globalScan, props.disabled]);

  useEffect(() => {
    if (open) return;
    setMenuPos(null);
  }, [open]);

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

  // If a scan initiated a search, auto-select the exact match as soon as remote results arrive.
  useEffect(() => {
    const token = pendingScanRef.current;
    if (!token) return;
    if (norm(q) !== norm(token)) {
      pendingScanRef.current = "";
      return;
    }
    const exact = (remoteItems || []).find((it) => exactMatches(it, token));
    if (!exact) return;
    pendingScanRef.current = "";
    select(exact);
  }, [remoteItems, q]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef}
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
                          "w-full px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
                          "border-b border-border-subtle last:border-b-0",
                          isActive ? "bg-primary/15 ring-1 ring-primary/25" : "hover:bg-bg-sunken/50"
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
                            {it.barcode ? <div className="mt-0.5 truncate font-mono text-xs text-fg-subtle">{String(it.barcode)}</div> : null}
                          </div>
                          {it.unit_of_measure ? <div className="shrink-0 font-mono text-xs text-fg-muted">{String(it.unit_of_measure)}</div> : null}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-3 text-sm text-fg-subtle">{showRecent ? "No recent items." : "No matches."}</div>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
