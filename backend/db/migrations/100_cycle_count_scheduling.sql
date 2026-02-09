-- Warehouse v2: cycle count scheduling + tasks (v1).
-- - Plans generate tasks for a warehouse/location on a cadence.
-- - Tasks snapshot expected on-hand by (item, location) and allow counting + posting adjustments.

BEGIN;

CREATE TABLE IF NOT EXISTS cycle_count_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  location_id uuid REFERENCES warehouse_locations(id),
  frequency_days int NOT NULL DEFAULT 7,
  next_run_date date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cycle_count_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cycle_count_plans_isolation ON cycle_count_plans;
CREATE POLICY cycle_count_plans_isolation
  ON cycle_count_plans USING (company_id = app_current_company_id());

CREATE INDEX IF NOT EXISTS idx_cycle_count_plans_company_active_next
  ON cycle_count_plans(company_id, is_active, next_run_date, warehouse_id);

DROP TRIGGER IF EXISTS trg_cycle_count_plans_updated_at ON cycle_count_plans;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_cycle_count_plans_updated_at
      BEFORE UPDATE ON cycle_count_plans
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS cycle_count_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  plan_id uuid REFERENCES cycle_count_plans(id) ON DELETE SET NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  location_id uuid REFERENCES warehouse_locations(id),
  status text NOT NULL DEFAULT 'open',
  scheduled_date date NOT NULL DEFAULT CURRENT_DATE,
  started_at timestamptz,
  completed_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  posted_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cycle_count_tasks
  DROP CONSTRAINT IF EXISTS cycle_count_tasks_status_check;
ALTER TABLE cycle_count_tasks
  ADD CONSTRAINT cycle_count_tasks_status_check
  CHECK (status IN ('open', 'in_progress', 'posted', 'canceled'));

ALTER TABLE cycle_count_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cycle_count_tasks_isolation ON cycle_count_tasks;
CREATE POLICY cycle_count_tasks_isolation
  ON cycle_count_tasks USING (company_id = app_current_company_id());

CREATE INDEX IF NOT EXISTS idx_cycle_count_tasks_company_status
  ON cycle_count_tasks(company_id, status, scheduled_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_count_tasks_company_wh_loc
  ON cycle_count_tasks(company_id, warehouse_id, location_id, status);

DROP TRIGGER IF EXISTS trg_cycle_count_tasks_updated_at ON cycle_count_tasks;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_cycle_count_tasks_updated_at
      BEFORE UPDATE ON cycle_count_tasks
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS cycle_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  task_id uuid NOT NULL REFERENCES cycle_count_tasks(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  expected_qty numeric(18,4) NOT NULL DEFAULT 0,
  counted_qty numeric(18,4),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, task_id, item_id)
);

ALTER TABLE cycle_count_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cycle_count_lines_isolation ON cycle_count_lines;
CREATE POLICY cycle_count_lines_isolation
  ON cycle_count_lines USING (company_id = app_current_company_id());

CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_company_task
  ON cycle_count_lines(company_id, task_id, item_id);

COMMIT;

