-- Snapshot actual cost (warehouse avg) and replacement cost (supplier price today)
-- on each sales invoice line at the time of sale.
-- Actual cost → realized margin (what you actually made).
-- Replacement cost → sustainability margin (will you still profit on reorder?).
-- Neither column affects COGS or GL — stock_moves remains the accounting source of truth.

ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS unit_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_lbp numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replacement_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replacement_cost_lbp numeric(18,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_invoice_lines.unit_cost_usd IS 'Warehouse avg cost USD snapshot at sale time (actual COGS per unit).';
COMMENT ON COLUMN sales_invoice_lines.unit_cost_lbp IS 'Warehouse avg cost LBP snapshot at sale time (actual COGS per unit).';
COMMENT ON COLUMN sales_invoice_lines.replacement_cost_usd IS 'Replacement cost USD from price list at sale time — for pricing analysis, NOT COGS.';
COMMENT ON COLUMN sales_invoice_lines.replacement_cost_lbp IS 'Replacement cost LBP from price list at sale time — for pricing analysis, NOT COGS.';
