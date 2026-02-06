-- Purchase order lines

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  qty numeric(18,4) NOT NULL,
  unit_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost_lbp numeric(18,2) NOT NULL DEFAULT 0,
  line_total_usd numeric(18,4) NOT NULL DEFAULT 0,
  line_total_lbp numeric(18,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_po_lines_company ON purchase_order_lines(company_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(purchase_order_id);

ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_order_lines_isolation
  ON purchase_order_lines USING (company_id = app_current_company_id());
