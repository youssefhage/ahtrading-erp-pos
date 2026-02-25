"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  EntityTypeahead,
  type EntityTypeaheadConfig,
  type EntityTypeaheadHandle,
} from "@/components/entity-typeahead";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

function buildHaystack(it: ItemTypeaheadItem): string {
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

function exactMatches(it: ItemTypeaheadItem, token: string): boolean {
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

/* ------------------------------------------------------------------ */
/*  Static parts of the config (no dependency on props)                */
/* ------------------------------------------------------------------ */

const RECENT_STORAGE_KEY = "admin.recent.items.v1";
const LEGACY_STORAGE_KEY = "admin.recent.items.v1";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ItemTypeahead(props: {
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  endpoint?: string;
  /**
   * When enabled, barcode scans (fast keyboard input + Enter) will be
   * captured at the document level so the cashier doesn't need to focus
   * this field first.  We intentionally do NOT capture while the user
   * is typing in any other input/select/textarea/contenteditable element.
   */
  globalScan?: boolean;
  onSelect: (item: ItemTypeaheadItem) => void;
  onClear?: () => void;
}) {
  const typeaheadRef = useRef<EntityTypeaheadHandle<ItemTypeaheadItem>>(null);
  const scanBufRef = useRef<{ buf: string; timer: number | null }>({ buf: "", timer: null });
  const pendingScanRef = useRef<string>("");

  /* -- EntityTypeahead config (memoised per endpoint) ----------------- */

  const endpoint = props.endpoint || "/items/typeahead";

  const config = useMemo<EntityTypeaheadConfig<ItemTypeaheadItem>>(
    () => ({
      endpoint,
      responseKey: "items",
      recentStorageKey: RECENT_STORAGE_KEY,
      legacyStorageKey: LEGACY_STORAGE_KEY,
      buildHaystack,
      findExactMatch(items, query) {
        return items.find((it) => exactMatches(it, query));
      },
      getLabel(_it) {
        // ItemTypeahead clears the input on select (unlike Customer/Supplier).
        // The actual clearing is handled by the `clearOnSelect` prop.
        return "";
      },
      renderItem(it) {
        return (
          <>
            <span className="font-mono text-xs text-fg-muted">{it.sku}</span>{" "}
            <span className="text-foreground">· {it.name}</span>
          </>
        );
      },
      renderSecondary(it) {
        if (!it.barcode) return null;
        return <>{String(it.barcode)}</>;
      },
      renderBadge(it) {
        if (!it.unit_of_measure) return null;
        return (
          <div className="shrink-0 font-mono text-xs text-fg-muted">
            {String(it.unit_of_measure)}
          </div>
        );
      },
      placeholder: "Search SKU / name / barcode...",
      emptyRecentText: "No recent items.",
    }),
    [endpoint],
  );

  /* -- Global barcode scan capture ------------------------------------ */

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
        // Programmatically trigger the typeahead search via the handle.
        typeaheadRef.current?.search(token);
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

  /* -- Auto-select on barcode scan result ----------------------------- */

  const onSelectRef = useRef(props.onSelect);
  useEffect(() => {
    onSelectRef.current = props.onSelect;
  });

  const onRemoteChange = useCallback(
    (items: ItemTypeaheadItem[], query: string) => {
      const token = pendingScanRef.current;
      if (!token) return;
      if (norm(query) !== norm(token)) {
        pendingScanRef.current = "";
        return;
      }
      const exact = items.find((it) => exactMatches(it, token));
      if (!exact) return;
      pendingScanRef.current = "";
      onSelectRef.current(exact);
    },
    [],
  );

  /* -- Render --------------------------------------------------------- */

  return (
    <EntityTypeahead<ItemTypeaheadItem>
      ref={typeaheadRef}
      config={config}
      disabled={props.disabled}
      placeholder={props.placeholder}
      className={props.className}
      onSelect={props.onSelect}
      onClear={props.onClear}
      onRemoteChange={onRemoteChange}
      clearOnSelect
    />
  );
}
