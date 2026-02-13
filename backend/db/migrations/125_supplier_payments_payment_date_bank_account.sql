-- Add payment_date and bank_account_id to supplier_payments so we can:
-- - filter/report by the intended payment date (not created_at)
-- - link payments to a bank account when applicable

BEGIN;

ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES bank_accounts(id);

-- Backfill legacy rows so date filters behave as users expect.
UPDATE supplier_payments
SET payment_date = COALESCE(payment_date, created_at::date)
WHERE payment_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_payment_date
  ON supplier_payments(payment_date);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_bank_account
  ON supplier_payments(bank_account_id);

COMMIT;

