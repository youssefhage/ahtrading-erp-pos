-- Payment method to account role mapping

CREATE TABLE IF NOT EXISTS payment_method_mappings (
  company_id uuid NOT NULL REFERENCES companies(id),
  method text NOT NULL,
  role_code text NOT NULL REFERENCES account_roles(code),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, method)
);

ALTER TABLE payment_method_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_method_mappings_isolation
  ON payment_method_mappings USING (company_id = app_current_company_id());

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
