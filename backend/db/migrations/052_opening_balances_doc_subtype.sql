-- Support go-live opening balances without inventory side effects.
-- Adds a generic OPENING_BALANCE account role and an invoice subtype flag.

-- Account role used as the offset account for opening balances (equity).
INSERT INTO account_roles (code, description)
VALUES ('OPENING_BALANCE', 'Opening Balance Offset (Equity)')
ON CONFLICT (code) DO NOTHING;

-- Sales invoices: add subtype so we can post financial-only opening AR without stock moves.
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS doc_subtype text NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_subtype_status
  ON sales_invoices(company_id, doc_subtype, status);

-- Supplier invoices: add subtype so we can post opening AP without hitting expenses/GRNI.
ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS doc_subtype text NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_company_subtype_status
  ON supplier_invoices(company_id, doc_subtype, status);
