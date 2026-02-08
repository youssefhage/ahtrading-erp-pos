-- Per-item override for negative stock policy (company default lives in company_settings key='inventory').
-- NULL means "inherit from company policy" for backward compatibility.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean;

CREATE INDEX IF NOT EXISTS idx_items_company_allow_negative_stock
  ON items(company_id, allow_negative_stock)
  WHERE allow_negative_stock IS NOT NULL;

