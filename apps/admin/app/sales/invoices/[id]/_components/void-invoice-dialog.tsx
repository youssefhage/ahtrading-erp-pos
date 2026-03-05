"use client";

import { useEffect, useState } from "react";

import { apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* -------------------------------------------------------------------------- */
/*  Void Posted Invoice Dialog                                                */
/* -------------------------------------------------------------------------- */

export interface VoidInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  onVoided: () => void;
  onError: (msg: string) => void;
  onSuggestReturn?: () => void;
}

export function VoidInvoiceDialog({ open, onOpenChange, invoiceId, onVoided, onError, onSuggestReturn }: VoidInvoiceDialogProps) {
  const [cancelDate, setCancelDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => { if (open) setLocalError(null); }, [open]);

  const hasPaymentError = localError?.toLowerCase().includes("cannot cancel") && localError?.toLowerCase().includes("payment");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCanceling(true);
    setLocalError(null);
    try {
      await apiPost(`/sales/invoices/${invoiceId}/cancel`, {
        cancel_date: cancelDate || undefined,
        reason: cancelReason || undefined,
      });
      onOpenChange(false);
      onVoided();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("cannot cancel") && message.toLowerCase().includes("payment")) {
        setLocalError(message);
      } else {
        onError(message);
      }
    } finally {
      setCanceling(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Void Sales Invoice</DialogTitle>
          <DialogDescription>
            This will reverse stock moves, VAT tax lines, and GL entries. It is blocked if payments or posted returns exist.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div className="space-y-1 md:col-span-3">
            <label className="text-xs font-medium text-muted-foreground">Void Date</label>
            <Input type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
          </div>
          <div className="space-y-1 md:col-span-6">
            <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
            <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="customer error / duplicate / correction" />
          </div>
          {hasPaymentError && (
            <div className="md:col-span-6 rounded-md border border-orange-300/50 bg-orange-50 dark:border-orange-500/25 dark:bg-orange-950/20 p-3 text-sm">
              <p className="font-medium text-foreground">This invoice has payments</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Posted invoices with payments cannot be voided directly.
                Create a return or credit note instead to reverse stock and GL.
              </p>
              {onSuggestReturn && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    onOpenChange(false);
                    setLocalError(null);
                    onSuggestReturn();
                  }}
                >
                  Create Return Instead
                </Button>
              )}
            </div>
          )}
          <div className="md:col-span-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" variant="destructive" disabled={canceling}>
              {canceling ? "Voiding..." : "Void Invoice"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Cancel Draft Invoice Dialog                                               */
/* -------------------------------------------------------------------------- */

export interface CancelDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  onCanceled: () => void;
  onError: (msg: string) => void;
}

export function CancelDraftDialog({ open, onOpenChange, invoiceId, onCanceled, onError }: CancelDraftDialogProps) {
  const [reason, setReason] = useState("");
  const [canceling, setCanceling] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCanceling(true);
    try {
      await apiPost(`/sales/invoices/${invoiceId}/cancel-draft`, { reason: reason || undefined });
      onOpenChange(false);
      onCanceled();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onError(message);
    } finally {
      setCanceling(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Cancel Draft Invoice</DialogTitle>
          <DialogDescription>This will mark the draft as canceled. No stock or GL will be posted.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" variant="destructive" disabled={canceling}>
              {canceling ? "Canceling..." : "Cancel Draft"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Print Preview Dialog                                                      */
/* -------------------------------------------------------------------------- */

export interface PrintPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
}

export function PrintPreviewDialog({ open, onOpenChange, invoiceId }: PrintPreviewDialogProps) {
  const [template, setTemplate] = useState("official_classic");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl" style={{ height: "85vh", display: "flex", flexDirection: "column" }}>
        <DialogHeader>
          <DialogTitle>Print Preview</DialogTitle>
          <DialogDescription>Preview how this invoice looks with different templates.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 pb-2">
          {([
            ["official_classic", "Official Classic"],
            ["official_compact", "Official Compact"],
            ["standard", "Standard"],
          ] as const).map(([key, label]) => (
            <Button key={key} variant={template === key ? "default" : "outline"} size="sm" onClick={() => setTemplate(key)}>
              {label}
            </Button>
          ))}
        </div>
        <iframe
          key={template}
          src={`/exports/sales-invoices/${encodeURIComponent(invoiceId)}/pdf?inline=1&template=${encodeURIComponent(template)}`}
          className="flex-1 w-full rounded border border-border"
          title="Invoice PDF Preview"
        />
      </DialogContent>
    </Dialog>
  );
}
