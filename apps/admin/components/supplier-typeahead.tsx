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

export type SupplierTypeaheadSupplier = {
  id: string;
  code?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  vat_no?: string | null;
  tax_id?: string | null;
  is_active?: boolean;
};

const LEGACY_RECENT_KEY = "admin.recent.suppliers.v1";

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

function loadRecent(): SupplierTypeaheadSupplier[] {
  try {
    const k = recentKey();
    maybeMigrateLegacy(k);
    const parsed = safeJsonParse<SupplierTypeaheadSupplier[]>(localStorage.getItem(k));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushRecent(s: SupplierTypeaheadSupplier) {
  try {
    const k = recentKey();
    maybeMigrateLegacy(k);
    const prev = loadRecent();
    const next = [s, ...prev.filter((p) => p.id !== s.id)].slice(0, 12);
    localStorage.setItem(k, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function buildHaystack(s: SupplierTypeaheadSupplier) {
  const parts: string[] = [];
  if (s.code) parts.push(String(s.code));
  if (s.name) parts.push(String(s.name));
  if (s.phone) parts.push(String(s.phone));
  if (s.email) parts.push(String(s.email));
  if ((s as any).vat_no) parts.push(String((s as any).vat_no));
  if ((s as any).tax_id) parts.push(String((s as any).tax_id));
  return norm(parts.join(" "));
}

function exactMatches(s: SupplierTypeaheadSupplier, token: string) {
  const t = norm(token);
  if (!t) return false;
  if (s.code && norm(String(s.code)) === t) return true;
  if (norm(String(s.name || "")) === t) return true;
  return false;
}

export function SupplierTypeahead(props: {
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onSelect: (s: SupplierTypeaheadSupplier) => void;
  onClear?: () => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  const [loading, setLoading] = useState(false);
  const [remote, setRemote] = useState<SupplierTypeaheadSupplier[]>([]);
  const [recent, setRecent] = useState<SupplierTypeaheadSupplier[]>([]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setRecent(loadRecent());
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
        const res = await apiGet<{ suppliers: SupplierTypeaheadSupplier[] }>(
          `/suppliers/typeahead?q=${encodeURIComponent(qq)}&limit=50`
        );
        if (cancelled) return;
        setRemote(res.suppliers || []);
      } catch {
        if (cancelled) return;
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
  }, [q, open]);

  const indexedRecent = useMemo(() => (recent || []).map((s) => ({ s, hay: buildHaystack(s) })), [recent]);

  const localResults = useMemo(() => {
    const qq = norm(q);
    if (!qq) return recent.slice(0, 12);
    const terms = qq.split(/\s+/g).filter(Boolean);
    if (!terms.length) return [];
    const out: SupplierTypeaheadSupplier[] = [];
    for (const row of indexedRecent) {
      let ok = true;
      for (const t of terms) {
        if (!row.hay.includes(t)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(row.s);
      if (out.length >= 12) break;
    }
    return out;
  }, [q, indexedRecent, recent]);

  const showRecent = open && !q.trim();
  const rankedRemote = useMemo(() => rankByFuzzy(remote || [], q, buildHaystack), [remote, q]);
  const results = q.trim() ? rankedRemote : localResults;

  useEffect(() => setActive(0), [q]);

  function select(s: SupplierTypeaheadSupplier) {
    pushRecent(s);
    props.onSelect(s);
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
        const exact = (remote || []).find((s) => exactMatches(s, token));
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
        placeholder={props.placeholder || "Search supplier code / name / phone..."}
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
                  results.map((s, idx) => {
                    const isActive = idx === active;
                    return (
                      <button
                        key={s.id}
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
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate">
                              {s.code ? <span className="font-mono text-xs text-fg-muted">{s.code}</span> : null}
                              {s.code ? <span className="text-fg-muted"> · </span> : null}
                              <span className="text-foreground">{s.name}</span>
                            </div>
                            {s.phone || s.email ? (
                              <div className="mt-0.5 truncate font-mono text-[10px] text-fg-subtle">
                                {[s.phone, s.email].filter(Boolean).join(" · ")}
                              </div>
                            ) : null}
                          </div>
                          {s.is_active === false ? <div className="shrink-0 font-mono text-[11px] text-fg-muted">inactive</div> : null}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-3 text-sm text-fg-subtle">{showRecent ? "No recent suppliers." : "No matches."}</div>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
