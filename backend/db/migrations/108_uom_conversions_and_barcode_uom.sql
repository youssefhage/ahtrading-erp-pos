-- Add per-item UOM conversions and attach barcode UOM metadata.
--
-- NOTE:
-- Keep this migration lightweight for production deployments. Avoid large/locking
-- backfills and do NOT enforce NOT NULL on new columns here.

BEGIN;

-- 1) Per-item conversions: uom_code -> base factor (to_base_factor).
CREATE TABLE IF NOT EXISTS item_uom_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  uom_code text NOT NULL,
  to_base_factor numeric(18,6) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, item_id, uom_code),
  CONSTRAINT item_uom_conversions_factor_check CHECK (to_base_factor > 0)
);

-- Best-effort FK to UOM master (composite), if the table exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='unit_of_measures'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema='public'
        AND table_name='item_uom_conversions'
        AND constraint_name='item_uom_conversions_uom_fk'
    ) THEN
      ALTER TABLE item_uom_conversions
        ADD CONSTRAINT item_uom_conversions_uom_fk
        FOREIGN KEY (company_id, uom_code)
        REFERENCES unit_of_measures(company_id, code)
        DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
  END IF;
END $$;

-- RLS
ALTER TABLE item_uom_conversions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_uom_conversions_isolation ON item_uom_conversions;
CREATE POLICY item_uom_conversions_isolation
  ON item_uom_conversions USING (company_id = app_current_company_id());

-- Ensure base conversion exists for every item (uom_code = items.unit_of_measure, factor=1).
INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
SELECT gen_random_uuid(), i.company_id, i.id, i.unit_of_measure, 1, true
FROM items i
ON CONFLICT (company_id, item_id, uom_code)
DO UPDATE SET to_base_factor = EXCLUDED.to_base_factor,
              is_active = true,
              updated_at = now();

-- 2) Barcodes: record the UOM the barcode represents (optional).
ALTER TABLE item_barcodes
  ADD COLUMN IF NOT EXISTS uom_code text;

-- Backfill existing barcodes to base UOM for clarity.
UPDATE item_barcodes b
SET uom_code = i.unit_of_measure
FROM items i
WHERE i.company_id = b.company_id
  AND i.id = b.item_id
  AND COALESCE(BTRIM(b.uom_code), '') = '';

-- Best-effort FK for barcode UOM if UOM master exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='unit_of_measures'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema='public'
        AND table_name='item_barcodes'
        AND constraint_name='item_barcodes_uom_fk'
    ) THEN
      ALTER TABLE item_barcodes
        ADD CONSTRAINT item_barcodes_uom_fk
        FOREIGN KEY (company_id, uom_code)
        REFERENCES unit_of_measures(company_id, code)
        DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
  END IF;
END $$;

COMMIT;

