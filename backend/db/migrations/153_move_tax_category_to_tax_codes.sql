-- Move tax_category from items to tax_codes
-- The category (standard/zero/exempt) is a property of the tax code itself,
-- not of each individual item.

-- 1. Add column to tax_codes
ALTER TABLE tax_codes
  ADD COLUMN IF NOT EXISTS tax_category text;

ALTER TABLE tax_codes
  DROP CONSTRAINT IF EXISTS chk_tax_codes_tax_category;
ALTER TABLE tax_codes
  ADD CONSTRAINT chk_tax_codes_tax_category
  CHECK (tax_category IS NULL OR tax_category IN ('standard', 'zero', 'exempt'));

-- 2. Backfill from items: for each tax code pick the most common category
UPDATE tax_codes tc
SET tax_category = sub.tax_category
FROM (
  SELECT DISTINCT ON (tax_code_id)
         tax_code_id,
         tax_category
  FROM (
    SELECT tax_code_id,
           tax_category,
           COUNT(*) AS cnt
    FROM items
    WHERE tax_code_id IS NOT NULL
      AND tax_category IS NOT NULL
    GROUP BY tax_code_id, tax_category
  ) agg
  ORDER BY tax_code_id, cnt DESC
) sub
WHERE tc.id = sub.tax_code_id
  AND tc.tax_category IS NULL;

-- 3. Keep items.tax_category column intact (no DROP) for safety.
--    Application code will stop reading/writing it.
