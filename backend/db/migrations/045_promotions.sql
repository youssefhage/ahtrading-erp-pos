-- Promotions (simple v1: item-level tier pricing or discount).

CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  starts_on date,
  ends_on date,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_promotions_company_active
  ON promotions(company_id, is_active, priority DESC);

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promotions_isolation ON promotions;
CREATE POLICY promotions_isolation
  ON promotions USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_promotions_updated_at ON promotions;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_promotions_updated_at
      BEFORE UPDATE ON promotions
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;


CREATE TABLE IF NOT EXISTS promotion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  min_qty numeric(18,4) NOT NULL DEFAULT 1,
  promo_price_usd numeric(18,4) NOT NULL DEFAULT 0,
  promo_price_lbp numeric(18,2) NOT NULL DEFAULT 0,
  discount_pct numeric(6,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, promotion_id, item_id, min_qty)
);

CREATE INDEX IF NOT EXISTS idx_promotion_items_company
  ON promotion_items(company_id, promotion_id);

ALTER TABLE promotion_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promotion_items_isolation ON promotion_items;
CREATE POLICY promotion_items_isolation
  ON promotion_items USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_promotion_items_updated_at ON promotion_items;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_promotion_items_updated_at
      BEFORE UPDATE ON promotion_items
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

