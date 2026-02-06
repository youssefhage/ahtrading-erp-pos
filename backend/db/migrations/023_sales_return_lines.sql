-- Sales return line items (v1 operational usability)

CREATE TABLE IF NOT EXISTS sales_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  sales_return_id uuid NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  qty numeric(18,4) NOT NULL,
  unit_price_usd numeric(18,4) NOT NULL DEFAULT 0,
  unit_price_lbp numeric(18,2) NOT NULL DEFAULT 0,
  line_total_usd numeric(18,4) NOT NULL DEFAULT 0,
  line_total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  unit_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost_lbp numeric(18,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sales_return_lines_company ON sales_return_lines(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_lines_return ON sales_return_lines(sales_return_id);

ALTER TABLE sales_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_return_lines_isolation
  ON sales_return_lines USING (company_id = app_current_company_id());

