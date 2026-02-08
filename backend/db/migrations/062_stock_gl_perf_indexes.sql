-- Performance indexes for core operational flows (inventory/sales/purchases/accounting).
-- These are safe additive changes.

-- Stock moves: speed up on-hand queries, FEFO allocation, and document reversals.
CREATE INDEX IF NOT EXISTS idx_stock_moves_company_item_wh
  ON stock_moves(company_id, item_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_moves_company_item_wh_batch
  ON stock_moves(company_id, item_id, warehouse_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_stock_moves_company_source
  ON stock_moves(company_id, source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_stock_moves_company_source_created
  ON stock_moves(company_id, source_type, source_id, created_at DESC);

-- GL entries: speed up journal retrieval and account-based reporting.
CREATE INDEX IF NOT EXISTS idx_gl_entries_journal
  ON gl_entries(journal_id);

CREATE INDEX IF NOT EXISTS idx_gl_entries_account
  ON gl_entries(account_id);

-- Tax lines: speed up fetch/reversal checks by source document.
CREATE INDEX IF NOT EXISTS idx_tax_lines_company_source
  ON tax_lines(company_id, source_type, source_id);

-- Sales: speed up invoice line + payment lookups.
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_invoice
  ON sales_invoice_lines(invoice_id);

CREATE INDEX IF NOT EXISTS idx_sales_payments_invoice
  ON sales_payments(invoice_id);

-- Purchases: speed up invoice payment lookups.
CREATE INDEX IF NOT EXISTS idx_supplier_payments_invoice
  ON supplier_payments(supplier_invoice_id);

