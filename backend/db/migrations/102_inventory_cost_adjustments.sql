-- Inventory average-cost adjustments ledger (for reversible best-effort costing tweaks).
-- Used by supplier credit notes (receipt-linked rebates) to adjust avg cost in a reversible way.

BEGIN;

CREATE TABLE IF NOT EXISTS inventory_cost_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES items(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  -- Positive deltas: how much avg_cost_* was reduced by this adjustment (per unit).
  delta_avg_cost_usd numeric(18,6) NOT NULL DEFAULT 0,
  delta_avg_cost_lbp numeric(18,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_cost_adj_company_source
  ON inventory_cost_adjustments(company_id, source_type, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_cost_adj_company_item_wh
  ON inventory_cost_adjustments(company_id, item_id, warehouse_id, created_at DESC);

ALTER TABLE inventory_cost_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_cost_adjustments_isolation ON inventory_cost_adjustments;
CREATE POLICY inventory_cost_adjustments_isolation
  ON inventory_cost_adjustments USING (company_id = app_current_company_id());

COMMIT;

