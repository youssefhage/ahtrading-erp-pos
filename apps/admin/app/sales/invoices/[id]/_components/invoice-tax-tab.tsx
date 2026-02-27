"use client";

import {
  VatBreakdownPanel,
  type VatItemAttributionRow,
  type VatRateRow,
  type VatRawTaxLine,
  type VatSummaryModel,
} from "../../_components/vat-breakdown-panel";

/* -------------------------------------------------------------------------- */
/*  Props                                                                     */
/* -------------------------------------------------------------------------- */

export interface InvoiceTaxTabProps {
  summary: VatSummaryModel;
  rateRows: VatRateRow[];
  itemRows: VatItemAttributionRow[];
  rawTaxLines: VatRawTaxLine[];
  settlementCurrency: "USD" | "LBP" | undefined;
  previewNote: string | null;
  emptyText: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function InvoiceTaxTab({
  summary,
  rateRows,
  itemRows,
  rawTaxLines,
  settlementCurrency,
  previewNote,
  emptyText,
}: InvoiceTaxTabProps) {
  return (
    <VatBreakdownPanel
      summary={summary}
      rateRows={rateRows}
      itemRows={itemRows}
      rawTaxLines={rawTaxLines}
      settlementCurrency={settlementCurrency}
      defaultItemAttributionOpen={rateRows.filter((r) => Number(r.ratePct || 0) > 0).length > 1}
      previewNote={previewNote}
      emptyText={emptyText}
    />
  );
}
