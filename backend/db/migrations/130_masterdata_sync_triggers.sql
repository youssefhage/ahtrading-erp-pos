-- Ensure master data tables used for Cloud -> Edge incremental replication
-- maintain updated_at automatically and have supporting indexes.

BEGIN;

-- Companies
CREATE INDEX IF NOT EXISTS idx_companies_updated_at
  ON companies(updated_at);

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_companies_updated_at
      BEFORE UPDATE ON companies
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

-- Branches
CREATE INDEX IF NOT EXISTS idx_branches_company_updated_at
  ON branches(company_id, updated_at);

DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_branches_updated_at
      BEFORE UPDATE ON branches
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

-- Unit of measures
CREATE INDEX IF NOT EXISTS idx_unit_of_measures_company_updated_at
  ON unit_of_measures(company_id, updated_at);

DROP TRIGGER IF EXISTS trg_unit_of_measures_updated_at ON unit_of_measures;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_unit_of_measures_updated_at
      BEFORE UPDATE ON unit_of_measures
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

-- Item UOM conversions
CREATE INDEX IF NOT EXISTS idx_item_uom_conversions_company_updated_at
  ON item_uom_conversions(company_id, updated_at);

DROP TRIGGER IF EXISTS trg_item_uom_conversions_updated_at ON item_uom_conversions;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_item_uom_conversions_updated_at
      BEFORE UPDATE ON item_uom_conversions
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

COMMIT;

