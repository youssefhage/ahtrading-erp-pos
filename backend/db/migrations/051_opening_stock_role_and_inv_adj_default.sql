-- Add OPENING_STOCK account role and improve default mappings for go-live.
-- Safe + idempotent.

BEGIN;

-- Account role used by opening stock import posting (Dr INVENTORY, Cr OPENING_STOCK).
INSERT INTO account_roles (code, description)
VALUES ('OPENING_STOCK', 'Opening Stock / Opening Balances Offset')
ON CONFLICT (code) DO NOTHING;

-- Ensure a postable equity-like offset account exists per company.
-- We intentionally create a dedicated account instead of reusing SALES/COGS/INV_ADJ.
-- Code chosen to be unlikely to collide with the Lebanese template clone.
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

-- Default OPENING_STOCK mapping (do not override if already set).
INSERT INTO company_account_defaults (company_id, role_code, account_id)
SELECT c.id, 'OPENING_STOCK', a.id
FROM companies c
JOIN company_coa_accounts a ON a.company_id = c.id AND a.account_code = '1099'
ON CONFLICT (company_id, role_code) DO NOTHING;

-- Improve INV_ADJ default mapping:
-- If it's still pointing at Purchase of Goods (6011) from the dev seed, switch to Goods Inventory Variance (6050) when available.
UPDATE company_account_defaults d
SET account_id = var.id
FROM company_coa_accounts var
WHERE d.role_code = 'INV_ADJ'
  AND var.company_id = d.company_id
  AND var.account_code = '6050'
  AND EXISTS (
    SELECT 1
    FROM company_coa_accounts cur
    WHERE cur.id = d.account_id AND cur.account_code = '6011'
  );

COMMIT;
