-- Add basic procurement workflow metadata and vendor references.
-- Goal: requested/approved attribution, expected delivery, and supplier reference numbers.

BEGIN;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_ref text,
  ADD COLUMN IF NOT EXISTS expected_delivery_date date,
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_expected_delivery
  ON purchase_orders(company_id, expected_delivery_date)
  WHERE expected_delivery_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_supplier_ref
  ON purchase_orders(company_id, supplier_id, supplier_ref)
  WHERE supplier_ref IS NOT NULL AND supplier_ref <> '';

ALTER TABLE goods_receipts
  ADD COLUMN IF NOT EXISTS supplier_ref text,
  ADD COLUMN IF NOT EXISTS received_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_goods_receipts_company_received_at
  ON goods_receipts(company_id, received_at DESC)
  WHERE received_at IS NOT NULL;

COMMIT;

