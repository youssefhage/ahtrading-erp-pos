-- Multi-barcode + pack-size support (scan CASE/PACK/EA barcodes in POS).

CREATE TABLE IF NOT EXISTS item_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  qty_factor numeric(18,4) NOT NULL DEFAULT 1, -- multiplier to base item UOM
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, barcode)
);

CREATE INDEX IF NOT EXISTS idx_item_barcodes_company_item ON item_barcodes(company_id, item_id);
CREATE INDEX IF NOT EXISTS idx_item_barcodes_company_barcode ON item_barcodes(company_id, barcode);

-- Reuse generic trigger from 022_catalog_timestamps.sql if present.
DROP TRIGGER IF EXISTS trg_item_barcodes_updated_at ON item_barcodes;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_item_barcodes_updated_at
      BEFORE UPDATE ON item_barcodes
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

ALTER TABLE item_barcodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_barcodes_isolation ON item_barcodes;
CREATE POLICY item_barcodes_isolation
  ON item_barcodes USING (company_id = app_current_company_id());

-- Backfill: copy legacy items.barcode into item_barcodes as primary (qty_factor=1).
INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, is_primary)
SELECT gen_random_uuid(), i.company_id, i.id, i.barcode, 1, true
FROM items i
WHERE i.barcode IS NOT NULL AND btrim(i.barcode) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM item_barcodes b
    WHERE b.company_id = i.company_id AND b.barcode = i.barcode
  );

