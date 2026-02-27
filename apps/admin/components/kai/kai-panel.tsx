"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Bot, RotateCcw, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { useKaiStore, kaiAsk, getSuggestionsForPath } from "@/lib/hooks/use-kai";
import { KaiMessage } from "./kai-message";
import { KaiSuggestions } from "./kai-suggestions";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ------------------------------------------------------------------ */
/*  Thinking indicator                                                 */
/* ------------------------------------------------------------------ */

function ThinkingDots() {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex items-center gap-1 rounded-xl bg-muted/60 px-3.5 py-2.5 rounded-bl-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Kai Panel                                                          */
/* ------------------------------------------------------------------ */

export function KaiPanel() {
  const pathname = usePathname() || "/dashboard";
  const { isOpen, messages, isThinking, close, clear } = useKaiStore();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = getSuggestionsForPath(pathname);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, close]);

  const { dispatch } = useKaiStore();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const q = input.trim();
      if (!q || isThinking) return;
      setInput("");
      kaiAsk(dispatch, q, { page: pathname });
    },
    [input, isThinking, pathname, dispatch]
  );

  const handleSuggestion = useCallback(
    (q: string) => {
      if (isThinking) return;
      setInput("");
      kaiAsk(dispatch, q, { page: pathname });
    },
    [isThinking, pathname, dispatch]
  );

  // Current page context label
  const pageLabel = (() => {
    const parts = pathname.split("/").filter(Boolean);
    return parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : "Dashboard";
  })();

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className={cn(
            "fixed bottom-20 right-6 z-40",
            "flex w-[420px] max-h-[70vh] flex-col",
            "rounded-2xl shadow-2xl kai-glass",
            "overflow-hidden"
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold leading-tight">Kai</h2>
              <p className="text-[11px] text-muted-foreground truncate">
                AI Assistant — {pageLabel}
              </p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clear}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:text-muted-foreground hover:bg-muted"
                title="Clear conversation"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Suggestions (when no messages) */}
          {messages.length === 0 && (
            <div className="px-4 pt-3">
              <p className="text-[11px] text-muted-foreground mb-2">
                Suggestions for {pageLabel}
              </p>
              <KaiSuggestions
                suggestions={suggestions}
                onSelect={handleSuggestion}
                disabled={isThinking}
              />
            </div>
          )}

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[120px]"
          >
            {messages.map((msg) => (
              <KaiMessage key={msg.id} msg={msg} />
            ))}
            {isThinking &&
              messages[messages.length - 1]?.role !== "assistant" && (
                <ThinkingDots />
              )}
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t px-3 py-2.5"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Kai anything..."
              disabled={isThinking}
              className={cn(
                "flex-1 bg-transparent text-[13px] placeholder:text-muted-foreground/50",
                "outline-none disabled:opacity-50"
              )}
            />
            <button
              type="submit"
              disabled={!input.trim() || isThinking}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                "bg-primary text-primary-foreground",
                "transition-all",
                "disabled:opacity-30 disabled:cursor-not-allowed",
                "hover:bg-primary/90"
              )}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
