"use client";

import Link from "next/link";
import { Bot, ExternalLink, User } from "lucide-react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import type { KaiMessage as KaiMessageType } from "@/lib/hooks/use-kai";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function KaiMessage({ msg }: { msg: KaiMessageType }) {
  const isUser = msg.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          isUser
            ? "bg-primary/10 text-primary"
            : "bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1 rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted/60 text-foreground rounded-bl-sm"
        )}
      >
        <div className="whitespace-pre-wrap break-words">
          {msg.content}
          {/* Streaming cursor */}
          {msg.isStreaming && (
            <span className="inline-block ml-0.5 w-[2px] h-[14px] bg-foreground/60 animate-pulse align-text-bottom" />
          )}
        </div>

        {/* Action card */}
        {msg.action && msg.action.type === "navigate" && (
          <Link
            href={msg.action.href}
            className="mt-1.5 flex items-center gap-2 rounded-lg border bg-background/50 px-3 py-2 text-[12px] font-medium text-primary transition-colors hover:bg-accent"
          >
            <ExternalLink className="h-3 w-3" />
            <span>{msg.action.label || "Open page"}</span>
          </Link>
        )}

        {/* Timestamp */}
        <span
          className={cn(
            "text-[10px] mt-0.5",
            isUser ? "text-primary-foreground/50" : "text-muted-foreground/50"
          )}
        >
          {formatTime(msg.createdAt)}
        </span>
      </div>
    </motion.div>
  );
}
