-- Extend price change logging to cover price_list_items changes.
-- Previously, only item_prices INSERT was tracked (migration 095).
-- This closes the gap: price list-based price edits now appear in item_price_change_log.

BEGIN;

-- ============================================================
-- 1. Schema additions to item_price_change_log
-- ============================================================

ALTER TABLE item_price_change_log
  ADD COLUMN IF NOT EXISTS price_list_item_id uuid REFERENCES price_list_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_list_id uuid,
  ADD COLUMN IF NOT EXISTS changed_by_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_ipcl_price_list_item
  ON item_price_change_log(price_list_item_id) WHERE price_list_item_id IS NOT NULL;

-- ============================================================
-- 2. Helper: read current user from session variable
-- ============================================================

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- 3. Trigger function for price_list_items
-- ============================================================

CREATE OR REPLACE FUNCTION log_price_list_item_change()
RETURNS trigger AS $$
DECLARE
  v_old_usd numeric(18,4);
  v_old_lbp numeric(18,2);
  v_pct_usd numeric(18,6);
  v_pct_lbp numeric(18,6);
BEGIN
  -- For UPDATE: use OLD row values directly
  IF TG_OP = 'UPDATE' THEN
    v_old_usd := OLD.price_usd;
    v_old_lbp := OLD.price_lbp;
  ELSE
    -- For INSERT: look up the most recent effective price for the same
    -- (company_id, price_list_id, item_id) before this entry.
    SELECT pli.price_usd, pli.price_lbp
      INTO v_old_usd, v_old_lbp
    FROM price_list_items pli
    WHERE pli.company_id = NEW.company_id
      AND pli.price_list_id = NEW.price_list_id
      AND pli.item_id = NEW.item_id
      AND pli.id <> NEW.id
      AND pli.effective_from <= NEW.effective_from
      AND (pli.effective_to IS NULL OR pli.effective_to >= NEW.effective_from)
    ORDER BY pli.effective_from DESC, pli.created_at DESC, pli.id DESC
    LIMIT 1;
  END IF;

  -- Calculate percentage changes
  v_pct_usd := NULL;
  v_pct_lbp := NULL;
  IF v_old_usd IS NOT NULL AND v_old_usd > 0 AND NEW.price_usd > 0 THEN
    v_pct_usd := (NEW.price_usd - v_old_usd) / NULLIF(v_old_usd, 0);
  END IF;
  IF v_old_lbp IS NOT NULL AND v_old_lbp > 0 AND NEW.price_lbp > 0 THEN
    v_pct_lbp := (NEW.price_lbp - v_old_lbp) / NULLIF(v_old_lbp, 0);
  END IF;

  -- Noise suppression: only log when prices actually changed or first entry
  IF (
      v_old_usd IS NULL
      OR v_old_lbp IS NULL
      OR COALESCE(v_old_usd, 0) <> COALESCE(NEW.price_usd, 0)
      OR COALESCE(v_old_lbp, 0) <> COALESCE(NEW.price_lbp, 0)
     ) THEN
    INSERT INTO item_price_change_log
      (company_id, item_id, price_list_item_id, price_list_id,
       effective_from, effective_to,
       old_price_usd, new_price_usd, old_price_lbp, new_price_lbp,
       pct_change_usd, pct_change_lbp,
       source_type, source_id, changed_by_user_id)
    VALUES
      (NEW.company_id, NEW.item_id, NEW.id, NEW.price_list_id,
       NEW.effective_from, NEW.effective_to,
       v_old_usd, NEW.price_usd, v_old_lbp, NEW.price_lbp,
       v_pct_usd, v_pct_lbp,
       'price_list', NEW.price_list_id, app_current_user_id());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_price_list_item_change_log ON price_list_items;
CREATE TRIGGER trg_price_list_item_change_log
AFTER INSERT OR UPDATE ON price_list_items
FOR EACH ROW
EXECUTE FUNCTION log_price_list_item_change();

-- ============================================================
-- 4. Backfill: log existing price_list_items that have no entry
-- ============================================================

INSERT INTO item_price_change_log
  (company_id, item_id, price_list_item_id, price_list_id,
   effective_from, effective_to,
   old_price_usd, new_price_usd, old_price_lbp, new_price_lbp,
   pct_change_usd, pct_change_lbp,
   source_type, source_id, changed_at)
SELECT
  pli.company_id, pli.item_id, pli.id, pli.price_list_id,
  pli.effective_from, pli.effective_to,
  NULL, pli.price_usd, NULL, pli.price_lbp,
  NULL, NULL,
  'price_list', pli.price_list_id, COALESCE(pli.created_at, now())
FROM price_list_items pli
WHERE NOT EXISTS (
  SELECT 1 FROM item_price_change_log c
  WHERE c.price_list_item_id = pli.id
);

COMMIT;
