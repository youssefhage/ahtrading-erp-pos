"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function MoneyInput(props: {
  label: string;
  currency: "USD" | "LBP";
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  quick?: Array<number | string>;
  className?: string;
}) {
  const quick = useMemo(() => props.quick || [], [props.quick]);
  return (
    <div className={cn("space-y-1", props.className)}>
      <label className="text-sm font-medium text-fg-muted">{props.label}</label>
      <div className="flex">
        <span className="inline-flex h-10 items-center rounded-l-md border border-border bg-bg-sunken px-2 text-sm font-semibold text-fg-muted">
          {props.currency}
        </span>
        <Input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          disabled={props.disabled}
          inputMode="decimal"
          className="rounded-l-none border-l-0"
        />
      </div>
      {quick.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {quick.map((q) => (
            <Button
              key={String(q)}
              type="button"
              variant="outline"
              size="sm"
              disabled={props.disabled}
              onClick={() => props.onChange(String(q))}
            >
              {String(q)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
