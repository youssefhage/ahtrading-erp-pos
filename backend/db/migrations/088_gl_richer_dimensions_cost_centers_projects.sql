-- Richer GL dimensions (v1): cost centers and projects.

BEGIN;

CREATE TABLE IF NOT EXISTS cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cost_centers_company
  ON cost_centers(company_id, is_active, code);

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_centers_isolation ON cost_centers;
CREATE POLICY cost_centers_isolation
  ON cost_centers USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_cost_centers_updated_at ON cost_centers;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_cost_centers_updated_at
      BEFORE UPDATE ON cost_centers
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_projects_company
  ON projects(company_id, is_active, code);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_isolation ON projects;
CREATE POLICY projects_isolation
  ON projects USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_projects_updated_at
      BEFORE UPDATE ON projects
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

ALTER TABLE gl_entries
  ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id),
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);

CREATE INDEX IF NOT EXISTS idx_gl_entries_cost_center
  ON gl_entries(cost_center_id)
  WHERE cost_center_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gl_entries_project
  ON gl_entries(project_id)
  WHERE project_id IS NOT NULL;

COMMIT;

