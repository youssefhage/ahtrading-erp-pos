-- Party codes (go-live imports) + cancel/void metadata on posted documents.

-- Optional customer/supplier codes (unique per company when provided).
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

-- Cancel metadata for auditability.
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE goods_receipts
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

