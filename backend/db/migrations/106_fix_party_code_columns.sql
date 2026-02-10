-- Safety migration: ensure party master-data "code" columns exist.
--
-- Why:
-- Application bulk import endpoints upsert customers/suppliers by (company_id, code) when provided.
-- Some deployments may have drifted where this column/index migration was skipped/incorrectly
-- marked as applied. This migration is idempotent and safe.

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS code text;

CREATE UNIQUE INDEX IF NOT EXISTS uix_customers_code
  ON customers(company_id, code)
  WHERE code IS NOT NULL AND code <> '';

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS code text;

CREATE UNIQUE INDEX IF NOT EXISTS uix_suppliers_code
  ON suppliers(company_id, code)
  WHERE code IS NOT NULL AND code <> '';

COMMIT;

