"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { usePulseData, type PulseItem } from "@/lib/hooks/use-pulse-data";

/* ------------------------------------------------------------------ */
/*  Severity helpers                                                   */
/* ------------------------------------------------------------------ */

const severityConfig = {
  critical: {
    border: "border-l-destructive",
    bg: "bg-destructive/5",
    icon: AlertTriangle,
    iconColor: "text-destructive",
    dot: "bg-destructive",
  },
  warning: {
    border: "border-l-warning",
    bg: "bg-warning/5",
    icon: Zap,
    iconColor: "text-warning",
    dot: "bg-warning",
  },
  info: {
    border: "border-l-info",
    bg: "bg-info/5",
    icon: Info,
    iconColor: "text-info",
    dot: "bg-info",
  },
} as const;

/* ------------------------------------------------------------------ */
/*  PulseBarItem                                                       */
/* ------------------------------------------------------------------ */

function PulseBarItem({
  item,
  onDismiss,
}: {
  item: PulseItem;
  onDismiss: (id: string) => void;
}) {
  const cfg = severityConfig[item.severity];
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex w-full items-center"
    >
      <Link
        href={item.href}
        className={cn(
          "group flex flex-1 items-center gap-3 rounded-md border-l-[3px] px-3 py-1.5 transition-colors",
          cfg.border,
          cfg.bg,
          "hover:bg-accent/50"
        )}
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.iconColor)} />
        <span className="text-[13px] font-medium truncate">{item.title}</span>
        <span className="hidden text-[12px] text-muted-foreground truncate sm:inline">
          {item.subtitle}
        </span>
        <span
          className={cn(
            "ml-auto hidden text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 sm:inline",
            item.source === "ai" ? "text-primary/60" : ""
          )}
        >
          {item.source === "ai" ? "AI Insight" : "Attention"}
        </span>
      </Link>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss(item.id);
        }}
        className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  AiPulseBar                                                         */
/* ------------------------------------------------------------------ */

const ROTATE_INTERVAL = 5_000; // 5 seconds

export function AiPulseBar() {
  const { items, loading, collapsed, toggleCollapsed, dismiss } =
    usePulseData();
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  // Auto-rotate
  useEffect(() => {
    if (paused || collapsed || items.length <= 1) {
      clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % items.length);
    }, ROTATE_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [paused, collapsed, items.length]);

  // Keep index in bounds
  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(0);
  }, [items.length, activeIndex]);

  const handleDismiss = useCallback(
    (id: string) => {
      dismiss(id);
    },
    [dismiss]
  );

  // Nothing to show
  if (loading || items.length === 0) return null;

  const criticalCount = items.filter((i) => i.severity === "critical").length;
  const warningCount = items.filter((i) => i.severity === "warning").length;
  const totalCount = items.length;

  // Collapsed: show badge only
  if (collapsed) {
    return (
      <button
        onClick={toggleCollapsed}
        className={cn(
          "flex items-center gap-2 border-b bg-background/50 px-4 py-1 text-[12px] transition-colors hover:bg-accent/30",
          criticalCount > 0
            ? "border-b-destructive/20"
            : warningCount > 0
            ? "border-b-warning/20"
            : "border-b-border"
        )}
      >
        <Sparkles className="h-3 w-3 text-primary" />
        <span className="font-medium text-muted-foreground">
          {totalCount} insight{totalCount !== 1 ? "s" : ""}
        </span>
        {criticalCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
            {criticalCount} critical
          </span>
        )}
        <ChevronDown className="ml-auto h-3 w-3 text-muted-foreground/50" />
      </button>
    );
  }

  const current = items[activeIndex];
  if (!current) return null;

  return (
    <div
      className="flex items-center gap-2 border-b bg-background/50 px-4 py-1"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="log"
      aria-live="polite"
      aria-label="AI insights"
    >
      {/* Sparkle indicator */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        {items.length > 1 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/50">
            {activeIndex + 1}/{items.length}
          </span>
        )}
      </div>

      {/* Rotating item */}
      <div className="flex-1 min-w-0">
        <AnimatePresence mode="wait">
          <PulseBarItem
            key={current.id}
            item={current}
            onDismiss={handleDismiss}
          />
        </AnimatePresence>
      </div>

      {/* Navigation dots (when >1) */}
      {items.length > 1 && (
        <div className="hidden items-center gap-1 sm:flex">
          {items.slice(0, 6).map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-all",
                i === activeIndex
                  ? "bg-primary w-3"
                  : "bg-muted-foreground/20 hover:bg-muted-foreground/40"
              )}
              aria-label={`Go to insight ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={toggleCollapsed}
        className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        aria-label="Minimize insights bar"
      >
        <ChevronUp className="h-3 w-3" />
      </button>
    </div>
  );
}
