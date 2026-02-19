-- Add ROUNDING account role + backfill a best-effort default mapping.
-- Needed for journal auto-balance of tiny dual-currency differences.

BEGIN;

INSERT INTO account_roles (code, description)
VALUES ('ROUNDING', 'Rounding Differences')
ON CONFLICT (code) DO NOTHING;

-- Prefer reusing INV_ADJ mapping if present (keeps behavior consistent per company).
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT d.company_id, 'ROUNDING', d.account_id
FROM company_account_defaults d
WHERE d.role_code = 'INV_ADJ'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Fallback to common template accounts when INV_ADJ is not mapped.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT DISTINCT ON (c.id) c.id, 'ROUNDING', a.id
FROM companies c
JOIN company_coa_accounts a
  ON a.company_id = c.id
 AND a.account_code IN ('6050', '6150', '6011')
WHERE NOT EXISTS (
  SELECT 1
  FROM company_account_defaults d
  WHERE d.company_id = c.id
    AND d.role_code = 'ROUNDING'
)
ORDER BY c.id,
  CASE a.account_code
    WHEN '6050' THEN 1
    WHEN '6150' THEN 2
    ELSE 3
  END;

COMMIT;
