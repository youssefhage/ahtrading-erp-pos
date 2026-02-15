-- Add timestamps to master data tables that are required for incremental Cloud -> Edge replication.

BEGIN;

-- Warehouses: add created_at/updated_at + trigger.
ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE warehouses
SET created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, created_at, now());

CREATE INDEX IF NOT EXISTS idx_warehouses_company_updated_at
  ON warehouses(company_id, updated_at);

DROP TRIGGER IF EXISTS trg_warehouses_updated_at ON warehouses;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_warehouses_updated_at
      BEFORE UPDATE ON warehouses
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

-- Tax codes: add created_at/updated_at + trigger.
ALTER TABLE tax_codes
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tax_codes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE tax_codes
SET created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, created_at, now());

CREATE INDEX IF NOT EXISTS idx_tax_codes_company_updated_at
  ON tax_codes(company_id, updated_at);

DROP TRIGGER IF EXISTS trg_tax_codes_updated_at ON tax_codes;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_tax_codes_updated_at
      BEFORE UPDATE ON tax_codes
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

-- Price list items: add updated_at + trigger (prices can be corrected).
ALTER TABLE price_list_items
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE price_list_items
SET updated_at = COALESCE(updated_at, created_at, now());

CREATE INDEX IF NOT EXISTS idx_price_list_items_company_updated_at
  ON price_list_items(company_id, updated_at);

DROP TRIGGER IF EXISTS trg_price_list_items_updated_at ON price_list_items;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_price_list_items_updated_at
      BEFORE UPDATE ON price_list_items
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

-- Item prices: add updated_at + trigger for robustness (even if the preferred pattern is "insert new effective prices").
ALTER TABLE item_prices
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE item_prices
SET updated_at = COALESCE(updated_at, created_at, now());

CREATE INDEX IF NOT EXISTS idx_item_prices_item_updated_at
  ON item_prices(item_id, updated_at);

DROP TRIGGER IF EXISTS trg_item_prices_updated_at ON item_prices;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_item_prices_updated_at
      BEFORE UPDATE ON item_prices
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

COMMIT;

