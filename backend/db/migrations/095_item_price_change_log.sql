-- Price intelligence: log meaningful sell price changes over time.
-- This supports operator auditability and pricing governance.

BEGIN;

CREATE TABLE IF NOT EXISTS item_price_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES items(id),
  item_price_id uuid REFERENCES item_prices(id) ON DELETE SET NULL,
  effective_from date,
  effective_to date,
  old_price_usd numeric(18,4),
  new_price_usd numeric(18,4),
  old_price_lbp numeric(18,2),
  new_price_lbp numeric(18,2),
  pct_change_usd numeric(18,6),
  pct_change_lbp numeric(18,6),
  source_type text,
  source_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_price_change_log_company_changed
  ON item_price_change_log(company_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_price_change_log_item_changed
  ON item_price_change_log(company_id, item_id, changed_at DESC);

ALTER TABLE item_price_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_price_change_log_isolation ON item_price_change_log;
CREATE POLICY item_price_change_log_isolation
  ON item_price_change_log USING (company_id = app_current_company_id());

CREATE OR REPLACE FUNCTION log_item_price_change()
RETURNS trigger AS $$
DECLARE
  v_company_id uuid;
  v_old_usd numeric(18,4);
  v_old_lbp numeric(18,2);
  v_pct_usd numeric(18,6);
  v_pct_lbp numeric(18,6);
BEGIN
  SELECT company_id INTO v_company_id
  FROM items
  WHERE id = NEW.item_id;

  IF v_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Previous effective price (as of NEW.effective_from).
  SELECT ip.price_usd, ip.price_lbp
    INTO v_old_usd, v_old_lbp
  FROM item_prices ip
  WHERE ip.item_id = NEW.item_id
    AND ip.id <> NEW.id
    AND ip.effective_from <= NEW.effective_from
    AND (ip.effective_to IS NULL OR ip.effective_to >= NEW.effective_from)
  ORDER BY ip.effective_from DESC, ip.created_at DESC, ip.id DESC
  LIMIT 1;

  v_pct_usd := NULL;
  v_pct_lbp := NULL;
  IF v_old_usd IS NOT NULL AND v_old_usd > 0 AND NEW.price_usd > 0 THEN
    v_pct_usd := (NEW.price_usd - v_old_usd) / NULLIF(v_old_usd, 0);
  END IF;
  IF v_old_lbp IS NOT NULL AND v_old_lbp > 0 AND NEW.price_lbp > 0 THEN
    v_pct_lbp := (NEW.price_lbp - v_old_lbp) / NULLIF(v_old_lbp, 0);
  END IF;

  -- Avoid noisy logging: log when a previous price exists and changed, or when initializing a first price.
  IF (
      v_old_usd IS NULL
      OR v_old_lbp IS NULL
      OR COALESCE(v_old_usd, 0) <> COALESCE(NEW.price_usd, 0)
      OR COALESCE(v_old_lbp, 0) <> COALESCE(NEW.price_lbp, 0)
     ) THEN
    INSERT INTO item_price_change_log
      (company_id, item_id, item_price_id, effective_from, effective_to,
       old_price_usd, new_price_usd, old_price_lbp, new_price_lbp,
       pct_change_usd, pct_change_lbp, source_type, source_id)
    VALUES
      (v_company_id, NEW.item_id, NEW.id, NEW.effective_from, NEW.effective_to,
       v_old_usd, NEW.price_usd, v_old_lbp, NEW.price_lbp,
       v_pct_usd, v_pct_lbp, NEW.source_type, NEW.source_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_item_price_change_log ON item_prices;
CREATE TRIGGER trg_item_price_change_log
AFTER INSERT ON item_prices
FOR EACH ROW
EXECUTE FUNCTION log_item_price_change();

COMMIT;

