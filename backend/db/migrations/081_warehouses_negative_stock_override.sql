-- Optional per-warehouse override for negative stock policy.
-- NULL means "inherit" (item override -> company policy).

BEGIN;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean;

CREATE INDEX IF NOT EXISTS idx_warehouses_company_allow_negative_stock
  ON warehouses(company_id, allow_negative_stock)
  WHERE allow_negative_stock IS NOT NULL;

COMMIT;

