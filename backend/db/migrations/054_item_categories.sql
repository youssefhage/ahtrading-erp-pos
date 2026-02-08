-- Item categories (simple v1) to support grouping and reporting.

BEGIN;

CREATE TABLE IF NOT EXISTS item_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  parent_id uuid REFERENCES item_categories(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_categories_isolation ON item_categories;
CREATE POLICY item_categories_isolation ON item_categories
  USING (company_id = app_current_company_id());

-- Reuse the shared trigger function defined in 022_catalog_timestamps.sql.
DROP TRIGGER IF EXISTS trg_item_categories_updated_at ON item_categories;
CREATE TRIGGER trg_item_categories_updated_at
  BEFORE UPDATE ON item_categories
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

