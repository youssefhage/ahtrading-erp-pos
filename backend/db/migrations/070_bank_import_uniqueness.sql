-- Prevent duplicate imported statement rows within a batch.

CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_transactions_import_batch_row
  ON bank_transactions(company_id, import_batch_id, import_row_no)
  WHERE import_batch_id IS NOT NULL AND import_row_no IS NOT NULL;

