-- Item master data extras (packaging, costing hints, logistics, integrations).
--
-- Keep all fields optional/nullable where possible to avoid backfill locks.

BEGIN;

-- Secondary/default UOMs (still uses item_uom_conversions for actual factors).
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS purchase_uom_code text,
  ADD COLUMN IF NOT EXISTS sales_uom_code text;

-- Packaging (explicit, optional).
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS case_pack_qty numeric(18,4),
  ADD COLUMN IF NOT EXISTS inner_pack_qty numeric(18,4);

ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_case_pack_qty;
ALTER TABLE items
  ADD CONSTRAINT chk_items_case_pack_qty CHECK (case_pack_qty IS NULL OR case_pack_qty > 0);

ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_inner_pack_qty;
ALTER TABLE items
  ADD CONSTRAINT chk_items_inner_pack_qty CHECK (inner_pack_qty IS NULL OR inner_pack_qty > 0);

-- Costing and pricing hints (optional; v1 uses moving-average).
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS standard_cost_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS standard_cost_lbp numeric(18,2),
  ADD COLUMN IF NOT EXISTS min_margin_pct numeric(6,4);

ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_min_margin_pct;
ALTER TABLE items
  ADD CONSTRAINT chk_items_min_margin_pct CHECK (min_margin_pct IS NULL OR (min_margin_pct >= 0 AND min_margin_pct <= 1));

-- Lightweight "future-proof" costing method flag (not enforced in v1 flows).
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS costing_method text;

ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_costing_method;
ALTER TABLE items
  ADD CONSTRAINT chk_items_costing_method CHECK (costing_method IS NULL OR costing_method IN ('avg', 'fifo', 'standard'));

-- Tax/compliance hints (optional).
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS tax_category text,
  ADD COLUMN IF NOT EXISTS is_excise boolean NOT NULL DEFAULT false;

ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_tax_category;
ALTER TABLE items
  ADD CONSTRAINT chk_items_tax_category CHECK (tax_category IS NULL OR tax_category IN ('standard', 'zero', 'exempt'));

-- Planning helpers.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS preferred_supplier_id uuid REFERENCES suppliers(id);

CREATE INDEX IF NOT EXISTS idx_items_company_preferred_supplier
  ON items(company_id, preferred_supplier_id)
  WHERE preferred_supplier_id IS NOT NULL;

-- Logistics.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS weight numeric(18,6),
  ADD COLUMN IF NOT EXISTS volume numeric(18,6);

ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_weight;
ALTER TABLE items
  ADD CONSTRAINT chk_items_weight CHECK (weight IS NULL OR weight >= 0);

ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_volume;
ALTER TABLE items
  ADD CONSTRAINT chk_items_volume CHECK (volume IS NULL OR volume >= 0);

-- External IDs for integrations (supplier SKU, ERP code, etc).
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS external_ids jsonb;

COMMIT;

