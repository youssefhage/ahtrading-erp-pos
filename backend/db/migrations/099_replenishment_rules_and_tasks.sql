-- Warehouse v2: bin replenishment rules + replenishment tasks (v1).
-- - Rules define min/target/max for an item in a destination bin (to_location).
-- - Suggestions are computed from stock_moves by location; tasks/transfers can be created from suggestions.

BEGIN;

CREATE TABLE IF NOT EXISTS replenishment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  from_location_id uuid REFERENCES warehouse_locations(id),
  to_location_id uuid NOT NULL REFERENCES warehouse_locations(id),
  item_id uuid NOT NULL REFERENCES items(id),
  min_qty numeric(18,4) NOT NULL DEFAULT 0,
  target_qty numeric(18,4) NOT NULL DEFAULT 0,
  max_qty numeric(18,4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, to_location_id, item_id)
);

ALTER TABLE replenishment_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS replenishment_rules_isolation ON replenishment_rules;
CREATE POLICY replenishment_rules_isolation
  ON replenishment_rules USING (company_id = app_current_company_id());

CREATE INDEX IF NOT EXISTS idx_replenishment_rules_company_wh
  ON replenishment_rules(company_id, warehouse_id, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_replenishment_rules_company_to_loc
  ON replenishment_rules(company_id, to_location_id, is_active);
CREATE INDEX IF NOT EXISTS idx_replenishment_rules_company_item
  ON replenishment_rules(company_id, item_id, is_active);

DROP TRIGGER IF EXISTS trg_replenishment_rules_updated_at ON replenishment_rules;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_replenishment_rules_updated_at
      BEFORE UPDATE ON replenishment_rules
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS replenishment_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  from_location_id uuid REFERENCES warehouse_locations(id),
  to_location_id uuid NOT NULL REFERENCES warehouse_locations(id),
  item_id uuid NOT NULL REFERENCES items(id),
  qty_needed numeric(18,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_by_user_id uuid REFERENCES users(id),
  assigned_to_user_id uuid REFERENCES users(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE replenishment_tasks
  DROP CONSTRAINT IF EXISTS replenishment_tasks_status_check;
ALTER TABLE replenishment_tasks
  ADD CONSTRAINT replenishment_tasks_status_check
  CHECK (status IN ('open', 'in_progress', 'done', 'canceled'));

ALTER TABLE replenishment_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS replenishment_tasks_isolation ON replenishment_tasks;
CREATE POLICY replenishment_tasks_isolation
  ON replenishment_tasks USING (company_id = app_current_company_id());

CREATE INDEX IF NOT EXISTS idx_replenishment_tasks_company_status
  ON replenishment_tasks(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_replenishment_tasks_company_loc
  ON replenishment_tasks(company_id, warehouse_id, to_location_id, status);
CREATE INDEX IF NOT EXISTS idx_replenishment_tasks_company_item
  ON replenishment_tasks(company_id, item_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_replenishment_tasks_updated_at ON replenishment_tasks;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_replenishment_tasks_updated_at
      BEFORE UPDATE ON replenishment_tasks
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

COMMIT;

