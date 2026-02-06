-- Item suppliers mapping

CREATE TABLE IF NOT EXISTS item_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES items(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  is_primary boolean NOT NULL DEFAULT false,
  lead_time_days integer NOT NULL DEFAULT 0,
  min_order_qty numeric(18,4) NOT NULL DEFAULT 0,
  last_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  last_cost_lbp numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, item_id, supplier_id)
);

ALTER TABLE item_suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_suppliers_isolation ON item_suppliers USING (company_id = app_current_company_id());
