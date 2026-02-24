-- Ensure item_suppliers supports recency tracking used by purchasing import apply flow.

ALTER TABLE item_suppliers
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_item_suppliers_company_supplier_seen
  ON item_suppliers(company_id, supplier_id, last_seen_at DESC);
