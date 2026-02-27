"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { apiGet } from "@/lib/api";
import {
  recommendationView,
  type RecommendationLike,
} from "@/lib/ai-recommendations";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type InsightItem = {
  id: string;
  severity: "info" | "warning" | "critical";
  kind: string;
  title: string;
  summary: string;
  nextStep: string;
  linkHref?: string;
  linkLabel?: string;
  agentCode: string;
};

type RecommendationRow = RecommendationLike & {
  id: string;
  agent_code: string;
  status: string;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/*  Route → agent code mapping                                         */
/* ------------------------------------------------------------------ */

const ROUTE_AGENTS: Record<string, string[]> = {
  "/sales": ["AI_CRM", "AI_ANOMALY"],
  "/inventory": ["AI_INVENTORY", "AI_EXPIRY_OPS", "AI_SHRINKAGE"],
  "/purchasing": ["AI_AP_GUARD", "AI_PURCHASE", "AI_PURCHASE_INVOICE_INSIGHTS"],
  "/accounting": ["AI_ANOMALY"],
  "/catalog": ["AI_DATA_HYGIENE", "AI_PRICING"],
};

function agentsForPath(pathname: string): string[] | null {
  for (const [prefix, agents] of Object.entries(ROUTE_AGENTS)) {
    if (pathname.startsWith(prefix)) return agents;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Severity normalization                                             */
/* ------------------------------------------------------------------ */

function normSeverity(s?: string): InsightItem["severity"] {
  const v = String(s || "").toLowerCase();
  if (v === "critical" || v === "high" || v === "danger") return "critical";
  if (v === "warning" || v === "medium") return "warning";
  return "info";
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useContextualInsights() {
  const pathname = usePathname() || "/";
  const [items, setItems] = useState<InsightItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(true);
  const lastPathRef = useRef("");

  const agents = useMemo(() => agentsForPath(pathname), [pathname]);
  const hasInsights = agents !== null;

  const load = useCallback(async () => {
    if (!agents || agents.length === 0) {
      setItems([]);
      return;
    }

    setLoading(true);
    try {
      // Fetch pending recommendations filtered by relevant agent codes
      const agentFilter = agents.join(",");
      const res = await apiGet<{ recommendations?: RecommendationRow[] }>(
        `/ai/recommendations?status=pending&limit=20&agent_code=${encodeURIComponent(agentFilter)}`
      );

      if (!mountedRef.current) return;

      const rows = Array.isArray(res?.recommendations) ? res.recommendations : [];
      const mapped: InsightItem[] = rows.map((row) => {
        const view = recommendationView(row);
        return {
          id: row.id,
          severity: normSeverity(view.severity),
          kind: view.kindLabel || view.kind,
          title: view.title,
          summary: view.summary,
          nextStep: view.nextStep,
          linkHref: view.linkHref,
          linkLabel: view.linkLabel,
          agentCode: row.agent_code,
        };
      });

      // Sort by severity
      const order = { critical: 0, warning: 1, info: 2 };
      mapped.sort((a, b) => order[a.severity] - order[b.severity]);

      setItems(mapped);
    } catch {
      // Non-critical — silently fail
      if (mountedRef.current) setItems([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [agents]);

  // Reload when route prefix changes
  useEffect(() => {
    const prefix = pathname.split("/").slice(0, 2).join("/");
    if (prefix === lastPathRef.current) return;
    lastPathRef.current = prefix;
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [pathname, load]);

  const toggle = useCallback(() => setOpen((p) => !p), []);

  return {
    items,
    loading,
    open,
    setOpen,
    toggle,
    hasInsights,
    count: items.length,
  };
}
