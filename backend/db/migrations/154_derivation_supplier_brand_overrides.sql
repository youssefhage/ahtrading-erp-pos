-- Add supplier and brand override columns to price_list_derivations.
-- Format:
--   supplier_overrides: [{"supplier_id":"uuid","supplier_name":"text","mode":"exempt"|"markup_pct"|"discount_pct","pct":0.02}]
--   brand_overrides:    [{"brand":"text","mode":"exempt"|"markup_pct"|"discount_pct","pct":0.02}]
--
-- Priority order when deriving prices:
--   item override > supplier override > brand override > category override > rule default

ALTER TABLE price_list_derivations
  ADD COLUMN IF NOT EXISTS supplier_overrides jsonb NOT NULL DEFAULT '[]';

ALTER TABLE price_list_derivations
  ADD COLUMN IF NOT EXISTS brand_overrides jsonb NOT NULL DEFAULT '[]';
