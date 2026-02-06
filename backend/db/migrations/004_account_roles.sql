-- Account role mapping for GL posting

CREATE TABLE IF NOT EXISTS account_roles (
  code text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS company_account_defaults (
  company_id uuid NOT NULL REFERENCES companies(id),
  role_code text NOT NULL REFERENCES account_roles(code),
  account_id uuid NOT NULL REFERENCES company_coa_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, role_code)
);

ALTER TABLE company_account_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_account_defaults_isolation
  ON company_account_defaults USING (company_id = app_current_company_id());
