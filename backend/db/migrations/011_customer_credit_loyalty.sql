-- Customer credit + loyalty

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_limit_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit_lbp numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_balance_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_balance_lbp numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_points numeric(18,4) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS customer_loyalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  points numeric(18,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_loyalty_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_loyalty_ledger_isolation
  ON customer_loyalty_ledger USING (company_id = app_current_company_id());
