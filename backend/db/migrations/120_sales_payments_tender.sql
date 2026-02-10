-- Track tender (cash received) separately from accounting value amounts.
-- In Lebanon, a payment can be a mix of USD + LBP used to settle a USD invoice.
-- We keep amount_usd/amount_lbp as the *applied value* (kept consistent via exchange_rate),
-- and store the cashier's tender breakdown in tender_usd/tender_lbp for receipt/audit.

BEGIN;

ALTER TABLE sales_payments
  ADD COLUMN IF NOT EXISTS tender_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tender_lbp numeric(18,2) NOT NULL DEFAULT 0;

COMMIT;

