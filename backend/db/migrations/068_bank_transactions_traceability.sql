-- Add traceability metadata to bank transactions (origin, import batch).

BEGIN;

CREATE TABLE IF NOT EXISTS bank_statement_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  source text NOT NULL, -- e.g. 'csv', 'manual', 'api'
  file_name text,
  statement_date_from date,
  statement_date_to date,
  notes text,
  imported_by_user_id uuid REFERENCES users(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_stmt_import_batches_company
  ON bank_statement_import_batches(company_id, imported_at DESC);

ALTER TABLE bank_statement_import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_statement_import_batches_isolation ON bank_statement_import_batches;
CREATE POLICY bank_statement_import_batches_isolation
  ON bank_statement_import_batches USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_bank_statement_import_batches_updated_at ON bank_statement_import_batches;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_bank_statement_import_batches_updated_at
      BEFORE UPDATE ON bank_statement_import_batches
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES bank_statement_import_batches(id),
  ADD COLUMN IF NOT EXISTS import_row_no integer,
  ADD COLUMN IF NOT EXISTS imported_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_company_source
  ON bank_transactions(company_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_company_import_batch
  ON bank_transactions(company_id, import_batch_id, import_row_no)
  WHERE import_batch_id IS NOT NULL;

COMMIT;

