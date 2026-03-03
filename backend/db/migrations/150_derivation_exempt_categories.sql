-- Allow price derivation rules to exempt specific item categories.
-- Items in exempt categories are skipped during derivation runs.

ALTER TABLE price_list_derivations
  ADD COLUMN IF NOT EXISTS exempt_category_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN price_list_derivations.exempt_category_ids IS
  'Item categories to skip when running this derivation rule';
