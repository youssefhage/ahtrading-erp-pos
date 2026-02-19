-- Best-effort autofill of commonly required account defaults.
-- Prevents runtime posting failures due to missing company_account_defaults mappings.

BEGIN;

INSERT INTO account_roles (code, description) VALUES
  ('AR','Accounts Receivable'),
  ('AP','Accounts Payable'),
  ('CASH','Cash'),
  ('BANK','Bank'),
  ('SALES','Sales Revenue'),
  ('SALES_RETURNS','Sales Returns'),
  ('VAT_PAYABLE','VAT Payable'),
  ('VAT_RECOVERABLE','VAT Recoverable'),
  ('INVENTORY','Inventory'),
  ('OPENING_STOCK','Opening Stock / Opening Balances Offset'),
  ('OPENING_BALANCE','Opening Balance Offset (Equity)'),
  ('COGS','Cost of Goods Sold'),
  ('INV_ADJ','Inventory Adjustments'),
  ('SHRINKAGE','Shrinkage / Expiry Write-offs'),
  ('ROUNDING','Rounding Differences'),
  ('INTERCO_AR','Intercompany Receivable'),
  ('INTERCO_AP','Intercompany Payable'),
  ('GRNI','Goods Received Not Invoiced'),
  ('PURCHASES_EXPENSE','Purchases / Supplier Invoice Expense (no goods receipt)')
ON CONFLICT (code) DO NOTHING;

-- Ensure an opening-balance equity account exists per company.
INSERT INTO company_coa_accounts (id, company_id, account_code, name_en, name_fr, name_ar, normal_balance, is_postable)
SELECT gen_random_uuid(), c.id, '1099', 'OPENING BALANCE EQUITY', 'CAPITAL D''OUVERTURE', NULL, 'credit', true
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM company_coa_accounts a WHERE a.company_id = c.id AND a.account_code = '1099'
);

-- AR / AP.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'AR', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '4111'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'AP', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '4011'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Cash / Bank.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'CASH', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '5300'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'BANK', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '5121'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Sales.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'SALES', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '7010'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'SALES_RETURNS', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '7090'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- VAT.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'VAT_PAYABLE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '4427'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'VAT_RECOVERABLE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '4426'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Inventory and expense-side accounts.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'INVENTORY', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '3700'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT DISTINCT ON (c.id) c.id, 'COGS', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code IN ('6011', '6010', '6000')
ORDER BY c.id, CASE a.account_code WHEN '6011' THEN 1 WHEN '6010' THEN 2 ELSE 3 END
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT DISTINCT ON (c.id) c.id, 'INV_ADJ', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code IN ('6050', '6150', '6011')
ORDER BY c.id, CASE a.account_code WHEN '6050' THEN 1 WHEN '6150' THEN 2 ELSE 3 END
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT DISTINCT ON (c.id) c.id, 'SHRINKAGE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code IN ('6050', '6150', '6011')
ORDER BY c.id, CASE a.account_code WHEN '6050' THEN 1 WHEN '6150' THEN 2 ELSE 3 END
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT d.company_id, 'SHRINKAGE', d.account_id
FROM company_account_defaults d
WHERE d.role_code = 'INV_ADJ'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT DISTINCT ON (c.id) c.id, 'ROUNDING', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code IN ('6050', '6150', '6011')
ORDER BY c.id, CASE a.account_code WHEN '6050' THEN 1 WHEN '6150' THEN 2 ELSE 3 END
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT d.company_id, 'ROUNDING', d.account_id
FROM company_account_defaults d
WHERE d.role_code IN ('INV_ADJ', 'SHRINKAGE')
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Opening balances.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'OPENING_STOCK', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '1099'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'OPENING_BALANCE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '1099'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT d.company_id, 'OPENING_STOCK', d.account_id
FROM company_account_defaults d
WHERE d.role_code IN ('OPENING_BALANCE', 'INV_ADJ')
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT d.company_id, 'OPENING_BALANCE', d.account_id
FROM company_account_defaults d
WHERE d.role_code IN ('OPENING_STOCK', 'INV_ADJ')
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Purchases / GRNI.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'GRNI', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '4018'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT DISTINCT ON (c.id) c.id, 'PURCHASES_EXPENSE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code IN ('6011', '6010', '6000')
ORDER BY c.id, CASE a.account_code WHEN '6011' THEN 1 WHEN '6010' THEN 2 ELSE 3 END
ON CONFLICT (company_id, role_code) DO NOTHING;

COMMIT;
