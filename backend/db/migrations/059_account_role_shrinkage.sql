-- Dedicated role code for shrinkage/expiry write-offs.
-- Defaults to inventory variance account if available.

BEGIN;

INSERT INTO account_roles (code, description)
VALUES ('SHRINKAGE', 'Shrinkage / Expiry Write-offs')
ON CONFLICT (code) DO NOTHING;

-- Default mapping: if 6050 exists (inventory variance), use it; otherwise keep unmapped.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'SHRINKAGE', a.id
FROM companies c
JOIN company_coa_accounts a
  ON a.company_id = c.id AND a.account_code = '6050'
ON CONFLICT (company_id, role_code) DO NOTHING;

COMMIT;

