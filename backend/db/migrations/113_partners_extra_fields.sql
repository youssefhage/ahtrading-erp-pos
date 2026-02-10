-- Customers/Suppliers extra fields (sales ops, bank/payment instructions).

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_type') THEN
    CREATE TYPE customer_type AS ENUM ('retail', 'wholesale', 'b2b');
  END IF;
END $$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type customer_type NOT NULL DEFAULT 'retail',
  ADD COLUMN IF NOT EXISTS assigned_salesperson_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_customers_company_salesperson
  ON customers(company_id, assigned_salesperson_user_id)
  WHERE assigned_salesperson_user_id IS NOT NULL;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_no text,
  ADD COLUMN IF NOT EXISTS bank_iban text,
  ADD COLUMN IF NOT EXISTS bank_swift text,
  ADD COLUMN IF NOT EXISTS payment_instructions text;

COMMIT;

