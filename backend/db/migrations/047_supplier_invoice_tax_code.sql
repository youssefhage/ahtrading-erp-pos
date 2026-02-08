-- Persist tax code selection on supplier invoices so drafts can be edited and posted reliably.

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS tax_code_id uuid NULL REFERENCES tax_codes(id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_company_tax
  ON supplier_invoices(company_id, tax_code_id);

