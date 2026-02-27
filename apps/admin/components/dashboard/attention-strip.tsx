"use client";

import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  AlertTriangle,
  Clock,
  Package,
  FileWarning,
  CreditCard,
  ShieldAlert,
  TrendingDown,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type AttentionItem = {
  key: string;
  severity?: string;
  label: string;
  count: number;
  href?: string;
};

/* ------------------------------------------------------------------ */
/*  Icon mapping by key pattern                                        */
/* ------------------------------------------------------------------ */

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  overdue: Clock,
  low_stock: Package,
  expir: FileWarning,
  unpaid: CreditCard,
  guard: ShieldAlert,
  anomal: AlertTriangle,
  shrink: TrendingDown,
};

function getIcon(key: string) {
  const k = key.toLowerCase();
  for (const [pattern, icon] of Object.entries(ICON_MAP)) {
    if (k.includes(pattern)) return icon;
  }
  return Zap;
}

/* ------------------------------------------------------------------ */
/*  Severity style                                                     */
/* ------------------------------------------------------------------ */

function severityStyle(s?: string) {
  const v = String(s || "").toLowerCase();
  if (v === "critical" || v === "high" || v === "danger")
    return "border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10";
  if (v === "warning" || v === "medium")
    return "border-warning/30 bg-warning/5 text-warning hover:bg-warning/10";
  return "border-info/30 bg-info/5 text-info hover:bg-info/10";
}

/* ------------------------------------------------------------------ */
/*  AttentionStrip                                                     */
/* ------------------------------------------------------------------ */

interface AttentionStripProps {
  items: AttentionItem[];
  loading: boolean;
}

export function AttentionStrip({ items, loading }: AttentionStripProps) {
  const router = useRouter();
  const visible = items.filter((i) => i.count > 0);

  if (loading || visible.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Needs Attention
      </h2>
      <motion.div
        className="flex flex-wrap gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        {visible.map((item) => {
          const Icon = getIcon(item.key);
          return (
            <button
              key={item.key}
              onClick={() => router.push(item.href || "/system/attention")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                severityStyle(item.severity)
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span>{item.count}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          );
        })}
      </motion.div>
    </div>
  );
}
