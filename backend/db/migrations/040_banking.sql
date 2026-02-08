-- Banking & reconciliation (phase 3 accounting depth).

CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  currency currency_code NOT NULL DEFAULT 'USD',
  gl_account_id uuid NOT NULL REFERENCES company_coa_accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_company ON bank_accounts(company_id);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_accounts_isolation ON bank_accounts;
CREATE POLICY bank_accounts_isolation
  ON bank_accounts USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON bank_accounts;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_bank_accounts_updated_at
      BEFORE UPDATE ON bank_accounts
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  txn_date date NOT NULL,
  direction text NOT NULL, -- inflow|outflow
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  description text,
  reference text,
  counterparty text,
  matched_journal_id uuid REFERENCES gl_journals(id),
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_company ON bank_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date ON bank_transactions(bank_account_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_matched ON bank_transactions(company_id, matched_journal_id);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_transactions_isolation ON bank_transactions;
CREATE POLICY bank_transactions_isolation
  ON bank_transactions USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_bank_transactions_updated_at ON bank_transactions;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_bank_transactions_updated_at
      BEFORE UPDATE ON bank_transactions
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

