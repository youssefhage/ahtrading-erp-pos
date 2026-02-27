"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useKaiStore } from "@/lib/hooks/use-kai";

export function KaiFab() {
  const { isOpen, toggle } = useKaiStore();

  // Cmd+J shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "j" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggle]);

  return (
    <motion.button
      onClick={toggle}
      className={cn(
        "fixed bottom-6 right-6 z-40",
        "flex h-12 w-12 items-center justify-center rounded-full",
        "bg-gradient-to-br from-primary to-primary/80",
        "text-primary-foreground shadow-lg",
        "transition-shadow hover:shadow-xl",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
      )}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label={isOpen ? "Close Kai" : "Open Kai — AI Assistant"}
      title="Kai — AI Assistant (⌘J)"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isOpen ? (
          <motion.div
            key="close"
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <X className="h-5 w-5" />
          </motion.div>
        ) : (
          <motion.div
            key="sparkle"
            initial={{ rotate: 90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: -90, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Sparkles className="h-5 w-5" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subtle glow when closed */}
      {!isOpen && (
        <span className="absolute inset-0 rounded-full animate-kai-glow pointer-events-none" />
      )}
    </motion.button>
  );
}
