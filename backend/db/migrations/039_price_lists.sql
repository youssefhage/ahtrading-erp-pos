-- Price lists (phase 2 operational depth).

CREATE TABLE IF NOT EXISTS price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  currency currency_code NOT NULL DEFAULT 'USD',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_price_lists_company ON price_lists(company_id);

ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_lists_isolation ON price_lists;
CREATE POLICY price_lists_isolation
  ON price_lists USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_price_lists_updated_at ON price_lists;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_price_lists_updated_at
      BEFORE UPDATE ON price_lists
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS price_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  price_usd numeric(18,4) NOT NULL DEFAULT 0,
  price_lbp numeric(18,2) NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_list_items_company ON price_list_items(company_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_list_item ON price_list_items(price_list_id, item_id);

ALTER TABLE price_list_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_list_items_isolation ON price_list_items;
CREATE POLICY price_list_items_isolation
  ON price_list_items USING (company_id = app_current_company_id());

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS price_list_id uuid REFERENCES price_lists(id);

CREATE INDEX IF NOT EXISTS idx_customers_price_list ON customers(company_id, price_list_id);

