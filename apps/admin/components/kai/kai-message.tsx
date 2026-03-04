"use client";

import Link from "next/link";
import { Bot, Check, ExternalLink, ShieldAlert, User, X } from "lucide-react";
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

export function KaiMessage({
  msg,
  onConfirm,
  onReject,
}: {
  msg: KaiMessageType;
  onConfirm?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
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

        {/* Confirmation card */}
        {msg.confirmation && (
          <div className="mt-2 rounded-lg border bg-background/70 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-[11px] font-semibold text-amber-700">
                Action requires confirmation
              </span>
            </div>

            {/* Summary */}
            <div className="px-3 py-2 text-[12px] whitespace-pre-wrap leading-relaxed">
              {msg.confirmation.summary}
            </div>

            {/* Buttons */}
            {msg.confirmation.status === "pending" && (
              <div className="flex gap-2 px-3 py-2 border-t">
                <button
                  onClick={() => onConfirm?.(msg.confirmation!.id)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium",
                    "bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  )}
                >
                  <Check className="h-3 w-3" />
                  Confirm
                </button>
                <button
                  onClick={() => onReject?.(msg.confirmation!.id)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium",
                    "bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  )}
                >
                  <X className="h-3 w-3" />
                  Cancel
                </button>
              </div>
            )}

            {/* Resolved status */}
            {msg.confirmation.status === "confirmed" && (
              <div className="flex items-center gap-1.5 px-3 py-2 border-t text-[11px] text-emerald-600 font-medium">
                <Check className="h-3 w-3" />
                Confirmed — executing...
              </div>
            )}
            {msg.confirmation.status === "rejected" && (
              <div className="flex items-center gap-1.5 px-3 py-2 border-t text-[11px] text-muted-foreground font-medium">
                <X className="h-3 w-3" />
                Cancelled
              </div>
            )}
          </div>
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
