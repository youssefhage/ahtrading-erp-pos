-- Seed initial companies and branches
BEGIN;

-- Company IDs are fixed to make seeds deterministic.
INSERT INTO companies (id, name, legal_name, base_currency, vat_currency, default_rate_type)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'AH Trading Official', 'AH Trading SARL', 'USD', 'LBP', 'market'),
  ('00000000-0000-0000-0000-000000000002', 'AH Trading Unofficial', 'AH Trading Unofficial', 'USD', 'LBP', 'market')
ON CONFLICT (id) DO NOTHING;

INSERT INTO branches (id, company_id, name, address)
VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Main Branch', 'Lebanon'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000002', 'Main Branch', 'Lebanon')
ON CONFLICT (id) DO NOTHING;

COMMIT;
