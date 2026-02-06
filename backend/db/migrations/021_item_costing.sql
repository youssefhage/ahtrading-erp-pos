-- Weighted moving average costing per item per warehouse.
-- Maintains current on-hand qty and avg costs in a summary table.
-- Also auto-fills outbound stock_moves cost using current average when missing.

CREATE TABLE IF NOT EXISTS item_warehouse_costs (
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES items(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  on_hand_qty numeric(18,4) NOT NULL DEFAULT 0,
  avg_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  avg_cost_lbp numeric(18,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, item_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_item_warehouse_costs_company ON item_warehouse_costs(company_id);
CREATE INDEX IF NOT EXISTS idx_item_warehouse_costs_item_wh ON item_warehouse_costs(item_id, warehouse_id);

ALTER TABLE item_warehouse_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_warehouse_costs_isolation
  ON item_warehouse_costs USING (company_id = app_current_company_id());

CREATE OR REPLACE FUNCTION stock_moves_apply_costing()
RETURNS trigger AS $$
DECLARE
  v_on_hand numeric(18,4);
  v_avg_usd numeric(18,4);
  v_avg_lbp numeric(18,2);
  v_new_on_hand numeric(18,4);
  v_new_avg_usd numeric(18,4);
  v_new_avg_lbp numeric(18,2);
  v_qty_in numeric(18,4);
  v_qty_out numeric(18,4);
BEGIN
  v_qty_in := COALESCE(NEW.qty_in, 0);
  v_qty_out := COALESCE(NEW.qty_out, 0);

  IF v_qty_in > 0 AND v_qty_out > 0 THEN
    RAISE EXCEPTION 'stock_moves cannot have both qty_in and qty_out (id=%)', NEW.id;
  END IF;

  IF v_qty_in = 0 AND v_qty_out = 0 THEN
    RETURN NEW;
  END IF;

  -- Ensure a summary row exists, then lock it for update.
  INSERT INTO item_warehouse_costs (company_id, item_id, warehouse_id)
  VALUES (NEW.company_id, NEW.item_id, NEW.warehouse_id)
  ON CONFLICT DO NOTHING;

  SELECT on_hand_qty, avg_cost_usd, avg_cost_lbp
    INTO v_on_hand, v_avg_usd, v_avg_lbp
  FROM item_warehouse_costs
  WHERE company_id = NEW.company_id
    AND item_id = NEW.item_id
    AND warehouse_id = NEW.warehouse_id
  FOR UPDATE;

  IF v_qty_out > 0 THEN
    -- Auto-fill outbound move cost when missing/zero.
    IF COALESCE(NEW.unit_cost_usd, 0) = 0 AND COALESCE(NEW.unit_cost_lbp, 0) = 0 THEN
      NEW.unit_cost_usd := COALESCE(v_avg_usd, 0);
      NEW.unit_cost_lbp := COALESCE(v_avg_lbp, 0);
    END IF;

    v_new_on_hand := v_on_hand - v_qty_out;
    v_new_avg_usd := v_avg_usd;
    v_new_avg_lbp := v_avg_lbp;
  ELSE
    -- Inbound move updates average cost.
    v_new_on_hand := v_on_hand + v_qty_in;

    IF v_new_on_hand > 0 THEN
      v_new_avg_usd := ((v_on_hand * v_avg_usd) + (v_qty_in * COALESCE(NEW.unit_cost_usd, 0))) / v_new_on_hand;
      v_new_avg_lbp := ((v_on_hand * v_avg_lbp) + (v_qty_in * COALESCE(NEW.unit_cost_lbp, 0))) / v_new_on_hand;
    ELSE
      v_new_avg_usd := COALESCE(NEW.unit_cost_usd, 0);
      v_new_avg_lbp := COALESCE(NEW.unit_cost_lbp, 0);
    END IF;
  END IF;

  UPDATE item_warehouse_costs
  SET on_hand_qty = v_new_on_hand,
      avg_cost_usd = v_new_avg_usd,
      avg_cost_lbp = v_new_avg_lbp,
      updated_at = now()
  WHERE company_id = NEW.company_id
    AND item_id = NEW.item_id
    AND warehouse_id = NEW.warehouse_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_moves_costing ON stock_moves;
CREATE TRIGGER trg_stock_moves_costing
BEFORE INSERT ON stock_moves
FOR EACH ROW
EXECUTE FUNCTION stock_moves_apply_costing();

