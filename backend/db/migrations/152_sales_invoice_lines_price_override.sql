-- Track which invoice lines had a manager price override applied at POS.
-- original_list_price_* records the catalog price before the override.

ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS price_override          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_list_price_usd numeric(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_list_price_lbp numeric(20,4) NOT NULL DEFAULT 0;
