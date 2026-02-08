-- Supplier invoice hold/unhold workflow (v1) for 3-way match variance review.

BEGIN;

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS is_on_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS hold_details jsonb,
  ADD COLUMN IF NOT EXISTS held_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS held_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_company_hold
  ON supplier_invoices(company_id, is_on_hold, created_at DESC);

COMMIT;

