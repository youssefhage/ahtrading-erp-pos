-- Price intelligence foundation: log meaningful item average-cost changes over time.
-- This supports "price impact" task generation when costs change.

CREATE TABLE IF NOT EXISTS item_cost_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES items(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  on_hand_qty numeric(18,4) NOT NULL DEFAULT 0,
  old_avg_cost_usd numeric(18,4),
  new_avg_cost_usd numeric(18,4),
  old_avg_cost_lbp numeric(18,2),
  new_avg_cost_lbp numeric(18,2),
  pct_change_usd numeric(18,6),
  pct_change_lbp numeric(18,6),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_cost_change_log_company_changed
  ON item_cost_change_log(company_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_cost_change_log_item_changed
  ON item_cost_change_log(company_id, item_id, changed_at DESC);

ALTER TABLE item_cost_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_cost_change_log_isolation ON item_cost_change_log;
CREATE POLICY item_cost_change_log_isolation
  ON item_cost_change_log USING (company_id = app_current_company_id());

CREATE OR REPLACE FUNCTION log_item_warehouse_cost_change()
RETURNS trigger AS $$
DECLARE
  v_pct_usd numeric(18,6);
  v_pct_lbp numeric(18,6);
BEGIN
  IF (COALESCE(OLD.avg_cost_usd, 0) = COALESCE(NEW.avg_cost_usd, 0))
     AND (COALESCE(OLD.avg_cost_lbp, 0) = COALESCE(NEW.avg_cost_lbp, 0)) THEN
    RETURN NEW;
  END IF;

  v_pct_usd := NULL;
  v_pct_lbp := NULL;
  IF COALESCE(OLD.avg_cost_usd, 0) > 0 AND COALESCE(NEW.avg_cost_usd, 0) > 0 THEN
    v_pct_usd := (NEW.avg_cost_usd - OLD.avg_cost_usd) / NULLIF(OLD.avg_cost_usd, 0);
  END IF;
  IF COALESCE(OLD.avg_cost_lbp, 0) > 0 AND COALESCE(NEW.avg_cost_lbp, 0) > 0 THEN
    v_pct_lbp := (NEW.avg_cost_lbp - OLD.avg_cost_lbp) / NULLIF(OLD.avg_cost_lbp, 0);
  END IF;

  -- Avoid noisy logging: only keep meaningful changes OR first-time cost initialization.
  IF (
      (v_pct_usd IS NOT NULL AND abs(v_pct_usd) >= 0.05)
      OR (v_pct_lbp IS NOT NULL AND abs(v_pct_lbp) >= 0.05)
      OR (COALESCE(OLD.avg_cost_usd, 0) = 0 AND COALESCE(NEW.avg_cost_usd, 0) > 0)
      OR (COALESCE(OLD.avg_cost_lbp, 0) = 0 AND COALESCE(NEW.avg_cost_lbp, 0) > 0)
     ) THEN
    INSERT INTO item_cost_change_log
      (company_id, item_id, warehouse_id, on_hand_qty,
       old_avg_cost_usd, new_avg_cost_usd, old_avg_cost_lbp, new_avg_cost_lbp,
       pct_change_usd, pct_change_lbp)
    VALUES
      (NEW.company_id, NEW.item_id, NEW.warehouse_id, NEW.on_hand_qty,
       OLD.avg_cost_usd, NEW.avg_cost_usd, OLD.avg_cost_lbp, NEW.avg_cost_lbp,
       v_pct_usd, v_pct_lbp);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_item_warehouse_cost_change_log ON item_warehouse_costs;
CREATE TRIGGER trg_item_warehouse_cost_change_log
AFTER UPDATE OF avg_cost_usd, avg_cost_lbp ON item_warehouse_costs
FOR EACH ROW
EXECUTE FUNCTION log_item_warehouse_cost_change();

