"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { recommendationView, type RecommendationLike } from "@/lib/ai-recommendations";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type PulseItem = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  subtitle: string;
  href: string;
  source: "attention" | "ai";
};

type AttentionRow = {
  key: string;
  severity?: string;
  label: string;
  count: number;
  href?: string;
};

type RecommendationRow = RecommendationLike & {
  id: string;
  agent_code: string;
  status: string;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function normSeverity(s?: string): PulseItem["severity"] {
  const v = String(s || "").toLowerCase();
  if (v === "critical" || v === "high" || v === "danger") return "critical";
  if (v === "warning" || v === "medium") return "warning";
  return "info";
}

function attentionToItems(rows: AttentionRow[]): PulseItem[] {
  return rows
    .filter((r) => r.count > 0)
    .map((r) => ({
      id: `att:${r.key}`,
      severity: normSeverity(r.severity),
      title: `${r.count} ${r.label}`,
      subtitle: "Tap to review",
      href: r.href || "/system/attention",
      source: "attention" as const,
    }));
}

function recsToItems(rows: RecommendationRow[]): PulseItem[] {
  return rows.slice(0, 10).map((r) => {
    const view = recommendationView(r);
    return {
      id: `ai:${r.id}`,
      severity: normSeverity(view.severity),
      title: view.title,
      subtitle: view.summary,
      href: view.linkHref || "/automation/ai-hub",
      source: "ai" as const,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

const POLL_INTERVAL = 90_000; // 90 seconds
const DISMISSED_KEY = "codex.pulse.dismissed";

function getDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function addDismissed(id: string) {
  const set = getDismissed();
  set.add(id);
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
  } catch {}
}

export function usePulseData() {
  const [items, setItems] = useState<PulseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("codex.pulse.collapsed") === "1";
  });
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const dismissed = getDismissed();

      const [attRes, recRes] = await Promise.allSettled([
        apiGet<{ items?: AttentionRow[] }>("/reports/attention"),
        apiGet<{ recommendations?: RecommendationRow[] }>("/ai/recommendations?status=pending&limit=20"),
      ]);

      if (!mountedRef.current) return;

      const attItems =
        attRes.status === "fulfilled" && Array.isArray(attRes.value?.items)
          ? attentionToItems(attRes.value.items)
          : [];

      const recItems =
        recRes.status === "fulfilled" && Array.isArray(recRes.value?.recommendations)
          ? recsToItems(recRes.value.recommendations)
          : [];

      // Merge: critical first, then warning, then info
      const all = [...attItems, ...recItems]
        .filter((i) => !dismissed.has(i.id))
        .sort((a, b) => {
          const order = { critical: 0, warning: 1, info: 2 };
          return order[a.severity] - order[b.severity];
        });

      setItems(all);
    } catch {
      // Silently fail — pulse bar is non-critical
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const id = setInterval(load, POLL_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [load]);

  const dismiss = useCallback((id: string) => {
    addDismissed(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("codex.pulse.collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  return { items, loading, collapsed, toggleCollapsed, dismiss, refresh: load };
}
