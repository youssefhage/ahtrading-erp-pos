-- Make price list items idempotent by (company, list, item, effective_from).
-- This enables safe reruns of derived-list generation and bulk updates.

-- 1) Deduplicate existing rows so the unique index can be created safely.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, price_list_id, item_id, effective_from
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM price_list_items
)
DELETE FROM price_list_items p
USING ranked r
WHERE p.id = r.id AND r.rn > 1;

-- 2) Add unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_list_items_effective
  ON price_list_items(company_id, price_list_id, item_id, effective_from);

