-- Add master-data depth for customers/suppliers: is_active + shared contacts table.

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_customers_company_active ON customers(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_company_active ON suppliers(company_id, is_active);

-- Shared contacts model for both customers and suppliers.
-- party_kind: 'customer' | 'supplier'
CREATE TABLE IF NOT EXISTS party_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  party_kind text NOT NULL,
  party_id uuid NOT NULL,
  name text NOT NULL,
  title text,
  phone text,
  email text,
  notes text,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_party_contacts_party
  ON party_contacts(company_id, party_kind, party_id);
CREATE INDEX IF NOT EXISTS idx_party_contacts_primary
  ON party_contacts(company_id, party_kind, party_id, is_primary);

ALTER TABLE party_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS party_contacts_isolation ON party_contacts;
CREATE POLICY party_contacts_isolation ON party_contacts
  USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_party_contacts_updated_at ON party_contacts;
CREATE TRIGGER trg_party_contacts_updated_at
  BEFORE UPDATE ON party_contacts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

