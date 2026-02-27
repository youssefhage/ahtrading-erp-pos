-- Add FX_GAIN_LOSS account role for exchange rate differences
-- recognized when payments are settled at a different rate than the invoice.

BEGIN;

INSERT INTO account_roles (code, description)
VALUES ('FX_GAIN_LOSS', 'Foreign Exchange Gains/Losses')
ON CONFLICT (code) DO NOTHING;

-- Best-effort autofill: look for common FX gain/loss account codes in existing COA.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'FX_GAIN_LOSS', a.id
FROM companies c
JOIN company_coa_accounts a
  ON a.company_id = c.id
  AND a.account_code IN ('6060', '6061', '7060', '7061', '6900', '7900')
  AND a.is_postable = true
WHERE NOT EXISTS (
  SELECT 1 FROM company_account_defaults d
  WHERE d.company_id = c.id AND d.role_code = 'FX_GAIN_LOSS'
)
ON CONFLICT DO NOTHING;

COMMIT;
