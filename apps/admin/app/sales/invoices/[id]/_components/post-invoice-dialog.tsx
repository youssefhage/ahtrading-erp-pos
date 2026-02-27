"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { parseNumberInput } from "@/lib/numbers";
import { fmtUsdLbp } from "@/lib/money";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
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

export interface PostInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceStatus: string;
  lineCount: number;
  exchangeRate: number;
  customerId: string | null;
  methodChoices: string[];
  hasPaymentMethodMappings: boolean;
  onPosted: () => void;
  onError: (msg: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function PostInvoiceDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceStatus,
  lineCount,
  exchangeRate,
  customerId,
  methodChoices,
  hasPaymentMethodMappings,
  onPosted,
  onError,
}: PostInvoiceDialogProps) {
  const [applyingVat, setApplyingVat] = useState(true);
  const [vatAdvancedOpen, setVatAdvancedOpen] = useState(false);
  const [recordPayment, setRecordPayment] = useState(false);
  const [method, setMethod] = useState(methodChoices[0] || "");
  const [postUsd, setPostUsd] = useState("0");
  const [postLbp, setPostLbp] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<{ total_usd: number; total_lbp: number; tax_usd: number; tax_lbp: number } | null>(null);

  /* ---- Reset on open ---- */
  useEffect(() => {
    if (open) {
      setApplyingVat(true);
      setVatAdvancedOpen(false);
      setRecordPayment(false);
      setMethod(methodChoices[0] || "");
      setPostUsd("0");
      setPostLbp("0");
      setSubmitting(false);
      // Fetch preview
      apiGet<{ total_usd: string | number; total_lbp: string | number; tax_usd: string | number; tax_lbp: string | number }>(
        `/sales/invoices/${invoiceId}/post-preview?apply_vat=1`
      )
        .then((prev) =>
          setPreview({
            total_usd: Number(prev.total_usd || 0),
            total_lbp: Number(prev.total_lbp || 0),
            tax_usd: Number(prev.tax_usd || 0),
            tax_lbp: Number(prev.tax_lbp || 0),
          })
        )
        .catch(() => setPreview(null));
    }
  }, [open, invoiceId, methodChoices]);

  /* ---- Sync method choice ---- */
  useEffect(() => {
    if (!methodChoices.length) {
      if (recordPayment) setRecordPayment(false);
      if (method) setMethod("");
      return;
    }
    if (!methodChoices.includes(String(method || "").trim().toLowerCase())) {
      setMethod(methodChoices[0]);
    }
  }, [methodChoices, method, recordPayment]);

  /* ---- Checklist ---- */
  const checklist = useMemo(() => {
    const blocking: string[] = [];
    const warnings: string[] = [];

    if (!lineCount) blocking.push("Add at least one line.");
    if (exchangeRate <= 0) blocking.push("Exchange rate is missing (USD→LL).");

    if (recordPayment) {
      if (!hasPaymentMethodMappings) {
        blocking.push("Payment methods are not configured.");
      }
      const usd = parseNumberInput(postUsd);
      const lbp = parseNumberInput(postLbp);
      if ((!usd.ok && usd.reason === "invalid") || (!lbp.ok && lbp.reason === "invalid")) {
        blocking.push("Payment amount is invalid.");
      }
      const paid = (usd.ok ? usd.value : 0) + (lbp.ok ? lbp.value : 0);
      if (paid > 0 && !customerId) {
        warnings.push("Walk-in + payment is ok, but credit/partial settlements are safer with a customer.");
      }
    }

    return { blocking, warnings };
  }, [lineCount, exchangeRate, recordPayment, hasPaymentMethodMappings, postUsd, postLbp, customerId]);

  /* ---- Refresh preview ---- */
  const refreshPreview = useCallback(
    async (applyVat: boolean) => {
      try {
        const prev = await apiGet<{ total_usd: string | number; total_lbp: string | number; tax_usd: string | number; tax_lbp: string | number }>(
          `/sales/invoices/${invoiceId}/post-preview?apply_vat=${applyVat ? "1" : "0"}`
        );
        setPreview({
          total_usd: Number(prev.total_usd || 0),
          total_lbp: Number(prev.total_lbp || 0),
          tax_usd: Number(prev.tax_usd || 0),
          tax_lbp: Number(prev.tax_lbp || 0),
        });
      } catch {
        setPreview(null);
      }
    },
    [invoiceId]
  );

  /* ---- Submit ---- */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invoiceStatus !== "draft") return;

    let usd = 0;
    let lbp = 0;
    if (recordPayment) {
      const usdRes = parseNumberInput(postUsd);
      const lbpRes = parseNumberInput(postLbp);
      if (!usdRes.ok && usdRes.reason === "invalid") return onError("Invalid payment USD amount.");
      if (!lbpRes.ok && lbpRes.reason === "invalid") return onError("Invalid payment LL amount.");
      usd = usdRes.ok ? usdRes.value : 0;
      lbp = lbpRes.ok ? lbpRes.value : 0;
    }
    const pay = !recordPayment || (usd === 0 && lbp === 0) ? [] : [{ method, amount_usd: usd, amount_lbp: lbp }];
    const applyVat = vatAdvancedOpen ? applyingVat : true;

    setSubmitting(true);
    try {
      await apiPost(`/sales/invoices/${invoiceId}/post`, { apply_vat: applyVat, payments: pay });
      onOpenChange(false);
      onPosted();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Post Draft Invoice</DialogTitle>
          <DialogDescription>Posting writes stock moves + GL. You can optionally record a payment now.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-6">
          {/* Checklist */}
          <div className="md:col-span-6 rounded-md border bg-muted/25 p-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium text-foreground">Posting checklist</div>
              <div className="text-xs text-muted-foreground">
                Hotkeys: <span className="ui-kbd">⌘</span>+<span className="ui-kbd">Enter</span> post,{" "}
                <span className="ui-kbd">⌘</span>+<span className="ui-kbd">P</span> print
              </div>
            </div>
            <div className="mt-2 space-y-1">
              {checklist.blocking.length ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
                  <div className="font-medium">Blocking</div>
                  <ul className="mt-1 list-disc pl-4">
                    {checklist.blocking.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-md border bg-card/60 p-2 text-muted-foreground">Ready to post.</div>
              )}
              {checklist.warnings.length ? (
                <div className="rounded-md border bg-card/60 p-2">
                  <div className="font-medium text-foreground">Warnings</div>
                  <ul className="mt-1 list-disc pl-4">
                    {checklist.warnings.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          {/* VAT mode */}
          <div className="md:col-span-6 rounded-md border bg-card/60 p-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span>VAT mode</span>
              <span className="font-medium text-foreground">Automatic</span>
            </div>
            <p className="mt-1">VAT is applied by default using item tax codes and company VAT settings.</p>
            {!vatAdvancedOpen ? (
              <button
                type="button"
                className="mt-2 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setVatAdvancedOpen(true)}
              >
                Change VAT behavior (advanced)
              </button>
            ) : (
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={applyingVat}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setApplyingVat(next);
                    refreshPreview(next);
                  }}
                />
                Apply VAT from company tax codes
              </label>
            )}
          </div>

          {/* Record payment toggle */}
          <label className="md:col-span-6 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={recordPayment}
              disabled={!hasPaymentMethodMappings}
              onChange={(e) => {
                const next = e.target.checked;
                setRecordPayment(next);
                if (!next) {
                  setPostUsd("0");
                  setPostLbp("0");
                  setMethod(methodChoices[0] || "");
                }
              }}
            />
            Record a payment now (otherwise invoice remains unpaid/credit)
          </label>

          {/* Preview */}
          {preview ? (
            <div className="md:col-span-6 rounded-md border bg-card/60 p-3 text-xs text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span>VAT</span>
                <span className="data-mono">{fmtUsdLbp(preview.tax_usd, preview.tax_lbp)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span>Total</span>
                <span className="data-mono">{fmtUsdLbp(preview.total_usd, preview.total_lbp)}</span>
              </div>
            </div>
          ) : (
            <div className="md:col-span-6 text-xs text-muted-foreground">
              Tip: If you post without paying the full amount, the remaining balance becomes credit and requires a customer.
            </div>
          )}

          {/* Payment fields */}
          {recordPayment ? (
            <>
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-muted-foreground">Payment Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={!hasPaymentMethodMappings}>
                  {!methodChoices.length ? <option value="">(no methods)</option> : null}
                  {methodChoices.map((m) => (
                    <option key={m} value={m}>
                      {formatMethodLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
              {!hasPaymentMethodMappings ? (
                <div className="md:col-span-6 text-xs text-warning">
                  No payment methods are configured. Add one in System Config to record payment at posting.
                </div>
              ) : null}
              <MoneyInput label="Amount" currency="USD" value={postUsd} onChange={setPostUsd} quick={[0, 1, 10, 100]} className="md:col-span-3" />
              <MoneyInput
                label="Amount"
                currency="LBP"
                displayCurrency="LL"
                value={postLbp}
                onChange={setPostLbp}
                quick={[0, 100000, 500000, 1000000]}
                className="md:col-span-3"
              />
            </>
          ) : null}

          <div className="md:col-span-6 flex justify-end">
            <Button type="submit" disabled={submitting || checklist.blocking.length > 0}>
              {submitting ? "Posting..." : "Post Invoice"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
