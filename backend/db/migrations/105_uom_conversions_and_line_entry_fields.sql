-- Robust UOM conversions + document-line "entered vs base" fields.
--
-- Goals:
-- - Keep inventory math in base UOM per item (existing `items.unit_of_measure`).
-- - Allow alternate UOM entry (CASE/BOX/EA) via per-item conversions.
-- - Persist the conversion used on every document line so history never changes.
--
-- This migration is intentionally additive and backward-compatible:
-- - Existing `qty` columns remain the canonical *base qty* used for stock moves/costing.
-- - New columns capture the cashier/user-entered qty/UOM + the factor used at posting time.

BEGIN;

-- 1) UOM master: add precision + RLS (missing in 104).
ALTER TABLE unit_of_measures
  ADD COLUMN IF NOT EXISTS precision int;

UPDATE unit_of_measures
SET precision = 0
WHERE precision IS NULL;

ALTER TABLE unit_of_measures
  ALTER COLUMN precision SET NOT NULL;

ALTER TABLE unit_of_measures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unit_of_measures_isolation ON unit_of_measures;
CREATE POLICY unit_of_measures_isolation
  ON unit_of_measures USING (company_id = app_current_company_id());

-- 2) Per-item conversions: uom_code -> base factor (to_base_factor).
CREATE TABLE IF NOT EXISTS item_uom_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  uom_code text NOT NULL,
  to_base_factor numeric(18,6) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, item_id, uom_code),
  CONSTRAINT item_uom_conversions_factor_check CHECK (to_base_factor > 0)
);

-- FK to UOM master (composite).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema='public'
      AND table_name='item_uom_conversions'
      AND constraint_name='item_uom_conversions_uom_fk'
  ) THEN
    ALTER TABLE item_uom_conversions
      ADD CONSTRAINT item_uom_conversions_uom_fk
      FOREIGN KEY (company_id, uom_code)
      REFERENCES unit_of_measures(company_id, code)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

-- Updated-at trigger if present.
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

ALTER TABLE item_uom_conversions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_uom_conversions_isolation ON item_uom_conversions;
CREATE POLICY item_uom_conversions_isolation
  ON item_uom_conversions USING (company_id = app_current_company_id());

-- Ensure base conversion exists for every item (uom_code = items.unit_of_measure, factor=1).
INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
SELECT gen_random_uuid(), i.company_id, i.id, i.unit_of_measure, 1, true
FROM items i
ON CONFLICT (company_id, item_id, uom_code)
DO UPDATE SET to_base_factor = EXCLUDED.to_base_factor,
              is_active = true,
              updated_at = now();

-- 3) Barcodes: attach an explicit UOM code (optional) in addition to qty_factor.
ALTER TABLE item_barcodes
  ADD COLUMN IF NOT EXISTS uom_code text;

-- Backfill existing barcodes to base UOM for clarity.
UPDATE item_barcodes b
SET uom_code = i.unit_of_measure
FROM items i
WHERE i.company_id = b.company_id
  AND i.id = b.item_id
  AND COALESCE(BTRIM(b.uom_code), '') = '';

-- Composite FK for barcode UOM.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema='public'
      AND table_name='item_barcodes'
      AND constraint_name='item_barcodes_uom_fk'
  ) THEN
    ALTER TABLE item_barcodes
      ADD CONSTRAINT item_barcodes_uom_fk
      FOREIGN KEY (company_id, uom_code)
      REFERENCES unit_of_measures(company_id, code)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

-- Keep conversions in sync: if a barcode declares a UOM, ensure a conversion row exists (best effort).
INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
SELECT gen_random_uuid(), b.company_id, b.item_id, b.uom_code, b.qty_factor::numeric(18,6), true
FROM item_barcodes b
WHERE b.uom_code IS NOT NULL
ON CONFLICT (company_id, item_id, uom_code)
DO UPDATE SET to_base_factor = EXCLUDED.to_base_factor,
              is_active = true,
              updated_at = now();

-- 4) Document lines: add entered qty/UOM + factor used at posting time.
--
-- Convention:
-- - `qty` stays base qty (what stock moves and costing use).
-- - `qty_entered` is what the user entered in `uom`.
-- - `qty_factor` converts entered qty -> base qty: qty = qty_entered * qty_factor.
--
-- Sales invoice lines already have `uom` + `qty_factor` via migration 069.
ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_price_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_price_entered_lbp numeric(18,2);

-- Backfill sales invoice lines (best effort; old rows are base UOM, factor=1).
UPDATE sales_invoice_lines l
SET qty_factor = 1
WHERE qty_factor IS NULL;

UPDATE sales_invoice_lines l
SET qty_entered = (l.qty / NULLIF(l.qty_factor, 0))
WHERE l.qty_entered IS NULL;

UPDATE sales_invoice_lines l
SET unit_price_entered_usd = (l.unit_price_usd * l.qty_factor),
    unit_price_entered_lbp = (l.unit_price_lbp * l.qty_factor)
WHERE (l.unit_price_entered_usd IS NULL OR l.unit_price_entered_lbp IS NULL);

-- Ensure uom defaulted to item base when missing.
UPDATE sales_invoice_lines l
SET uom = it.unit_of_measure
FROM sales_invoices si
JOIN items it
  ON it.company_id = si.company_id AND it.id = l.item_id
WHERE si.id = l.invoice_id
  AND COALESCE(BTRIM(l.uom), '') = '';

-- Other line tables: add uom/qty_factor/qty_entered (+ entered unit cost/price).
ALTER TABLE sales_return_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_price_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_price_entered_lbp numeric(18,2);

ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_lbp numeric(18,2);

ALTER TABLE goods_receipt_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_lbp numeric(18,2);

ALTER TABLE supplier_invoice_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_lbp numeric(18,2);

ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,4);

-- Backfills for these line tables (assume historical rows are base UOM, factor=1).
UPDATE sales_return_lines l
SET uom = it.unit_of_measure
FROM items it
WHERE it.company_id = l.company_id AND it.id = l.item_id
  AND COALESCE(BTRIM(l.uom), '') = '';

UPDATE sales_return_lines
SET qty_entered = qty / NULLIF(qty_factor, 0)
WHERE qty_entered IS NULL;

UPDATE sales_return_lines
SET unit_price_entered_usd = unit_price_usd * qty_factor,
    unit_price_entered_lbp = unit_price_lbp * qty_factor
WHERE unit_price_entered_usd IS NULL OR unit_price_entered_lbp IS NULL;

UPDATE purchase_order_lines l
SET uom = it.unit_of_measure
FROM items it
WHERE it.company_id = l.company_id AND it.id = l.item_id
  AND COALESCE(BTRIM(l.uom), '') = '';

UPDATE purchase_order_lines
SET qty_entered = qty / NULLIF(qty_factor, 0)
WHERE qty_entered IS NULL;

UPDATE purchase_order_lines
SET unit_cost_entered_usd = unit_cost_usd * qty_factor,
    unit_cost_entered_lbp = unit_cost_lbp * qty_factor
WHERE unit_cost_entered_usd IS NULL OR unit_cost_entered_lbp IS NULL;

UPDATE goods_receipt_lines l
SET uom = it.unit_of_measure
FROM items it
WHERE it.company_id = l.company_id AND it.id = l.item_id
  AND COALESCE(BTRIM(l.uom), '') = '';

UPDATE goods_receipt_lines
SET qty_entered = qty / NULLIF(qty_factor, 0)
WHERE qty_entered IS NULL;

UPDATE goods_receipt_lines
SET unit_cost_entered_usd = unit_cost_usd * qty_factor,
    unit_cost_entered_lbp = unit_cost_lbp * qty_factor
WHERE unit_cost_entered_usd IS NULL OR unit_cost_entered_lbp IS NULL;

UPDATE supplier_invoice_lines l
SET uom = it.unit_of_measure
FROM items it
WHERE it.company_id = l.company_id AND it.id = l.item_id
  AND COALESCE(BTRIM(l.uom), '') = '';

UPDATE supplier_invoice_lines
SET qty_entered = qty / NULLIF(qty_factor, 0)
WHERE qty_entered IS NULL;

UPDATE supplier_invoice_lines
SET unit_cost_entered_usd = unit_cost_usd * qty_factor,
    unit_cost_entered_lbp = unit_cost_lbp * qty_factor
WHERE unit_cost_entered_usd IS NULL OR unit_cost_entered_lbp IS NULL;

UPDATE stock_transfer_lines l
SET uom = it.unit_of_measure
FROM items it
WHERE it.company_id = l.company_id AND it.id = l.item_id
  AND COALESCE(BTRIM(l.uom), '') = '';

UPDATE stock_transfer_lines
SET qty_entered = qty / NULLIF(qty_factor, 0)
WHERE qty_entered IS NULL;

-- Make qty_entered NOT NULL (after backfill) for critical doc lines.
ALTER TABLE sales_invoice_lines
  ALTER COLUMN qty_entered SET NOT NULL;
ALTER TABLE sales_return_lines
  ALTER COLUMN qty_entered SET NOT NULL;
ALTER TABLE purchase_order_lines
  ALTER COLUMN qty_entered SET NOT NULL;
ALTER TABLE goods_receipt_lines
  ALTER COLUMN qty_entered SET NOT NULL;
ALTER TABLE supplier_invoice_lines
  ALTER COLUMN qty_entered SET NOT NULL;
ALTER TABLE stock_transfer_lines
  ALTER COLUMN qty_entered SET NOT NULL;

COMMIT;

