-- Receiving placement + per-batch cost trace (v1).
-- - Allow goods receipt lines to capture a warehouse bin/location.
-- - Record a cost layer per batch for auditability (unit cost + optional landed costs).

BEGIN;

ALTER TABLE goods_receipt_lines
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES warehouse_locations(id),
  ADD COLUMN IF NOT EXISTS landed_cost_total_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS landed_cost_total_lbp numeric(18,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_location
  ON goods_receipt_lines(location_id)
  WHERE location_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS batch_cost_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id),
  location_id uuid REFERENCES warehouse_locations(id),
  source_type text NOT NULL, -- e.g. 'goods_receipt'
  source_id uuid NOT NULL,
  source_line_type text,
  source_line_id uuid,
  qty numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost_lbp numeric(18,2) NOT NULL DEFAULT 0,
  line_total_usd numeric(18,4) NOT NULL DEFAULT 0,
  line_total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  landed_cost_total_usd numeric(18,4) NOT NULL DEFAULT 0,
  landed_cost_total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batch_cost_layers_company_batch_created
  ON batch_cost_layers(company_id, batch_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_batch_cost_layers_source_line
  ON batch_cost_layers(company_id, batch_id, source_type, source_id, source_line_id)
  WHERE source_line_id IS NOT NULL;

ALTER TABLE batch_cost_layers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS batch_cost_layers_isolation ON batch_cost_layers;
CREATE POLICY batch_cost_layers_isolation
  ON batch_cost_layers USING (company_id = app_current_company_id());

COMMIT;

