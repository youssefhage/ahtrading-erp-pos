-- Preserve supplier-provided item identifiers/names on purchase invoices,
-- and maintain a supplier->item alias mapping for future matching/cleanup.

BEGIN;

ALTER TABLE supplier_invoice_lines
  ADD COLUMN IF NOT EXISTS supplier_item_code text,
  ADD COLUMN IF NOT EXISTS supplier_item_name text;

CREATE TABLE IF NOT EXISTS supplier_item_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  item_id uuid NOT NULL REFERENCES items(id),
  supplier_item_code text,
  supplier_item_name text,
  normalized_code text,
  normalized_name text,
  last_unit_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  last_unit_cost_lbp numeric(18,2) NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Use code as the strongest identifier when available.
CREATE UNIQUE INDEX IF NOT EXISTS uix_supplier_item_aliases_code
  ON supplier_item_aliases(company_id, supplier_id, normalized_code)
  WHERE normalized_code IS NOT NULL AND normalized_code <> '';

CREATE INDEX IF NOT EXISTS idx_supplier_item_aliases_name
  ON supplier_item_aliases(company_id, supplier_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_supplier_item_aliases_item
  ON supplier_item_aliases(company_id, item_id);

ALTER TABLE supplier_item_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_item_aliases_isolation ON supplier_item_aliases;
CREATE POLICY supplier_item_aliases_isolation
  ON supplier_item_aliases USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_supplier_item_aliases_updated_at ON supplier_item_aliases;
CREATE TRIGGER trg_supplier_item_aliases_updated_at
  BEFORE UPDATE ON supplier_item_aliases
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

