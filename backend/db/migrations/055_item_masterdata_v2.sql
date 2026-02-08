-- Expand item master data to support real operations (tracking + lifecycle).

BEGIN;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES item_categories(id),
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS track_batches boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS track_expiry boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_shelf_life_days integer,
  ADD COLUMN IF NOT EXISTS min_shelf_life_days_for_sale integer,
  ADD COLUMN IF NOT EXISTS expiry_warning_days integer;

CREATE INDEX IF NOT EXISTS idx_items_company_active ON items(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_items_company_category ON items(company_id, category_id);

COMMIT;

