-- Unit of Measures (UOM) master data
--
-- Rationale:
-- - UOM must be controlled master data (not free-typed on each item) to avoid data drift.
-- - Items reference UOM by code (text) for simplicity.
-- - We enforce referential integrity with a composite FK on (company_id, unit_of_measure).

BEGIN;

-- Normalize existing item UOMs to a consistent code format.
UPDATE items
SET unit_of_measure = UPPER(BTRIM(unit_of_measure))
WHERE unit_of_measure IS NOT NULL;

-- Defensive: if any items have an empty UOM, coerce to EA so FK can be added safely.
UPDATE items
SET unit_of_measure = 'EA'
WHERE COALESCE(BTRIM(unit_of_measure), '') = '';

-- Defensive: keep codes short/stable; truncate any legacy free-typed values.
UPDATE items
SET unit_of_measure = LEFT(unit_of_measure, 32)
WHERE unit_of_measure IS NOT NULL AND LENGTH(unit_of_measure) > 32;

CREATE TABLE IF NOT EXISTS unit_of_measures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS unit_of_measures_company_code_uq
  ON unit_of_measures(company_id, code);

-- Ensure a base UOM exists for every company even before any items are created/imported.
INSERT INTO unit_of_measures (id, company_id, code, name, is_active)
SELECT gen_random_uuid(), c.id, 'EA', 'EA', true
FROM companies c
ON CONFLICT (company_id, code) DO NOTHING;

-- Backfill from existing items (if any).
INSERT INTO unit_of_measures (id, company_id, code, name, is_active)
SELECT gen_random_uuid(), i.company_id, i.unit_of_measure, i.unit_of_measure, true
FROM items i
WHERE COALESCE(i.unit_of_measure, '') <> ''
GROUP BY i.company_id, i.unit_of_measure
ON CONFLICT (company_id, code) DO NOTHING;

-- Enforce: items.unit_of_measure must exist in unit_of_measures.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema='public'
      AND table_name='items'
      AND constraint_name='items_uom_fk'
  ) THEN
    ALTER TABLE items
      ADD CONSTRAINT items_uom_fk
      FOREIGN KEY (company_id, unit_of_measure)
      REFERENCES unit_of_measures(company_id, code)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

COMMIT;
