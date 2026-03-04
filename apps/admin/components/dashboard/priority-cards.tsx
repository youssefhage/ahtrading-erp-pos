"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, Zap, Info, ArrowRight, Sparkles, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  recommendationView,
  type RecommendationLike,
} from "@/lib/ai-recommendations";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type RecommendationRow = RecommendationLike & {
  id: string;
  agent_code: string;
  status: string;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/*  Severity helpers                                                   */
/* ------------------------------------------------------------------ */

const severityConfig = {
  critical: {
    border: "border-l-destructive",
    badge: "bg-destructive/10 text-destructive",
    icon: AlertTriangle,
  },
  warning: {
    border: "border-l-warning",
    badge: "bg-warning/10 text-warning",
    icon: Zap,
  },
  info: {
    border: "border-l-info",
    badge: "bg-info/10 text-info",
    icon: Info,
  },
} as const;

function normSeverity(s?: string): keyof typeof severityConfig {
  const v = String(s || "").toLowerCase();
  if (v === "critical" || v === "high" || v === "danger") return "critical";
  if (v === "warning" || v === "medium") return "warning";
  return "info";
}

/* ------------------------------------------------------------------ */
/*  PriorityCards                                                      */
/* ------------------------------------------------------------------ */

interface PriorityCardsProps {
  rows: RecommendationRow[];
  loading: boolean;
}

const STORAGE_KEY = "dashboard:ai-priorities-expanded";

function getInitialExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function PriorityCards({ rows, loading }: PriorityCardsProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(getInitialExpanded);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch {}
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Priorities
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) return null;

  const top = rows.slice(0, 6).map((row) => {
    const view = recommendationView(row);
    const severity = normSeverity(view.severity);
    return { row, view, severity };
  });

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        AI Priorities
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          {rows.length}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 transition-transform duration-200",
            !expanded && "-rotate-90"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="ai-priorities-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <motion.div
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
            >
              {top.map(({ row, view, severity }) => {
                const cfg = severityConfig[severity];
                const Icon = cfg.icon;
                const href = view.linkHref || "/automation/ai-hub";

                return (
                  <motion.div key={row.id} variants={staggerItem}>
                    <Card
                      className={cn(
                        "group cursor-pointer border-l-[3px] transition-colors hover:bg-accent/50",
                        cfg.border
                      )}
                      onClick={() => router.push(href)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={cn("mt-0.5 rounded-md p-1.5", cfg.badge)}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <p className="text-sm font-medium leading-snug truncate">
                              {view.title}
                            </p>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {view.summary || view.nextStep}
                            </p>
                          </div>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-all group-hover:text-muted-foreground group-hover:translate-x-0.5" />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>

            {rows.length > 6 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-3"
                onClick={() => router.push("/automation/ai-hub")}
              >
                View all {rows.length} recommendations
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
