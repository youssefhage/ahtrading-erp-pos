"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Info,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useContextualInsights,
  type InsightItem,
} from "@/lib/hooks/use-contextual-insights";

/* ------------------------------------------------------------------ */
/*  Severity config                                                    */
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

/* ------------------------------------------------------------------ */
/*  InsightCard                                                        */
/* ------------------------------------------------------------------ */

function InsightCard({ item }: { item: InsightItem }) {
  const router = useRouter();
  const cfg = severityConfig[item.severity];
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "group rounded-lg border border-l-[3px] bg-card p-3 transition-colors hover:bg-accent/30",
        cfg.border
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn("mt-0.5 rounded-md p-1", cfg.badge)}>
          <Icon className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium leading-snug">{item.title}</p>
          {item.summary && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {item.summary}
            </p>
          )}
          {item.nextStep && (
            <p className="text-xs text-primary/70 italic">
              {item.nextStep}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
              {item.kind}
            </span>
            {item.linkHref && (
              <button
                onClick={() => router.push(item.linkHref!)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {item.linkLabel || "View"}
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  InsightsPanel                                                      */
/* ------------------------------------------------------------------ */

export function InsightsPanel() {
  const { items, loading, open, setOpen, hasInsights } =
    useContextualInsights();

  if (!hasInsights || !open) return null;

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-[380px] max-w-[90vw] border-l bg-background shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">AI Insights</h2>
                {items.length > 0 && (
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {items.length}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Content */}
            <ScrollArea className="h-[calc(100%-53px)]">
              <div className="space-y-3 p-4">
                {loading ? (
                  Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="rounded-lg border p-3 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))
                ) : items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Sparkles className="mb-3 h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm font-medium text-muted-foreground">
                      No insights for this section
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      AI recommendations will appear here when available.
                    </p>
                  </div>
                ) : (
                  <AnimatePresence mode="popLayout">
                    {items.map((item) => (
                      <InsightCard key={item.id} item={item} />
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  InsightsTrigger — for the top nav                                  */
/* ------------------------------------------------------------------ */

export function InsightsTrigger() {
  const { hasInsights, count, toggle } = useContextualInsights();

  if (!hasInsights) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative h-8 w-8"
      onClick={toggle}
    >
      <Sparkles className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Button>
  );
}
