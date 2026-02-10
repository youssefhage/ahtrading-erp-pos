"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { X } from "lucide-react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";

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
          const variant =
            t.kind === "success" ? "success" : t.kind === "error" ? "danger" : "info";
          return (
            <div
              key={t.id}
            >
              <Banner
                role="status"
                size="sm"
                variant={variant}
                title={t.title}
                description={t.message}
                className="pointer-events-auto backdrop-blur-sm animate-in fade-in slide-in-from-top-1 duration-200"
                actions={
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
                }
              />
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
