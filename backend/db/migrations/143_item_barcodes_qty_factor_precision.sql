-- Keep barcode factors aligned with canonical UOM conversion precision.
--
-- Why:
-- - item_uom_conversions stores to_base_factor as numeric(18,6) and is the source of truth.
-- - item_barcodes.qty_factor was numeric(18,4), which could truncate values like 0.083333 -> 0.0833.
-- - That truncation can later fail strict sale-line validation.

BEGIN;

ALTER TABLE item_barcodes
  ALTER COLUMN qty_factor TYPE numeric(18,6)
  USING qty_factor::numeric(18,6);

-- Backfill barcode factors from canonical conversions where possible.
UPDATE item_barcodes b
SET qty_factor = c.to_base_factor,
    updated_at = now()
FROM item_uom_conversions c
WHERE c.company_id = b.company_id
  AND c.item_id = b.item_id
  AND c.uom_code = b.uom_code
  AND b.qty_factor IS DISTINCT FROM c.to_base_factor;

-- Base-UOM barcodes must always map to factor 1.
UPDATE item_barcodes b
SET qty_factor = 1,
    updated_at = now()
FROM items i
WHERE i.company_id = b.company_id
  AND i.id = b.item_id
  AND b.uom_code = i.unit_of_measure
  AND b.qty_factor IS DISTINCT FROM 1;

COMMIT;
