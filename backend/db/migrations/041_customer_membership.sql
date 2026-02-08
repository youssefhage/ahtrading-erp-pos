-- Customer memberships (Costco-like) + timestamps for POS delta sync.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS membership_no text,
  ADD COLUMN IF NOT EXISTS is_member boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS membership_expires_at date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill updated_at for existing rows to keep delta sync stable.
UPDATE customers
SET updated_at = COALESCE(updated_at, created_at, now());

-- Membership number should be unique per company when provided.
CREATE UNIQUE INDEX IF NOT EXISTS uix_customers_membership_no
  ON customers(company_id, membership_no)
  WHERE membership_no IS NOT NULL AND membership_no <> '';

CREATE INDEX IF NOT EXISTS idx_customers_updated_at
  ON customers(company_id, updated_at);

-- Keep updated_at fresh on updates (only if set_updated_at exists).
DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_customers_updated_at
      BEFORE UPDATE ON customers
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

