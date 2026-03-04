-- Add item-level overrides to price derivation rules.
-- Each override: {item_id, item_sku, item_name, mode, pct}
-- item_sku and item_name are denormalized for display; item_id is authoritative.
-- Item overrides take priority over category overrides at execution time.

ALTER TABLE price_list_derivations
  ADD COLUMN IF NOT EXISTS item_overrides jsonb NOT NULL DEFAULT '[]';
