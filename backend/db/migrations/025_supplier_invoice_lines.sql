-- Supplier invoice line items (v1 operational usability)

CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  qty numeric(18,4) NOT NULL,
  unit_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost_lbp numeric(18,2) NOT NULL DEFAULT 0,
  line_total_usd numeric(18,4) NOT NULL DEFAULT 0,
  line_total_lbp numeric(18,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_company ON supplier_invoice_lines(company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_inv ON supplier_invoice_lines(supplier_invoice_id);

ALTER TABLE supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_invoice_lines_isolation
  ON supplier_invoice_lines USING (company_id = app_current_company_id());

