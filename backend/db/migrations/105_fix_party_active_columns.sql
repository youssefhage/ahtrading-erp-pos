-- Safety migration: ensure party master-data "is_active" columns exist.
--
-- Why:
-- Some deployments may have drifted where application code expects `customers.is_active`
-- / `suppliers.is_active`, but the migration that adds them was skipped/incorrectly
-- marked as applied. This migration is idempotent and safe.

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_customers_company_active ON customers(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_company_active ON suppliers(company_id, is_active);

COMMIT;

