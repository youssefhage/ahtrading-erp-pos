-- Support both businesses and individuals for customers/suppliers.
-- Keep it minimal and backward-compatible (name remains required).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'party_type') THEN
    CREATE TYPE party_type AS ENUM ('individual', 'business');
  END IF;
END $$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS party_type party_type NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS legal_name text NULL,
  ADD COLUMN IF NOT EXISTS tax_id text NULL,
  ADD COLUMN IF NOT EXISTS vat_no text NULL,
  ADD COLUMN IF NOT EXISTS notes text NULL;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS party_type party_type NOT NULL DEFAULT 'business',
  ADD COLUMN IF NOT EXISTS legal_name text NULL,
  ADD COLUMN IF NOT EXISTS tax_id text NULL,
  ADD COLUMN IF NOT EXISTS vat_no text NULL,
  ADD COLUMN IF NOT EXISTS notes text NULL;

-- Addresses (shared shape for customers & suppliers)
CREATE TABLE IF NOT EXISTS party_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  party_kind text NOT NULL CHECK (party_kind IN ('customer','supplier')),
  party_id uuid NOT NULL,
  label text NULL,
  line1 text NULL,
  line2 text NULL,
  city text NULL,
  region text NULL,
  country text NULL,
  postal_code text NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_party_addresses_party ON party_addresses(company_id, party_kind, party_id);
CREATE INDEX IF NOT EXISTS idx_party_addresses_default ON party_addresses(company_id, party_kind, party_id, is_default);

-- Basic FK-ish integrity using triggers is overkill for now; we validate via API.

ALTER TABLE party_addresses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS party_addresses_isolation ON party_addresses;
CREATE POLICY party_addresses_isolation ON party_addresses
  USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_party_addresses_updated_at ON party_addresses;
CREATE TRIGGER trg_party_addresses_updated_at
  BEFORE UPDATE ON party_addresses
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
