-- Bootstrap master data for a usable dev environment (idempotent).
-- Safe to run in production too (no secrets), but review defaults before go-live.

BEGIN;

-- Default warehouse (one per company if none exist yet).
INSERT INTO warehouses (id, company_id, name, location)
SELECT gen_random_uuid(), c.id, 'Main Warehouse', 'Lebanon'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM warehouses w WHERE w.company_id = c.id
);

-- Default VAT code per company (Lebanon VAT is 11%).
INSERT INTO tax_codes (id, company_id, name, rate, tax_type, reporting_currency)
SELECT gen_random_uuid(), c.id, 'VAT 11%', 0.11, 'vat', 'LBP'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM tax_codes t WHERE t.company_id = c.id AND t.tax_type = 'vat'
);

-- Default exchange rate (fallback only; override from Admin -> Config in real use).
INSERT INTO exchange_rates (id, company_id, rate_date, rate_type, usd_to_lbp)
SELECT gen_random_uuid(), c.id, CURRENT_DATE, 'market', 90000
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM exchange_rates r WHERE r.company_id = c.id
);

-- Default account role mappings (assumes Lebanese COA template was cloned).
-- If you use a custom COA, set these via /config/account-defaults instead.

-- Opening balance equity (used as the default offset for opening stock imports).
-- We create a dedicated postable account to avoid polluting P&L accounts by default.
INSERT INTO company_coa_accounts (id, company_id, account_code, name_en, name_fr, name_ar, normal_balance, is_postable)
SELECT gen_random_uuid(), c.id, '1099', 'OPENING BALANCE EQUITY', 'CAPITAL D''OUVERTURE', 'رصيد افتتاحي', 'credit', true
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM company_coa_accounts a WHERE a.company_id = c.id AND a.account_code = '1099'
);

-- If present in the template clone, make inventory variance postable.
UPDATE company_coa_accounts
SET is_postable = true
WHERE account_code IN ('6050', '6150') AND is_postable = false;

-- Receivables / Payables
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

-- Cash / Bank
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

-- Sales
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

-- VAT
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

-- Inventory + COGS (v1: map COGS to purchases of goods).
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'INVENTORY', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '3700'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'COGS', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6011'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Inventory adjustments (v1 default): map to purchase of goods (COGS). Change in Admin -> Config in production.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'INV_ADJ', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6050'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Fallback for companies/COAs that do not have 6050.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'INV_ADJ', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6011'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Rounding differences (small FX/quantization balancing).
-- Prefer inventory variance accounts if available; fallback to purchases.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'ROUNDING', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6050'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'ROUNDING', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6150'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'ROUNDING', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6011'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Shrinkage / expiry write-offs.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'SHRINKAGE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6050'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'SHRINKAGE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6150'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'SHRINKAGE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6011'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Direct supplier invoices (no goods receipt).
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'PURCHASES_EXPENSE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6011'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'PURCHASES_EXPENSE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6010'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'PURCHASES_EXPENSE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '6000'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Intercompany defaults (reuse AR/AP by default).
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'INTERCO_AR', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '4111'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'INTERCO_AP', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '4011'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Opening stock offset (opening balances equity). Used by Inventory -> Opening Stock Import.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'OPENING_STOCK', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '1099'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Generic opening balance offset (equity). Used by Opening AR/AP imports.
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'OPENING_BALANCE', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '1099'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- GRNI (goods received, invoice pending)
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'GRNI', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '4018'
ON CONFLICT (company_id, role_code) DO NOTHING;

INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'GRNI', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '4011'
ON CONFLICT (company_id, role_code) DO NOTHING;

COMMIT;
