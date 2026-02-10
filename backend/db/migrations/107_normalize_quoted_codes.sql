-- Normalize quoted codes coming from some ERPNext CSV exports.
--
-- Observed issue:
-- - Some exports wrap IDs as a literal string containing quotes, e.g. `"ALBUZ-001"` (quotes included).
-- - If imported as-is, SKU/code becomes harder to search and breaks downstream assumptions.
--
-- This migration strips leading/trailing double-quotes from:
-- - items.sku
-- - customers.code
-- - suppliers.code
--
-- It only affects rows that actually start/end with quotes.

BEGIN;

UPDATE items
SET sku = regexp_replace(sku, '^\"+|\"+$', '', 'g')
WHERE sku ~ '^\".+\"$';

UPDATE customers
SET code = regexp_replace(code, '^\"+|\"+$', '', 'g')
WHERE code ~ '^\".+\"$';

UPDATE suppliers
SET code = regexp_replace(code, '^\"+|\"+$', '', 'g')
WHERE code ~ '^\".+\"$';

COMMIT;

