"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, ClipboardCopy, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function safeStringify(v: unknown) {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function ViewRaw(props: {
  value: unknown;
  className?: string;
  defaultOpen?: boolean;
  label?: string;
  downloadName?: string;
}) {
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const raw = useMemo(() => safeStringify(props.value), [props.value]);
  const lines = useMemo(() => raw.split("\n"), [raw]);
  const label = props.label || "View raw";
  const downloadName = props.downloadName || "raw.json";

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  function downloadRaw() {
    if (!raw) return;
    const blob = new Blob([raw], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className={cn("space-y-2", props.className)}>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 px-2.5 text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {open ? "Hide raw" : label}
      </Button>
      {open ? (
        <div className="rounded-md border border-border-subtle bg-bg-sunken/60">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-2 py-1">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2.5 text-sm"
                onClick={copyRaw}
                title={copied ? "Copied to clipboard" : "Copy JSON"}
              >
                {copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
                <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
              </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 text-sm"
            onClick={() => setWrap((v) => !v)}
            title={wrap ? "Disable line wrap" : "Enable line wrap"}
          >
            {wrap ? "No wrap" : "Wrap"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 text-sm"
            onClick={downloadRaw}
            title="Download JSON"
          >
            <Download className="h-4 w-4" />
            <span className="ml-1">Download</span>
          </Button>
        </div>
        <span className="text-sm text-fg-subtle">{lines.length} lines</span>
      </div>
          <div className={cn("max-h-96 overflow-auto p-3 text-sm leading-6 text-fg-muted", wrap ? "whitespace-pre-wrap" : "whitespace-pre")}>
            {lines.map((line, idx) => (
              <div key={idx} className="grid min-h-5 grid-cols-[2rem_1fr] gap-2">
                <span className="select-none text-right text-fg-subtle">{String(idx + 1).padStart(3, "0")}</span>
                <pre className={cn("min-h-5 tabular-nums font-mono", wrap ? "whitespace-pre-wrap" : "whitespace-pre")}>{line || " "}</pre>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
