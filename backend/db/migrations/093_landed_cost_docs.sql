-- Landed cost allocation (v1):
-- Record additional costs per goods receipt and allocate them into batch_cost_layers for reporting.
-- (Note: full COGS/GL integration can be extended in v2.)

CREATE TABLE IF NOT EXISTS landed_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  landed_cost_no text NOT NULL,
  goods_receipt_id uuid NOT NULL REFERENCES goods_receipts(id),
  status text NOT NULL DEFAULT 'draft', -- draft|posted|canceled
  memo text,
  exchange_rate numeric(18,6) NOT NULL DEFAULT 0,
  total_usd numeric(18,4) NOT NULL DEFAULT 0,
  total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  canceled_at timestamptz,
  canceled_by_user_id uuid REFERENCES users(id),
  cancel_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_landed_costs_company_no
  ON landed_costs(company_id, landed_cost_no);
CREATE INDEX IF NOT EXISTS idx_landed_costs_company_receipt
  ON landed_costs(company_id, goods_receipt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_landed_costs_company_status
  ON landed_costs(company_id, status, created_at DESC);

ALTER TABLE landed_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS landed_costs_isolation ON landed_costs;
CREATE POLICY landed_costs_isolation
  ON landed_costs USING (company_id = app_current_company_id());

CREATE TABLE IF NOT EXISTS landed_cost_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  landed_cost_id uuid NOT NULL REFERENCES landed_costs(id) ON DELETE CASCADE,
  description text,
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_landed_cost_lines_company_doc
  ON landed_cost_lines(company_id, landed_cost_id, created_at ASC);

ALTER TABLE landed_cost_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS landed_cost_lines_isolation ON landed_cost_lines;
CREATE POLICY landed_cost_lines_isolation
  ON landed_cost_lines USING (company_id = app_current_company_id());

