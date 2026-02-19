-- Merge/dedup support for customer/supplier masters (soft-merge with auditability).

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_reason text;

CREATE INDEX IF NOT EXISTS idx_customers_company_merged
  ON customers(company_id, merged_into_id)
  WHERE merged_into_id IS NOT NULL;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_reason text;

CREATE INDEX IF NOT EXISTS idx_suppliers_company_merged
  ON suppliers(company_id, merged_into_id)
  WHERE merged_into_id IS NOT NULL;

COMMIT;

