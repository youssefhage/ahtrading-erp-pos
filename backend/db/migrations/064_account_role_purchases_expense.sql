-- Add a default account role for direct (non-receipt) supplier invoices.
-- These invoices should hit an expense/purchases account, not GRNI.

BEGIN;

INSERT INTO account_roles (code, description)
VALUES ('PURCHASES_EXPENSE', 'Purchases / Supplier Invoice Expense (no goods receipt)')
ON CONFLICT (code) DO NOTHING;

-- Best-effort default mapping: if a "Purchase of Goods" account exists (common in templates), use it.
-- We avoid overriding any existing mapping.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT DISTINCT ON (c.id) c.id, 'PURCHASES_EXPENSE', a.id
FROM companies c
JOIN company_coa_accounts a
  ON a.company_id = c.id AND a.account_code IN ('6011', '6010', '6000')
WHERE NOT EXISTS (
  SELECT 1 FROM company_account_defaults d WHERE d.company_id = c.id AND d.role_code = 'PURCHASES_EXPENSE'
)
ORDER BY c.id, CASE a.account_code WHEN '6011' THEN 1 WHEN '6010' THEN 2 ELSE 3 END;

COMMIT;
