-- Repair legacy 4-decimal UOM factors imported from ERPNext and downstream qty_entered drift.
--
-- Scope:
-- 1) Master data:
--    - For item_uom_conversions factors that look like truncated reciprocals
--      (e.g. 0.0833 for 1/12), normalize to 6dp reciprocal precision.
--    - Re-sync item_barcodes.qty_factor from canonical conversions.
--
-- 2) Transaction lines:
--    - For lines where qty_entered matches canonical back-calculation (qty/qty_factor)
--      and differs meaningfully from the legacy 4dp-compatible back-calculation,
--      rewrite qty_entered to the legacy-compatible value.
--    - This repairs rows affected by the temporary compat-path mutation bug.

BEGIN;

-- 1) Normalize legacy 4dp reciprocal-like factors to canonical 6dp.
UPDATE item_uom_conversions c
SET to_base_factor = cand.f6,
    updated_at = now()
FROM LATERAL (
    SELECT ROUND((1::numeric / n)::numeric, 6) AS f6
    FROM generate_series(2, 1000) AS s(n)
    WHERE ROUND((1::numeric / n)::numeric, 4) = ROUND(c.to_base_factor, 4)
    ORDER BY ABS(ROUND((1::numeric / n)::numeric, 6) - c.to_base_factor), n
    LIMIT 1
) cand
WHERE c.to_base_factor > 0
  AND c.to_base_factor < 1
  AND c.to_base_factor = ROUND(c.to_base_factor, 4)
  AND ABS(cand.f6 - c.to_base_factor) > 0
  AND ABS(cand.f6 - c.to_base_factor) <= 0.00005;

-- Keep barcode factors aligned with canonical conversions.
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

-- 2) Repair qty_entered drift where canonical recomputation mutated entered UOM qty.
-- Sales invoice lines
WITH candidates AS (
    SELECT l.id,
           ROUND(l.qty / ROUND(l.qty_factor, 4), 6) AS qe_legacy,
           ROUND(l.qty / l.qty_factor, 6) AS qe_canonical
    FROM sales_invoice_lines l
    WHERE COALESCE(l.qty_factor, 0) > 0
      AND ROUND(l.qty_factor, 6) <> ROUND(l.qty_factor, 4)
)
UPDATE sales_invoice_lines l
SET qty_entered = c.qe_legacy
FROM candidates c
WHERE c.id = l.id
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_canonical) <= 0.000001
  AND ABS(l.qty - ROUND(c.qe_legacy * ROUND(l.qty_factor, 4), 6)) <= 0.000001
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_legacy) >= 0.000050;

-- Sales return lines
WITH candidates AS (
    SELECT l.id,
           ROUND(l.qty / ROUND(l.qty_factor, 4), 6) AS qe_legacy,
           ROUND(l.qty / l.qty_factor, 6) AS qe_canonical
    FROM sales_return_lines l
    WHERE COALESCE(l.qty_factor, 0) > 0
      AND ROUND(l.qty_factor, 6) <> ROUND(l.qty_factor, 4)
)
UPDATE sales_return_lines l
SET qty_entered = c.qe_legacy
FROM candidates c
WHERE c.id = l.id
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_canonical) <= 0.000001
  AND ABS(l.qty - ROUND(c.qe_legacy * ROUND(l.qty_factor, 4), 6)) <= 0.000001
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_legacy) >= 0.000050;

-- Purchase order lines
WITH candidates AS (
    SELECT l.id,
           ROUND(l.qty / ROUND(l.qty_factor, 4), 6) AS qe_legacy,
           ROUND(l.qty / l.qty_factor, 6) AS qe_canonical
    FROM purchase_order_lines l
    WHERE COALESCE(l.qty_factor, 0) > 0
      AND ROUND(l.qty_factor, 6) <> ROUND(l.qty_factor, 4)
)
UPDATE purchase_order_lines l
SET qty_entered = c.qe_legacy
FROM candidates c
WHERE c.id = l.id
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_canonical) <= 0.000001
  AND ABS(l.qty - ROUND(c.qe_legacy * ROUND(l.qty_factor, 4), 6)) <= 0.000001
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_legacy) >= 0.000050;

-- Goods receipt lines
WITH candidates AS (
    SELECT l.id,
           ROUND(l.qty / ROUND(l.qty_factor, 4), 6) AS qe_legacy,
           ROUND(l.qty / l.qty_factor, 6) AS qe_canonical
    FROM goods_receipt_lines l
    WHERE COALESCE(l.qty_factor, 0) > 0
      AND ROUND(l.qty_factor, 6) <> ROUND(l.qty_factor, 4)
)
UPDATE goods_receipt_lines l
SET qty_entered = c.qe_legacy
FROM candidates c
WHERE c.id = l.id
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_canonical) <= 0.000001
  AND ABS(l.qty - ROUND(c.qe_legacy * ROUND(l.qty_factor, 4), 6)) <= 0.000001
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_legacy) >= 0.000050;

-- Supplier invoice lines
WITH candidates AS (
    SELECT l.id,
           ROUND(l.qty / ROUND(l.qty_factor, 4), 6) AS qe_legacy,
           ROUND(l.qty / l.qty_factor, 6) AS qe_canonical
    FROM supplier_invoice_lines l
    WHERE COALESCE(l.qty_factor, 0) > 0
      AND ROUND(l.qty_factor, 6) <> ROUND(l.qty_factor, 4)
)
UPDATE supplier_invoice_lines l
SET qty_entered = c.qe_legacy
FROM candidates c
WHERE c.id = l.id
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_canonical) <= 0.000001
  AND ABS(l.qty - ROUND(c.qe_legacy * ROUND(l.qty_factor, 4), 6)) <= 0.000001
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_legacy) >= 0.000050;

-- Stock transfer lines
WITH candidates AS (
    SELECT l.id,
           ROUND(l.qty / ROUND(l.qty_factor, 4), 6) AS qe_legacy,
           ROUND(l.qty / l.qty_factor, 6) AS qe_canonical
    FROM stock_transfer_lines l
    WHERE COALESCE(l.qty_factor, 0) > 0
      AND ROUND(l.qty_factor, 6) <> ROUND(l.qty_factor, 4)
)
UPDATE stock_transfer_lines l
SET qty_entered = c.qe_legacy
FROM candidates c
WHERE c.id = l.id
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_canonical) <= 0.000001
  AND ABS(l.qty - ROUND(c.qe_legacy * ROUND(l.qty_factor, 4), 6)) <= 0.000001
  AND ABS(COALESCE(l.qty_entered, 0) - c.qe_legacy) >= 0.000050;

COMMIT;
