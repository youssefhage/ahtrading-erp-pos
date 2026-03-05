"use client";

import { useState } from "react";

import { apiPost } from "@/lib/api";
import { fmtUsd, fmtLbp } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function formatMethodLabel(method: string) {
  const s = String(method || "").trim();
  if (!s) return "";
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/* -------------------------------------------------------------------------- */
/*  Props                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceTotal: { usd: number; lbp: number };
  settlementCurrency: string;
  lineCount: number;
  methodChoices: string[];
  onCreated: () => void;
  onError: (msg: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function CreateReturnDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceTotal,
  settlementCurrency,
  lineCount,
  methodChoices,
  onCreated,
  onError,
}: CreateReturnDialogProps) {
  const [refundMethod, setRefundMethod] = useState("credit");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const allMethods = Array.from(new Set(["credit", ...methodChoices]));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiPost(`/sales/invoices/${invoiceId}/create-return`, {
        refund_method: refundMethod || undefined,
        reason: reason || undefined,
      });
      onOpenChange(false);
      onCreated();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const settle = String(settlementCurrency || "USD").toUpperCase();
  const primaryTotal = settle === "LBP" ? fmtLbp(invoiceTotal.lbp) : fmtUsd(invoiceTotal.usd);
  const secondaryTotal = settle === "LBP" ? fmtUsd(invoiceTotal.usd) : fmtLbp(invoiceTotal.lbp);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create Return / Credit Note</DialogTitle>
          <DialogDescription>
            This will create a full return for all {lineCount} item(s) on this invoice,
            reversing stock moves, VAT tax lines, and GL entries.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-6">
          {/* Invoice total info */}
          <div className="md:col-span-6 rounded-md border border-border bg-muted/25 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Invoice total:</span>{" "}
            <span className="font-medium">{primaryTotal}</span>{" "}
            <span className="text-muted-foreground">/ {secondaryTotal}</span>
          </div>

          {/* Refund method */}
          <div className="space-y-1 md:col-span-3">
            <label className="text-xs font-medium text-muted-foreground">Refund Method</label>
            <select
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {allMethods.map((m) => (
                <option key={m} value={m}>
                  {formatMethodLabel(m)}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3" />

          {/* Reason */}
          <div className="space-y-1 md:col-span-6">
            <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="customer return / defective / correction"
            />
          </div>

          {/* Actions */}
          <div className="md:col-span-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create Return"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
