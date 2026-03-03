-- Upgrade from simple exempt_category_ids to rich category_overrides.
-- Each override can be: exempt, custom markup_pct, or custom discount_pct.
-- Format: [{"category_id":"uuid","mode":"exempt"|"markup_pct"|"discount_pct","pct":0.02}]

ALTER TABLE price_list_derivations
  ADD COLUMN IF NOT EXISTS category_overrides jsonb NOT NULL DEFAULT '[]';

-- Migrate existing exempt_category_ids into the new format
UPDATE price_list_derivations
SET category_overrides = (
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('category_id', cat_id::text, 'mode', 'exempt', 'pct', 0)),
    '[]'::jsonb
  )
  FROM unnest(exempt_category_ids) AS cat_id
)
WHERE exempt_category_ids IS NOT NULL AND array_length(exempt_category_ids, 1) > 0;

-- Drop the old column
ALTER TABLE price_list_derivations DROP COLUMN IF EXISTS exempt_category_ids;
