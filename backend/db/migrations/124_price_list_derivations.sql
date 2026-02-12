-- Derived Price Lists (simple pricing rules v1)
--
-- Use case:
-- - Retail = Wholesale + 5% (with rounding)
-- - B2B = Wholesale - 2% (only if margin >= X)
--
-- We materialize derived results into `price_list_items` so existing pricing logic
-- and offline POS catalogs keep working without a new runtime rule engine.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'price_derivation_mode') THEN
    CREATE TYPE price_derivation_mode AS ENUM ('markup_pct', 'discount_pct');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS price_list_derivations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  target_price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  base_price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,

  mode price_derivation_mode NOT NULL DEFAULT 'markup_pct',
  pct numeric(6,4) NOT NULL DEFAULT 0,

  usd_round_step numeric(18,4) NOT NULL DEFAULT 0.01,
  lbp_round_step numeric(18,2) NOT NULL DEFAULT 0,

  -- Optional: do not apply discounts/markups that would violate this margin.
  -- Enforced using a cost basis in code (prefer avg cost, fallback to standard).
  min_margin_pct numeric(6,4),
  skip_if_cost_missing boolean NOT NULL DEFAULT false,

  is_active boolean NOT NULL DEFAULT true,

  last_run_at timestamptz,
  last_run_summary jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, target_price_list_id)
);

CREATE INDEX IF NOT EXISTS idx_price_list_derivations_company
  ON price_list_derivations(company_id, is_active, target_price_list_id);

ALTER TABLE price_list_derivations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_list_derivations_isolation ON price_list_derivations;
CREATE POLICY price_list_derivations_isolation
  ON price_list_derivations USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_price_list_derivations_updated_at ON price_list_derivations;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_price_list_derivations_updated_at
      BEFORE UPDATE ON price_list_derivations
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

