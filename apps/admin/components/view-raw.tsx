"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function ViewRaw(props: { value: unknown; className?: string; defaultOpen?: boolean; label?: string }) {
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  const raw = useMemo(() => safeStringify(props.value), [props.value]);

  return (
    <div className={cn("space-y-2", props.className)}>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide raw" : props.label || "View raw"}
      </Button>
      {open ? (
        <pre className="whitespace-pre-wrap rounded-md border border-border bg-bg-sunken p-3 text-xs text-fg-muted">{raw}</pre>
      ) : null}
    </div>
  );
}

