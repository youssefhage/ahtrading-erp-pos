"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

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
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {open ? "Hide raw" : props.label || "View raw"}
      </Button>
      {open ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-bg-sunken/60 p-3 text-[11px] leading-4 text-fg-muted">
          {raw}
        </pre>
      ) : null}
    </div>
  );
}
