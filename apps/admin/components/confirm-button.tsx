"use client";

import { useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ConfirmButton(
  props: Omit<ButtonProps, "onClick"> & {
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: ButtonProps["variant"];
    onConfirm: () => Promise<void> | void;
    onError?: (err: unknown) => void;
  }
) {
  const {
    title,
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    confirmVariant = "default",
    onConfirm,
    onError,
    disabled,
    children,
    ...buttonProps
  } = props;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  async function runConfirm() {
    if (busy) return;
    setBusy(true);
    setLocalError("");
    try {
      await onConfirm();
      setOpen(false);
    } catch (err) {
      onError?.(err);
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        setOpen(v);
        if (v) setLocalError("");
      }}
    >
      <DialogTrigger asChild>
        <Button {...buttonProps} disabled={disabled || busy}>
          {children}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {localError ? (
          <div className="rounded-md border border-border-strong bg-bg-sunken/20 p-3 text-sm text-fg-subtle">
            {localError}
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            {cancelText}
          </Button>
          <Button type="button" variant={confirmVariant} onClick={runConfirm} disabled={busy}>
            {busy ? "..." : confirmText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

