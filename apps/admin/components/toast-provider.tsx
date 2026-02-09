"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";

type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  createdAt: number;
  ttlMs: number;
};

type ToastApi = {
  push: (t: { kind: ToastKind; title: string; message?: string; ttlMs?: number }) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

function rid() {
  try {
    return globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as Crypto).randomUUID()
      : `t_${Math.random().toString(16).slice(2)}`;
  } catch {
    return `t_${Math.random().toString(16).slice(2)}`;
  }
}

export function ToastProvider(props: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: { kind: ToastKind; title: string; message?: string; ttlMs?: number }) => {
      const toast: Toast = {
        id: rid(),
        kind: t.kind,
        title: t.title,
        message: t.message,
        createdAt: Date.now(),
        ttlMs: Math.max(1500, Math.min(15000, Math.floor(t.ttlMs ?? 4500)))
      };
      setToasts((prev) => [toast, ...prev].slice(0, 4));
      window.setTimeout(() => remove(toast.id), toast.ttlMs);
    },
    [remove]
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, message) => push({ kind: "success", title, message }),
      error: (title, message) => push({ kind: "error", title, message, ttlMs: 8000 }),
      info: (title, message) => push({ kind: "info", title, message })
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {props.children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] w-[360px] max-w-[calc(100vw-2rem)] space-y-2">
        {toasts.map((t) => {
          const tone =
            t.kind === "success"
              ? "border-success/25 bg-success/10"
              : t.kind === "error"
                ? "border-danger/25 bg-danger/10"
                : "border-border bg-bg-elevated";
          return (
            <div
              key={t.id}
              role="status"
              aria-live="polite"
              className={cn(
                "pointer-events-auto overflow-hidden rounded-lg border shadow-sm backdrop-blur-sm",
                "animate-in fade-in slide-in-from-top-1 duration-200",
                tone
              )}
            >
              <div className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{t.title}</div>
                  {t.message ? (
                    <div className="mt-0.5 text-xs text-fg-muted">{t.message}</div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-fg-subtle hover:text-foreground"
                  onClick={() => remove(t.id)}
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Safe fallback for tests/edge cases.
    return {
      push: () => {},
      success: () => {},
      error: () => {},
      info: () => {}
    };
  }
  return ctx;
}

