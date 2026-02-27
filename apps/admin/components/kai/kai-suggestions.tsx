"use client";

import { motion } from "motion/react";

import { cn } from "@/lib/utils";

interface KaiSuggestionsProps {
  suggestions: string[];
  onSelect: (query: string) => void;
  disabled?: boolean;
}

export function KaiSuggestions({
  suggestions,
  onSelect,
  disabled,
}: KaiSuggestionsProps) {
  if (!suggestions.length) return null;

  return (
    <div className="flex gap-1.5 overflow-x-auto py-1 scrollbar-none">
      {suggestions.map((s, i) => (
        <motion.button
          key={s}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15, delay: i * 0.03 }}
          onClick={() => onSelect(s)}
          disabled={disabled}
          className={cn(
            "shrink-0 rounded-full border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground",
            "transition-colors hover:bg-accent hover:text-foreground",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "whitespace-nowrap"
          )}
        >
          {s}
        </motion.button>
      ))}
    </div>
  );
}
