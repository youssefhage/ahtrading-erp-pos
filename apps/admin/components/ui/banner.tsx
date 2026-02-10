"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
  ShieldAlert
} from "lucide-react";

import { cn } from "@/lib/utils";

export type BannerVariant =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "progress";

export function Banner(props: {
  variant?: BannerVariant;
  size?: "sm" | "md";
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  role?: "status" | "alert";
  icon?: React.ReactNode;
}) {
  const variant = props.variant ?? "neutral";
  const size = props.size ?? "md";

  const Icon =
    variant === "progress"
      ? Loader2
      : variant === "danger"
        ? AlertCircle
        : variant === "warning"
          ? ShieldAlert
          : variant === "success"
            ? CheckCircle2
            : variant === "info"
              ? Info
              : Info;

  const toneClasses =
    variant === "danger"
      ? "border-danger/25 bg-danger/5"
      : variant === "warning"
        ? "border-warning/25 bg-warning/5"
        : variant === "success"
          ? "border-success/25 bg-success/5"
          : variant === "info"
            ? "border-info/25 bg-info/5"
            : "border-border-subtle bg-bg-elevated/70";

  const stripeClasses =
    variant === "danger"
      ? "bg-danger"
      : variant === "warning"
        ? "bg-warning"
        : variant === "success"
          ? "bg-success"
          : variant === "info"
            ? "bg-info"
            : "bg-border-strong";

  const iconClasses =
    variant === "danger"
      ? "text-danger"
      : variant === "warning"
        ? "text-warning"
        : variant === "success"
          ? "text-success"
          : variant === "info"
            ? "text-info"
            : "text-fg-muted";

  const iconWrapClasses =
    variant === "danger"
      ? "bg-danger/10 border-danger/20"
      : variant === "warning"
        ? "bg-warning/10 border-warning/20"
        : variant === "success"
          ? "bg-success/10 border-success/20"
          : variant === "info"
            ? "bg-info/10 border-info/20"
            : "bg-bg-elevated/70 border-border-subtle";

  const rootPad = size === "sm" ? "px-3 py-2" : "px-3 py-3";
  const iconBox = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const titleSize = size === "sm" ? "text-[13px] leading-5" : "text-sm leading-5";
  const descSize = size === "sm" ? "text-xs leading-4" : "text-sm leading-5";

  const role =
    props.role ?? (variant === "danger" ? "alert" : "status");

  return (
    <div
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      className={cn(
        "relative overflow-hidden rounded-lg border text-foreground shadow-sm",
        "animate-fade-in",
        rootPad,
        toneClasses,
        props.className
      )}
      data-variant={variant}
    >
      <div className={cn("absolute left-0 top-0 h-full w-1", stripeClasses)} />

      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5 flex items-center justify-center rounded-md border", iconBox, iconWrapClasses)}>
          {props.icon ?? (
            <Icon
              className={cn(
                "h-5 w-5",
                iconClasses,
                variant === "progress" && "animate-spin"
              )}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className={cn("font-semibold text-foreground", titleSize)}>
                  {props.title}
                </div>
                {props.badge ? (
                  <div className="shrink-0">{props.badge}</div>
                ) : null}
              </div>
              {props.description ? (
                <div className={cn("mt-0.5 text-fg-muted", descSize)}>
                  {props.description}
                </div>
              ) : null}
            </div>

            {props.actions ? (
              <div className="flex flex-wrap items-center gap-2">
                {props.actions}
              </div>
            ) : null}
          </div>

          {props.children ? (
            <div className={cn(size === "sm" ? "mt-2" : "mt-2.5")}>
              {props.children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
