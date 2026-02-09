-- Returns/refunds operational robustness:
-- - Restocking fee metadata on returns
-- - First-class refund transactions for reconciliation-grade workflows

BEGIN;

ALTER TABLE sales_returns
  ADD COLUMN IF NOT EXISTS restocking_fee_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS restocking_fee_lbp numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS restocking_fee_reason text;

CREATE TABLE IF NOT EXISTS sales_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  sales_return_id uuid NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  method text NOT NULL,
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  settlement_currency currency_code NOT NULL DEFAULT 'USD',
  bank_account_id uuid REFERENCES bank_accounts(id),
  reference text,
  provider text,
  auth_code text,
  captured_at timestamptz,
  source_type text,
  source_id uuid,
  created_by_user_id uuid REFERENCES users(id),
  created_by_device_id uuid REFERENCES pos_devices(id),
  created_by_cashier_id uuid REFERENCES pos_cashiers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_refunds_company_return
  ON sales_refunds(company_id, sales_return_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_refunds_company_source
  ON sales_refunds(company_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE sales_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_refunds_isolation ON sales_refunds;
CREATE POLICY sales_refunds_isolation
  ON sales_refunds USING (company_id = app_current_company_id());

COMMIT;

