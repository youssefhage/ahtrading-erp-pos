-- Ensure loyalty points are idempotent per source document.

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_loyalty_ledger_company_source
  ON customer_loyalty_ledger (company_id, source_type, source_id);

