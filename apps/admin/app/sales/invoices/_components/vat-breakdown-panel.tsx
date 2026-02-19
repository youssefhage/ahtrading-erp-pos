"use client";

import { useEffect, useMemo, useState } from "react";

import { fmtUsdLbp } from "@/lib/money";

export type VatMoney = {
  usd: number;
  lbp: number;
};

export type VatSummaryModel = {
  totalTax: VatMoney;
  taxableBase: VatMoney;
  taxCodesCount: number;
  singleRateNote?: string | null;
};

export type VatRateRow = {
  id: string;
  label: string;
  ratePct: number | null;
  effectiveRatePct: number | null;
  taxableBase: VatMoney;
  tax: VatMoney;
  shareOfTotalTaxPct: number | null;
};

export type VatItemAttributionRow = {
  id: string;
  itemLabel: string;
  qty: number;
  net: VatMoney;
  vatRatePct: number | null;
  vat: VatMoney;
  shareOfTotalTaxPct: number | null;
};

export type VatRawTaxLine = {
  id: string;
  label: string;
  ratePct: number | null;
  base: VatMoney;
  tax: VatMoney;
};

export type VatBreakdownPanelProps = {
  summary: VatSummaryModel;
  rateRows: VatRateRow[];
  itemRows: VatItemAttributionRow[];
  rawTaxLines?: VatRawTaxLine[];
  loading?: boolean;
  error?: string | null;
  settlementCurrency?: "USD" | "LBP";
  defaultItemAttributionOpen?: boolean;
  previewNote?: string | null;
  emptyText?: string;
};

function n(v: unknown) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

function fmtPct(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return `${v.toFixed(2)}%`;
}

function moneyRef(m: VatMoney, prefer: "USD" | "LBP") {
  const preferred = prefer === "LBP" ? n(m.lbp) : n(m.usd);
  const fallback = prefer === "LBP" ? n(m.usd) : n(m.lbp);
  return Math.abs(preferred) > 0 ? preferred : fallback;
}

function LoadingState() {
  return (
    <div className="space-y-2">
      <div className="h-14 animate-pulse rounded-lg bg-bg-sunken/35" />
      <div className="h-20 animate-pulse rounded-lg bg-bg-sunken/30" />
      <div className="h-10 animate-pulse rounded-lg bg-bg-sunken/25" />
    </div>
  );
}

export function VatBreakdownPanel({
  summary,
  rateRows,
  itemRows,
  rawTaxLines = [],
  loading = false,
  error = null,
  settlementCurrency = "USD",
  defaultItemAttributionOpen,
  previewNote = null,
  emptyText = "No taxable lines for this invoice",
}: VatBreakdownPanelProps) {
  const autoOpen = useMemo(() => {
    if (typeof defaultItemAttributionOpen === "boolean") return defaultItemAttributionOpen;
    const nonZeroRates = rateRows.filter((r) => Number(r.ratePct || 0) > 0);
    return nonZeroRates.length > 1;
  }, [defaultItemAttributionOpen, rateRows]);

  const [itemOpen, setItemOpen] = useState(autoOpen);

  useEffect(() => {
    setItemOpen(autoOpen);
  }, [autoOpen]);

  const reconciliation = useMemo(() => {
    const itemVat = itemRows.reduce<VatMoney>(
      (acc, r) => ({ usd: acc.usd + n(r.vat.usd), lbp: acc.lbp + n(r.vat.lbp) }),
      { usd: 0, lbp: 0 }
    );
    const rateVat = rateRows.reduce<VatMoney>(
      (acc, r) => ({ usd: acc.usd + n(r.tax.usd), lbp: acc.lbp + n(r.tax.lbp) }),
      { usd: 0, lbp: 0 }
    );
    const totalVat = { usd: n(summary.totalTax.usd), lbp: n(summary.totalTax.lbp) };

    const diffFromItemsUsd = Math.abs(totalVat.usd - itemVat.usd);
    const diffFromItemsLbp = Math.abs(totalVat.lbp - itemVat.lbp);
    const diffFromRatesUsd = Math.abs(totalVat.usd - rateVat.usd);
    const diffFromRatesLbp = Math.abs(totalVat.lbp - rateVat.lbp);

    const tolerance = settlementCurrency === "LBP" ? 1 : 0.01;
    const mainDiff = settlementCurrency === "LBP" ? Math.max(diffFromItemsLbp, diffFromRatesLbp) : Math.max(diffFromItemsUsd, diffFromRatesUsd);
    const mismatch = mainDiff > tolerance;

    return { itemVat, rateVat, totalVat, mismatch };
  }, [itemRows, rateRows, settlementCurrency, summary.totalTax.lbp, summary.totalTax.usd]);

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
        Unable to compute VAT breakdown. Retry.
      </div>
    );
  }

  if (!rateRows.length) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3 text-sm text-fg-subtle">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-1">
            <div className="ui-kv">
              <span className="ui-kv-label">Total VAT</span>
              <span className="ui-kv-value">{fmtUsdLbp(summary.totalTax.usd, summary.totalTax.lbp)}</span>
            </div>
            <div className="ui-kv">
              <span className="ui-kv-label">Taxable base</span>
              <span className="ui-kv-value">{fmtUsdLbp(summary.taxableBase.usd, summary.taxableBase.lbp)}</span>
            </div>
          </div>
          <div className="space-y-1 text-right text-xs text-fg-subtle">
            <div>{summary.taxCodesCount} code(s)</div>
            {summary.singleRateNote ? <div>{summary.singleRateNote}</div> : null}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">VAT by rate</span>
          <span className="text-xs text-fg-subtle">{rateRows.length} rate group(s)</span>
        </div>
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead className="ui-thead">
              <tr>
                <th>VAT Rate</th>
                <th className="text-right">Taxable Base</th>
                <th className="text-right">VAT Amount</th>
                <th className="text-right">% of Total VAT</th>
              </tr>
            </thead>
            <tbody>
              {rateRows.map((r) => (
                <tr key={r.id} className="ui-tr">
                  <td>
                    <div className="data-mono text-sm text-foreground">
                      {r.label}
                      {r.ratePct !== null ? <span className="text-fg-subtle"> · {fmtPct(r.ratePct)}</span> : null}
                      {r.effectiveRatePct !== null ? <span className="text-fg-subtle"> · eff {fmtPct(r.effectiveRatePct)}</span> : null}
                    </div>
                  </td>
                  <td className="text-right data-mono">{fmtUsdLbp(r.taxableBase.usd, r.taxableBase.lbp)}</td>
                  <td className="text-right data-mono">{fmtUsdLbp(r.tax.usd, r.tax.lbp)}</td>
                  <td className="text-right data-mono">{fmtPct(r.shareOfTotalTaxPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="cursor-pointer text-sm font-medium text-fg-muted hover:text-foreground"
            aria-expanded={itemOpen}
            onClick={() => setItemOpen((v) => !v)}
          >
            {itemOpen ? "Hide" : "Show"} item attribution ({itemRows.length} item{itemRows.length === 1 ? "" : "s"})
          </button>
        </div>
        {itemOpen ? (
          <div className="mt-2 ui-table-wrap">
            <table className="ui-table">
              <thead className="ui-thead">
                <tr>
                  <th>Item</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Net Amount</th>
                  <th className="text-right">VAT %</th>
                  <th className="text-right">VAT Amount</th>
                  <th className="text-right">% of Total VAT</th>
                </tr>
              </thead>
              <tbody>
                {itemRows.map((r) => (
                  <tr key={r.id} className="ui-tr">
                    <td className="data-mono">{r.itemLabel}</td>
                    <td className="text-right data-mono">{n(r.qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                    <td className="text-right data-mono">{fmtUsdLbp(r.net.usd, r.net.lbp)}</td>
                    <td className="text-right data-mono">{fmtPct(r.vatRatePct)}</td>
                    <td className="text-right data-mono">{fmtUsdLbp(r.vat.usd, r.vat.lbp)}</td>
                    <td className="text-right data-mono">{fmtPct(r.shareOfTotalTaxPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-fg-subtle">Sum of item VAT</span>
          <span className="data-mono text-foreground">{fmtUsdLbp(reconciliation.itemVat.usd, reconciliation.itemVat.lbp)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-fg-subtle">Sum of rate-group VAT</span>
          <span className="data-mono text-foreground">{fmtUsdLbp(reconciliation.rateVat.usd, reconciliation.rateVat.lbp)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-fg-subtle">Total VAT</span>
          <span className="data-mono text-foreground">{fmtUsdLbp(reconciliation.totalVat.usd, reconciliation.totalVat.lbp)}</span>
        </div>
        {reconciliation.mismatch ? (
          <div className="mt-2 inline-flex rounded border border-warning/50 bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning">
            Calculation mismatch
          </div>
        ) : null}
      </div>

      {previewNote ? <p className="text-xs text-fg-subtle">{previewNote}</p> : null}

      {rawTaxLines.length ? (
        <details className="rounded-lg border border-border-subtle bg-bg-sunken/25 p-3">
          <summary className="cursor-pointer text-xs font-medium text-fg-subtle">Raw tax lines</summary>
          <div className="mt-2 space-y-1">
            {rawTaxLines.map((t) => (
              <div key={t.id} className="rounded-md border border-border-subtle bg-bg-elevated/50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="data-mono text-foreground">
                    {t.label}
                    {t.ratePct !== null ? <span className="text-fg-subtle"> · {fmtPct(t.ratePct)}</span> : null}
                  </span>
                  <span className="data-mono text-foreground">{fmtUsdLbp(t.tax.usd, t.tax.lbp)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-xs text-fg-subtle">Base</span>
                  <span className="data-mono text-xs text-fg-muted">{fmtUsdLbp(t.base.usd, t.base.lbp)}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function buildVatSharePct(value: VatMoney, total: VatMoney, settlementCurrency: "USD" | "LBP"): number | null {
  const numerator = moneyRef(value, settlementCurrency);
  const denominator = moneyRef(total, settlementCurrency);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}
