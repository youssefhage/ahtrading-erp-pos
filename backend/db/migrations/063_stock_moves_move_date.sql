-- Add a movement date to stock_moves so inventory can be reported "as of" a date.
-- Backfills from created_at::date for existing rows.

ALTER TABLE stock_moves
  ADD COLUMN IF NOT EXISTS move_date date;

UPDATE stock_moves
SET move_date = created_at::date
WHERE move_date IS NULL;

ALTER TABLE stock_moves
  ALTER COLUMN move_date SET NOT NULL;

ALTER TABLE stock_moves
  ALTER COLUMN move_date SET DEFAULT CURRENT_DATE;

CREATE INDEX IF NOT EXISTS idx_stock_moves_company_move_date
  ON stock_moves(company_id, move_date);

CREATE INDEX IF NOT EXISTS idx_stock_moves_company_item_wh_move_date
  ON stock_moves(company_id, item_id, warehouse_id, move_date);

