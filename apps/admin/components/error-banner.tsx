"use client";

import { useMemo, useState } from "react";

import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ViewRaw } from "@/components/view-raw";

function classify(err: unknown): { title: string; hint?: string; status?: number; raw?: unknown } {
  if (typeof err === "string") {
    const s = err.trim();
    if (!s) return { title: "Something went wrong", hint: "", raw: err };
    const m = /^HTTP\s+(\d{3})\s*:\s*(.*)$/.exec(s);
    if (m) {
      const st = Number(m[1]);
      const msg = (m[2] || "").trim();
      if (st === 401) return { title: "Signed out", hint: "Please sign in again.", status: st, raw: s };
      if (st === 403) return { title: "Permission missing", hint: "You may not have access to this action.", status: st, raw: s };
      if (st === 409) return { title: "Conflict", hint: msg || "This change conflicts with existing data.", status: st, raw: s };
      if (st === 422) return { title: "Invalid input", hint: msg || "Please check the fields and try again.", status: st, raw: s };
      return {
        title: `Request failed (HTTP ${st})`,
        hint: msg || "Please retry. If it keeps failing, share the details with support.",
        status: st,
        raw: s
      };
    }

    // If the page uses a single `status` string for progress, keep it gentle.
    if (/\.\.\.$/.test(s) || /^loading\b/i.test(s) || /^saving\b/i.test(s) || /^creating\b/i.test(s) || /^posting\b/i.test(s)) {
      return { title: "Working...", hint: s, raw: s };
    }

    return { title: "Notice", hint: s, raw: s };
  }
  if (err instanceof ApiError) {
    const st = err.status;
    if (st === 401) return { title: "Signed out", hint: "Please sign in again.", status: st, raw: err.body ?? err.message };
    if (st === 403) return { title: "Permission missing", hint: "You may not have access to this action.", status: st, raw: err.body ?? err.message };
    if (st === 409) return { title: "Conflict", hint: "This change conflicts with existing data (duplicate or already processed).", status: st, raw: err.body ?? err.message };
    if (st === 422) return { title: "Invalid input", hint: "Please check the fields and try again.", status: st, raw: err.body ?? err.message };
    return { title: `Request failed (HTTP ${st})`, hint: "Please retry. If it keeps failing, share the details with support.", status: st, raw: err.body ?? err.message };
  }
  if (err instanceof Error) return { title: "Something went wrong", hint: err.message, raw: String(err.stack || err.message) };
  return { title: "Something went wrong", hint: String(err || ""), raw: err };
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

  const rawText = useMemo(() => {
    const v = meta.raw ?? props.error;
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }, [meta.raw, props.error]);

  return (
    <Card className={props.className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{hint || "Fix the issue and try again."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {props.onRetry ? (
            <Button type="button" variant="outline" onClick={() => props.onRetry?.()}>
              Retry
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
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
            Copy details
          </Button>
          {copied ? <span className="text-xs text-fg-subtle">Copied</span> : null}
        </div>
        <ViewRaw value={meta.raw ?? props.error} />
      </CardContent>
    </Card>
  );
}
