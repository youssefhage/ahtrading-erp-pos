-- Supplier invoice import v2: queue extraction and require human mapping before creating invoice lines.
-- Adds:
-- - import_status: pending_review
-- - supplier_invoice_import_lines table for extracted lines and mapping choices

-- Expand import_status check constraint to include 'pending_review'.
ALTER TABLE supplier_invoices DROP CONSTRAINT IF EXISTS supplier_invoices_import_status_check;
ALTER TABLE supplier_invoices
  ADD CONSTRAINT supplier_invoices_import_status_check
  CHECK (import_status = ANY (ARRAY['none','pending','processing','pending_review','filled','failed','skipped']));

CREATE TABLE IF NOT EXISTS supplier_invoice_import_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  qty numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost_lbp numeric(18,2) NOT NULL DEFAULT 0,
  supplier_item_code text,
  supplier_item_name text,
  description text,
  suggested_item_id uuid REFERENCES items(id),
  suggested_confidence numeric(6,4) NOT NULL DEFAULT 0,
  resolved_item_id uuid REFERENCES items(id),
  status text NOT NULL DEFAULT 'pending', -- pending|resolved|skipped
  raw_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_invoice_import_lines_line_no
  ON supplier_invoice_import_lines(company_id, supplier_invoice_id, line_no);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_import_lines_inv_status
  ON supplier_invoice_import_lines(company_id, supplier_invoice_id, status, line_no);

ALTER TABLE supplier_invoice_import_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_invoice_import_lines_isolation ON supplier_invoice_import_lines;
CREATE POLICY supplier_invoice_import_lines_isolation
  ON supplier_invoice_import_lines USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_supplier_invoice_import_lines_updated_at ON supplier_invoice_import_lines;
CREATE TRIGGER trg_supplier_invoice_import_lines_updated_at
  BEFORE UPDATE ON supplier_invoice_import_lines
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

