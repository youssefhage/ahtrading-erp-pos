"use client";

import { Button } from "@/components/ui/button";

export function EmptyState(props: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-sunken/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-foreground">{props.title}</div>
          {props.description ? <div className="mt-1 text-sm text-fg-muted">{props.description}</div> : null}
        </div>

        {props.actionLabel && props.onAction ? (
          <Button type="button" onClick={props.onAction}>
            {props.actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
