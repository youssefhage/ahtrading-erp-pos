-- Invoice-level (header) discount for sales invoices.
-- Existing line-level discounts remain supported; header discount applies on top of net lines.

BEGIN;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS invoice_discount_pct numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_discount_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_discount_lbp numeric(18,2) NOT NULL DEFAULT 0;

COMMIT;

