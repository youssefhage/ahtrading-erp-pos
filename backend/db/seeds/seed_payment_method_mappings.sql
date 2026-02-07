-- Default payment methods for each company (idempotent).
-- These mappings are required for POS sale posting to find the correct debit accounts.

BEGIN;

INSERT INTO payment_method_mappings (company_id, method, role_code)
SELECT id, 'cash', 'CASH' FROM companies
ON CONFLICT (company_id, method) DO NOTHING;

INSERT INTO payment_method_mappings (company_id, method, role_code)
SELECT id, 'card', 'BANK' FROM companies
ON CONFLICT (company_id, method) DO NOTHING;

INSERT INTO payment_method_mappings (company_id, method, role_code)
SELECT id, 'bank', 'BANK' FROM companies
ON CONFLICT (company_id, method) DO NOTHING;

INSERT INTO payment_method_mappings (company_id, method, role_code)
SELECT id, 'transfer', 'BANK' FROM companies
ON CONFLICT (company_id, method) DO NOTHING;

COMMIT;

