"use client";

import { useMemo, useState } from "react";
import { Copy, RotateCw } from "lucide-react";

import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Banner, type BannerVariant } from "@/components/ui/banner";
import { Chip, type ChipVariant } from "@/components/ui/chip";
import { ViewRaw } from "@/components/view-raw";

type Tone = "danger" | "warning" | "info" | "success" | "neutral" | "progress";

function classify(err: unknown): { title: string; hint?: string; status?: number; raw?: unknown; tone: Tone } {
  if (typeof err === "string") {
    const s = err.trim();
    if (!s) return { title: "Something went wrong", hint: "", raw: err, tone: "danger" };
    const m = /^HTTP\s+(\d{3})\s*:\s*(.*)$/.exec(s);
    if (m) {
      const st = Number(m[1]);
      const msg = (m[2] || "").trim();
      if (st === 401) return { title: "Signed out", hint: "Please sign in again.", status: st, raw: s, tone: "warning" };
      if (st === 403) return { title: "Permission missing", hint: "You may not have access to this action.", status: st, raw: s, tone: "warning" };
      if (st === 409) return { title: "Conflict", hint: msg || "This change conflicts with existing data.", status: st, raw: s, tone: "warning" };
      if (st === 422) return { title: "Invalid input", hint: msg || "Please check the fields and try again.", status: st, raw: s, tone: "warning" };
      return {
        title: "Request failed",
        hint: msg || "Please retry. If it keeps failing, share the details with support.",
        status: st,
        raw: s,
        tone: "danger"
      };
    }

    // If the page uses a single `status` string for progress, keep it gentle.
    if (/\.\.\.$/.test(s) || /^loading\b/i.test(s) || /^saving\b/i.test(s) || /^creating\b/i.test(s) || /^posting\b/i.test(s)) {
      return { title: "Working...", hint: s, raw: s, tone: "progress" };
    }

    return { title: "Notice", hint: s, raw: s, tone: "info" };
  }
  if (err instanceof ApiError) {
    const st = err.status;
    if (st === 401) return { title: "Signed out", hint: "Please sign in again.", status: st, raw: err.body ?? err.message, tone: "warning" };
    if (st === 403) return { title: "Permission missing", hint: "You may not have access to this action.", status: st, raw: err.body ?? err.message, tone: "warning" };
    if (st === 409) return { title: "Conflict", hint: "This change conflicts with existing data (duplicate or already processed).", status: st, raw: err.body ?? err.message, tone: "warning" };
    if (st === 422) return { title: "Invalid input", hint: "Please check the fields and try again.", status: st, raw: err.body ?? err.message, tone: "warning" };
    return { title: "Request failed", hint: "Please retry. If it keeps failing, share the details with support.", status: st, raw: err.body ?? err.message, tone: "danger" };
  }
  if (err instanceof Error) return { title: "Something went wrong", hint: err.message, raw: String(err.stack || err.message), tone: "danger" };
  return { title: "Something went wrong", hint: String(err || ""), raw: err, tone: "danger" };
}

export function ErrorBanner(props: {
  error: unknown;
  onRetry?: () => void | Promise<void>;
  title?: string;
  className?: string;
}) {
  const meta = useMemo(() => classify(props.error), [props.error]);
  const title = props.title || meta.title;
  const hint = meta.hint || "";
  const [copied, setCopied] = useState(false);

  const tone = meta.tone;
  const chipVariant: ChipVariant =
    tone === "danger"
      ? "danger"
      : tone === "warning"
        ? "warning"
        : tone === "success"
          ? "success"
          : tone === "info"
            ? "primary"
            : "default";

  const rawText = useMemo(() => {
    const v = meta.raw ?? props.error;
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }, [meta.raw, props.error]);

  const variant: BannerVariant = tone === "neutral" ? "neutral" : tone;
  const badge = meta.status ? (
    <Chip variant={chipVariant} className="py-0.5">
      HTTP {meta.status}
    </Chip>
  ) : null;

  const actions = (
    <>
      {props.onRetry && tone !== "progress" ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => props.onRetry?.()}>
          <RotateCw className="h-4 w-4" />
          Retry
        </Button>
      ) : null}

      {tone !== "progress" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(rawText);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              // ignore
            }
          }}
        >
          <Copy className="h-4 w-4" />
          Copy details
        </Button>
      ) : null}

      {copied ? (
        <Chip variant="success" className="py-0.5">
          Copied
        </Chip>
      ) : null}
    </>
  );

  return (
    <Banner
      variant={variant}
      title={title}
      description={hint || "Fix the issue and try again."}
      badge={badge}
      actions={actions}
      className={props.className}
    >
      <ViewRaw value={meta.raw ?? props.error} className="space-y-1" />
    </Banner>
  );
}
