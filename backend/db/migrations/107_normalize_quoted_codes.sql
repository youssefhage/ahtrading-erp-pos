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
WHERE sku ~ '^\".+\"$'
  AND NOT EXISTS (
    SELECT 1
    FROM items i2
    WHERE i2.company_id = items.company_id
      AND i2.sku = regexp_replace(items.sku, '^\"+|\"+$', '', 'g')
  );

UPDATE customers
SET code = regexp_replace(code, '^\"+|\"+$', '', 'g')
WHERE code ~ '^\".+\"$'
  AND NOT EXISTS (
    SELECT 1
    FROM customers c2
    WHERE c2.company_id = customers.company_id
      AND c2.code = regexp_replace(customers.code, '^\"+|\"+$', '', 'g')
  );

UPDATE suppliers
SET code = regexp_replace(code, '^\"+|\"+$', '', 'g')
WHERE code ~ '^\".+\"$'
  AND NOT EXISTS (
    SELECT 1
    FROM suppliers s2
    WHERE s2.company_id = suppliers.company_id
      AND s2.code = regexp_replace(suppliers.code, '^\"+|\"+$', '', 'g')
  );

COMMIT;
