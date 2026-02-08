-- Minimal IFRS-style COA template stub (v1).
-- This is intentionally small: it provides a starting point for custom templates and consolidated reporting.

BEGIN;

WITH upsert_template AS (
  INSERT INTO coa_templates (id, code, name, description, default_language)
  VALUES (
    gen_random_uuid(),
    'IFRS_STUB_2026',
    'IFRS (Stub)',
    'Minimal IFRS-style template stub. Extend/customize per company.',
    'en'
  )
  ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        default_language = EXCLUDED.default_language
  RETURNING id
),
tid AS (
  SELECT id FROM upsert_template
  UNION ALL
  SELECT id FROM coa_templates WHERE code = 'IFRS_STUB_2026'
)
INSERT INTO coa_template_accounts (id, template_id, account_code, name_en, name_fr, name_ar, normal_balance_raw, is_postable_default)
VALUES
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '1000', 'ASSETS', 'ACTIFS', NULL, 'D', false),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '1100', 'CURRENT ASSETS', 'ACTIFS COURANTS', NULL, 'D', false),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '1110', 'CASH AND CASH EQUIVALENTS', 'TRESORERIE', NULL, 'D', true),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '1120', 'ACCOUNTS RECEIVABLE', 'CLIENTS', NULL, 'D', true),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '1130', 'INVENTORIES', 'STOCKS', NULL, 'D', true),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '1200', 'NON-CURRENT ASSETS', 'ACTIFS NON COURANTS', NULL, 'D', false),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '1210', 'PROPERTY, PLANT AND EQUIPMENT', 'IMMOBILISATIONS CORPORELLES', NULL, 'D', true),

  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '2000', 'LIABILITIES', 'PASSIFS', NULL, 'C', false),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '2100', 'CURRENT LIABILITIES', 'PASSIFS COURANTS', NULL, 'C', false),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '2110', 'ACCOUNTS PAYABLE', 'FOURNISSEURS', NULL, 'C', true),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '2120', 'TAX PAYABLE', 'IMPOTS A PAYER', NULL, 'C', true),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '2200', 'NON-CURRENT LIABILITIES', 'PASSIFS NON COURANTS', NULL, 'C', false),

  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '3000', 'EQUITY', 'CAPITAUX PROPRES', NULL, 'C', false),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '3100', 'RETAINED EARNINGS', 'RESULTAT REPORTE', NULL, 'C', true),

  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '4000', 'REVENUE', 'PRODUITS', NULL, 'C', false),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '4100', 'SALES REVENUE', 'CHIFFRE D''AFFAIRES', NULL, 'C', true),

  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '5000', 'EXPENSES', 'CHARGES', NULL, 'D', false),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '5100', 'COST OF SALES', 'COUT DES VENTES', NULL, 'D', true),
  (gen_random_uuid(), (SELECT id FROM tid LIMIT 1), '5200', 'OPERATING EXPENSES', 'CHARGES D''EXPLOITATION', NULL, 'D', true)
ON CONFLICT (template_id, account_code) DO NOTHING;

COMMIT;

