-- Soft-void sales payments (pilot/admin safety).
-- We avoid hard-deleting payments in production because they have accounting implications.
-- Voiding a payment creates reversing GL entries and (optionally) a reversing bank txn.

BEGIN;

ALTER TABLE sales_payments
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason text;

CREATE INDEX IF NOT EXISTS sales_payments_invoice_voided_idx
  ON sales_payments (invoice_id, voided_at);

COMMIT;

