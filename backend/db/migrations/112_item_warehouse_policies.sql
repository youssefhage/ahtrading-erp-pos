-- Item planning policy per warehouse (min/max stock, preferred supplier, lead time).
--
-- Note: replenishment_rules exists for bin-level min/target/max. This table is for
-- simpler warehouse-level planning without requiring bins.

BEGIN;

CREATE TABLE IF NOT EXISTS item_warehouse_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES items(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  min_stock numeric(18,4) NOT NULL DEFAULT 0,
  max_stock numeric(18,4) NOT NULL DEFAULT 0,
  preferred_supplier_id uuid REFERENCES suppliers(id),
  replenishment_lead_time_days integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, item_id, warehouse_id)
);

ALTER TABLE item_warehouse_policies
  DROP CONSTRAINT IF EXISTS chk_item_warehouse_policies_min_stock;
ALTER TABLE item_warehouse_policies
  ADD CONSTRAINT chk_item_warehouse_policies_min_stock CHECK (min_stock >= 0);

ALTER TABLE item_warehouse_policies
  DROP CONSTRAINT IF EXISTS chk_item_warehouse_policies_max_stock;
ALTER TABLE item_warehouse_policies
  ADD CONSTRAINT chk_item_warehouse_policies_max_stock CHECK (max_stock >= 0);

ALTER TABLE item_warehouse_policies
  DROP CONSTRAINT IF EXISTS chk_item_warehouse_policies_lead_time;
ALTER TABLE item_warehouse_policies
  ADD CONSTRAINT chk_item_warehouse_policies_lead_time CHECK (replenishment_lead_time_days IS NULL OR replenishment_lead_time_days >= 0);

ALTER TABLE item_warehouse_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_warehouse_policies_isolation ON item_warehouse_policies;
CREATE POLICY item_warehouse_policies_isolation
  ON item_warehouse_policies USING (company_id = app_current_company_id());

CREATE INDEX IF NOT EXISTS idx_item_warehouse_policies_company_wh
  ON item_warehouse_policies(company_id, warehouse_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_warehouse_policies_company_item
  ON item_warehouse_policies(company_id, item_id, updated_at DESC);

-- Keep timestamps consistent with other tables (if helper exists).
DROP TRIGGER IF EXISTS trg_item_warehouse_policies_updated_at ON item_warehouse_policies;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_item_warehouse_policies_updated_at
      BEFORE UPDATE ON item_warehouse_policies
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

COMMIT;

