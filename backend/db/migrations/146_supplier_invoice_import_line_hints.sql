-- Import review line enrichments:
-- - classify non-item lines (discount/tax/freight/etc)
-- - store entered UOM + conversion hint
-- - keep entered costs separately from normalized(base) costs
-- - persist suggestion reason for reviewer transparency

ALTER TABLE supplier_invoice_import_lines
  ADD COLUMN IF NOT EXISTS line_type text NOT NULL DEFAULT 'item',
  ADD COLUMN IF NOT EXISTS entered_uom_code text,
  ADD COLUMN IF NOT EXISTS entered_qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_entered_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_entered_lbp numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suggested_match_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'supplier_invoice_import_lines_line_type_check'
      AND conrelid = 'supplier_invoice_import_lines'::regclass
  ) THEN
    ALTER TABLE supplier_invoice_import_lines
      ADD CONSTRAINT supplier_invoice_import_lines_line_type_check
      CHECK (line_type IN ('item', 'free_item', 'discount', 'tax', 'freight', 'other'));
  END IF;
END$$;

-- Backfill existing rows for consistent editing math.
UPDATE supplier_invoice_import_lines
SET
  entered_qty_factor = CASE
    WHEN COALESCE(entered_qty_factor, 0) <= 0 THEN 1
    ELSE entered_qty_factor
  END,
  qty_entered = CASE
    WHEN COALESCE(qty_entered, 0) = 0 THEN COALESCE(qty, 0)
    ELSE qty_entered
  END,
  unit_cost_entered_usd = CASE
    WHEN COALESCE(unit_cost_entered_usd, 0) = 0 THEN COALESCE(unit_cost_usd, 0) * CASE WHEN COALESCE(entered_qty_factor, 0) > 0 THEN entered_qty_factor ELSE 1 END
    ELSE unit_cost_entered_usd
  END,
  unit_cost_entered_lbp = CASE
    WHEN COALESCE(unit_cost_entered_lbp, 0) = 0 THEN COALESCE(unit_cost_lbp, 0) * CASE WHEN COALESCE(entered_qty_factor, 0) > 0 THEN entered_qty_factor ELSE 1 END
    ELSE unit_cost_entered_lbp
  END
WHERE true;

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_import_lines_line_type
  ON supplier_invoice_import_lines(company_id, supplier_invoice_id, line_type, status);
