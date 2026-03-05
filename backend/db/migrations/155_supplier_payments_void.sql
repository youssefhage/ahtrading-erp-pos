-- Soft-void supplier payments (mirrors 121_sales_payments_void.sql).
-- Voiding a supplier payment creates reversing GL entries and (optionally) a reversing bank txn.

BEGIN;

ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason text;

CREATE INDEX IF NOT EXISTS supplier_payments_invoice_voided_idx
  ON supplier_payments (supplier_invoice_id, voided_at);

COMMIT;
