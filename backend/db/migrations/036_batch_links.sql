-- Batch/expiry capture in receiving + invoice lines.

ALTER TABLE goods_receipt_lines
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES batches(id);

ALTER TABLE supplier_invoice_lines
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES batches(id);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_batch ON goods_receipt_lines(batch_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_batch ON supplier_invoice_lines(batch_id);

-- Speed up batch lookups; allows multiple NULLs (no batch tracking).
CREATE UNIQUE INDEX IF NOT EXISTS uq_batches_company_item_no_exp
  ON batches(company_id, item_id, batch_no, expiry_date);

