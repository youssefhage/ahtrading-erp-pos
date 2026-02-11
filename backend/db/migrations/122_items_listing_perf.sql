-- Improve catalog items list performance for server-side pagination/sorting.
-- Supports:
-- - WHERE company_id = ? ORDER BY sku LIMIT/OFFSET
-- - WHERE company_id = ? AND is_active = ? ORDER BY sku LIMIT/OFFSET

CREATE INDEX IF NOT EXISTS idx_items_company_sku
  ON items(company_id, sku);

CREATE INDEX IF NOT EXISTS idx_items_company_active_sku
  ON items(company_id, is_active, sku);
