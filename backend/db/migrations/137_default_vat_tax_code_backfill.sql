-- Backfill explicit default VAT code so POS default-tax selection remains deterministic.
-- We preserve existing behavior by choosing the first VAT code by name when no default is set.

WITH ranked_vat AS (
  SELECT
    tc.company_id,
    tc.id AS tax_code_id,
    ROW_NUMBER() OVER (PARTITION BY tc.company_id ORDER BY tc.name, tc.id) AS rn
  FROM tax_codes tc
  WHERE tc.tax_type = 'vat'
),
missing_default AS (
  SELECT r.company_id, r.tax_code_id
  FROM ranked_vat r
  LEFT JOIN company_settings cs
    ON cs.company_id = r.company_id
   AND cs.key = 'default_vat_tax_code_id'
  WHERE r.rn = 1
    AND (cs.company_id IS NULL OR cs.value_json IS NULL)
)
INSERT INTO company_settings (company_id, key, value_json)
SELECT
  m.company_id,
  'default_vat_tax_code_id',
  to_jsonb(m.tax_code_id::text)
FROM missing_default m
ON CONFLICT (company_id, key) DO UPDATE
SET
  value_json = EXCLUDED.value_json,
  updated_at = now()
WHERE company_settings.value_json IS NULL;
