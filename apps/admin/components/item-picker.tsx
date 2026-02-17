"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type MenuPosition = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
};

type BarcodeRow = { barcode?: string | null };

export type ItemPickerItem = {
  id: string;
  sku: string;
  name: string;
  barcode?: string | null;
  unit_of_measure?: string | null;
  barcodes?: BarcodeRow[] | null;
};

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

function buildHaystack(it: ItemPickerItem) {
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

function exactMatches(it: ItemPickerItem, token: string) {
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

export function ItemPicker(props: {
  items: ItemPickerItem[];
  disabled?: boolean;
  placeholder?: string;
  onSelect: (item: ItemPickerItem) => void;
  onClear?: () => void;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const indexed = useMemo(() => {
    return (props.items || []).map((it) => ({ it, hay: buildHaystack(it) }));
  }, [props.items]);

  const results = useMemo(() => {
    const qq = norm(q);
    if (!qq) return [];
    const terms = qq.split(/\s+/g).filter(Boolean);
    if (!terms.length) return [];
    const out: ItemPickerItem[] = [];
    for (const row of indexed) {
      let ok = true;
      for (const t of terms) {
        if (!row.hay.includes(t)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(row.it);
      if (out.length >= 50) break;
    }
    return out;
  }, [indexed, q]);

  useEffect(() => {
    setActive(0);
  }, [q]);

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

  function select(it: ItemPickerItem) {
    props.onSelect(it);
    setQ("");
    setOpen(false);
    setActive(0);
    // Keep keyboard flow fast: focus stays on the input unless the parent moves it.
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
      // Prefer exact matches for barcode/scanner flows.
      const token = (q || "").trim();
      if (token) {
        const exact = (props.items || []).find((it) => exactMatches(it, token));
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

      {open && q.trim() && menuPos
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

              <div className="max-h-72 overflow-auto">
                {results.length ? (
                  results.map((it, idx) => {
                    const isActive = idx === active;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        className={cn(
                          "w-full px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
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
                            {it.barcode ? (
                              <div className="mt-0.5 truncate font-mono text-xs text-fg-subtle">{String(it.barcode)}</div>
                            ) : null}
                          </div>
                          {it.unit_of_measure ? (
                            <div className="shrink-0 font-mono text-xs text-fg-muted">{String(it.unit_of_measure)}</div>
                          ) : null}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-3 text-sm text-fg-subtle">No matches.</div>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
